import { useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useAppState } from '../state/AppContext'
import type { MeetingNote, TeamMember } from '../types'
import ConfirmDialog from './ConfirmDialog'
import { useWorkspace } from '../state/WorkspaceContext'
import MemberGrowthOverview from './MemberGrowthOverview'
import MeetingCalendar from './MeetingCalendar'
import RecentPerformanceSummary from './RecentPerformanceSummary'
import Badge from './Badge'
import { getMemberEvaluationHistory, getRecentMemberPerformance } from '../utils/growth'
import { parseGrowthHistoryWorkbook } from '../utils/growthExcel'
import ExpandCollapseIcon from './ExpandCollapseIcon'
import DisclosureIcon from './DisclosureIcon'
import MeetingNotesFocusPreview from './MeetingNotesFocusPreview'

function todayString() {
  return new Date().toISOString().slice(0, 10)
}

const MEETING_MOODS = [
  { emoji: '😄', label: '매우 좋음' }, { emoji: '😊', label: '좋음' }, { emoji: '🙂', label: '편안함' },
  { emoji: '😐', label: '보통' }, { emoji: '🙁', label: '아쉬움' }, { emoji: '😢', label: '슬픔' },
  { emoji: '😣', label: '힘듦' }, { emoji: '😩', label: '매우 힘듦' }, { emoji: '😭', label: '눈물' },
] as const

function MoodSelector({ value, onChange, compact = false }: { value: string; onChange: (value: string) => void; compact?: boolean }) {
  return <div className={`grid grid-cols-3 ${compact ? 'gap-0.5' : 'gap-1'}`} role="radiogroup" aria-label="면담 분위기">
    {MEETING_MOODS.map((mood) => <button key={mood.emoji} type="button" role="radio" aria-checked={value === mood.emoji} aria-label={mood.label} title={mood.label} onClick={() => onChange(value === mood.emoji ? '' : mood.emoji)} className={`flex items-center justify-center rounded-md border text-base transition ${compact ? 'h-7 w-7' : 'h-8 w-8'} ${value === mood.emoji ? 'border-orange-400 bg-orange-50' : 'border-transparent bg-white hover:border-gray-200 hover:bg-gray-50'}`}>{mood.emoji}</button>)}
  </div>
}

