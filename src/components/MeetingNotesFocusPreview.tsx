import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { MeetingNote, TeamMember } from '../types'
import Badge from './Badge'
import DisclosureIcon from './DisclosureIcon'
import MemberGrowthOverview from './MemberGrowthOverview'
import RecentPerformanceSummary from './RecentPerformanceSummary'
import MeetingCalendar from './MeetingCalendar'
import { COLLAPSED_PANEL_WIDTH, PANEL_SPLITTER_WIDTH, PanelSplitter } from './PanelControls'
import { useWorkspace } from '../state/WorkspaceContext'
import { applyMemberTenure, calculatePromotionSimulation, getDefaultGrowthProfile, getMemberEvaluationHistory } from '../utils/growth'
import type { MemberInsight } from '../utils/memberInsights'
import InsightEvidenceButton from './InsightEvidenceButton'
import MeetingPrintPreview from './MeetingPrintPreview'
import GrowthHistoryImportDialog from './GrowthHistoryImportDialog'
import ConfirmDialog from './ConfirmDialog'

interface MeetingNotesFocusPreviewProps {
  members: TeamMember[]
  selectedMember: TeamMember
  selectedMemberId: string
  onSelectMember: (memberId: string) => void
  notes: MeetingNote[]
  allNotes: MeetingNote[]
  importedCommentNotes: MeetingNote[]
  insights: MemberInsight[]
  newDate: string
  newComment: string
  newMood: string
  growthPoints: { strength: string; improvement: string; challenge: string; careerGoal: string }
  onDateChange: (value: string) => void
  onCommentChange: (value: string) => void
  onMoodChange: (value: string) => void
  onGrowthPointsChange: (value: { strength: string; improvement: string; challenge: string; careerGoal: string }) => void
  onAdd: () => void
  onStartNew: () => void
  onUpdateLoaded: (note: MeetingNote) => void
  onEdit: (note: MeetingNote) => void
  editingNoteId: string | null
  editDate: string
  editComment: string
  editMood: string
  onEditDateChange: (value: string) => void
  onEditCommentChange: (value: string) => void
  onEditMoodChange: (value: string) => void
  onSaveEdit: (note: MeetingNote) => void
  onCancelEdit: () => void
  onDelete: (note: MeetingNote) => void
  getMemberGrade: (memberId: string) => string | null
}

const MOODS = [
  { value: 'angry', label: '매우 힘듦', asset: `${import.meta.env.BASE_URL}assets/moods/angry.svg`, color: '#ff5261' },
  { value: 'bad', label: '힘듦', asset: `${import.meta.env.BASE_URL}assets/moods/sad.svg`, color: '#ff7f43' },
  { value: 'okay', label: '보통', asset: `${import.meta.env.BASE_URL}assets/moods/annoyed.svg`, color: '#eab308' },
  { value: 'good', label: '편안함', asset: `${import.meta.env.BASE_URL}assets/moods/smile.svg`, color: '#cfe8f8' },
  { value: 'great', label: '좋음', asset: `${import.meta.env.BASE_URL}assets/moods/smile-plus.svg`, color: '#9bd56c' },
  { value: 'question', label: '매우 좋음', asset: `${import.meta.env.BASE_URL}assets/moods/question.svg`, color: '#59c65f' },
] as const
const LEGACY_MOOD_COLORS: Record<string, string> = { '😣': '#ef4444', '😩': '#ef4444', '😭': '#ef4444', '😢': '#f97316', '🙁': '#eab308', '😐': '#eab308', '🙂': '#22c55e', '😊': '#3b82f6', '😄': '#3b82f6' }
const EMPTY_GROWTH_POINTS = { strength: '', improvement: '', challenge: '', careerGoal: '' }

function moodOption(value?: string) { return MOODS.find((mood) => mood.value === value) }
function moodColor(value?: string) { return moodOption(value)?.color ?? (value ? LEGACY_MOOD_COLORS[value] : undefined) }
function htmlEscape(value: unknown) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') }
function MoodGlyph({ value, className = 'h-6 w-6' }: { value?: string; className?: string }) {
  const mood = moodOption(value)
  if (!mood) return value ? <span className="text-sm">{value}</span> : null
  return <img src={mood.asset} alt="" className={`${className} block`} />
}
const DOCUMENT_USABLE_MIN_WIDTH = 620
const REFERENCE_USABLE_MIN_WIDTH = 150
const CALENDAR_RAIL_MIN_WIDTH = 120
const HISTORY_RAIL_WIDTH = 56

