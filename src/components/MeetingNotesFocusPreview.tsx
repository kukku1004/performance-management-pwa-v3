import { useMemo, useRef, useState } from 'react'
import type { MeetingNote, TeamMember } from '../types'
import Badge from './Badge'
import DisclosureIcon from './DisclosureIcon'
import MemberGrowthOverview from './MemberGrowthOverview'
import RecentPerformanceSummary from './RecentPerformanceSummary'
import MeetingCalendar from './MeetingCalendar'
import { useWorkspace } from '../state/WorkspaceContext'
import { calculatePromotionSimulation, getDefaultGrowthProfile, getMemberEvaluationHistory } from '../utils/growth'

interface MeetingNotesFocusPreviewProps {
  members: TeamMember[]
  selectedMember: TeamMember
  selectedMemberId: string
  onSelectMember: (memberId: string) => void
  notes: MeetingNote[]
  allNotes: MeetingNote[]
  insights: string[]
  newDate: string
  newComment: string
  newMood: string
  onDateChange: (value: string) => void
  onCommentChange: (value: string) => void
  onMoodChange: (value: string) => void
  onAdd: () => void
  onEdit: (note: MeetingNote) => void
  onDelete: (note: MeetingNote) => void
  getMemberGrade: (memberId: string) => string | null
}

const MOODS = ['😄', '😊', '🙂', '😐', '🙁', '😢', '😣', '😩', '😭']