export default function MeetingNotes() {
  const { state } = useAppState()
  const { workspace, activeTeam, saveMeetingNote, deleteMeetingNote, saveGrowthProfile } = useWorkspace()
  const members = state.members
  const currentMemberIds = new Set(members.map((member) => member.id))
  const meetingNotes = (activeTeam?.meetingNotes ?? state.meetingNotes).filter((note) => currentMemberIds.has(note.memberId))

  const [selectedMemberId, setSelectedMemberId] = useState(members[0]?.id ?? '')
  const [newDate, setNewDate] = useState(todayString())
  const [newComment, setNewComment] = useState('')
  const [newMood, setNewMood] = useState('')

  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editDate, setEditDate] = useState('')
  const [editComment, setEditComment] = useState('')
  const [editMood, setEditMood] = useState('')

  const [deletingNote, setDeletingNote] = useState<MeetingNote | null>(null)

  const [growthImportMessage, setGrowthImportMessage] = useState('')
  const growthFileInputRef = useRef<HTMLInputElement>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const [leftWidth, setLeftWidth] = useState(440)
  const [centerWidth, setCenterWidth] = useState(520)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [insightsOpen, setInsightsOpen] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(true)
  const [meetingPanelMinimized, setMeetingPanelMinimized] = useState(false)
  const [growthPanelsMinimized, setGrowthPanelsMinimized] = useState(false)
  const [, setGrowthExpanded] = useState(true)
  const [comparisonView, setComparisonView] = useState<'current' | 'improved'>('current')

  function startResize(side: 'left' | 'right', event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    const startX = event.clientX
    const startLeft = leftWidth
    const startCenter = centerWidth
    const containerWidth = workspaceRef.current?.clientWidth ?? 1200
    function handleMove(moveEvent: PointerEvent) {
      const delta = moveEvent.clientX - startX
      if (side === 'left') {
        const nextLeft = Math.max(240, Math.min(760, startLeft + delta))
        setLeftWidth(nextLeft)
        setCenterWidth(Math.max(440, Math.min(820, startCenter - (nextLeft - startLeft))))
      } else {
        setCenterWidth(Math.max(360, Math.min(containerWidth - leftWidth - 520, startCenter + delta)))
      }
    }
    function handleUp() {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  useEffect(() => {
    if (!members.some((member) => member.id === selectedMemberId)) setSelectedMemberId(members[0]?.id ?? '')
  }, [members, selectedMemberId])

  const selectedMember: TeamMember | undefined = members.find((m) => m.id === selectedMemberId)
  const notesForMember = meetingNotes
    .filter((n) => n.memberId === selectedMemberId)
    .sort((a, b) => b.date.localeCompare(a.date))
  const selectedProfile = activeTeam?.growthProfiles.find((profile) => profile.memberId === selectedMemberId)
  const selectedPerformance = activeTeam ? getRecentMemberPerformance(workspace, activeTeam.id, selectedMemberId) : null
  const meetingInsights = [
    ...(selectedProfile?.personalNotes ?? []).map((note) => typeof note === 'string' ? note : note.content),
    ...(selectedPerformance ? [
      `${selectedPerformance.latest.grade} 고과에서 본인이 가장 의미 있게 느낀 결과와 다음 목표를 확인해 보세요.`,
      selectedPerformance.majorTasks.length > 0 ? `${selectedPerformance.majorTasks.map((task) => task.name).join(', ')}에서 맡은 역할과 지원이 필요한 부분을 확인해 보세요.` : '최근 평가기간의 주요 업무와 성과 근거를 확인해 보세요.',
    ] : []),
  ]

  function getMemberTabStatus(memberId: string) {
    const now = new Date()
    const history = activeTeam ? getMemberEvaluationHistory(workspace, activeTeam.id, memberId) : []
    const grade = history.find((item) => item.year === now.getFullYear())?.grade ?? null
    const profile = activeTeam?.growthProfiles.find((item) => item.memberId === memberId)
    const reviewDate = profile?.promotionReviewDate ? new Date(`${profile.promotionReviewDate}-01T00:00:00`) : null
    const daysToReview = reviewDate ? Math.ceil((reviewDate.getTime() - now.getTime()) / 86400000) : null
    const promotionSoon = daysToReview !== null && daysToReview >= 0 && daysToReview <= 90
    const memberNotes = meetingNotes.filter((note) => note.memberId === memberId)
    const upcoming = memberNotes.filter((note) => new Date(`${note.date}T23:59:59`) >= now).sort((a, b) => a.date.localeCompare(b.date))[0]
    const recentCutoff = new Date(now); recentCutoff.setDate(recentCutoff.getDate() - 90)
    const hasRecent = memberNotes.some((note) => { const date = new Date(`${note.date}T00:00:00`); return date >= recentCutoff && date <= now })
    return { grade, promotionSoon, upcoming, needsMeeting: !upcoming && !hasRecent }
  }

  function handleAdd() {
    if (!selectedMemberId || !newDate || !newComment.trim()) return
    saveMeetingNote({ id: uuidv4(), memberId: selectedMemberId, date: newDate, comment: newComment.trim(), ...(newMood ? { mood: newMood } : {}) })
    setNewComment('')
    setNewMood('')
  }

  function startEdit(note: MeetingNote) {
    setEditingNoteId(note.id)
    setEditDate(note.date)
    setEditComment(note.comment)
    setEditMood(note.mood ?? '')
  }

  function cancelEdit() {
    setEditingNoteId(null)
  }

  function saveEdit(note: MeetingNote) {
    if (!editDate || !editComment.trim()) return
    saveMeetingNote({ ...note, date: editDate, comment: editComment.trim(), mood: editMood || undefined })
    setEditingNoteId(null)
  }

  function handleDeleteConfirm() {
    if (deletingNote) {
      deleteMeetingNote(deletingNote.id)
      setDeletingNote(null)
    }
  }

  async function handleGrowthFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !activeTeam) return
    const result = parseGrowthHistoryWorkbook(await file.arrayBuffer(), members, activeTeam.growthProfiles)
    result.profiles.forEach((profile) => saveGrowthProfile(profile))
    setGrowthImportMessage(result.importedMembers.length > 0 ? `${result.importedMembers.length}명 성과 이력 반영: ${result.importedMembers.join(', ')}` : result.errors[0] ?? '반영된 이력이 없습니다.')
  }

  function renderHistoryItem(note: MeetingNote, index: number) {
    return <div key={note.id} className="relative pb-6 last:pb-0">{note.mood ? <span className="absolute -left-[34px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white text-base" title="저장된 면담 분위기">{note.mood}</span> : <span className={`absolute -left-[29px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white ${index === 0 ? 'bg-gray-950 ring-2 ring-gray-950/15' : 'bg-gray-400'}`} />}<span className="absolute -left-6 top-[10px] h-px w-4 bg-gray-300" />
      {editingNoteId === note.id ? <div className="flex flex-wrap items-start gap-2 rounded-md border border-gray-200 p-3"><input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} className="ui-field w-auto" /><textarea value={editComment} onChange={(e) => setEditComment(e.target.value)} rows={2} className="ui-field min-w-[240px] flex-1" /><MoodSelector value={editMood} onChange={setEditMood} compact /><div className="flex gap-2"><button onClick={() => saveEdit(note)} disabled={!editComment.trim()} className="ui-button ui-button-primary ui-button-sm">저장</button><button onClick={cancelEdit} className="ui-button ui-button-secondary ui-button-sm">취소</button></div></div> : <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 pb-5"><div className="min-w-0 flex-1"><p className={`text-xs font-semibold ${index === 0 ? 'text-gray-950' : 'text-gray-500'}`}>{note.date}{index === 0 && <span className="ml-2 font-normal text-gray-400">최근 면담</span>}</p><p className="mt-1 whitespace-pre-wrap text-sm text-black">{note.comment}</p></div><div className="flex shrink-0 gap-2"><button onClick={() => startEdit(note)} className="ui-button ui-button-secondary ui-button-sm">수정</button><button onClick={() => setDeletingNote(note)} className="ui-button ui-button-danger ui-button-sm">삭제</button></div></div>}
    </div>
  }

  return (
    <div className="ui-page">
      {members.length === 0 ? (
        <p className="ui-empty">
          등록된 팀원이 없습니다. 팀원 관리에서 먼저 팀원을 등록하세요.
        </p>
      ) : (
        <div className="-mt-5 overflow-hidden bg-white">
          {comparisonView === 'improved' && selectedMember ? <MeetingNotesFocusPreview
            members={members}
            selectedMember={selectedMember}
            selectedMemberId={selectedMemberId}
            onSelectMember={setSelectedMemberId}
            notes={notesForMember}
            insights={meetingInsights}
            newDate={newDate}
            newComment={newComment}
            newMood={newMood}
            onDateChange={setNewDate}
            onCommentChange={setNewComment}
            onMoodChange={setNewMood}
            onAdd={handleAdd}
            onEdit={startEdit}
            onDelete={setDeletingNote}
            getMemberGrade={(memberId) => getMemberTabStatus(memberId).grade}
          /> : <>
          <div className="flex h-12 items-end border-b border-gray-200 bg-white px-1"><div className="flex min-w-0 flex-1 items-end gap-1" role="tablist" aria-label="면담 팀원 선택">
              {members.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  role="tab"
                  aria-selected={member.id === selectedMemberId}
                  onClick={() => setSelectedMemberId(member.id)}
                  className={`relative inline-flex h-11 w-[200px] min-w-0 max-w-[200px] flex-[1_1_200px] items-center justify-center overflow-hidden rounded-t-lg px-2 text-center text-sm font-medium transition-colors ${member.id === selectedMemberId ? 'z-10 -mb-px border border-gray-950 bg-gray-950 text-white' : 'border border-gray-200 border-b-0 bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-900'}`}
                >
                  {(() => { const status = getMemberTabStatus(member.id); return status.grade ? <Badge tone="neutral" className="mr-1.5 shrink-0 bg-white text-gray-900">{status.grade}</Badge> : null })()}
                  <span className="truncate">{member.name}</span>
                  {(() => { const status = getMemberTabStatus(member.id); return <span className="ml-2 inline-flex items-center gap-1.5">
                    {status.upcoming && <span title={`면담 예정 ${status.upcoming.date}`} className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-700"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-3 w-3 fill-none stroke-current" strokeWidth="1.8"><path d="M6 3v3M18 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1z" /></svg>{status.upcoming.date.slice(5).replace('-', '/')}</span>}
                  </span> })()}
                </button>
              ))}
          </div><div className="flex shrink-0 items-center gap-2 pb-1 pl-3"><span className="max-w-40 truncate text-xs text-gray-500">{growthImportMessage}</span><input ref={growthFileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleGrowthFileSelected} /><button type="button" onClick={() => growthFileInputRef.current?.click()} className="ui-button ui-button-secondary ui-button-sm"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8"><path d="M12 16V4M7 9l5-5 5 5M5 14v6h14v-6"/></svg>성과 가져오기</button></div></div>
          <div
            ref={workspaceRef}
            className="grid h-[calc(100vh-10rem)] min-h-[620px] items-stretch overflow-hidden"
            style={{ gridTemplateColumns: meetingPanelMinimized
              ? `minmax(0,1fr) 0 0 6px 48px 1px ${calendarOpen ? 320 : 92}px`
              : `${growthPanelsMinimized ? 97 : leftWidth + centerWidth + 6}px 0 0 6px minmax(420px, 1fr) 1px ${calendarOpen ? 320 : 92}px` }}
          >
          <aside className={`min-w-0 overflow-y-auto ${growthPanelsMinimized ? 'px-0 pb-4 pt-0' : 'px-4 pb-4 pt-5'}`}>
            {selectedMember && <MemberGrowthOverview member={selectedMember} compact collapsible onExpandedChange={setGrowthExpanded} onPanelMinimizedChange={setGrowthPanelsMinimized} collapsedContent={<RecentPerformanceSummary member={selectedMember} />} />}
          </aside>
          <span aria-hidden="true" />
          <main className={`relative col-start-5 row-start-1 min-w-0 overflow-y-auto ${meetingPanelMinimized ? 'px-1 py-3' : 'px-5 pb-5 pt-5'}`}>
          {meetingPanelMinimized ? <button type="button" onClick={() => setMeetingPanelMinimized(false)} title="면담 영역 복원" aria-label="면담 영역 복원" className="flex w-full flex-col items-center gap-3 py-2 text-gray-500 hover:text-gray-950"><ExpandCollapseIcon expanded={false} className="h-4 w-4"/><span className="text-xs font-semibold [writing-mode:vertical-rl]">면담</span></button> : <>
          <button type="button" onClick={() => setMeetingPanelMinimized(true)} title="면담 영역 최소화" aria-label="면담 영역 최소화" className="ui-button ui-button-ghost ui-button-sm absolute right-5 top-4 z-10 h-8 w-8 px-0"><ExpandCollapseIcon expanded className="h-4 w-4" /></button>
          <div className={`meeting-responsive ${growthPanelsMinimized ? 'meeting-responsive-wide' : ''}`}>
          <div className="contents">
          {meetingInsights.length > 0 && <div className="meeting-responsive-insights rounded-lg border border-amber-200 bg-amber-50 px-4"><button type="button" onClick={() => setInsightsOpen((value) => !value)} className="flex w-full items-center justify-between py-3 text-left" title={insightsOpen ? '면담 인사이트 접기' : '면담 인사이트 펼치기'} aria-label={insightsOpen ? '면담 인사이트 접기' : '면담 인사이트 펼치기'}><h3 className="ui-section-title text-amber-950">면담 인사이트</h3><DisclosureIcon open={insightsOpen} className="h-4 w-4 text-amber-700" /></button>{insightsOpen && <ul className="space-y-2 pb-4 text-sm leading-5 text-amber-950/80">{meetingInsights.map((insight) => <li key={insight} className="flex gap-2"><span className="text-orange-600">•</span><span>{insight}</span></li>)}</ul>}</div>}

          <div className="meeting-responsive-history min-w-0">
          <button type="button" onClick={() => setHistoryOpen((value) => !value)} className="flex w-full items-center justify-between border-t border-gray-200 pt-4 text-left" title={historyOpen ? '면담 기록 접기' : '면담 기록 펼치기'} aria-label={historyOpen ? '면담 기록 접기' : '면담 기록 펼치기'}><span className="flex items-center gap-2"><h3 className="ui-section-title">면담 기록</h3><span className="text-xs text-gray-500">최근 {Math.min(notesForMember.length, 4)}건</span></span><DisclosureIcon open={historyOpen} className="h-4 w-4 text-gray-500" /></button>
          {historyOpen && <div className={`mt-3 ${notesForMember.length > 0 ? 'relative ml-2 border-l border-gray-300 pl-6' : ''}`}>
            {notesForMember.length === 0 && <p className="ui-empty py-6">아직 면담 기록이 없습니다.</p>}
            {notesForMember.map(renderHistoryItem)}
          </div>}
          </div>
          </div>
          <div className="contents">
          <div className="meeting-responsive-journal min-w-0">
          <div className="flex items-center justify-between gap-3"><h3 className="ui-section-title">면담 포인트</h3></div>
          <div className="mt-3 border-t border-gray-200 pt-4">
            <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-gray-950">면담일지</span><input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="ui-field w-auto" /></div>
            <div className="mt-3 flex items-stretch gap-3">
              <textarea value={newComment} onChange={(e) => setNewComment(e.target.value)} placeholder="면담 내용을 입력하세요." rows={4} className="ui-field min-w-[240px] flex-1 resize-y" />
              <div className="flex w-[104px] shrink-0 flex-col items-center justify-between gap-2">
                <MoodSelector value={newMood} onChange={setNewMood} />
                <button onClick={handleAdd} disabled={!newComment.trim()} className="ui-button ui-button-primary w-full">작성하기</button>
              </div>
            </div>
          </div>
          </div>
          <div className="meeting-responsive-growth min-w-0 border-t border-gray-200 pt-4"><div className="flex items-center justify-between gap-3"><h3 className="ui-section-title">육성 포인트</h3><span className="text-xs text-gray-500">{selectedProfile?.personalNotes?.length ?? 0}건</span></div><div className="mt-3 flex flex-wrap gap-2">{(selectedProfile?.personalNotes ?? []).length > 0 ? (selectedProfile?.personalNotes ?? []).map((note, index) => { const content = typeof note === 'string' ? note : note.content; return <span key={typeof note === 'string' ? `${content}-${index}` : note.id} className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700">{content}</span> }) : <span className="text-sm text-gray-400">등록된 육성 포인트가 없습니다.</span>}</div></div>
          </div>
          </div>

          </>}
          </main>
          <button type="button" aria-label="성과와 면담 영역 너비 조절" onPointerDown={(event) => startResize('right', event)} className="group col-start-4 row-start-1 flex min-h-full cursor-col-resize items-center justify-center self-stretch border-x border-gray-200 bg-gray-50 hover:bg-orange-50"><span className="h-10 w-0.5 rounded-full bg-gray-300 group-hover:bg-orange-400" /></button>
          <aside className="hidden" aria-hidden="true" />
          <div className="col-start-6 row-start-1 bg-gray-200" aria-hidden="true" />
          <div className="col-start-7 row-start-1 min-w-0 overflow-hidden bg-gray-50">
            <MeetingCalendar notes={meetingNotes} members={members} open={calendarOpen} onToggle={() => setCalendarOpen((value) => !value)} />
          </div>
          </div>
          </>}
        </div>
      )}

      <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 rounded-full border border-gray-200 bg-white p-1 shadow-sm" role="group" aria-label="면담 화면 비교">
        <button type="button" onClick={() => setComparisonView('current')} className={`h-8 rounded-full px-4 text-xs font-semibold transition ${comparisonView === 'current' ? 'bg-gray-950 text-white' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-950'}`}>현재 버전</button>
        <button type="button" onClick={() => setComparisonView('improved')} className={`h-8 rounded-full px-4 text-xs font-semibold transition ${comparisonView === 'improved' ? 'bg-gray-950 text-white' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-950'}`}>개선 버전</button>
      </div>

      <ConfirmDialog
        open={deletingNote !== null}
        title="면담 기록 삭제"
        message={`${deletingNote?.date} 면담 기록을 삭제하시겠습니까?`}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeletingNote(null)}
      />
    </div>
  )
}