export default function MeetingNotesFocusPreview({
  members, selectedMember, selectedMemberId, onSelectMember, notes, allNotes, importedCommentNotes, insights,
  newDate, newComment, newMood, growthPoints, onDateChange, onCommentChange, onMoodChange, onGrowthPointsChange,
  onAdd, onStartNew, onUpdateLoaded, onEdit, editingNoteId, editDate, editComment, editMood, onEditDateChange, onEditCommentChange, onEditMoodChange, onSaveEdit, onCancelEdit, onDelete, getMemberGrade,
}: MeetingNotesFocusPreviewProps) {
  const { workspace, activeTeam, saveGrowthProfile, saveMeetingNote, deleteMeetingNote } = useWorkspace()
  const [insightsOpen, setInsightsOpen] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(true)
  const [commentRecordsOpen, setCommentRecordsOpen] = useState(true)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [noteAdding, setNoteAdding] = useState(false)
  const [noteInput, setNoteInput] = useState('')
  const [noteColorPicker, setNoteColorPicker] = useState<string | null>(null)
  const [growthOpen, setGrowthOpen] = useState(false)
  const [referencePanelsMinimized, setReferencePanelsMinimized] = useState(true)
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false)
  const [historyImportOpen, setHistoryImportOpen] = useState(false)
  const [commentToDelete, setCommentToDelete] = useState<{ recordId: string; commentIndex: number } | null>(null)
  const layoutRef = useRef<HTMLDivElement>(null)
  const [referenceWidth, setReferenceWidth] = useState(() => Math.min(520, Math.max(360, window.innerWidth * 0.26)))
  const sortedNotes = useMemo(() => [...notes].sort((a, b) => b.date.localeCompare(a.date)), [notes])
  const loadedNote = selectedNoteId ? notes.find((note) => note.id === selectedNoteId) ?? null : null
  const storedProfile = activeTeam?.growthProfiles.find((profile) => profile.memberId === selectedMemberId) ?? getDefaultGrowthProfile(selectedMemberId)
  const simulationProfile = applyMemberTenure(storedProfile, selectedMember)
  const evaluationHistory = activeTeam ? getMemberEvaluationHistory(workspace, activeTeam.id, selectedMemberId) : []
  const currentSimulation = calculatePromotionSimulation(evaluationHistory, { ...simulationProfile, performanceHistory: [] }, selectedMember.level)
  const expectedSimulation = calculatePromotionSimulation(evaluationHistory, simulationProfile, selectedMember.level)
  const expectedGap = Math.round((expectedSimulation.currentScore - expectedSimulation.targetScore) * 10) / 10
  const personalNotes = (storedProfile.personalNotes ?? []).map((note, index) => typeof note === 'string' ? { id: `legacy-${index}`, content: note, color: 'gray' as const } : note)
  const performanceCommentRecords = (storedProfile.importedPerformanceDocuments ?? []).flatMap((document) => {
    const comments = document.selectedComments ?? []
    return comments.length > 0 ? [{ id: `document-${document.id}`, source: 'document' as const, documentId: document.id, period: document.periodLabel, fileName: document.fileName, comments }] : []
  })
  const recordedDocumentIds = new Set(performanceCommentRecords.map((record) => `meeting-${record.documentId}`))
  const legacyCommentRecords = importedCommentNotes.filter((note) => !recordedDocumentIds.has(note.id)).map((note) => ({
    id: `legacy-${note.id}`,
    source: 'legacy' as const,
    noteId: note.id,
    period: note.sourcePeriod ?? note.date,
    fileName: note.sourceFileName ?? '',
    comments: note.comment.split(/\n{2,}/).map((comment) => comment.trim()).filter(Boolean),
  }))
  const allCommentRecords = [...performanceCommentRecords, ...legacyCommentRecords]

  useEffect(() => {
    setSelectedNoteId(null)
  }, [selectedMemberId])

  useEffect(() => {
    if (selectedNoteId && !notes.some((note) => note.id === selectedNoteId)) setSelectedNoteId(null)
  }, [notes, selectedNoteId])

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

  function openMeetingNote(note: MeetingNote) {
    setSelectedNoteId(note.id)
    onDateChange(note.date)
    onCommentChange(note.comment)
    onMoodChange(note.mood ?? '')
    onGrowthPointsChange(note.growthPoints ?? EMPTY_GROWTH_POINTS)
  }

  function startNewMeeting() {
    setSelectedNoteId(null)
    onStartNew()
  }

  function updateLoadedMeeting(note: MeetingNote) {
    onUpdateLoaded(note)
    setSelectedNoteId(null)
  }

  function deleteSelectedComment() {
    if (!commentToDelete) return
    const record = allCommentRecords.find((item) => item.id === commentToDelete.recordId)
    if (!record) { setCommentToDelete(null); return }
    if (record.source === 'document') {
      saveGrowthProfile({
        ...storedProfile,
        importedPerformanceDocuments: (storedProfile.importedPerformanceDocuments ?? []).map((document) => document.id === record.documentId
          ? { ...document, selectedComments: (document.selectedComments ?? []).filter((_, index) => index !== commentToDelete.commentIndex) }
          : document),
      })
    } else {
      const note = importedCommentNotes.find((item) => item.id === record.noteId)
      if (note) {
        const comments = record.comments.filter((_, index) => index !== commentToDelete.commentIndex)
        if (comments.length === 0) deleteMeetingNote(note.id)
        else saveMeetingNote({ ...note, comment: comments.join('\n\n') })
      }
    }
    setCommentToDelete(null)
  }

  function printMeetingNote(note: MeetingNote) {
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.position = 'fixed'
    frame.style.width = '1px'
    frame.style.height = '1px'
    frame.style.right = '0'
    frame.style.bottom = '0'
    frame.style.opacity = '0'
    frame.style.pointerEvents = 'none'
    document.body.appendChild(frame)
    const printDocument = frame.contentDocument
    if (!printDocument) { frame.remove(); return }
    const mood = moodOption(note.mood)?.label ?? note.mood ?? '미선택'
    const growthRows = note.growthPoints ? [
      ['강점', note.growthPoints.strength],
      ['보완 필요', note.growthPoints.improvement],
      ['다음 도전 경험', note.growthPoints.challenge],
      ['Career Goal', note.growthPoints.careerGoal],
    ].filter(([, value]) => value.trim()) : []
    printDocument.open()
    printDocument.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${htmlEscape(selectedMember.name)} 면담 기록</title><style>@page{size:A4;margin:18mm}*{box-sizing:border-box}body{margin:0;color:#111827;font-family:Arial,"Apple SD Gothic Neo",sans-serif;font-size:12px;line-height:1.65}header{border-bottom:2px solid #17233b;padding-bottom:14px}h1{margin:0;font-size:22px}header p{margin:5px 0 0;color:#6b7280}.meta{display:grid;grid-template-columns:110px 1fr;margin-top:24px;border-top:1px solid #d9dee7}.meta div{display:contents}.meta dt,.meta dd{margin:0;border-bottom:1px solid #d9dee7;padding:10px}.meta dt{background:#f3f4f6;font-weight:700}.content{margin-top:24px;white-space:pre-wrap;font-size:14px}.growth{margin-top:28px}.growth h2{font-size:15px}.growth-row{display:grid;grid-template-columns:130px 1fr;border-top:1px solid #e5e7eb}.growth-row:last-child{border-bottom:1px solid #e5e7eb}.growth-row strong,.growth-row span{padding:9px}.growth-row strong{background:#f9fafb}</style></head><body><header><h1>면담 기록</h1><p>${htmlEscape(selectedMember.name)} · ${htmlEscape(selectedMember.level || '직급 미설정')}</p></header><dl class="meta"><div><dt>면담일</dt><dd>${htmlEscape(note.date)}</dd></div><div><dt>면담 분위기</dt><dd>${htmlEscape(mood)}</dd></div></dl><section class="content">${htmlEscape(note.comment)}</section>${growthRows.length ? `<section class="growth"><h2>육성 포인트</h2>${growthRows.map(([label, value]) => `<div class="growth-row"><strong>${htmlEscape(label)}</strong><span>${htmlEscape(value)}</span></div>`).join('')}</section>` : ''}</body></html>`)
    printDocument.close()
    const cleanup = () => frame.remove()
    frame.contentWindow?.addEventListener('afterprint', cleanup, { once: true })
    window.setTimeout(() => {
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
      window.setTimeout(cleanup, 1000)
    }, 80)
  }

  function startResize(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    const startX = event.clientX
    const startReference = referenceWidth
    const available = layoutRef.current?.clientWidth ?? 1440
    function move(moveEvent: PointerEvent) {
      const proposed = startReference - (moveEvent.clientX - startX)
      const calendarWidth = calendarOpen ? 340 : CALENDAR_RAIL_MIN_WIDTH
      const fixedWidth = calendarWidth + 1 + 12 + HISTORY_RAIL_WIDTH + PANEL_SPLITTER_WIDTH
      const maximum = Math.max(REFERENCE_USABLE_MIN_WIDTH, available - fixedWidth - DOCUMENT_USABLE_MIN_WIDTH)
      setReferencePanelsMinimized(proposed < REFERENCE_USABLE_MIN_WIDTH)
      setReferenceWidth(Math.max(REFERENCE_USABLE_MIN_WIDTH, Math.min(maximum, proposed)))
    }
    function up() { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return <div className="meeting-focus-shell">
    <div className="meeting-focus-members">
      <div className="flex min-w-0 flex-1 overflow-x-auto" role="tablist" aria-label="면담 팀원 선택">{members.map((member) => <button key={member.id} type="button" role="tab" aria-selected={member.id === selectedMemberId} onClick={() => onSelectMember(member.id)} className={`meeting-focus-member-tab ${member.id === selectedMemberId ? 'meeting-focus-member-tab-active' : ''}`}>
        {getMemberGrade(member.id) && <Badge tone="neutral" className="shrink-0 bg-white text-gray-900">{getMemberGrade(member.id)}</Badge>}
        <span className="truncate">{member.name}</span>
      </button>)}</div>
      <button type="button" onClick={() => setHistoryImportOpen(true)} className="ui-button ui-button-secondary ui-button-sm mx-3 shrink-0">지난 성과 파일 불러오기</button>
    </div>

    <div ref={layoutRef} className={`meeting-focus-workspace ${referencePanelsMinimized ? 'meeting-focus-workspace-expanded' : ''}`} style={{ gridTemplateColumns: !referencePanelsMinimized
      ? `${calendarOpen ? 340 : CALENDAR_RAIL_MIN_WIDTH}px 1px 12px ${HISTORY_RAIL_WIDTH}px minmax(${DOCUMENT_USABLE_MIN_WIDTH}px, 1fr) ${PANEL_SPLITTER_WIDTH}px ${referenceWidth}px`
      : `${calendarOpen ? 340 : CALENDAR_RAIL_MIN_WIDTH}px 1px 12px ${HISTORY_RAIL_WIDTH}px minmax(0, 1fr) ${PANEL_SPLITTER_WIDTH}px ${COLLAPSED_PANEL_WIDTH}px` }}>
      <aside className="meeting-focus-timeline meeting-focus-rail-two-rows">
        <MeetingCalendar notes={allNotes} members={members} selectedMemberId={selectedMemberId} open={calendarOpen} onToggle={() => setCalendarOpen((value) => !value)} />
      </aside>

      <div className="meeting-focus-calendar-divider meeting-focus-rail-two-rows" aria-hidden="true" />
      <span className="meeting-focus-rail-two-rows" aria-hidden="true" />

      <aside className="meeting-focus-history-sidebar meeting-focus-rail-two-rows" aria-label="면담 기록 탐색">
        <div className="meeting-focus-history-count" title={`면담 기록 ${sortedNotes.length}건`} aria-label={`면담 기록 ${sortedNotes.length}건`}><svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8"><path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/></svg><span className="text-xs font-semibold tabular-nums">{sortedNotes.length}</span></div>
        <div className="meeting-focus-history-rail">
          {sortedNotes.length === 0 ? <p className="py-3 text-xs text-gray-400">기록 없음</p> : sortedNotes.map((note, index) => <button key={note.id} type="button" onClick={() => openMeetingNote(note)} aria-label={`${note.date} 면담일지 불러오기`} className={`meeting-focus-history-mark group ${selectedNoteId === note.id ? 'meeting-focus-history-mark-active' : ''}`} style={{ '--history-color': moodColor(note.mood) } as CSSProperties}>
            <span className="meeting-focus-history-tick" />
            <span className="meeting-focus-history-tooltip"><span className="flex items-center justify-between gap-3"><strong>{note.sourcePeriod ?? note.date}</strong>{note.mood && <MoodGlyph value={note.mood} />}</span>{note.source === 'performance-pdf' && <span className="mt-1 block text-[10px] font-semibold text-orange-600">성과 PDF에서 가져온 기록</span>}<span className="mt-1 block line-clamp-2 font-normal text-gray-500">{note.comment}</span><span className="mt-2 block text-[10px] font-semibold text-orange-600">클릭하여 상세 보기</span>{index === 0 && <Badge tone="neutral" className="mt-2">최근 면담</Badge>}</span>
          </button>)}
        </div>
      </aside>

      <section className="meeting-focus-summary meeting-focus-summary-row">
          <div className="meeting-focus-profile">
            <div className="meeting-focus-member-title"><h2>{selectedMember.name}</h2><span>{selectedMember.level || '직급 미설정'} · {selectedMember.yearsOfService ?? '-'}년차</span></div>
            <div className="meeting-focus-memos">{personalNotes.map((note) => { const colors = { gray: 'bg-gray-100 text-gray-700', orange: 'bg-[#fdf4ee] text-[#e05221]', blue: 'bg-blue-50 text-blue-800', green: 'bg-green-50 text-green-800', violet: 'bg-violet-50 text-violet-800' }; const dots = { gray: 'bg-gray-400', orange: 'bg-[#e05221]', blue: 'bg-blue-500', green: 'bg-green-500', violet: 'bg-violet-500' }; return <span key={note.id} className={`relative inline-flex max-w-56 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${colors[note.color]}`}><button type="button" onClick={() => setNoteColorPicker((value) => value === note.id ? null : note.id)} title="메모 색상 변경" aria-label={`${note.content} 색상 변경`} className={`h-1.5 w-1.5 shrink-0 rounded-full ${dots[note.color]}`} /><span className="truncate">{note.content}</span><button type="button" onClick={() => savePersonalNotes(personalNotes.filter((item) => item.id !== note.id))} title="메모 삭제" aria-label={`${note.content} 삭제`} className="text-current opacity-70 hover:opacity-100">×</button>{noteColorPicker === note.id && <span className="absolute left-0 top-full z-50 mt-1 flex gap-1 rounded-md border border-gray-200 bg-white p-2 shadow-sm">{(Object.keys(dots) as Array<keyof typeof dots>).map((color) => <button key={color} type="button" onClick={() => { savePersonalNotes(personalNotes.map((item) => item.id === note.id ? { ...item, color } : item)); setNoteColorPicker(null) }} aria-label={`${color} 색상 지정`} className={`h-4 w-4 rounded-full ring-1 ring-black/10 ${dots[color]} ${note.color === color ? 'ring-2 ring-gray-950 ring-offset-1' : ''}`} />)}</span>}</span> })}{noteAdding ? <form onSubmit={addPersonalNote} className="flex items-center gap-1"><input autoFocus value={noteInput} onChange={(event) => setNoteInput(event.target.value)} onBlur={() => { if (!noteInput.trim()) setNoteAdding(false) }} className="ui-field ui-field-sm w-40" placeholder="팀원 메모" /><button type="submit" className="ui-button ui-button-secondary ui-button-sm">추가</button></form> : <button type="button" onClick={() => setNoteAdding(true)} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-500 hover:border-slate-300 hover:text-slate-800">+ 메모</button>}</div>
          </div>
          <div className="meeting-focus-score-actions">
            <div className="meeting-focus-score-grid">
              <div><p>목표 점수</p><strong>{expectedSimulation.targetScore}점</strong></div>
              <div><p>현재 점수</p><strong>{currentSimulation.currentScore}점</strong></div>
              <div className={`meeting-focus-score-final ${expectedGap >= 0 ? 'meeting-focus-score-final-met' : 'meeting-focus-score-final-short'}`}><p>최종 기대 점수</p><span className="meeting-focus-score-result"><strong>{expectedSimulation.currentScore}점</strong><em className={expectedGap >= 0 ? 'text-green-500' : 'text-orange-600'}>{expectedGap >= 0 ? `+${expectedGap}점 충족` : `-${Math.abs(expectedGap)}점 필요`}</em></span></div>
            </div>
            <div id="meeting-simulation-trigger" className="flex shrink-0 items-center" />
          </div>
      </section>

      <main className="meeting-focus-document meeting-focus-document-row">

        <div className="meeting-focus-content meeting-focus-content-expanded">
        <div className="meeting-focus-compose">
        <section className="mt-6">
          {loadedNote && <div className="mb-3 flex items-center justify-between rounded-md border border-orange-200 bg-orange-50 px-3 py-2"><p className="text-xs font-medium text-orange-800">{loadedNote.date} 면담 기록을 수정 중입니다.</p><button type="button" onClick={startNewMeeting} className="ui-button ui-button-ghost ui-button-sm">+ 새 면담 작성</button></div>}
          <div className="flex flex-wrap items-center gap-3"><input type="date" value={newDate} onChange={(event) => onDateChange(event.target.value)} className="ui-field w-auto" /><div className="flex items-center gap-1" aria-label="면담 분위기">{MOODS.map((mood) => { const selected = newMood === mood.value; return <button key={mood.value} type="button" title={mood.label} aria-label={mood.label} aria-pressed={selected} onClick={() => onMoodChange(selected ? '' : mood.value)} className={`flex h-8 w-8 items-center justify-center rounded-md border transition ${selected ? 'border-current' : 'border-transparent hover:bg-gray-50'}`} style={{ color: mood.color, backgroundColor: selected ? `${mood.color}14` : undefined }}><MoodGlyph value={mood.value} className="h-5 w-5" /></button> })}</div><span className="ml-auto flex gap-2"><button type="button" onClick={() => setPrintPreviewOpen(true)} className="ui-button ui-button-secondary ui-button-sm">면담용지</button>{loadedNote ? <><button type="button" onClick={() => onDelete(loadedNote)} className="ui-button ui-button-danger ui-button-sm">삭제</button><button type="button" onClick={() => updateLoadedMeeting(loadedNote)} disabled={!newComment.trim()} className="ui-button ui-button-primary ui-button-sm">변경 저장</button></> : <button type="button" onClick={onAdd} disabled={!newComment.trim()} className="ui-button ui-button-primary ui-button-sm">새 면담 저장</button>}</span></div>
          <textarea value={newComment} onChange={(event) => onCommentChange(event.target.value)} rows={7} placeholder="면담 내용을 입력하세요." className="ui-field mt-3 min-h-32 w-full resize-y" />
          <section className="mt-4 border-t border-gray-200 pt-3"><button type="button" onClick={() => setGrowthOpen((value) => !value)} className="flex w-full items-center gap-2 text-left"><DisclosureIcon open={growthOpen} className="h-4 w-4 text-gray-400"/><strong className="text-sm text-gray-800">육성 포인트</strong><span className="text-xs text-gray-400">강점 · 보완 필요 · 다음 경험 · Career Goal</span></button>{growthOpen && <div className="mt-3 grid gap-3"><label><span className="ui-label">강점</span><input value={growthPoints.strength} onChange={(event) => onGrowthPointsChange({ ...growthPoints, strength: event.target.value })} placeholder="강점 입력" className="ui-field" /></label><label><span className="ui-label">보완 필요</span><input value={growthPoints.improvement} onChange={(event) => onGrowthPointsChange({ ...growthPoints, improvement: event.target.value })} placeholder="보완이 필요한 영역 입력" className="ui-field" /></label><label><span className="ui-label">다음 도전 경험</span><input value={growthPoints.challenge} onChange={(event) => onGrowthPointsChange({ ...growthPoints, challenge: event.target.value })} placeholder="도전해 보고 싶은 경험 입력" className="ui-field" /></label><label><span className="ui-label">Career Goal</span><input value={growthPoints.careerGoal} onChange={(event) => onGrowthPointsChange({ ...growthPoints, careerGoal: event.target.value })} placeholder="성장 커리어/목표 입력" className="ui-field" /></label></div>}</section>
        </section>
        </div>

        <div className="meeting-focus-context">

        {insights.length > 0 && <section className="mt-5 overflow-hidden rounded-lg border border-gray-200 bg-white">
          <button type="button" onClick={() => setInsightsOpen((value) => !value)} className="flex w-full items-center justify-between px-4 py-3 text-left"><h3 className="text-sm font-semibold text-gray-950">면담 인사이트</h3><DisclosureIcon open={insightsOpen} className="h-4 w-4 text-gray-500" /></button>
          {insightsOpen && <div className="divide-y divide-gray-100 border-t border-gray-100">{insights.map((insight) => <article key={insight.id} className="px-4 py-2.5"><div className="flex items-center gap-2"><span className={`h-2 w-2 shrink-0 rounded-full ${insight.tone === 'positive' ? 'bg-emerald-500' : insight.tone === 'attention' ? 'bg-orange-500' : 'bg-gray-400'}`} /><p className="min-w-0 flex-1 truncate text-[14px] font-medium leading-5 text-gray-900">{insight.title}</p><InsightEvidenceButton evidence={insight.evidence} label={insight.title} /></div><p className="mt-1 pl-4 text-[13px] leading-5 text-gray-600"><span className="mr-1 font-semibold text-gray-500">추천 질문</span>{insight.question}</p></article>)}</div>}
        </section>}

        <section className="mt-7">
          <button type="button" onClick={() => setHistoryOpen((value) => !value)} className="flex w-full items-center justify-between border-b border-gray-200 pb-3 text-left"><span className="flex items-center gap-2"><h3 className="ui-section-title">면담 기록</h3><span className="text-xs text-gray-400">{sortedNotes.length}건</span></span><DisclosureIcon open={historyOpen} className="h-4 w-4 text-gray-500" /></button>
          {historyOpen && <div className="divide-y divide-gray-100">{sortedNotes.map((note) => <article key={note.id} className="py-4">{editingNoteId === note.id ? <div className="rounded-lg border border-gray-200 bg-gray-50 p-4"><div className="flex flex-wrap items-center gap-3"><input type="date" value={editDate} onChange={(event) => onEditDateChange(event.target.value)} className="ui-field w-auto" /><div className="flex items-center gap-1" aria-label="면담 분위기 수정">{MOODS.map((mood) => { const selected = editMood === mood.value; return <button key={mood.value} type="button" title={mood.label} aria-label={mood.label} aria-pressed={selected} onClick={() => onEditMoodChange(selected ? '' : mood.value)} className={`flex h-8 w-8 items-center justify-center rounded-md border transition ${selected ? 'border-current' : 'border-transparent hover:bg-white'}`} style={{ color: mood.color, backgroundColor: selected ? `${mood.color}14` : undefined }}><MoodGlyph value={mood.value} className="h-5 w-5" /></button> })}</div></div><textarea autoFocus value={editComment} onChange={(event) => onEditCommentChange(event.target.value)} rows={4} className="ui-field mt-3 resize-y" /><div className="mt-3 flex justify-end gap-2"><button type="button" onClick={onCancelEdit} className="ui-button ui-button-secondary ui-button-sm">취소</button><button type="button" disabled={!editDate || !editComment.trim()} onClick={() => onSaveEdit(note)} className="ui-button ui-button-primary ui-button-sm">수정 저장</button></div></div> : <div className="flex items-start justify-between gap-3"><div><strong className="flex items-center gap-2 text-sm text-gray-950">{note.mood && <MoodGlyph value={note.mood} />}{note.sourcePeriod ?? note.date}{note.source === 'performance-pdf' && <Badge tone="accent">성과 PDF</Badge>}</strong>{note.sourceFileName && <p className="mt-1 text-xs text-gray-400">{note.sourceFileName}</p>}<p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">{note.comment}</p></div><div className="flex shrink-0 gap-1"><button type="button" onClick={() => openMeetingNote(note)} className="ui-button ui-button-ghost ui-button-sm" title="상세 보기">상세</button><button type="button" onClick={() => onEdit(note)} className="ui-button ui-button-ghost ui-button-sm h-8 w-8 px-0" title="수정" aria-label={`${note.date} 면담 수정`}><svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8"><path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" /></svg></button><button type="button" onClick={() => onDelete(note)} className="ui-button ui-button-danger ui-button-sm h-8 w-8 px-0" title="삭제" aria-label={`${note.date} 면담 삭제`}><svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg></button><button type="button" onClick={() => printMeetingNote(note)} className="ui-button ui-button-ghost ui-button-sm h-8 w-8 px-0" title="출력" aria-label={`${note.date} 면담 출력`}><svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8"><path d="M7 9V4h10v5M7 17H5V9h14v8h-2M7 14h10v6H7z" /></svg></button></div></div>}</article>)}</div>}
        </section>

        <section className="mt-7">
          <button type="button" onClick={() => setCommentRecordsOpen((value) => !value)} aria-expanded={commentRecordsOpen} className="flex w-full items-center justify-between border-b border-gray-200 pb-3 text-left"><span className="flex items-center gap-2"><h3 className="ui-section-title">코멘트만 모아보기</h3><span className="text-xs text-gray-400">{allCommentRecords.reduce((sum, record) => sum + record.comments.length, 0)}건</span></span><DisclosureIcon open={commentRecordsOpen} className="h-4 w-4 text-gray-500" /></button>
          {commentRecordsOpen && (allCommentRecords.length === 0 ? <p className="py-5 text-sm text-gray-400">가져온 성과 코멘트가 없습니다.</p> : <div className="divide-y divide-gray-100">{allCommentRecords.map((record) => <article key={record.id} className="py-4"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm text-gray-950">{record.period}</strong>{record.fileName && <span className="max-w-72 truncate text-xs text-gray-400">{record.fileName}</span>}</div><div className="mt-2 space-y-2">{record.comments.map((comment, index) => <div key={`${record.id}-${index}`} className="flex items-start gap-1"><details className="group min-w-0 flex-1 rounded-md border border-gray-200 px-3 py-2"><summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-gray-700"><span className="shrink-0 text-xs font-semibold text-gray-500">코멘트 {index + 1}</span><span className="min-w-0 flex-1 truncate group-open:hidden">{comment}</span><span className="ml-auto text-xs font-medium text-gray-400 group-open:hidden">펼쳐보기</span><span className="ml-auto hidden text-xs font-medium text-gray-400 group-open:inline">접기</span></summary><p className="mt-2 whitespace-pre-wrap border-t border-gray-100 pt-2 text-sm leading-6 text-gray-700">{comment}</p></details><button type="button" onClick={() => setCommentToDelete({ recordId: record.id, commentIndex: index })} className="ui-button ui-button-danger ui-button-sm h-9 w-9 shrink-0 px-0" title="코멘트 삭제" aria-label={`${record.period} 코멘트 ${index + 1} 삭제`}><svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg></button></div>)}</div></article>)}</div>)}
        </section>

        </div>
        </div>
      </main>
      <PanelSplitter aria-label="면담일지와 성과 영역 너비 조절" onPointerDown={startResize} />
      <aside className="meeting-focus-reference"><MemberGrowthOverview member={selectedMember} compact collapsible hideSummary simulationOnRight simulationTriggerContainerId="meeting-simulation-trigger" onPanelMinimizedChange={setReferencePanelsMinimized} collapsedContent={<RecentPerformanceSummary member={selectedMember} />} /></aside>
    </div>
    {printPreviewOpen && <MeetingPrintPreview member={selectedMember} history={evaluationHistory} insights={insights} latestNote={sortedNotes[0] ?? null} draft={newComment} growthPoints={growthPoints} onClose={() => setPrintPreviewOpen(false)} />}
    {historyImportOpen && <GrowthHistoryImportDialog members={members} profiles={activeTeam?.growthProfiles ?? []} onApply={(profiles) => { profiles.forEach(saveGrowthProfile) }} onClose={() => setHistoryImportOpen(false)} />}
    <ConfirmDialog open={commentToDelete !== null} title="코멘트 삭제" message="선택한 코멘트만 삭제하시겠습니까? 원본 성과 파일과 다른 코멘트는 유지됩니다." onConfirm={deleteSelectedComment} onCancel={() => setCommentToDelete(null)} />
  </div>
}
