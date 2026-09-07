import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { GrowthPerformanceRecord, TeamMember } from '../types'
import { PERFORMANCE_GRADE_OPTIONS } from '../types'
import { useWorkspace } from '../state/WorkspaceContext'
import { applyMemberTenure, calculatePromotionSimulation, getDefaultGrowthProfile, getMemberEvaluationHistory, GRADE_POINTS, mergeProjectHistoryForSimulation } from '../utils/growth'
import PromotionCriteriaDialog from './PromotionCriteriaDialog'
import { PanelToggleIcon } from './PanelControls'

const PERFORMANCE_USABLE_MIN_WIDTH = 150
const SIMULATION_AUTO_COLLAPSE_WIDTH = 360
const SIMULATION_POPUP_TOP = 142

export default function MemberGrowthOverview({ member, collapsedContent, onPanelMinimizedChange, hideSummary = false, removeTopSpacing = false, simulationOnRight = false, simulationTriggerContainerId, showPerformancePanel = true }: { member: TeamMember; compact?: boolean; collapsible?: boolean; collapsedContent?: ReactNode; onPanelMinimizedChange?: (bothMinimized: boolean) => void; hideSummary?: boolean; removeTopSpacing?: boolean; simulationOnRight?: boolean; simulationTriggerContainerId?: string; showPerformancePanel?: boolean }) {
  const { workspace, activeTeam, saveGrowthProfile } = useWorkspace()
  const [noteInput, setNoteInput] = useState('')
  const [noteAdding, setNoteAdding] = useState(false)
  const [noteColorPicker, setNoteColorPicker] = useState<string | null>(null)
  const [criteriaOpen, setCriteriaOpen] = useState(false)
  const [auxiliaryDetailOpen, setAuxiliaryDetailOpen] = useState<'rewardPenalty' | 'education' | null>(null)
  const [simulationPanelMinimized, setSimulationPanelMinimized] = useState(Boolean(collapsedContent))
  const [performancePanelMinimized, setPerformancePanelMinimized] = useState(Boolean(collapsedContent))
  const panelRef = useRef<HTMLDivElement>(null)
  const performancePanelRef = useRef<HTMLDivElement>(null)
  const manualExpandUntilRef = useRef(0)
  const [simulationPopupPosition, setSimulationPopupPosition] = useState(() => ({ x: Math.max(24, window.innerWidth - 560 - 24), y: SIMULATION_POPUP_TOP }))
  const storedProfile = activeTeam?.growthProfiles.find((profile) => profile.memberId === member.id)
  const [profile, setProfile] = useState(storedProfile ?? getDefaultGrowthProfile(member.id))

  useEffect(() => setProfile(storedProfile ?? getDefaultGrowthProfile(member.id)), [member.id, storedProfile])
  useEffect(() => {
    const width = Math.min(criteriaOpen ? 1240 : 560, window.innerWidth - 48)
    setSimulationPopupPosition({ x: Math.max(24, window.innerWidth - width - 24), y: Math.min(SIMULATION_POPUP_TOP, Math.max(16, window.innerHeight - 160)) })
  }, [criteriaOpen])
  useEffect(() => onPanelMinimizedChange?.(collapsedContent ? performancePanelMinimized : simulationPanelMinimized && performancePanelMinimized), [collapsedContent, onPanelMinimizedChange, performancePanelMinimized, simulationPanelMinimized])
  useEffect(() => {
    const element = panelRef.current
    if (!element) return
    const update = () => {
      const width = element.getBoundingClientRect().width
      if (collapsedContent && width > 0 && width < SIMULATION_AUTO_COLLAPSE_WIDTH && Date.now() > manualExpandUntilRef.current) setSimulationPanelMinimized(true)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [collapsedContent])
  useEffect(() => {
    const element = performancePanelRef.current
    if (!element || !collapsedContent) return
    const update = () => {
      const width = element.getBoundingClientRect().width
      if (!performancePanelMinimized && width > 0 && width < PERFORMANCE_USABLE_MIN_WIDTH && Date.now() > manualExpandUntilRef.current) setPerformancePanelMinimized(true)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [collapsedContent, performancePanelMinimized])
  const history = useMemo(() => activeTeam ? getMemberEvaluationHistory(workspace, activeTeam.id, member.id) : [], [activeTeam, member.id, workspace])
  const hasManagedTenure = member.yearsOfService !== null && Number.isFinite(member.yearsOfService)
  const hasTenureOverride = profile.auxiliaryMetrics?.tenureOverridden === true
  const effectiveTenure = hasTenureOverride
    ? profile.auxiliaryMetrics?.tenure ?? 0
    : hasManagedTenure
      ? member.yearsOfService!
      : profile.auxiliaryMetrics?.tenure ?? 0
  const simulationProfile = applyMemberTenure(profile, member)
  const currentSimulation = calculatePromotionSimulation(history, { ...simulationProfile, performanceHistory: [] }, member.level)
  const simulation = calculatePromotionSimulation(history, simulationProfile, member.level)
  const performanceTotal = simulation.rows.reduce((sum, row) => sum + ((row.firstHalf ? GRADE_POINTS[row.firstHalf] : 0) + (row.secondHalf ? GRADE_POINTS[row.secondHalf] : 0)) * row.weight, 0)
  const competencyTotal = simulation.rows.reduce((sum, row) => sum + (row.competency ? GRADE_POINTS[row.competency] * 2 * row.weight : 0), 0)
  const firstYear = simulation.rows[simulation.rows.length - 1]?.year
  const lastYear = simulation.rows[0]?.year
  const reviewLabel = profile.promotionReviewDate ? `${profile.promotionReviewDate.slice(0, 4)}년 ${Number(profile.promotionReviewDate.slice(5, 7))}월` : '심사일 미설정'
  const expectedGap = Math.round((simulation.currentScore - simulation.targetScore) * 10) / 10
  const simulationBonus = Math.round((simulation.currentScore - currentSimulation.currentScore) * 10) / 10
  const personalNotes = (profile.personalNotes ?? []).map((note, index) => typeof note === 'string' ? { id: `legacy-${index}`, content: note, color: 'gray' as const } : note)

  function updateProfile(patch: Partial<typeof profile>) {
    const next = { ...profile, ...patch }
    setProfile(next)
    saveGrowthProfile(next)
  }

  function updateHistory(year: number, key: keyof Omit<GrowthPerformanceRecord, 'year'>, value: string) {
    const records = mergeProjectHistoryForSimulation(history, profile.performanceHistory)
    const existing = records.find((item) => item.year === year) ?? { year, firstHalf: null, secondHalf: null, competency: null }
    updateProfile({ performanceHistory: [...records.filter((item) => item.year !== year), { ...existing, [key]: value || null }].sort((a, b) => b.year - a.year) })
  }

  function updateAuxiliary(key: 'position' | 'rewardPenalty' | 'tenure' | 'education', value: string) {
    updateProfile({ auxiliaryMetrics: { ...(profile.auxiliaryMetrics ?? { position: 0, rewardPenalty: 0, tenure: 0, education: 0 }), [key]: Number(value) || 0, ...(key === 'tenure' ? { tenureOverridden: true } : {}) } })
  }

  function addPersonalNote(event: FormEvent) {
    event.preventDefault()
    const note = noteInput.trim()
    if (!note) return
    updateProfile({ personalNotes: [...personalNotes, { id: `${Date.now()}-${Math.random()}`, content: note, color: 'gray' }] })
    setNoteInput('')
    setNoteAdding(false)
  }

  function startSimulationPopupDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!collapsedContent || (event.target as HTMLElement).closest('button,input,select')) return
    event.preventDefault()
    const startX = event.clientX
    const startY = event.clientY
    const start = simulationPopupPosition
    function move(moveEvent: PointerEvent) {
      const width = Math.min(criteriaOpen ? 1240 : 560, window.innerWidth - 48)
      const height = Math.min(720, window.innerHeight - 32)
      setSimulationPopupPosition({
        x: Math.max(16, Math.min(window.innerWidth - width - 16, start.x + moveEvent.clientX - startX)),
        y: Math.max(16, Math.min(window.innerHeight - height - 16, start.y + moveEvent.clientY - startY)),
      })
    }
    function up() { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <>
    <section className={showPerformancePanel ? 'flex min-h-full flex-col' : 'h-0'}>
      {!hideSummary && (!simulationPanelMinimized || !performancePanelMinimized) ? <div className="flex flex-wrap items-center gap-6 border-b border-slate-200 pb-5">
        <div className="min-w-[240px] flex-1">
          <div className="flex flex-wrap items-center gap-2"><h3 className="text-xl font-semibold text-gray-950">{member.name}</h3><span className="text-sm text-gray-500">{member.level || '직급 미설정'} · {member.yearsOfService ?? '-'}년차</span></div>
          <div className="mt-2 flex flex-wrap items-center gap-2">{personalNotes.map((note) => { const styles = { gray: 'border-gray-200 bg-gray-50 text-gray-700', orange: 'border-orange-200 bg-orange-50 text-orange-800', blue: 'border-blue-200 bg-blue-50 text-blue-800', green: 'border-green-200 bg-green-50 text-green-800', violet: 'border-violet-200 bg-violet-50 text-violet-800' }; const dots = { gray: 'bg-gray-400', orange: 'bg-orange-500', blue: 'bg-blue-500', green: 'bg-green-500', violet: 'bg-violet-500' }; return <span key={note.id} className={`relative inline-flex max-w-52 items-center gap-1 rounded-md border px-2 py-1 text-xs ${styles[note.color]}`}><button type="button" onClick={() => setNoteColorPicker((value) => value === note.id ? null : note.id)} title="메모 색상 선택" aria-label={`${note.content} 메모 색상 선택`} className={`h-2.5 w-2.5 shrink-0 rounded-full ${dots[note.color]}`} /><span className="truncate">{note.content}</span><button type="button" onClick={() => updateProfile({ personalNotes: personalNotes.filter((item) => item.id !== note.id) })} aria-label={`${note.content} 메모 삭제`} className="text-current opacity-50 hover:opacity-100">×</button>{noteColorPicker === note.id && <span className="absolute left-0 top-full z-20 mt-1 flex gap-1 rounded-md border border-gray-200 bg-white p-2 shadow-sm">{(['gray', 'orange', 'blue', 'green', 'violet'] as const).map((color) => <button key={color} type="button" onClick={() => { updateProfile({ personalNotes: personalNotes.map((item) => item.id === note.id ? { ...item, color } : item) }); setNoteColorPicker(null) }} aria-label={`${color} 색상 지정`} className={`h-4 w-4 rounded-full ring-1 ring-black/10 ${dots[color]} ${note.color === color ? 'ring-2 ring-gray-950 ring-offset-1' : ''}`} />)}</span>}</span> })}{noteAdding ? <form onSubmit={addPersonalNote} className="flex items-center gap-1"><input autoFocus value={noteInput} onChange={(event) => setNoteInput(event.target.value)} onBlur={() => { if (!noteInput.trim()) setNoteAdding(false) }} placeholder="팀원 메모" className="ui-field ui-field-sm w-44" /><button type="submit" className="ui-button ui-button-secondary ui-button-sm">추가</button></form> : <button type="button" onClick={() => setNoteAdding(true)} className="text-xs font-medium text-gray-500 hover:text-gray-950">+ 메모</button>}</div>
        </div>
        <div className="grid w-full shrink-0 grid-cols-3 overflow-hidden rounded-lg border border-slate-200 bg-white sm:w-[392px]">
            <div className="px-3 py-3"><p className="text-[11px] font-medium text-slate-500">목표 점수</p><p className="mt-1 text-lg font-semibold tabular-nums text-slate-950">{simulation.targetScore}점</p></div>
            <div className="border-x border-slate-200 px-3 py-3"><p className="text-[11px] font-medium text-slate-500">현재 점수</p><p className="mt-1 text-lg font-semibold tabular-nums text-slate-950">{currentSimulation.currentScore}점</p></div>
            <div className="px-3 py-3"><p className="text-[11px] font-medium text-slate-500">최종 기대 점수</p><div className="mt-1 flex flex-wrap items-baseline gap-1.5"><p className="text-lg font-semibold tabular-nums text-slate-950">{simulation.currentScore}점</p><span className={`text-xs font-semibold ${expectedGap >= 0 ? 'text-emerald-600' : 'text-orange-600'}`}>{expectedGap >= 0 ? `+${expectedGap}점 충족` : `-${Math.abs(expectedGap)}점 필요`}</span></div></div>
          </div>
      </div> : null}
      {member.personnelRecord && (!simulationPanelMinimized || !performancePanelMinimized) && <details className="border-b border-slate-200 py-3">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <strong className="text-slate-800">인사·성장 이력</strong>
          <span className="text-slate-500">사번 {member.personnelRecord.employeeNumber || '-'} · 입사 {member.personnelRecord.hireDate || '-'} · 최근 승진 {member.personnelRecord.lastPromotionDate || '-'}</span>
          <span className="ml-auto text-xs text-slate-400">발령 {member.personnelRecord.appointments.length} · 교육 {member.personnelRecord.education.length} · 경력 {member.personnelRecord.careers.length} · 포상 {member.personnelRecord.awards.length}</span>
        </summary>
        <div className="mt-3 grid gap-4 xl:grid-cols-2">
          <section><h4 className="text-xs font-semibold text-slate-600">최근 발령</h4><div className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">{member.personnelRecord.appointments.slice(0, 6).map((item, index) => <div key={`${item.date}-${index}`} className="grid grid-cols-[88px_72px_1fr] gap-2 px-3 py-2 text-xs"><span className="tabular-nums text-slate-500">{item.date}</span><strong className="text-slate-700">{item.type}</strong><span className="text-slate-600">{item.department} · {item.jobTitle} · {item.position}</span></div>)}</div></section>
          <section><h4 className="text-xs font-semibold text-slate-600">최근 교육</h4><div className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">{member.personnelRecord.education.slice(0, 6).map((item, index) => <div key={`${item.startDate}-${index}`} className="grid grid-cols-[88px_1fr] gap-2 px-3 py-2 text-xs"><span className="tabular-nums text-slate-500">{item.startDate}</span><span className="text-slate-600">{item.courseName}</span></div>)}</div></section>
          {member.personnelRecord.careers.length > 0 && <section><h4 className="text-xs font-semibold text-slate-600">이전 경력</h4><div className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">{member.personnelRecord.careers.slice(0, 6).map((item, index) => <div key={`${item.startDate}-${index}`} className="grid grid-cols-[120px_1fr] gap-2 px-3 py-2 text-xs"><span className="tabular-nums text-slate-500">{item.startDate}~{item.endDate}</span><span className="text-slate-600">{item.company}{item.jobTitle ? ` · ${item.jobTitle}` : ''}</span></div>)}</div></section>}
          {member.personnelRecord.awards.length > 0 && <section><h4 className="text-xs font-semibold text-slate-600">포상</h4><div className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">{member.personnelRecord.awards.slice(0, 6).map((item, index) => <div key={`${item.date}-${index}`} className="grid grid-cols-[88px_1fr] gap-2 px-3 py-2 text-xs"><span className="tabular-nums text-slate-500">{item.date}</span><span className="text-slate-600">{item.name}{item.reason ? ` · ${item.reason}` : ''}</span></div>)}</div></section>}
        </div>
      </details>}
      {(profile.importedPerformanceDocuments?.length ?? 0) > 0 && (!simulationPanelMinimized || !performancePanelMinimized) && <details className="border-b border-slate-200 py-3">
        <summary className="flex cursor-pointer list-none items-center gap-3 text-sm"><strong className="text-slate-800">불러온 성과 상세</strong><span className="text-xs text-slate-400">PDF {profile.importedPerformanceDocuments!.length}건 · 과제별 가중치와 코멘트</span></summary>
        <div className="mt-3 space-y-3">{profile.importedPerformanceDocuments!.map((document) => <section key={document.id} className="rounded-lg border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm text-slate-800">{document.periodLabel}</strong><span className="text-xs text-slate-500">최종 {document.finalGrade ?? '-'} · {document.fileName}</span></div><div className="mt-2 divide-y divide-slate-100">{document.tasks.map((task) => <div key={task.name} className="grid grid-cols-[1fr_48px_36px] gap-2 py-1.5 text-xs"><span className="text-slate-700">{task.name}</span><span className="text-right tabular-nums text-slate-500">{task.weightPercent ?? '-'}%</span><strong className="text-center text-slate-700">{task.grade ?? '-'}</strong></div>)}</div>{document.comments.length > 0 && <p className="mt-2 max-h-28 overflow-y-auto border-t border-slate-100 pt-2 text-xs leading-5 text-slate-600">{document.comments.join('\n')}</p>}</section>)}</div>
      </details>}
      <div className={`${collapsedContent ? 'flex flex-1 bg-slate-50' : 'bg-white'}`}>
        <div ref={panelRef} style={collapsedContent && !simulationPanelMinimized ? { left: simulationPopupPosition.x, top: simulationPopupPosition.y, width: criteriaOpen ? 'min(1240px, calc(100vw - 48px))' : 'min(560px, calc(100vw - 48px))', maxHeight: 'calc(100vh - 32px)' } : undefined} className={simulationPanelMinimized ? (collapsedContent ? 'hidden' : 'bg-transparent') : collapsedContent ? `simulation-popup-compact fixed z-[60] overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-xl transition-[width] duration-200` : `space-y-5 bg-white ${removeTopSpacing ? 'pt-0' : 'pt-6'} px-0`}>
          {simulationPanelMinimized ? (collapsedContent ? null : <button type="button" onClick={() => { manualExpandUntilRef.current = Date.now() + 800; setSimulationPanelMinimized(false) }} title="승진 시뮬레이션 영역 복원" aria-label="승진 시뮬레이션 영역 복원" className="flex w-full flex-col items-center gap-3 py-2 text-slate-500 hover:text-slate-950"><PanelToggleIcon collapsed edge="right" className="h-4 w-4"/><span className="text-xs font-semibold [writing-mode:vertical-rl]">승진 시뮬레이션</span></button>) : <>
          <div onPointerDown={startSimulationPopupDrag} className={`flex min-h-9 flex-wrap items-center gap-4 ${collapsedContent ? 'cursor-move select-none' : ''}`}>
            <h3 className="text-xl font-bold text-slate-800">승진 시뮬레이션</h3>
            <label><span className="sr-only">승진심사 시기</span><input type="month" value={profile.promotionReviewDate} onChange={(event) => updateProfile({ promotionReviewDate: event.target.value })} className="ui-field ui-field-sm w-36 bg-white" /></label>
            <span className="ml-auto flex items-center gap-1"><button type="button" onClick={() => setCriteriaOpen((value) => !value)} aria-expanded={criteriaOpen} className={`ui-button ui-button-ghost ui-button-sm h-8 w-8 px-0 ${criteriaOpen ? 'border-orange-200 text-orange-600' : ''}`} title={criteriaOpen ? '승진 기준 닫기' : '승진 기준 보기'} aria-label={criteriaOpen ? '승진 기준 닫기' : '승진 기준 보기'}><svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8">{criteriaOpen ? <rect x="5" y="5" width="14" height="14" rx="2"/> : <><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M12 5v14"/></>}</svg></button><button type="button" onClick={() => { setCriteriaOpen(false); setSimulationPanelMinimized(true) }} className="ui-button ui-button-ghost ui-button-sm h-8 w-8 px-0" title="승진 시뮬레이션 닫기" aria-label="승진 시뮬레이션 닫기"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></span>
          </div>
          <div className={criteriaOpen ? 'grid grid-cols-[512px_minmax(0,1fr)] gap-6 pt-6' : 'pt-6'}><div className="w-[512px] min-w-0 space-y-5">
          <div className="grid h-[100px] grid-cols-[96px_minmax(210px,1fr)_152px] overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="flex flex-col justify-center px-5"><p className="text-xs font-medium text-slate-500">목표 점수</p><strong className="mt-2 block text-2xl tabular-nums text-slate-800">{simulation.targetScore.toFixed(0)}</strong></div><div className="flex flex-col justify-center border-x border-slate-200 px-5"><p className="text-xs font-medium text-slate-500">현재 점수　　시뮬레이션 가산</p><div className="mt-2 flex items-baseline gap-2"><strong className="text-2xl tabular-nums text-slate-800">{currentSimulation.currentScore.toFixed(1)}</strong><span className="text-2xl font-bold text-blue-500">+ {simulationBonus.toFixed(1)}</span></div></div><div className="flex flex-col justify-center px-5"><p className="text-xs font-medium text-slate-500">최종 시뮬레이션 점수</p><div className="mt-2 flex flex-wrap items-baseline gap-1"><strong className={`text-2xl tabular-nums ${expectedGap >= 0 ? 'text-emerald-500' : 'text-orange-600'}`}>{simulation.currentScore.toFixed(1)}점</strong><span className={`text-[11px] font-semibold ${expectedGap >= 0 ? 'text-emerald-500' : 'text-orange-600'}`}>{expectedGap >= 0 ? `+${expectedGap}점 충족` : `-${Math.abs(expectedGap)}점 필요`}</span></div></div></div>
          <p className="text-xs leading-5 text-slate-500">{reviewLabel} 심사 기준으로 {firstYear ?? '-'}년부터 {lastYear ?? '-'}년까지의 5년 데이터를 반영합니다.</p>
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white"><div className="min-w-[360px]"><div className="grid grid-cols-[48px_repeat(3,minmax(48px,1fr))_56px] bg-slate-50 text-center text-xs font-semibold text-slate-500"><span className="px-1 py-3 text-left">연도</span><span className="px-1 py-3">업적(상)</span><span className="px-1 py-3">업적(하)</span><span className="px-1 py-3">역량 ×2</span><span className="px-1 py-3">가중합</span></div>{simulation.rows.map((row) => <div key={row.year} className="grid grid-cols-[48px_repeat(3,minmax(48px,1fr))_56px] items-center border-t border-slate-100"><strong className="px-1 py-3 text-sm text-slate-700">{row.year}</strong>{([['firstHalf', '상반기 업적'], ['secondHalf', '하반기 업적'], ['competency', '역량']] as const).map(([key, label]) => <label key={key} className="min-w-0 border-l border-slate-100 px-1 py-2"><span className="sr-only">{row.year} {label}</span><select value={row[key] ?? ''} onChange={(event) => updateHistory(row.year, key, event.target.value)} className="ui-field ui-field-sm mx-auto min-w-[44px] max-w-16 bg-white px-1 text-center"><option value="">-</option>{PERFORMANCE_GRADE_OPTIONS.map((grade) => <option key={grade}>{grade}</option>)}</select></label>)}<span className="border-l border-slate-100 px-1 py-3 text-center text-sm font-semibold tabular-nums">{row.weighted.toFixed(1)}</span></div>)}<div className="grid grid-cols-[1fr_auto_auto] items-center border-t border-slate-200 bg-amber-50 px-3 py-3 text-sm"><strong>합계</strong><span className="mr-4 text-xs text-slate-600">성과 {performanceTotal.toFixed(1)} + 역량 {competencyTotal.toFixed(1)} + 보조 {simulation.auxiliaryScore.toFixed(1)}</span><strong className="text-orange-700">{simulation.currentScore.toFixed(1)}점</strong></div></div></div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4"><div className="flex items-center gap-3"><h4 className="ui-section-title">보조지표</h4><strong className="text-sm">합계 {simulation.auxiliaryScore}점</strong></div><div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2">{([['position', '직책'], ['rewardPenalty', '상벌'], ['tenure', '체류'], ['education', '교육']] as const).map(([key, label]) => {
              const details = key === 'education' ? member.personnelRecord?.education ?? [] : key === 'rewardPenalty' ? member.personnelRecord?.awards ?? [] : []
              const hasDetails = details.length > 0
              const detailKey = key === 'education' || key === 'rewardPenalty' ? key : null
              return <div key={key} className="relative grid grid-cols-[40px_64px] items-center gap-2"><span className="flex items-center gap-1 text-xs font-medium text-gray-600">{label}{hasDetails && detailKey && <button type="button" onClick={() => setAuxiliaryDetailOpen((value) => value === detailKey ? null : detailKey)} aria-expanded={auxiliaryDetailOpen === detailKey} aria-label={`${label} 상세 내역 보기`} title={`${label} 상세 내역`} className="inline-flex h-5 w-5 items-center justify-center rounded-full text-orange-600 hover:bg-orange-100"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg></button>}</span><input type="number" aria-label={`${label} 보조점수`} value={key === 'tenure' ? effectiveTenure : (profile.auxiliaryMetrics?.[key] ?? 0)} onChange={(event) => updateAuxiliary(key, event.target.value)} title={key === 'tenure' && hasManagedTenure && !hasTenureOverride ? '팀원 관리의 연차를 기본값으로 적용했습니다. 수정할 수 있습니다.' : undefined} className="ui-field ui-field-sm w-16 bg-white text-right" />{hasDetails && detailKey && auxiliaryDetailOpen === detailKey && <div role="dialog" aria-label={`${label} 상세 내역`} className="absolute bottom-full left-0 z-30 mb-2 w-80 rounded-lg border border-gray-200 bg-white p-3 shadow-lg"><div className="mb-2 flex items-center justify-between"><strong className="text-sm text-gray-900">{label} 상세 내역</strong><button type="button" onClick={() => setAuxiliaryDetailOpen(null)} aria-label="상세 내역 닫기" className="ui-icon-button h-6 w-6">×</button></div><div className="max-h-48 divide-y divide-gray-100 overflow-y-auto">{detailKey === 'education' ? member.personnelRecord!.education.map((item, index) => <div key={`${item.startDate}-${index}`} className="py-2 text-xs"><p className="font-medium text-gray-800">{item.courseName || '교육명 없음'}</p><p className="mt-0.5 text-gray-500">{item.startDate || '-'}{item.endDate ? ` ~ ${item.endDate}` : ''}{item.score ? ` · ${item.score}` : ''}</p></div>) : member.personnelRecord!.awards.map((item, index) => <div key={`${item.date}-${index}`} className="py-2 text-xs"><p className="font-medium text-gray-800">{item.name || '상벌명 없음'}</p><p className="mt-0.5 text-gray-500">{item.date || '-'}{item.organization ? ` · ${item.organization}` : ''}</p>{item.reason && <p className="mt-1 leading-5 text-gray-600">{item.reason}</p>}</div>)}</div></div>}</div>
            })}</div><p className={`mt-3 text-xs leading-5 ${hasManagedTenure || hasTenureOverride ? 'text-slate-500' : 'text-orange-700'}`}>{hasTenureOverride ? `체류 ${effectiveTenure}년을 시뮬레이션 값으로 직접 적용했습니다.` : hasManagedTenure ? `체류는 팀원 관리의 연차 ${member.yearsOfService}년을 기본 적용하며 여기서 수정할 수 있습니다.` : '팀원 관리에 연차가 없어 Excel의 체류 값을 적용했습니다. Excel 값은 실제 정보와 다를 수 있으니 반드시 확인해 주세요.'}</p></div>
          </div>{criteriaOpen && <PromotionCriteriaDialog embedded level={member.level} onClose={() => setCriteriaOpen(false)} />}</div>
          </>}
        </div>
        {collapsedContent && showPerformancePanel && <div ref={performancePanelRef} className={`min-w-0 flex-1 overflow-hidden bg-slate-50 ${performancePanelMinimized ? 'px-1 py-3' : `px-5 ${removeTopSpacing ? 'pt-0' : 'pt-6'}`}`}>{performancePanelMinimized ? <button type="button" onClick={() => { manualExpandUntilRef.current = Date.now() + 800; setPerformancePanelMinimized(false) }} title="성과 영역 복원" aria-label="성과 영역 복원" className="flex w-full flex-col items-center gap-3 py-2 text-slate-500 hover:text-slate-950"><PanelToggleIcon collapsed edge="right" className="h-4 w-4"/><span className="whitespace-nowrap text-xs font-semibold">성과</span></button> : <><div className="mb-3 flex items-center justify-between"><h3 className="ui-section-title">성과</h3><button type="button" onClick={() => setPerformancePanelMinimized(true)} title="성과 영역 최소화" aria-label="성과 영역 최소화" className="ui-button ui-button-ghost ui-button-sm h-8 w-8 px-0"><PanelToggleIcon collapsed={false} edge={simulationOnRight ? 'left' : 'right'} /></button></div>{collapsedContent}</>}</div>}
      </div>
      </section>
    {collapsedContent && simulationTriggerContainerId && typeof document !== 'undefined' && document.getElementById(simulationTriggerContainerId) ? createPortal(<button type="button" onClick={() => { manualExpandUntilRef.current = Date.now() + 800; setSimulationPanelMinimized((value) => !value) }} title={simulationPanelMinimized ? '승진 시뮬레이션 열기' : '승진 시뮬레이션 닫기'} aria-label={simulationPanelMinimized ? '승진 시뮬레이션 열기' : '승진 시뮬레이션 닫기'} className="flex h-11 w-11 items-center justify-center rounded-xl border border-orange-200 bg-orange-50 text-orange-600 transition hover:border-orange-300 hover:bg-orange-100"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 17l5-5 3 3 6-7"/><path d="M14 8h5v5"/><path d="M5 6h.01M8 4h.01M4 10h.01"/></svg></button>, document.getElementById(simulationTriggerContainerId)!) : null}
    </>
  )
}
