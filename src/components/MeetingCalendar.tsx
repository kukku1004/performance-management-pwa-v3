import { useEffect, useMemo, useState } from 'react'
import type { MeetingNote, TeamMember } from '../types'
import { PanelToggleIcon } from './PanelControls'
import { connectGoogleDrive, isGoogleDriveConnected } from '../utils/googleDrive'
import { syncMeetingNotesToGoogleCalendar } from '../utils/googleCalendar'
import { useWorkspace } from '../state/WorkspaceContext'
import ConfirmDialog from './ConfirmDialog'

const COLORS = ['bg-orange-500', 'bg-green-500', 'bg-blue-500', 'bg-purple-500', 'bg-amber-500']
const COLOR_VALUES = ['#f97316', '#22c55e', '#3b82f6', '#a855f7', '#f59e0b']

function TrashIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg>
}

function CloseIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3 w-3 fill-none stroke-current" strokeWidth="2" strokeLinecap="round"><path d="m7 7 10 10M17 7 7 17" /></svg>
}

export default function MeetingCalendar({ notes, members, selectedMemberId, open, onToggle }: { notes: MeetingNote[]; members: TeamMember[]; selectedMemberId: string; open: boolean; onToggle: () => void }) {
  const { activeTeam, saveMeetingNote, deleteMeetingNote } = useWorkspace()
  const today = new Date()
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState(() => today.toISOString().slice(0, 10))
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [scheduleMemberId, setScheduleMemberId] = useState(selectedMemberId)
  const [deletingNote, setDeletingNote] = useState<MeetingNote | null>(null)
  const memberMap = useMemo(() => new Map(members.map((member) => [member.id, member])), [members])
  const scheduled = useMemo(() => [...notes].sort((a, b) => a.date.localeCompare(b.date)), [notes])
  const upcoming = scheduled.find((note) => note.date >= today.toISOString().slice(0, 10))
  const todayValue = today.toISOString().slice(0, 10)

  useEffect(() => {
    setScheduleMemberId(selectedMemberId)
  }, [selectedMemberId])

  async function syncGoogleCalendar() {
    setSyncing(true)
    setSyncMessage('')
    try {
      if (!isGoogleDriveConnected()) await connectGoogleDrive('consent')
      if (!activeTeam) throw new Error('현재 팀을 확인할 수 없습니다.')
      const result = await syncMeetingNotesToGoogleCalendar(notes, members, activeTeam)
      const prefix = result.calendarCreated ? `${result.calendarName} 생성 · ` : `${result.calendarName} · `
      setSyncMessage(result.total === 0 ? `${prefix}예정 일정 없음` : `${prefix}${result.created + result.updated}건 연동`)
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : '일정 연동 실패')
    } finally {
      setSyncing(false)
    }
  }

  async function addMeeting(date: string, memberId = scheduleMemberId) {
    if (!memberId || !date) return
    const memberName = memberMap.get(memberId)?.name ?? '팀원'
    if (notes.some((note) => note.memberId === memberId && note.date === date)) {
      setSelectedDate(date)
      setSyncMessage(`${date.slice(5).replace('-', '/')} · ${memberName} 일정이 이미 있습니다.`)
      return
    }
    const note: MeetingNote = {
      id: crypto.randomUUID(),
      memberId,
      date,
      comment: `${memberName} 면담 예정`,
    }
    saveMeetingNote(note)
    setSelectedDate(date)
    setMonth(new Date(`${date}T00:00:00`))
    setSyncMessage(`${date.slice(5).replace('-', '/')} · ${memberName} 일정 추가 완료`)
    if (isGoogleDriveConnected() && activeTeam) {
      setSyncing(true)
      try {
        const result = await syncMeetingNotesToGoogleCalendar([...notes, note], members, activeTeam)
        setSyncMessage(`${result.calendarName} · 일정 저장 완료`)
      } catch (error) {
        setSyncMessage(error instanceof Error ? error.message : '일정 연동 실패')
      } finally {
        setSyncing(false)
      }
    }
  }

  function memberColor(memberId: string) {
    const index = Math.max(0, members.findIndex((member) => member.id === memberId))
    return COLOR_VALUES[index % COLOR_VALUES.length]
  }

  if (!open) return <aside className="m-2 self-start rounded-lg border border-gray-200 bg-white p-2 text-center"><button type="button" onClick={() => { void syncGoogleCalendar() }} disabled={syncing} className="ui-button ui-button-ghost ui-button-sm w-full px-1 text-[10px]" title="Google Calendar에 면담 일정 연동">{syncing ? '연동 중' : '↻ 일정 연동'}</button><button type="button" onClick={onToggle} title="면담 일정 펼치기" aria-label="면담 일정 펼치기" className="mt-1 flex w-full flex-col items-center gap-2 rounded-md px-1 py-2 text-center text-gray-600 hover:bg-gray-50 hover:text-gray-950"><span className="inline-flex items-center gap-1 text-[11px] font-semibold"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="1.8"><path d="M6 3v3M18 3v3M4 8h16M5 5h14v15H5z"/></svg>면담</span>{upcoming ? <><span className="text-[10px] font-semibold">{upcoming.date.slice(5).replace('-', '/')}</span><span className="flex max-w-full items-center gap-1 truncate text-[9px] text-gray-500"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />{memberMap.get(upcoming.memberId)?.name}</span></> : <span className="text-[9px] text-gray-400">일정 없음</span>}</button>{syncMessage && <p className="mt-1 break-words text-[9px] leading-3 text-gray-400">{syncMessage}</p>}</aside>

  const year = month.getFullYear()
  const monthIndex = month.getMonth()
  const firstDay = new Date(year, monthIndex, 1).getDay()
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  const previousDays = new Date(year, monthIndex, 0).getDate()
  const cells = Array.from({ length: 42 }, (_, index) => {
    const dayOffset = index - firstDay + 1
    const date = dayOffset < 1 ? new Date(year, monthIndex - 1, previousDays + dayOffset) : dayOffset > daysInMonth ? new Date(year, monthIndex + 1, dayOffset - daysInMonth) : new Date(year, monthIndex, dayOffset)
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    return { date, value, current: date.getMonth() === monthIndex, hasMeeting: notes.some((note) => note.date === value) }
  })
  const selectedNotes = scheduled.filter((note) => note.date === selectedDate)

  const todayNotes = scheduled.filter((note) => note.date === todayValue)
  const futureNotes = scheduled.filter((note) => note.date > todayValue)
  const futureByDate = Array.from(futureNotes.reduce((groups, note) => {
    const dateNotes = groups.get(note.date) ?? []
    dateNotes.push(note)
    groups.set(note.date, dateNotes)
    return groups
  }, new Map<string, MeetingNote[]>()).entries()).slice(0, 6)

  return <>
    <aside className="m-2 self-start rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="shrink-0 text-base font-bold text-black">면담 일정</h3>
          <button type="button" onClick={() => { void syncGoogleCalendar() }} disabled={syncing} className="flex min-w-0 items-center gap-1 whitespace-nowrap text-xs font-medium text-gray-400 hover:text-accent disabled:opacity-50" title="팀 전용 Google Calendar에 면담 일정 연동">{syncing ? '↻ 연동 중…' : '↻ 일정 연동'}</button>
        </div>
        <button type="button" onClick={onToggle} className="shrink-0 rounded-md p-1.5 text-gray-400 hover:bg-gray-100" title="면담 일정 축소" aria-label="면담 일정 축소"><PanelToggleIcon collapsed={false} edge="right" /></button>
      </div>
      {syncMessage && <p className="mt-1 text-[11px] text-gray-400">{syncMessage}</p>}

      <div className="mt-3 flex items-center justify-between"><button type="button" onClick={() => setMonth(new Date(year, monthIndex - 1, 1))} className="flex h-7 w-7 items-center justify-center rounded-md text-lg text-gray-500 hover:bg-gray-100" aria-label="이전 달">‹</button><strong className="text-sm font-semibold text-black">{year}년 {monthIndex + 1}월</strong><button type="button" onClick={() => setMonth(new Date(year, monthIndex + 1, 1))} className="flex h-7 w-7 items-center justify-center rounded-md text-lg text-gray-500 hover:bg-gray-100" aria-label="다음 달">›</button></div>
      <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[11px] text-gray-400">{['일','월','화','수','목','금','토'].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="mt-1 grid grid-cols-7 gap-1">{cells.map((cell) => <button key={cell.value} type="button" onClick={() => setSelectedDate(cell.value)} className={`relative flex h-8 flex-col items-center justify-center rounded-md text-xs transition-colors ${cell.value === selectedDate ? 'bg-accent font-semibold text-white' : cell.current ? 'text-black hover:bg-gray-100' : 'text-gray-300 hover:bg-gray-50'}`}>{cell.date.getDate()}{cell.hasMeeting && <span className={`absolute bottom-0.5 h-1 w-1 rounded-full ${cell.value === selectedDate ? 'bg-white' : 'bg-orange-500'}`} />}</button>)}</div>

      <div className="mt-3 flex flex-wrap gap-x-2.5 gap-y-1">{members.map((member, index) => <span key={member.id} className="flex items-center gap-1 text-[11px] text-gray-500"><span className={`h-1.5 w-1.5 rounded-full ${COLORS[index % COLORS.length]}`} />{member.name}</span>)}</div>

      <section className="mt-3 border-t border-gray-200 pt-3">
        <h4 className="text-[13px] font-semibold text-black">{selectedDate.slice(5).replace('-', '/')} 면담</h4>
        {selectedNotes.length === 0 ? <p className="mt-1.5 text-[13px] text-gray-400">이 날짜에 등록된 면담이 없습니다.</p> : <div className="mt-1.5 space-y-1">{selectedNotes.map((note) => <div key={note.id} className="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-gray-100">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: memberColor(note.memberId) }} />
          <p className="min-w-0 flex-1 truncate text-[13px]"><span className="font-medium text-black">{memberMap.get(note.memberId)?.name}</span><span className="ml-1.5 text-gray-500">{note.comment || '(코멘트 없음)'}</span></p>
          <span className="h-4 w-px shrink-0 bg-gray-200" />
          <button type="button" onClick={() => setDeletingNote(note)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-white hover:text-red-500" aria-label="면담 일정 삭제" title="면담 일정 삭제"><TrashIcon /></button>
        </div>)}</div>}
        <div className="mt-1 flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5">
          <select value={scheduleMemberId} onChange={(event) => setScheduleMemberId(event.target.value)} className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-black" aria-label="면담 일정 팀원 선택">
            {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select>
          <button type="button" onClick={() => { void addMeeting(selectedDate) }} disabled={!scheduleMemberId} className="ui-button ui-button-primary h-8 shrink-0 px-3 text-xs">추가</button>
        </div>
      </section>

      <section className="mt-3 border-t border-gray-200 pt-3">
        <h4 className="text-[13px] font-semibold text-black">오늘 일정</h4>
        {todayNotes.length === 0 ? <p className="mt-1.5 text-[13px] text-gray-400">등록된 일정이 없습니다.</p> : <div className="mt-1.5 flex flex-wrap gap-1.5">{todayNotes.map((note) => <span key={note.id} className="inline-flex items-center gap-1 rounded-full bg-orange-50 py-0.5 pl-2 pr-0.5 text-xs font-semibold text-accent"><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: memberColor(note.memberId) }} />{memberMap.get(note.memberId)?.name}<span className="h-2.5 w-px bg-accent/20" /><button type="button" onClick={() => setDeletingNote(note)} className="rounded-full p-0.5 text-accent/60 hover:bg-white hover:text-red-500" aria-label="오늘 면담 일정 삭제"><CloseIcon /></button></span>)}</div>}
      </section>

      <section className="mt-3 border-t border-gray-200 pt-3">
        <h4 className="text-[13px] font-semibold text-black">이후 예정 ({futureNotes.length}건)</h4>
        {futureByDate.length === 0 ? <p className="mt-1.5 text-[13px] text-gray-400">예정된 면담이 없습니다.</p> : <div className="mt-1.5 space-y-1.5">{futureByDate.map(([date, dateNotes]) => <div key={date} className="flex items-start gap-2 text-xs"><span className="shrink-0 pt-0.5 font-medium text-gray-500">{date.slice(5).replace('-', '/')}</span><div className="flex flex-wrap gap-1">{dateNotes.map((note) => <span key={note.id} className="inline-flex items-center gap-1 rounded-full bg-gray-100 py-0.5 pl-1.5 pr-0.5 text-gray-600"><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: memberColor(note.memberId) }} />{memberMap.get(note.memberId)?.name}<span className="h-2.5 w-px bg-gray-300" /><button type="button" onClick={() => setDeletingNote(note)} className="rounded-full p-0.5 text-gray-400 hover:bg-white hover:text-red-500" aria-label={`${date.slice(5).replace('-', '/')} ${memberMap.get(note.memberId)?.name ?? ''} 면담 일정 삭제`}><CloseIcon /></button></span>)}</div></div>)}</div>}
      </section>
    </aside>
    <ConfirmDialog open={deletingNote !== null} title="면담 일정 삭제" message={`${deletingNote?.date ?? ''} ${memberMap.get(deletingNote?.memberId ?? '')?.name ?? ''} 면담 일정을 삭제하시겠습니까?`} onCancel={() => setDeletingNote(null)} onConfirm={() => { if (deletingNote) deleteMeetingNote(deletingNote.id); setDeletingNote(null) }} />
  </>
}
