import { useEffect, useMemo, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useAppState } from '../state/AppContext'
import { useWorkspace } from '../state/WorkspaceContext'
import type { PerformanceGrade } from '../types'
import { downloadMemberPeerReviewTemplates, parseIntegratedPeerReviewWorkbook, parseProjectPeerReviewWorkbook } from '../utils/excel'
import { mergePeerReviews } from '../utils/peerReview'
import { evaluationPeriodFolderName, formatEvaluationPeriod } from '../utils/workspace'
import Badge from './Badge'
import FileDropZone from './FileDropZone'
import ModalCloseButton from './ModalCloseButton'

const GRADES: PerformanceGrade[] = ['S', 'A', 'B', 'C', 'D']
const GRADE_SCORE: Record<PerformanceGrade, number> = { S: 5, A: 4, B: 3, C: 2, D: 1 }

function average(values: number[]) {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length
}

function gradeLabel(score: number | null) {
  if (score === null) return '-'
  return GRADES[Math.max(0, Math.min(GRADES.length - 1, 5 - Math.round(score)))]
}

function MiniChartIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round"><path d="M4 19V9m6 10V5m6 14v-7m4 7H2" /></svg>
}

export default function PeerReviewSection() {
  const { state, dispatch } = useAppState()
  const { activeProject } = useWorkspace()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [generatedMembers, setGeneratedMembers] = useState<string[]>([])
  const [uploadMessage, setUploadMessage] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [dashboardView, setDashboardView] = useState<'member' | 'task'>('member')
  const [filterTaskId, setFilterTaskId] = useState('')
  const [filterReviewerId, setFilterReviewerId] = useState('')
  const [filterMemberId, setFilterMemberId] = useState('')
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [selectedReviewerId, setSelectedReviewerId] = useState('')
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, { contribution: string; grade: string; evidence: string }>>({})
  const [reviewSaveMessage, setReviewSaveMessage] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [previewMemberId, setPreviewMemberId] = useState('')
  const [previewTaskId, setPreviewTaskId] = useState('')
  const [participantIdsByTask, setParticipantIdsByTask] = useState<Record<string, string[]>>({})
  const inputRef = useRef<HTMLInputElement>(null)

  const ready = state.tasks.length > 0 && state.members.length > 0
  const submittedIds = useMemo(() => new Set(state.peerReviews.map((review) => review.reviewerMemberId).filter(Boolean)), [state.peerReviews])
  const expectedCount = state.members.length
  const submittedCount = submittedIds.size
  const status = state.criteria.peerReviewWeight === 0
    ? '미사용'
    : generatedMembers.length === 0 && submittedCount === 0
      ? (ready ? '배포 가능' : '준비 전')
      : submittedCount >= expectedCount && expectedCount > 0
        ? '수집 완료'
        : submittedCount > 0 ? '수집 중' : '양식 생성됨'

  const receivedTaskId = selectedTaskId || state.peerReviews[0]?.taskId || state.tasks[0]?.id || ''
  const taskParticipants = useMemo(() => state.members, [state.members])
  const receivedReviewerId = selectedReviewerId || state.peerReviews.find((review) => review.taskId === receivedTaskId)?.reviewerMemberId || taskParticipants[0]?.id || ''
  const selectedReviewer = state.members.find((member) => member.id === receivedReviewerId)

  const filteredReviews = useMemo(() => state.peerReviews.filter((review) => (
    (!filterTaskId || review.taskId === filterTaskId)
    && (!filterReviewerId || review.reviewerMemberId === filterReviewerId)
    && (!filterMemberId || review.targetMemberId === filterMemberId)
  )), [filterMemberId, filterReviewerId, filterTaskId, state.peerReviews])

  const dashboardMemberOptions = useMemo(() => state.members.filter((member) => state.peerReviews.some((review) => (
    review.targetMemberId === member.id
    && (!filterReviewerId || review.reviewerMemberId === filterReviewerId)
  ))), [filterReviewerId, state.members, state.peerReviews])
  const activeDashboardMemberId = filterMemberId && dashboardMemberOptions.some((member) => member.id === filterMemberId)
    ? filterMemberId
    : dashboardMemberOptions[0]?.id || ''
  const dashboardTaskOptions = useMemo(() => state.tasks.filter((task) => state.peerReviews.some((review) => (
    review.taskId === task.id
    && review.targetMemberId === activeDashboardMemberId
    && (!filterReviewerId || review.reviewerMemberId === filterReviewerId)
  ))), [activeDashboardMemberId, filterReviewerId, state.peerReviews, state.tasks])
  const activeDashboardTaskId = filterTaskId && dashboardTaskOptions.some((task) => task.id === filterTaskId)
    ? filterTaskId
    : dashboardTaskOptions[0]?.id || ''

  const memberTaskDashboard = useMemo(() => state.members.flatMap((member) => {
    const memberReviews = filteredReviews.filter((review) => review.targetMemberId === member.id)
    if (memberReviews.length === 0) return []
    const tasks = state.tasks.flatMap((task) => {
      const reviews = memberReviews.filter((review) => review.taskId === task.id)
      if (reviews.length === 0) return []
      const contribution = average(reviews.flatMap((review) => review.contributionPercent === null ? [] : [review.contributionPercent]))
      const gradeScores = reviews.flatMap((review) => review.grade ? [GRADE_SCORE[review.grade]] : [])
      const grade = average(gradeScores)
      const gradeSpread = gradeScores.length < 2 ? 0 : Math.max(...gradeScores) - Math.min(...gradeScores)
      return [{ task, reviews, contribution, grade, gradeSpread }]
    })
    const contributions = memberReviews.flatMap((review) => review.contributionPercent === null ? [] : [review.contributionPercent])
    const grades = memberReviews.flatMap((review) => review.grade ? [GRADE_SCORE[review.grade]] : [])
    return [{ member, tasks, reviewCount: memberReviews.length, contribution: average(contributions), grade: average(grades) }]
  }), [filteredReviews, state.members, state.tasks])

  const activeMemberResult = memberTaskDashboard.find((result) => result.member.id === activeDashboardMemberId)
  const activeTaskResult = activeMemberResult?.tasks.find((result) => result.task.id === activeDashboardTaskId)

  const taskViewTaskOptions = useMemo(() => state.tasks.filter((task) => state.peerReviews.some((review) => (
    review.taskId === task.id && (!filterReviewerId || review.reviewerMemberId === filterReviewerId)
  ))), [filterReviewerId, state.peerReviews, state.tasks])
  const activeTaskViewTaskId = filterTaskId && taskViewTaskOptions.some((task) => task.id === filterTaskId)
    ? filterTaskId
    : taskViewTaskOptions[0]?.id || ''
  const taskViewMemberOptions = useMemo(() => state.members.filter((member) => state.peerReviews.some((review) => (
    review.taskId === activeTaskViewTaskId
    && review.targetMemberId === member.id
    && (!filterReviewerId || review.reviewerMemberId === filterReviewerId)
  ))), [activeTaskViewTaskId, filterReviewerId, state.members, state.peerReviews])
  const activeTaskViewMemberId = filterMemberId && taskViewMemberOptions.some((member) => member.id === filterMemberId)
    ? filterMemberId
    : taskViewMemberOptions[0]?.id || ''
  const activeTaskViewTask = state.tasks.find((task) => task.id === activeTaskViewTaskId)
  const activeTaskViewMember = state.members.find((member) => member.id === activeTaskViewMemberId)
  const taskViewMemberResults = useMemo(() => taskViewMemberOptions.map((member) => {
    const reviews = state.peerReviews.filter((review) => review.taskId === activeTaskViewTaskId && review.targetMemberId === member.id && (!filterReviewerId || review.reviewerMemberId === filterReviewerId))
    const contribution = average(reviews.flatMap((review) => review.contributionPercent === null ? [] : [review.contributionPercent]))
    const gradeScores = reviews.flatMap((review) => review.grade ? [GRADE_SCORE[review.grade]] : [])
    const grade = average(gradeScores)
    const gradeSpread = gradeScores.length < 2 ? 0 : Math.max(...gradeScores) - Math.min(...gradeScores)
    return { member, reviews, contribution, grade, gradeSpread }
  }), [activeTaskViewTaskId, filterReviewerId, state.peerReviews, taskViewMemberOptions])
  const activeTaskViewResult = taskViewMemberResults.find((result) => result.member.id === activeTaskViewMemberId)
  const perspectiveTargetId = dashboardView === 'member' ? activeDashboardMemberId : activeTaskViewMemberId
  const perspectiveReviews = useMemo(() => state.peerReviews.filter((review) => (
    review.targetMemberId === perspectiveTargetId
    && (dashboardView === 'member' || review.taskId === activeTaskViewTaskId)
    && (!filterReviewerId || review.reviewerMemberId === filterReviewerId)
  )), [activeTaskViewTaskId, dashboardView, filterReviewerId, perspectiveTargetId, state.peerReviews])
  const perspective = useMemo(() => {
    const selfReviews = perspectiveReviews.filter((review) => review.reviewerMemberId === perspectiveTargetId)
    const peerReviews = perspectiveReviews.filter((review) => review.reviewerMemberId !== perspectiveTargetId)
    const summarize = (reviews: typeof perspectiveReviews) => ({
      grade: average(reviews.flatMap((review) => review.grade ? [GRADE_SCORE[review.grade]] : [])),
      contribution: average(reviews.flatMap((review) => review.contributionPercent === null ? [] : [review.contributionPercent])),
    })
    const evidenceRate = perspectiveReviews.length === 0 ? 0 : Math.round(perspectiveReviews.filter((review) => review.evidence.trim()).length / perspectiveReviews.length * 100)
    return { self: summarize(selfReviews), peers: summarize(peerReviews), peerCount: new Set(peerReviews.map((review) => review.reviewerMemberId)).size, evidenceRate }
  }, [perspectiveReviews, perspectiveTargetId])

  const previewMember = state.members.find((member) => member.id === previewMemberId) ?? state.members[0]
  const previewTask = state.tasks.find((task) => task.id === previewTaskId) ?? state.tasks[0]
  const defaultParticipantIdsByTask = useMemo(() => Object.fromEntries(state.tasks.map((task) => {
    const assignedIds = state.members
      .filter((member) => state.contributions.some((item) => item.taskId === task.id && item.memberId === member.id && item.contributionPercent > 0))
      .map((member) => member.id)
    return [task.id, assignedIds.length > 0 ? assignedIds : state.members.map((member) => member.id)]
  })), [state.contributions, state.members, state.tasks])
  const previewParticipantIds = previewTask ? (participantIdsByTask[previewTask.id] ?? defaultParticipantIdsByTask[previewTask.id] ?? []) : []
  const previewParticipants = state.members.filter((member) => previewParticipantIds.includes(member.id))
  const configuredTaskCount = state.tasks.filter((task) => (participantIdsByTask[task.id] ?? defaultParticipantIdsByTask[task.id] ?? []).length > 0).length
  const previewEqualContribution = previewParticipants.length > 0 ? Math.floor(100 / previewParticipants.length) : 0

  useEffect(() => {
    if (!receivedTaskId || !receivedReviewerId) {
      setReviewDrafts({})
      return
    }
    const next: Record<string, { contribution: string; grade: string; evidence: string }> = {}
    taskParticipants.forEach((member) => {
      const review = state.peerReviews.find((item) => item.taskId === receivedTaskId && item.reviewerMemberId === receivedReviewerId && item.targetMemberId === member.id)
      next[member.id] = {
        contribution: review?.contributionPercent === null || review?.contributionPercent === undefined ? '' : String(review.contributionPercent),
        grade: review?.grade ?? '',
        evidence: review?.evidence ?? '',
      }
    })
    setReviewDrafts(next)
  }, [receivedReviewerId, receivedTaskId, state.peerReviews, taskParticipants])

  if (!activeProject) return null
  const project = activeProject

  async function generateFiles() {
    const generated = await downloadMemberPeerReviewTemplates({
      projectId: project.id,
      periodLabel: formatEvaluationPeriod(project.period),
      periodFileName: evaluationPeriodFolderName(project.period),
      tasks: state.tasks,
      members: state.members,
      contributions: state.contributions,
      includeGrade: state.criteria.personalGradeWeight > 0,
      participantIdsByTask,
    })
    setGeneratedMembers(generated)
  }

  function openTemplateDialog() {
    setPreviewMemberId(state.members[0]?.id ?? '')
    setPreviewTaskId(state.tasks[0]?.id ?? '')
    setParticipantIdsByTask(defaultParticipantIdsByTask)
    setGeneratedMembers([])
    setDialogOpen(true)
  }

  function removeTaskParticipant(taskId: string, memberId: string) {
    setParticipantIdsByTask((current) => ({
      ...current,
      [taskId]: (current[taskId] ?? defaultParticipantIdsByTask[taskId] ?? []).filter((id) => id !== memberId),
    }))
  }


  async function upload(files: FileList | File[] | null) {
    if (!files?.length) return
    let merged = state.peerReviews
    let validFiles = 0
    let invalidFiles = 0
    const issues: string[] = []
    for (const file of Array.from(files)) {
      if (!/\.xlsx?$/i.test(file.name)) { invalidFiles += 1; continue }
      try {
        const buffer = await file.arrayBuffer()
        const result = parseProjectPeerReviewWorkbook(buffer, project.id, state.tasks, state.members, state.contributions, state.criteria.personalGradeWeight > 0, formatEvaluationPeriod(project.period))
        if (result.reviews.length > 0) {
          merged = mergePeerReviews(merged, result.reviews)
          validFiles += 1
          if (result.errors.length > 0) issues.push(`${file.name}: ${result.errors.slice(0, 2).join(' ')}`)
        } else {
          const integrated = parseIntegratedPeerReviewWorkbook(buffer, state.tasks, state.members)
          if (integrated.reviews.length === 0) {
            invalidFiles += 1
            const errors = integrated.errors.length > 0 ? integrated.errors : result.errors
            if (errors.length > 0) issues.push(`${file.name}: ${errors.slice(0, 2).join(' ')}`)
          } else {
            merged = mergePeerReviews(merged, integrated.reviews)
            validFiles += 1
            if (integrated.errors.length > 0) issues.push(`${file.name}: ${integrated.errors.slice(0, 2).join(' ')}`)
          }
        }
      } catch { invalidFiles += 1; issues.push(`${file.name}: 파일을 읽을 수 없습니다.`) }
    }
    if (validFiles > 0) {
      dispatch({ type: 'IMPORT_PEER_REVIEWS', payload: merged })
      setUploadOpen(false)
    }
    setUploadMessage(`${files.length}개 중 ${validFiles}개 반영${invalidFiles ? ` / ${invalidFiles}개 확인 필요` : ''}${issues.length ? ` · ${issues.join(' · ')}` : ''}`)
  }

  function updateDraft(memberId: string, patch: Partial<{ contribution: string; grade: string; evidence: string }>) {
    setReviewDrafts((current) => ({ ...current, [memberId]: { ...(current[memberId] ?? { contribution: '', grade: '', evidence: '' }), ...patch } }))
  }

  function saveReceivedReviews() {
    if (!receivedTaskId || !selectedReviewer) return
    const invalidContribution = taskParticipants.some((member) => {
      const value = reviewDrafts[member.id]?.contribution.trim()
      return value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100)
    })
    if (invalidContribution) {
      setReviewSaveMessage('기여도는 0~100 사이의 숫자로 입력하세요.')
      return
    }
    const preserved = state.peerReviews.filter((review) => !(review.taskId === receivedTaskId && review.reviewerMemberId === receivedReviewerId))
    const saved = taskParticipants.flatMap((member) => {
      const draft = reviewDrafts[member.id] ?? { contribution: '', grade: '', evidence: '' }
      const hasValue = draft.contribution.trim() !== '' || draft.grade !== '' || draft.evidence.trim() !== ''
      if (!hasValue) return []
      const existing = state.peerReviews.find((review) => review.taskId === receivedTaskId && review.reviewerMemberId === receivedReviewerId && review.targetMemberId === member.id)
      return [{
        id: existing?.id ?? uuidv4(),
        taskId: receivedTaskId,
        reviewerMemberId: receivedReviewerId,
        reviewerName: selectedReviewer.name,
        targetMemberId: member.id,
        contributionPercent: draft.contribution.trim() === '' ? null : Number(draft.contribution),
        grade: draft.grade === '' ? null : draft.grade as PerformanceGrade,
        evidence: draft.evidence.trim(),
      }]
    })
    dispatch({ type: 'IMPORT_PEER_REVIEWS', payload: [...preserved, ...saved] })
    setReviewSaveMessage(`${selectedReviewer.name} 리뷰 ${saved.length}건을 저장했습니다.`)
  }

  return (
    <section className="mb-4 space-y-4 py-1">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <h3 className="ui-section-title">피어리뷰</h3>
          <Badge tone={status === '수집 완료' ? 'success' : 'neutral'}>{status}</Badge>
          <span className="text-sm text-gray-500">{submittedCount} / {expectedCount}명 제출</span>
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={!ready} onClick={openTemplateDialog} className="ui-button ui-button-primary">팀원별 양식 만들기</button>
          <button type="button" aria-expanded={uploadOpen} onClick={() => setUploadOpen((open) => !open)} className="ui-button ui-button-secondary">결과 업로드</button>
          <button type="button" aria-haspopup="dialog" onClick={() => setEditorOpen(true)} className="ui-button ui-button-ghost">값 조정</button>
          <input ref={inputRef} type="file" multiple accept=".xlsx,.xls" className="hidden" onChange={(event) => { void upload(event.target.files); event.target.value = '' }} />
        </div>
      </div>

      {uploadOpen && <FileDropZone
        title="피어리뷰 결과 파일을 여기에 드래그"
        description="팀원별 결과 파일 또는 통합 피어리뷰 Excel을 한 번에 업로드할 수 있습니다. 반영이 끝나면 업로드 영역은 자동으로 닫힙니다."
        disabled={!ready}
        onClick={() => inputRef.current?.click()}
        onDrop={(event) => { event.preventDefault(); void upload(event.dataTransfer.files) }}
      />}

      {uploadMessage && <p className="border-l-2 border-accent pl-3 text-sm text-gray-600">{uploadMessage}</p>}
      {state.criteria.peerReviewWeight === 0 && <p className="text-sm text-gray-500">현재 평가기준에서 피어리뷰가 미사용 상태입니다. 데이터는 확인할 수 있지만 평가 계산에는 반영되지 않습니다.</p>}

      {state.peerReviews.length === 0 ? (
        <div className="ui-empty py-14">
          <MiniChartIcon />
          <p className="mt-3 font-medium text-gray-700">아직 가져온 피어리뷰가 없습니다.</p>
          <p className="mt-1 text-sm text-gray-500">팀원별 양식을 배포한 뒤 결과 파일을 업로드하면 분석 결과가 표시됩니다.</p>
        </div>
      ) : <>
        <section aria-label="피어리뷰 결과" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-200">
            <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto px-1" role="tablist" aria-label={dashboardView === 'member' ? '팀원 선택' : '과제 선택'}>{dashboardView === 'member' ? dashboardMemberOptions.map((member) => <button key={member.id} type="button" role="tab" aria-selected={activeDashboardMemberId === member.id} onClick={() => { setFilterMemberId(member.id); setFilterTaskId('') }} className={`shrink-0 rounded-t-lg border-x border-t px-5 py-3 text-sm font-semibold ${activeDashboardMemberId === member.id ? 'border-gray-950 bg-gray-950 text-white' : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-white'}`}>{member.name}</button>) : taskViewTaskOptions.map((task) => <button key={task.id} type="button" role="tab" aria-selected={activeTaskViewTaskId === task.id} onClick={() => { setFilterTaskId(task.id); setFilterMemberId('') }} className={`max-w-56 shrink-0 truncate rounded-t-lg border-x border-t px-5 py-3 text-sm font-semibold ${activeTaskViewTaskId === task.id ? 'border-gray-950 bg-gray-950 text-white' : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-white'}`}>{task.name}</button>)}</div>
            <div className="mb-2 flex shrink-0 items-center gap-2"><div className="flex rounded-md border border-gray-200 bg-white p-0.5" role="tablist" aria-label="피어리뷰 분석 기준"><button type="button" role="tab" aria-selected={dashboardView === 'member'} onClick={() => { setDashboardView('member'); setFilterMemberId(''); setFilterTaskId('') }} className={`ui-button ui-button-sm ${dashboardView === 'member' ? 'bg-gray-950 text-white' : 'ui-button-ghost text-gray-500'}`}>팀원별 보기</button><button type="button" role="tab" aria-selected={dashboardView === 'task'} onClick={() => { setDashboardView('task'); setFilterMemberId(''); setFilterTaskId('') }} className={`ui-button ui-button-sm ${dashboardView === 'task' ? 'bg-gray-950 text-white' : 'ui-button-ghost text-gray-500'}`}>과제별 근거</button></div><select aria-label="리뷰어 필터" value={filterReviewerId} onChange={(event) => { setFilterReviewerId(event.target.value); setFilterTaskId('') }} className="ui-field ui-field-sm w-36"><option value="">전체 리뷰어</option>{state.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></div>
          </div>

          <section aria-label="본인 평가와 동료 평가 비교" className="grid overflow-hidden rounded-lg border border-gray-200 bg-white lg:grid-cols-[180px_180px_minmax(0,1fr)]">
            <div className="px-4 py-3"><span className="text-xs font-medium text-gray-500">본인 평가</span><strong className="mt-1 block text-base text-gray-950">{gradeLabel(perspective.self.grade)} · {perspective.self.contribution === null ? '-' : `${perspective.self.contribution.toFixed(1)}%`}</strong></div>
            <div className="border-gray-200 px-4 py-3 lg:border-l"><span className="text-xs font-medium text-gray-500">동료 평균 <span className="text-gray-400">{perspective.peerCount}명</span></span><strong className="mt-1 block text-base text-gray-950">{gradeLabel(perspective.peers.grade)} · {perspective.peers.contribution === null ? '-' : `${perspective.peers.contribution.toFixed(1)}%`}</strong></div>
            <div className="border-gray-200 px-4 py-3 lg:border-l"><span className="text-xs font-medium text-gray-500">인식 차이</span><p className="mt-1 text-sm leading-5 text-gray-700">{perspective.self.grade === null || perspective.peers.grade === null ? '본인과 동료 평가가 모두 모이면 차이를 확인할 수 있습니다.' : Math.abs(perspective.self.grade - perspective.peers.grade) < 0.5 ? '본인과 동료가 성과 수준을 비슷하게 보고 있습니다.' : perspective.self.grade < perspective.peers.grade ? '동료가 본인보다 성과를 더 높게 평가하고 있습니다.' : '본인이 동료보다 성과를 더 높게 평가하고 있습니다.'} <span className="text-gray-400">근거 작성률 {perspective.evidenceRate}%</span></p></div>
          </section>

          {dashboardView === 'member' ? (!activeMemberResult || !activeTaskResult ? <div className="ui-empty py-12">조건에 맞는 리뷰가 없습니다.</div> : <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3"><div><div className="flex items-center gap-2"><h5 className="text-base font-semibold text-gray-950">{activeMemberResult.member.name}</h5><span className="text-xs text-gray-500">{activeMemberResult.member.level || activeMemberResult.member.position || '직급 미설정'}</span></div><p className="mt-1 text-xs text-gray-500">{activeMemberResult.tasks.length}개 과제 · 리뷰 {activeMemberResult.reviewCount}건</p></div><div className="flex items-center gap-4 text-sm"><span className="text-gray-500">종합등급 <strong className="ml-1 text-gray-950">{gradeLabel(activeMemberResult.grade)}</strong></span><span className="text-gray-500">평균 기여도 <strong className="ml-1 tabular-nums text-gray-950">{activeMemberResult.contribution === null ? '-' : `${activeMemberResult.contribution.toFixed(1)}%`}</strong></span></div></header>
            <div className="grid min-h-[360px] lg:grid-cols-[280px_minmax(0,1fr)]">
              <aside className="border-b border-gray-200 bg-gray-50/60 p-3 lg:border-b-0 lg:border-r"><p className="px-2 text-xs font-semibold text-gray-500">과제별 종합</p><div className="mt-2 flex gap-2 overflow-x-auto pb-1 lg:max-h-[420px] lg:flex-col lg:overflow-y-auto">{dashboardTaskOptions.map((task) => { const result = activeMemberResult.tasks.find((item) => item.task.id === task.id); const active = task.id === activeDashboardTaskId; return <button key={task.id} type="button" onClick={() => setFilterTaskId(task.id)} className={`min-w-56 rounded-md border p-3 text-left lg:min-w-0 ${active ? 'border-accent bg-white ring-1 ring-accent' : 'border-gray-200 bg-white hover:border-gray-400'}`}><span className="block truncate text-sm font-semibold text-gray-900">{task.name}</span><span className="mt-1 flex items-center justify-between gap-2 text-xs text-gray-500"><span>종합 {gradeLabel(result?.grade ?? null)}</span><span>{result?.contribution === null || result?.contribution === undefined ? '-' : `${result.contribution.toFixed(1)}%`}</span></span></button> })}</div></aside>
              <article className="min-w-0 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h6 className="text-sm font-semibold text-gray-950">{activeTaskResult.task.name}</h6><p className="mt-1 text-xs text-gray-500">과제별 종합 리뷰 · {activeTaskResult.reviews.length}명 평가</p></div><div className="flex flex-wrap items-center gap-2"><Badge tone="accent">종합 {gradeLabel(activeTaskResult.grade)}</Badge><Badge tone="neutral">기여도 {activeTaskResult.contribution === null ? '-' : `${activeTaskResult.contribution.toFixed(1)}%`}</Badge>{activeTaskResult.gradeSpread >= 2 && <Badge tone="danger">의견 차이 확인</Badge>}</div></div>
                <div className="mt-3 max-h-[420px] overflow-auto rounded-md border border-gray-200"><div className="sticky top-0 grid min-w-[640px] grid-cols-[140px_60px_80px_minmax(260px,1fr)] gap-3 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500"><span>평가자</span><span className="text-center">등급</span><span className="text-right">기여도</span><span>핵심 의견</span></div><div className="min-w-[640px] divide-y divide-gray-100">{activeTaskResult.reviews.map((review) => <div key={review.id} className="grid grid-cols-[140px_60px_80px_minmax(260px,1fr)] items-start gap-3 px-3 py-3 text-sm"><span className="flex items-center gap-1.5 font-medium text-gray-800">{review.reviewerName}{review.reviewerMemberId === activeMemberResult.member.id && <Badge tone="neutral">본인</Badge>}</span><span className="text-center font-semibold text-gray-950">{review.grade ?? '-'}</span><span className="text-right tabular-nums text-gray-700">{review.contributionPercent === null ? '-' : `${review.contributionPercent}%`}</span><span className={review.evidence ? 'leading-5 text-gray-700' : 'text-gray-400'}>{review.evidence || '작성된 근거 없음'}</span></div>)}</div></div>
              </article>
            </div>
          </section>) : (!activeTaskViewTask || !activeTaskViewMember || !activeTaskViewResult ? <div className="ui-empty py-12">조건에 맞는 리뷰가 없습니다.</div> : <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3"><div><h5 className="text-base font-semibold text-gray-950">{activeTaskViewTask.name}</h5><p className="mt-1 text-xs text-gray-500">평가 대상 {taskViewMemberResults.length}명 · 리뷰 {taskViewMemberResults.reduce((sum, result) => sum + result.reviews.length, 0)}건</p></div><p className="text-sm text-gray-500">과제 안에서 팀원들이 서로 평가한 결과</p></header>
            <div className="grid min-h-[360px] lg:grid-cols-[280px_minmax(0,1fr)]">
              <aside className="border-b border-gray-200 bg-gray-50/60 p-3 lg:border-b-0 lg:border-r"><p className="px-2 text-xs font-semibold text-gray-500">팀원별 종합</p><div className="mt-2 flex gap-2 overflow-x-auto pb-1 lg:max-h-[420px] lg:flex-col lg:overflow-y-auto">{taskViewMemberResults.map((result) => <button key={result.member.id} type="button" onClick={() => setFilterMemberId(result.member.id)} className={`min-w-56 rounded-md border p-3 text-left lg:min-w-0 ${result.member.id === activeTaskViewMemberId ? 'border-accent bg-white ring-1 ring-accent' : 'border-gray-200 bg-white hover:border-gray-400'}`}><span className="block truncate text-sm font-semibold text-gray-900">{result.member.name}</span><span className="mt-1 flex items-center justify-between gap-2 text-xs text-gray-500"><span>종합 {gradeLabel(result.grade)}</span><span>{result.contribution === null ? '-' : `${result.contribution.toFixed(1)}%`}</span></span></button>)}</div></aside>
              <article className="min-w-0 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h6 className="text-sm font-semibold text-gray-950">{activeTaskViewMember.name}</h6><span className="text-xs text-gray-500">{activeTaskViewMember.level || activeTaskViewMember.position || '직급 미설정'}</span></div><p className="mt-1 text-xs text-gray-500">이 팀원이 받은 리뷰 · {activeTaskViewResult.reviews.length}명 평가</p></div><div className="flex flex-wrap items-center gap-2"><Badge tone="accent">종합 {gradeLabel(activeTaskViewResult.grade)}</Badge><Badge tone="neutral">기여도 {activeTaskViewResult.contribution === null ? '-' : `${activeTaskViewResult.contribution.toFixed(1)}%`}</Badge>{activeTaskViewResult.gradeSpread >= 2 && <Badge tone="danger">의견 차이 확인</Badge>}</div></div>
                <div className="mt-3 max-h-[420px] overflow-auto rounded-md border border-gray-200"><div className="sticky top-0 grid min-w-[640px] grid-cols-[140px_60px_80px_minmax(260px,1fr)] gap-3 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500"><span>평가자</span><span className="text-center">등급</span><span className="text-right">기여도</span><span>핵심 의견</span></div><div className="min-w-[640px] divide-y divide-gray-100">{activeTaskViewResult.reviews.map((review) => <div key={review.id} className="grid grid-cols-[140px_60px_80px_minmax(260px,1fr)] items-start gap-3 px-3 py-3 text-sm"><span className="flex items-center gap-1.5 font-medium text-gray-800">{review.reviewerName}{review.reviewerMemberId === activeTaskViewMember.id && <Badge tone="neutral">본인</Badge>}</span><span className="text-center font-semibold text-gray-950">{review.grade ?? '-'}</span><span className="text-right tabular-nums text-gray-700">{review.contributionPercent === null ? '-' : `${review.contributionPercent}%`}</span><span className={review.evidence ? 'leading-5 text-gray-700' : 'text-gray-400'}>{review.evidence || '작성된 근거 없음'}</span></div>)}</div></div>
              </article>
            </div>
          </section>)}
        </section>

        <details className="rounded-lg border border-gray-200 bg-white"><summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50">원본 데이터 보기 · {filteredReviews.length}건</summary><div className="max-h-[420px] overflow-auto border-t border-gray-200 p-3"><div className="ui-table-wrap"><table className="ui-table min-w-[760px]"><thead><tr><th>과제</th><th>리뷰어</th><th>팀원</th><th className="text-right">기여도</th><th className="text-center">등급</th><th>근거</th></tr></thead><tbody>{filteredReviews.map((review) => <tr key={review.id}><td>{state.tasks.find((task) => task.id === review.taskId)?.name ?? '-'}</td><td>{review.reviewerName}</td><td>{state.members.find((member) => member.id === review.targetMemberId)?.name ?? '-'}</td><td className="text-right tabular-nums">{review.contributionPercent === null ? '-' : `${review.contributionPercent}%`}</td><td className="text-center font-semibold">{review.grade ?? '-'}</td><td className="max-w-[360px] whitespace-normal">{review.evidence || '-'}</td></tr>)}</tbody></table></div></div></details>

        {editorOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4"><div role="dialog" aria-modal="true" aria-labelledby="peer-editor-title" className="flex max-h-[min(760px,calc(100vh-32px))] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4"><div><h2 id="peer-editor-title" className="text-lg font-semibold text-gray-950">업로드 값 조정</h2><p className="mt-1 text-sm text-gray-500">과제와 리뷰어를 선택한 뒤 필요한 값만 수정합니다.</p></div><ModalCloseButton onClick={() => setEditorOpen(false)} label="업로드 값 조정 닫기" /></div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-gray-700">과제<select value={receivedTaskId} onChange={(event) => { setSelectedTaskId(event.target.value); setSelectedReviewerId(''); setReviewSaveMessage('') }} className="ui-field mt-2">{state.tasks.map((task) => <option key={task.id} value={task.id}>{task.name}</option>)}</select></label>
            <label className="text-sm font-medium text-gray-700">리뷰어<select value={receivedReviewerId} onChange={(event) => { setSelectedReviewerId(event.target.value); setReviewSaveMessage('') }} className="ui-field mt-2">{taskParticipants.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
          </div>
          <div className="mt-4 divide-y divide-gray-200 rounded-md border border-gray-200">{taskParticipants.map((member) => {
            const draft = reviewDrafts[member.id] ?? { contribution: '', grade: '', evidence: '' }
            return <div key={member.id} className="grid items-center gap-3 p-3 lg:grid-cols-[100px_100px_90px_minmax(180px,1fr)]"><strong className="text-sm text-gray-950">{member.name}{member.id === receivedReviewerId && <span className="ml-1 text-xs font-normal text-gray-400">(본인)</span>}</strong><input aria-label={`${member.name} 기여도`} type="number" min="0" max="100" value={draft.contribution} onChange={(event) => updateDraft(member.id, { contribution: event.target.value })} placeholder="기여도 %" className="ui-field" /><select aria-label={`${member.name} 수행등급`} value={draft.grade} onChange={(event) => updateDraft(member.id, { grade: event.target.value })} className="ui-field"><option value="">-</option>{GRADES.map((grade) => <option key={grade} value={grade}>{grade}</option>)}</select><input aria-label={`${member.name} 근거`} value={draft.evidence} onChange={(event) => updateDraft(member.id, { evidence: event.target.value })} placeholder="근거(선택)" className="ui-field" /></div>
          })}</div>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-5 py-4"><div>{reviewSaveMessage && <p className={`text-sm ${reviewSaveMessage.includes('0~100') ? 'text-danger' : 'text-success'}`}>{reviewSaveMessage}</p>}</div><div className="flex items-center gap-2"><button type="button" onClick={() => setEditorOpen(false)} className="ui-button ui-button-secondary">취소</button><button type="button" onClick={saveReceivedReviews} className="ui-button ui-button-primary">저장</button></div></div>
        </div></div>}
      </>}

      {generatedMembers.length > 0 && <p className="text-sm text-success">팀원별 양식 {generatedMembers.length}개가 생성되었습니다.</p>}

      {dialogOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4"><div role="dialog" aria-modal="true" aria-labelledby="peer-template-title" className="flex max-h-[min(760px,calc(100vh-32px))] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
        <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4"><div><h2 id="peer-template-title" className="text-lg font-semibold text-gray-950">팀원별 피어리뷰 양식</h2><p className="mt-1 text-sm text-gray-500">내보내기 전에 팀원이 받게 될 Excel 파일의 구성과 입력 형태를 확인하세요.</p></div><ModalCloseButton onClick={() => setDialogOpen(false)} /></div>
        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="border-b border-gray-200 bg-gray-50 p-4 lg:border-b-0 lg:border-r"><p className="text-xs font-semibold uppercase tracking-wide text-gray-400">생성 파일</p><p className="mt-2 text-sm text-gray-600">{formatEvaluationPeriod(project.period)} · {state.tasks.length}개 과제</p><div className="mt-4 space-y-1">{state.members.map((member) => <button key={member.id} type="button" onClick={() => setPreviewMemberId(member.id)} className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${previewMember?.id === member.id ? 'bg-white font-semibold text-gray-950 shadow-sm ring-1 ring-gray-200' : 'text-gray-600 hover:bg-white'}`}><span className="truncate">{member.name}</span><span className="text-xs font-normal text-gray-400">.xlsx</span></button>)}</div><p className="mt-4 text-xs leading-5 text-gray-500">내보내기 시 위 파일을 하나의 ZIP으로 다운로드합니다.</p></aside>
          <div className="min-w-0 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold text-gray-950">{evaluationPeriodFolderName(project.period)}_피어리뷰_{previewMember?.name ?? '팀원'}.xlsx</p><p className="mt-1 text-xs text-gray-500">안내 시트와 과제별 입력 시트로 구성됩니다.</p></div><Badge tone="neutral">미리보기</Badge></div>
            <div className="mt-4 flex gap-1 overflow-x-auto border-b border-gray-200"><button type="button" className="shrink-0 border-b-2 border-transparent px-3 py-2 text-xs text-gray-500">안내</button>{state.tasks.map((task, index) => <button key={task.id} type="button" onClick={() => setPreviewTaskId(task.id)} className={`shrink-0 border-b-2 px-3 py-2 text-xs font-medium ${previewTask?.id === task.id ? 'border-accent text-accent' : 'border-transparent text-gray-500'}`}>{index + 1}_{task.name}</button>)}</div>
            <div className="mt-4 overflow-hidden rounded-md border border-gray-200">
              <div className="border-b border-gray-200 bg-[#eef2f7] px-4 py-3"><p className="text-sm font-semibold text-gray-950">과제: {previewTask?.name ?? '-'}</p><p className="mt-1 text-xs text-gray-500">평가기간: {formatEvaluationPeriod(project.period)} · 평가자: {previewMember?.name ?? '-'} · 평가 대상 {previewParticipants.length}명</p></div>
              {previewParticipants.length === 0 ? <div className="px-5 py-10 text-center"><p className="text-sm font-medium text-gray-600">이 과제는 파일에서 제외됩니다.</p><p className="mt-1 text-xs text-gray-400">팀원을 추가하면 과제 시트가 다시 생성됩니다.</p></div> : <div className="overflow-x-auto"><table className="ui-table min-w-[680px]"><thead><tr><th>평가 대상</th><th className="text-right">기여도(%)</th>{state.criteria.personalGradeWeight > 0 && <th className="text-center">수행등급</th>}<th>근거</th><th className="w-14 text-center">삭제</th></tr></thead><tbody>{previewParticipants.map((member, index) => <tr key={member.id}><td className="font-medium">{member.name}{member.id === previewMember?.id ? <span className="ml-1 text-xs font-normal text-gray-400">(본인)</span> : null}</td><td className="bg-orange-50/70 text-right tabular-nums">{previewEqualContribution + (index < 100 % previewParticipants.length ? 1 : 0)}</td>{state.criteria.personalGradeWeight > 0 && <td className="bg-orange-50/70 text-center text-gray-400">선택</td>}<td className="bg-orange-50/70 text-gray-400">관찰한 행동이나 결과 입력</td><td className="text-center"><button type="button" onClick={() => previewTask && removeTaskParticipant(previewTask.id, member.id)} aria-label={`${member.name} 삭제`} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-danger"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" /></svg></button></td></tr>)}<tr className="bg-green-50 font-semibold text-green-900"><td>기여도 합계</td><td className="text-right">100</td>{state.criteria.personalGradeWeight > 0 && <td className="text-center">검증</td>}<td>정상</td><td /></tr></tbody></table></div>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-5 py-4"><p className="text-xs text-gray-500">{state.members.length}명 파일 · 선택한 {configuredTaskCount}개 과제 · 과제별 기여도 합계 100%</p><div className="flex items-center gap-2">{generatedMembers.length > 0 && <span className="text-sm text-success">{generatedMembers.length}명 생성 완료</span>}<button type="button" disabled={configuredTaskCount === 0} onClick={() => void generateFiles()} className="ui-button ui-button-primary">팀원별 Excel 내보내기</button></div></div>
      </div></div>}
    </section>
  )
}
