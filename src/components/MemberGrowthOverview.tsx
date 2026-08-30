import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { GrowthPerformanceRecord, TeamMember } from '../types'
import { PERFORMANCE_GRADE_OPTIONS } from '../types'
import { useWorkspace } from '../state/WorkspaceContext'
import { calculatePromotionSimulation, getDefaultGrowthProfile, getMemberEvaluationHistory, GRADE_POINTS, mergeProjectHistoryForSimulation } from '../utils/growth'
import PromotionCriteriaDialog from './PromotionCriteriaDialog'
import { PanelToggleIcon } from './PanelControls'

const PERFORMANCE_USABLE_MIN_WIDTH = 150
const SIMULATION_AUTO_COLLAPSE_WIDTH = 360

export default function MemberGrowthOverview({ member, collapsedContent, onPanelMinimizedChange, hideSummary = false, removeTopSpacing = false, simulationOnRight = false, simulationTriggerContainerId, showPerformancePanel = true }: { member: TeamMember; compact?: boolean; collapsible?: boolean; collapsedContent?: ReactNode; onPanelMinimizedChange?: (bothMinimized: boolean) => void; hideSummary?: boolean; removeTopSpacing?: boolean; simulationOnRight?: boolean; simulationTriggerContainerId?: string; showPerformancePanel?: boolean }) {
  const { workspace, activeTeam, saveGrowthProfile } = useWorkspace()
  const [noteInput, setNoteInput] = useState('')
  const [noteAdding, setNoteAdding] = useState(false)
  const [noteColorPicker, setNoteColorPicker] = useState<string | null>(null)
  const [criteriaOpen, setCriteriaOpen] = useState(false)
  const [simulationPanelMinimized, setSimulationPanelMinimized] = useState(Boolean(collapsedContent))
  const [performancePanelMinimized, setPerformancePanelMinimized] = useState(Boolean(collapsedContent))
  const panelRef = useRef<HTMLDivElement>(null)
  const performancePanelRef = useRef<HTMLDivElement>(null)
  const manualExpandUntilRef = useRef(0)
  const [narrowPanel, setNarrowPanel] = useState(false)
  const [simulationPopupPosition, setSimulationPopupPosition] = useState(() => ({ x: Math.max(24, window.innerWidth - 760), y: 72 }))
  const storedProfile = activeTeam?.growthProfiles.find((profile) => profile.memberId === member.id)
  const [profile, setProfile] = useState(storedProfile ?? getDefaultGrowthProfile(member.id))

  useEffect(() => setProfile(storedProfile ?? getDefaultGrowthProfile(member.id)), [member.id, storedProfile])
  useEffect(() => {
    if (!criteriaOpen) return
    const width = Math.min(1480, window.innerWidth - 48)
    setSimulationPopupPosition((position) => ({ ...position, x: Math.max(24, Math.min(position.x, window.innerWidth - width - 24)), y: 16 }))
  }, [criteriaOpen])
  useEffect(() => onPanelMinimizedChange?.(collapsedContent ? performancePanelMinimized : simulationPanelMinimized && performancePanelMinimized), [collapsedContent, onPanelMinimizedChange, performancePanelMinimized, simulationPanelMinimized])
  useEffect(() => {
    const element = panelRef.current
    if (!element) return
    const update = () => {
      const width = element.getBoundingClientRect().width
      setNarrowPanel(width < 500)
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
  const currentSimulation = calculatePromotionSimulation(history, { ...profile, performanceHistory: [] }, member.level)
  const simulation = calculatePromotionSimulation(history, profile, member.level)
  const performanceTotal = simulation.rows.reduce((sum, row) => sum + ((row.firstHalf ? GRADE_POINTS[row.firstHalf] : 0) + (row.secondHalf ? GRADE_POINTS[row.secondHalf] : 0)) * row.weight, 0)
  const competencyTotal = simulation.rows.reduce((sum, row) => sum + (row.competency ? GRADE_POINTS[row.competency] * 2 * row.weight : 0), 0)
  const firstYear = simulation.rows[simulation.rows.length - 1]?.year
  const lastYear = simulation.rows[0]?.year
  const reviewLabel = profile.promotionReviewDate ? `${profile.promotionReviewDate.slice(0, 4)}년 ${Number(profile.promotionReviewDate.slice(5, 7))}월` : '심사일 미설정'
  const expectedGap = Math.round((simulation.currentScore - simulation.targetScore) * 10) / 10
  const simulationBonus = Math.round((simulation.currentScore - currentSimulation.currentScore) * 10) / 10
  const simulationBonusRows = simulation.rows.flatMap((row) => {
    const currentRow = currentSimulation.rows.find((item) => item.year === row.year)
    const bonus = Math.round((row.weighted - (currentRow?.weighted ?? 0)) * 10) / 10
    return Math.abs(bonus) < 0.1 ? [] : [{ year: row.year, bonus }]
  })
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
    updateProfile({ auxiliaryMetrics: { ...(profile.auxiliaryMetrics ?? { position: 0, rewardPenalty: 0, tenure: 0, education: 0 }), [key]: Number(value) || 0 } })
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
      const width = Math.min(criteriaOpen ? 1480 : 760, window.innerWidth - 48)
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
      <div className={`${collapsedContent ? 'flex flex-1 bg-slate-50' : 'bg-white'}`}>
        <div ref={panelRef} style={collapsedContent && !simulationPanelMinimized ? { left: simulationPopupPosition.x, top: simulationPopupPosition.y, width: criteriaOpen ? 'min(1480px, calc(100vw - 48px))' : 'min(760px, calc(100vw - 48px))', height: criteriaOpen ? 'calc(100vh - 32px)' : undefined, maxHeight: 'calc(100vh - 32px)' } : undefined} className={simulationPanelMinimized ? (collapsedContent ? 'hidden' : 'bg-transparent') : collapsedContent ? `fixed z-[60] rounded-lg border border-slate-200 bg-white p-4 shadow-xl transition-[width] duration-200 ${criteriaOpen ? 'overflow-hidden' : 'overflow-y-auto'}` : `space-y-5 bg-white ${removeTopSpacing ? 'pt-0' : 'pt-6'} px-0`}>
          {simulationPanelMinimized ? (collapsedContent ? null : <button type="button" onClick={() => { manualExpandUntilRef.current = Date.now() + 800; setSimulationPanelMinimized(false) }} title="승진 시뮬레이션 영역 복원" aria-label="승진 시뮬레이션 영역 복원" className="flex w-full flex-col items-center gap-3 py-2 text-slate-500 hover:text-slate-950"><PanelToggleIcon collapsed edge="right" className="h-4 w-4"/><span className="text-xs font-semibold [writing-mode:vertical-rl]">승진 시뮬레이션</span></button>) : <>
          <div onPointerDown={startSimulationPopupDrag} className={`flex min-h-9 flex-wrap items-center gap-2 border-b border-slate-200 pb-3 ${collapsedContent ? 'cursor-move select-none' : ''}`}>
            <h3 className="ui-section-title">승진 시뮬레이션</h3>
            <label><span className="sr-only">승진심사 시기</span><input type="month" value={profile.promotionReviewDate} onChange={(event) => updateProfile({ promotionReviewDate: event.target.value })} className="ui-field ui-field-sm w-36 bg-white" /></label>
            <span className="ml-auto flex items-center gap-1"><button type="button" onClick={() => setCriteriaOpen((value) => !value)} aria-expanded={criteriaOpen} className={`ui-button ui-button-ghost ui-button-sm h-8 w-8 px-0 ${criteriaOpen ? 'text-orange-600' : ''}`} title={criteriaOpen ? '승진 기준 닫기' : '승진 기준 보기'} aria-label={criteriaOpen ? '승진 기준 닫기' : '승진 기준 보기'}><svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/></svg></button><button type="button" onClick={() => { setCriteriaOpen(false); setSimulationPanelMinimized(true) }} className="ui-button ui-button-ghost ui-button-sm h-8 w-8 px-0" title="승진 시뮬레이션 영역 최소화" aria-label="승진 시뮬레이션 영역 최소화"><PanelToggleIcon collapsed={false} edge={simulationOnRight ? 'right' : 'left'} /></button></span>
          </div>
          <div className={criteriaOpen ? 'grid h-[calc(100%-48px)] grid-cols-[minmax(0,1fr)_minmax(480px,0.9fr)] gap-4 pt-4' : 'space-y-5 pt-5'}><div className={`min-w-0 ${criteriaOpen ? 'space-y-3 overflow-hidden' : 'space-y-5'}`}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><div className="rounded-lg bg-gray-50 px-3 py-3"><p className="text-xs font-medium text-gray-500">승진자격 점수</p><strong className="mt-1 block text-xl tabular-nums">{simulation.targetScore.toFixed(1)}점</strong></div><div className="rounded-lg bg-gray-50 px-3 py-3"><p className="text-xs font-medium text-gray-500">현재 점수</p><strong className="mt-1 block text-xl tabular-nums">{currentSimulation.currentScore.toFixed(1)}점</strong></div><div className="rounded-lg bg-blue-50 px-3 py-3"><p className="text-xs font-medium text-gray-500">시뮬레이션 가산</p><strong className="mt-1 block text-xl tabular-nums text-blue-600">{simulationBonus >= 0 ? '+' : ''}{simulationBonus.toFixed(1)}점</strong></div><div className={`rounded-lg px-3 py-3 ${expectedGap >= 0 ? 'bg-emerald-50' : 'bg-orange-50'}`}><p className="text-xs font-medium text-gray-500">최종 시뮬레이션 점수</p><strong className={`mt-1 block text-xl tabular-nums ${expectedGap >= 0 ? 'text-emerald-600' : 'text-orange-600'}`}>{simulation.currentScore.toFixed(1)}점</strong></div></div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600"><strong className="text-gray-800">가산 근거</strong>{simulationBonusRows.length ? simulationBonusRows.map((item) => <span key={item.year} className="rounded-md border border-gray-200 bg-white px-2 py-1">{item.year}년 입력 {item.bonus >= 0 ? '+' : ''}{item.bonus.toFixed(1)}점</span>) : <span className="text-gray-400">추가 입력으로 반영된 가산점이 없습니다.</span>}</div>
          <p className="text-xs leading-5 text-slate-500">{reviewLabel} 심사 기준으로 {firstYear ?? '-'}년부터 {lastYear ?? '-'}년까지의 5년 데이터를 반영합니다.</p>
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white"><div className="min-w-[360px]"><div className="grid grid-cols-[48px_repeat(3,minmax(48px,1fr))_56px] bg-slate-50 text-center text-xs font-semibold text-slate-500"><span className="px-1 py-3 text-left">연도</span><span className="px-1 py-3">업적(상)</span><span className="px-1 py-3">업적(하)</span><span className="px-1 py-3">역량 ×2</span><span className="px-1 py-3">가중합</span></div>{simulation.rows.map((row) => <div key={row.year} className="grid grid-cols-[48px_repeat(3,minmax(48px,1fr))_56px] items-center border-t border-slate-100"><strong className="px-1 py-3 text-sm text-slate-700">{row.year}</strong>{([['firstHalf', '상반기 업적'], ['secondHalf', '하반기 업적'], ['competency', '역량']] as const).map(([key, label]) => <label key={key} className="min-w-0 border-l border-slate-100 px-1 py-2"><span className="sr-only">{row.year} {label}</span><select value={row[key] ?? ''} onChange={(event) => updateHistory(row.year, key, event.target.value)} className="ui-field ui-field-sm mx-auto min-w-[44px] max-w-16 bg-white px-1 text-center"><option value="">-</option>{PERFORMANCE_GRADE_OPTIONS.map((grade) => <option key={grade}>{grade}</option>)}</select></label>)}<span className="border-l border-slate-100 px-1 py-3 text-center text-sm font-semibold tabular-nums">{row.weighted.toFixed(1)}</span></div>)}<div className="grid grid-cols-[1fr_auto_auto] items-center border-t border-slate-200 bg-amber-50 px-3 py-3 text-sm"><strong>합계</strong><span className="mr-4 text-xs text-slate-600">성과 {performanceTotal.toFixed(1)} + 역량 {competencyTotal.toFixed(1)} + 보조 {simulation.auxiliaryScore.toFixed(1)}</span><strong className="text-orange-700">{simulation.currentScore.toFixed(1)}점</strong></div></div></div>
            <div className={`rounded-lg bg-gray-50 px-4 py-3 ${narrowPanel ? 'grid grid-cols-2 gap-x-10 gap-y-2' : 'flex flex-wrap items-center gap-5'}`}><div className={`flex shrink-0 items-center gap-5 ${narrowPanel ? 'col-span-2' : ''}`}><h4 className="ui-section-title">보조지표</h4><strong className="text-sm">합계 {simulation.auxiliaryScore}점</strong></div>{([['position', '직책'], ['rewardPenalty', '상벌'], ['tenure', '체류'], ['education', '교육']] as const).map(([key, label]) => <label key={key} className="flex min-w-0 items-center gap-2"><span className="shrink-0 text-xs font-medium text-gray-600">{label}</span><input type="number" value={profile.auxiliaryMetrics?.[key] ?? 0} onChange={(event) => updateAuxiliary(key, event.target.value)} className="ui-field ui-field-sm w-16 bg-white text-right" /></label>)}</div>
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