export default function MeetingNotesFocusPreview({
  members, selectedMember, selectedMemberId, onSelectMember, notes, allNotes, insights,
  newDate, newComment, newMood, onDateChange, onCommentChange, onMoodChange,
  onAdd, onEdit, onDelete, getMemberGrade,
}: MeetingNotesFocusPreviewProps) {
  const { workspace, activeTeam, saveGrowthProfile } = useWorkspace()
  const [insightsOpen, setInsightsOpen] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(true)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(notes[0]?.id ?? null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [noteAdding, setNoteAdding] = useState(false)
  const [noteInput, setNoteInput] = useState('')
  const [noteColorPicker, setNoteColorPicker] = useState<string | null>(null)
  const [referencePanelsMinimized, setReferencePanelsMinimized] = useState(false)
  const layoutRef = useRef<HTMLDivElement>(null)
  const [timelineWidth, setTimelineWidth] = useState(92)
  const [documentWidth, setDocumentWidth] = useState(700)
  const sortedNotes = useMemo(() => [...notes].sort((a, b) => b.date.localeCompare(a.date)), [notes])
  const selectedNote = sortedNotes.find((note) => note.id === selectedNoteId) ?? null
  const storedProfile = activeTeam?.growthProfiles.find((profile) => profile.memberId === selectedMemberId) ?? getDefaultGrowthProfile(selectedMemberId)
  const evaluationHistory = activeTeam ? getMemberEvaluationHistory(workspace, activeTeam.id, selectedMemberId) : []
  const currentSimulation = calculatePromotionSimulation(evaluationHistory, { ...storedProfile, performanceHistory: [] }, selectedMember.level)
  const expectedSimulation = calculatePromotionSimulation(evaluationHistory, storedProfile, selectedMember.level)
  const expectedGap = Math.round((expectedSimulation.currentScore - expectedSimulation.targetScore) * 10) / 10
  const personalNotes = (storedProfile.personalNotes ?? []).map((note, index) => typeof note === 'string' ? { id: `legacy-${index}`, content: note, color: 'gray' as const } : note)

  function savePersonalNotes(next: typeof personalNotes) {
    saveGrowthProfile({ ...storedProfile, personalNotes: next })
  }

  function addPersonalNote(event: React.FormEvent) {
    event.preventDefault()
    const content = noteInput.trim()
    if (!content) return
    savePersonalNotes([...personalNotes, { id: `${Date.now()}-${Math.random()}`, content, color: 'gray', starred: false }])
    setNoteInput('')
    setNoteAdding(false)
  }

  function startResize(side: 'timeline' | 'document', event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    const startX = event.clientX
    const startTimeline = timelineWidth
    const startDocument = documentWidth
    const available = layoutRef.current?.clientWidth ?? 1440
    function move(moveEvent: PointerEvent) {
      const delta = moveEvent.clientX - startX
      if (side === 'timeline') {
        const next = Math.max(92, Math.min(360, startTimeline + delta))
        setTimelineWidth(next)
        setDocumentWidth(Math.max(440, Math.min(900, startDocument - (next - startTimeline))))
      } else {
        setDocumentWidth(Math.max(440, Math.min(Math.max(440, available - timelineWidth - 220), startDocument + delta)))
      }
    }
    function up() { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return <div className="meeting-focus-shell">
    <div className="meeting-focus-members" role="tablist" aria-label="면담 팀원 선택">
      {members.map((member) => <button key={member.id} type="button" role="tab" aria-selected={member.id === selectedMemberId} onClick={() => onSelectMember(member.id)} className={`meeting-focus-member-tab ${member.id === selectedMemberId ? 'meeting-focus-member-tab-active' : ''}`}>
        {getMemberGrade(member.id) && <Badge tone="neutral" className="shrink-0 bg-white text-gray-900">{getMemberGrade(member.id)}</Badge>}
        <span className="truncate">{member.name}</span>
      </button>)}
    </div>

    <div ref={layoutRef} className={`meeting-focus-workspace ${referencePanelsMinimized ? 'meeting-focus-workspace-expanded' : ''}`} style={{ gridTemplateColumns: referencePanelsMinimized
      ? `${calendarOpen ? Math.max(320, timelineWidth) : timelineWidth}px 6px minmax(720px, 1fr) 6px 98px`
      : `${calendarOpen ? Math.max(320, timelineWidth) : timelineWidth}px 6px minmax(440px, ${documentWidth}px) 6px minmax(220px, 1fr)` }}>
      <aside className="meeting-focus-timeline">
        <MeetingCalendar notes={allNotes} members={members} open={calendarOpen} onToggle={() => setCalendarOpen((value) => !value)} />
        <div className="mb-4 mt-3 flex items-center justify-between"><p className="text-xs font-semibold text-gray-600">면담 히스토리</p><span className="text-[10px] text-gray-400">{sortedNotes.length}건</span></div>
        <div className="meeting-focus-history-rail">
          {sortedNotes.length === 0 ? <p className="py-3 pl-5 text-xs text-gray-400">기록 없음</p> : sortedNotes.map((note, index) => <button key={note.id} type="button" onClick={() => setSelectedNoteId(note.id)} aria-label={`${note.date} 면담 상세보기`} className={`meeting-focus-history-mark group ${selectedNoteId === note.id ? 'meeting-focus-history-mark-active' : ''}`}>
            <span className="meeting-focus-history-tick" />
            <span className="meeting-focus-history-date">{note.date.slice(5).replace('-', '/')}</span>
            <span className="meeting-focus-history-tooltip"><span className="flex items-center justify-between gap-3"><strong>{note.date}</strong>{note.mood && <span>{note.mood}</span>}</span><span className="mt-1 block line-clamp-2 font-normal text-gray-500">{note.comment}</span><span className="mt-2 block text-[10px] font-semibold text-orange-600">클릭하여 상세보기</span>{index === 0 && <Badge tone="neutral" className="mt-2">최근 면담</Badge>}</span>
          </button>)}
        </div>
      </aside>

      <button type="button" aria-label="면담 히스토리와 면담일지 영역 너비 조절" onPointerDown={(event) => startResize('timeline', event)} className="meeting-focus-splitter"><span /></button>

      <main className="meeting-focus-document">
        <section className="meeting-focus-summary">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2"><h2 className="text-xl font-semibold text-gray-950">{selectedMember.name}</h2><span className="text-sm text-gray-500">{selectedMember.level || '직급 미설정'} · {selectedMember.yearsOfService ?? '-'}년차</span></div>
            <div className="mt-3 flex flex-wrap items-center gap-2">{personalNotes.map((note) => { const colors = { gray: 'bg-gray-400', orange: 'bg-orange-500', blue: 'bg-blue-500', green: 'bg-green-500', violet: 'bg-violet-500' }; return <span key={note.id} className="relative inline-flex max-w-56 items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700"><button type="button" onClick={() => savePersonalNotes(personalNotes.map((item) => item.id === note.id ? { ...item, starred: !item.starred } : item))} title={note.starred ? '즐겨찾기 해제' : '즐겨찾기'} aria-label={note.starred ? `${note.content} 즐겨찾기 해제` : `${note.content} 즐겨찾기`} className={note.starred ? 'text-orange-500' : 'text-gray-300 hover:text-gray-500'}>★</button><button type="button" onClick={() => setNoteColorPicker((value) => value === note.id ? null : note.id)} title="메모 색상 변경" aria-label={`${note.content} 색상 변경`} className={`h-2.5 w-2.5 rounded-full ${colors[note.color]}`} /><span className="truncate">{note.content}</span><button type="button" onClick={() => savePersonalNotes(personalNotes.filter((item) => item.id !== note.id))} title="메모 삭제" aria-label={`${note.content} 삭제`} className="ml-0.5 text-gray-400 hover:text-gray-950">×</button>{noteColorPicker === note.id && <span className="absolute left-5 top-full z-50 mt-1 flex gap-1 rounded-md border border-gray-200 bg-white p-2 shadow-sm">{(Object.keys(colors) as Array<keyof typeof colors>).map((color) => <button key={color} type="button" onClick={() => { savePersonalNotes(personalNotes.map((item) => item.id === note.id ? { ...item, color } : item)); setNoteColorPicker(null) }} aria-label={`${color} 색상 지정`} className={`h-4 w-4 rounded-full ring-1 ring-black/10 ${colors[color]} ${note.color === color ? 'ring-2 ring-gray-950 ring-offset-1' : ''}`} />)}</span>}</span> })}{noteAdding ? <form onSubmit={addPersonalNote} className="flex items-center gap-1"><input autoFocus value={noteInput} onChange={(event) => setNoteInput(event.target.value)} onBlur={() => { if (!noteInput.trim()) setNoteAdding(false) }} className="ui-field ui-field-sm w-40" placeholder="팀원 메모" /><button type="submit" className="ui-button ui-button-secondary ui-button-sm">추가</button></form> : <button type="button" onClick={() => setNoteAdding(true)} className="rounded-full border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-500">+ 메모</button>}</div>
          </div>
          <div className="meeting-focus-score-grid">
            <div><p>목표 점수</p><strong>{expectedSimulation.targetScore}점</strong></div>
            <div><p>현재 점수</p><strong>{currentSimulation.currentScore}점</strong></div>
            <div><p>최종 기대 점수</p><span className="flex flex-wrap items-baseline gap-1.5"><strong>{expectedSimulation.currentScore}점</strong><em className={expectedGap >= 0 ? 'text-emerald-600' : 'text-orange-600'}>{expectedGap >= 0 ? `+${expectedGap}점 충족` : `-${Math.abs(expectedGap)}점 필요`}</em></span></div>
          </div>
        </section>

        <div className={`meeting-focus-content ${referencePanelsMinimized ? 'meeting-focus-content-expanded' : ''}`}>
        <div className="meeting-focus-compose">
        <section className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="ui-section-title">면담일지</h3><input type="date" value={newDate} onChange={(event) => onDateChange(event.target.value)} className="ui-field w-auto" /></div>
          <textarea value={newComment} onChange={(event) => onCommentChange(event.target.value)} rows={7} placeholder="면담 내용을 입력하세요." className="ui-field mt-3 resize-y" />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-1" aria-label="면담 분위기">{MOODS.map((mood) => <button key={mood} type="button" onClick={() => onMoodChange(newMood === mood ? '' : mood)} className={`flex h-8 w-8 items-center justify-center rounded-md border ${newMood === mood ? 'border-orange-400 bg-orange-50' : 'border-transparent hover:border-gray-200'}`}>{mood}</button>)}</div><button type="button" onClick={onAdd} disabled={!newComment.trim()} className="ui-button ui-button-primary">작성하기</button></div>
        </section>
        </div>

        <div className="meeting-focus-context">

        {insights.length > 0 && <section className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4">
          <button type="button" onClick={() => setInsightsOpen((value) => !value)} className="flex w-full items-center justify-between py-3 text-left"><h3 className="text-sm font-semibold text-amber-950">면담 인사이트</h3><DisclosureIcon open={insightsOpen} className="h-4 w-4 text-amber-700" /></button>
          {insightsOpen && <ul className="space-y-2 pb-4 text-sm leading-5 text-amber-950/80">{insights.map((insight) => <li key={insight} className="flex gap-2"><span className="text-orange-600">•</span><span>{insight}</span></li>)}</ul>}
        </section>}

        <section className="mt-7">
          <button type="button" onClick={() => setHistoryOpen((value) => !value)} className="flex w-full items-center justify-between border-b border-gray-200 pb-3 text-left"><span className="flex items-center gap-2"><h3 className="ui-section-title">면담 기록</h3><span className="text-xs text-gray-400">{sortedNotes.length}건</span></span><DisclosureIcon open={historyOpen} className="h-4 w-4 text-gray-500" /></button>
          {historyOpen && <div className="divide-y divide-gray-100">{sortedNotes.map((note) => <article key={note.id} className="py-4"><div className="flex items-start justify-between gap-3"><div><strong className="text-sm text-gray-950">{note.mood && <span className="mr-2">{note.mood}</span>}{note.date}</strong><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">{note.comment}</p></div><div className="flex shrink-0 gap-1"><button type="button" onClick={() => onEdit(note)} className="ui-button ui-button-ghost ui-button-sm h-8 w-8 px-0" title="수정" aria-label={`${note.date} 면담 수정`}><svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8"><path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" /></svg></button><button type="button" onClick={() => onDelete(note)} className="ui-button ui-button-danger ui-button-sm h-8 w-8 px-0" title="삭제" aria-label={`${note.date} 면담 삭제`}><svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg></button><button type="button" onClick={() => window.print()} className="ui-button ui-button-ghost ui-button-sm h-8 w-8 px-0" title="출력" aria-label={`${note.date} 면담 출력`}><svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8"><path d="M7 9V4h10v5M7 17H5V9h14v8h-2M7 14h10v6H7z" /></svg></button></div></div></article>)}</div>}
        </section>

        {selectedNote && <section className="mt-8 border-t border-gray-200 pt-5 print:block"><p className="text-xs font-medium text-gray-400">선택한 면담 상세</p><div className="mt-2 flex items-center gap-2"><strong>{selectedNote.date}</strong>{selectedNote.mood && <span>{selectedNote.mood}</span>}</div><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-700">{selectedNote.comment}</p></section>}
        </div>
        </div>
      </main>
      <button type="button" aria-label="면담일지와 성과·성장 영역 너비 조절" onPointerDown={(event) => startResize('document', event)} className="meeting-focus-splitter"><span /></button>
      <aside className="meeting-focus-reference"><MemberGrowthOverview member={selectedMember} compact collapsible hideSummary onPanelMinimizedChange={setReferencePanelsMinimized} collapsedContent={<RecentPerformanceSummary member={selectedMember} />} /></aside>
    </div>
  </div>
}
