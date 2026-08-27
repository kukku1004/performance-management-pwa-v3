import type { MeetingNote, TeamMember } from '../types'
import { googleAuthorizedFetch } from './googleDrive'

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
const APP_ID = 'performance-management-pwa-v3'

interface GoogleCalendar {
  id: string
  summary?: string
  description?: string
}

interface CalendarList {
  items?: GoogleCalendar[]
}

interface CalendarEvent {
  id: string
  extendedProperties?: { private?: { meetingNoteId?: string } }
}

interface CalendarEventList {
  items?: CalendarEvent[]
}

function nextDate(date: string) {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + 1)
  return value.toISOString().slice(0, 10)
}

async function ensureTeamMeetingCalendar(teamId: string, teamName: string) {
  const marker = `${APP_ID}:team:${teamId}`
  const params = new URLSearchParams({ maxResults: '250' })
  const calendars = await googleAuthorizedFetch<CalendarList>(`${CALENDAR_API}/users/me/calendarList?${params}`)
  const existing = calendars.items?.find((calendar) => calendar.description?.includes(marker))
  if (existing) return { calendar: existing, created: false }

  const calendar = await googleAuthorizedFetch<GoogleCalendar>(`${CALENDAR_API}/calendars`, {
    method: 'POST',
    body: JSON.stringify({
      summary: `${teamName} 면담`,
      description: `${teamName} 팀의 면담 일정 · ${marker}`,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul',
    }),
  })
  return { calendar, created: true }
}

export async function syncMeetingNotesToGoogleCalendar(notes: MeetingNote[], members: TeamMember[], team: { id: string; name: string }) {
  const today = new Date().toISOString().slice(0, 10)
  const scheduled = notes.filter((note) => note.date >= today)
  const memberMap = new Map(members.map((member) => [member.id, member]))
  const { calendar, created: calendarCreated } = await ensureTeamMeetingCalendar(team.id, team.name)
  const eventsApi = `${CALENDAR_API}/calendars/${encodeURIComponent(calendar.id)}/events`
  const params = new URLSearchParams({
    privateExtendedProperty: `appId=${APP_ID}`,
    maxResults: '2500',
    singleEvents: 'true',
  })
  const existing = await googleAuthorizedFetch<CalendarEventList>(`${eventsApi}?${params}`)
  const eventByNoteId = new Map((existing.items ?? []).flatMap((event) => {
    const noteId = event.extendedProperties?.private?.meetingNoteId
    return noteId ? [[noteId, event] as const] : []
  }))

  let created = 0
  let updated = 0
  for (const note of scheduled) {
    const memberName = memberMap.get(note.memberId)?.name ?? '팀원'
    const body = {
      summary: `${memberName} 면담`,
      description: note.comment,
      start: { date: note.date },
      end: { date: nextDate(note.date) },
      extendedProperties: { private: { appId: APP_ID, meetingNoteId: note.id } },
    }
    const event = eventByNoteId.get(note.id)
    if (event) {
      await googleAuthorizedFetch(`${eventsApi}/${encodeURIComponent(event.id)}`, { method: 'PATCH', body: JSON.stringify(body) })
      updated += 1
    } else {
      await googleAuthorizedFetch(eventsApi, { method: 'POST', body: JSON.stringify(body) })
      created += 1
    }
  }
  return { created, updated, total: scheduled.length, calendarCreated, calendarName: calendar.summary ?? `${team.name} 면담` }
}
