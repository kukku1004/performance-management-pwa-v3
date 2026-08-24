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

export default function PeerReviewSection() {
  const { state, dispatch } = useAppState()
  const { activeProject } = useWorkspace()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [generatedMembers, setGeneratedMembers] = useState<string[]>([])
  const [uploadMessage, setUploadMessage] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [activeView, setActiveView] = useState<'templates' | 'received'>('templates')
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [selectedReviewerId, setSelectedReviewerId] = useState('')
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, { contribution: string; grade: string; evidence: string }>>({})
  const [reviewSaveMessage, setReviewSaveMessage] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  if (!activeProject) return null
  const project = activeProject

  const ready = state.tasks.length > 0 && state.members.length > 0
  const submittedIds = new Set(state.peerReviews.map((review) => review.reviewerMemberId).filter(Boolean))
  const expectedCount = state.members.length
  const submittedCount = submittedIds.size
  const status = state.criteria.peerReviewWeight === 0 ? '미사용' : generatedMembers.length === 0 && submittedCount === 0 ? (ready ? '배포 가능' : '준비 전') : submittedCount >= expectedCount && expectedCount > 0 ? '수집 완료' : submittedCount > 0 ? '수집 중' : '양식 생성됨'
  const receivedTaskId = selectedTaskId || state.peerReviews[0]?.taskId || state.tasks[0]?.id || ''
  const taskParticipants = useMemo(() => state.members, [state.members])
  const receivedReviewerId = selectedReviewerId || state.peerReviews.find((review) => review.taskId === receivedTaskId)?.reviewerMemberId || taskParticipants[0]?.id || ''
  const selectedReviewer = state.members.find((member) => member.id === receivedReviewerId)

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

  async function generateFiles() {
    const generated = await downloadMemberPeerReviewTemplates({
      projectId: project.id,
      periodLabel: formatEvaluationPeriod(project.period),
      periodFileName: evaluationPeriodFolderName(project.period),
      tasks: state.tasks,
      members: state.members,
      contributions: state.contributions,
      includeGrade: state.criteria.personalGradeWeight > 0,
    })
    setGeneratedMembers(generated)
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
      setActiveView('received')
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
    <section className="mb-4 space-y-5 py-1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><h3 className="ui-section-title">피어리뷰</h3><Badge tone={status === '수집 완료' ? 'success' : 'neutral'}>{status}</Badge><span className="text-sm text-gray-500">{submittedCount} / {expectedCount}명 제출</span></div>
        <div className="flex gap-2"><button type="button" disabled={!ready} onClick={() => setDialogOpen(true)} className="ui-button ui-button-primary">팀원별 양식 만들기</button><button type="button" aria-expanded={uploadOpen} onClick={() => { setActiveView('received'); setUploadOpen((open) => !open) }} className="ui-button ui-button-secondary">결과 업로드</button><input ref={inputRef} type="file" multiple accept=".xlsx,.xls" className="hidden" onChange={(event) => { void upload(event.target.files); event.target.value = '' }} /></div>
      </div>

      <div className="flex border-b border-gray-200" role="tablist" aria-label="피어리뷰 관리 구분">
        <button type="button" role="tab" aria-selected={activeView === 'templates'} onClick={() => { setActiveView('templates'); setUploadOpen(false) }} className={`border-b-2 px-4 py-2.5 text-sm font-semibold ${activeView === 'templates' ? 'border-gray-950 text-gray-950' : 'border-transparent text-gray-500 hover:text-gray-900'}`}>양식 배포</button>
        <button type="button" role="tab" aria-selected={activeView === 'received'} onClick={() => setActiveView('received')} className={`border-b-2 px-4 py-2.5 text-sm font-semibold ${activeView === 'received' ? 'border-gray-950 text-gray-950' : 'border-transparent text-gray-500 hover:text-gray-900'}`}>받은 리뷰 <span className="ml-1 text-xs font-medium text-gray-400">{state.peerReviews.length}</span></button>
      </div>

      {activeView === 'templates' ? <><div>
        <h4 className="text-sm font-semibold text-gray-950">자동 양식 구성</h4>
        {ready ? <p className="mt-1 text-sm leading-6 text-gray-600">과제 {state.tasks.length}개와 팀원 {state.members.length}명을 기준으로 팀원별 파일을 만듭니다. 각 과제 시트의 기여도는 합계 100%가 되도록 자동 균등 배분됩니다.</p> : <p className="ui-empty mt-3">과제와 팀원을 먼저 등록하세요.</p>}
      </div>
      {state.criteria.peerReviewWeight === 0 && <p className="text-sm text-gray-500">현재 평가기준에서 피어리뷰가 미사용 상태입니다. 데이터는 생성·업로드할 수 있으며 계산에는 반영되지 않습니다.</p>}
      {generatedMembers.length > 0 && <p className="text-sm text-success">팀원별 양식 {generatedMembers.length}개가 생성되었습니다. 다운로드된 파일을 각 팀원에게 배포하세요.</p>}
      {uploadMessage && <p className="text-sm text-gray-600">{uploadMessage}</p>}
      </> : <div className="space-y-8">
        {uploadOpen && <FileDropZone
          title="피어리뷰 결과 파일을 여기에 드래그"
          description="팀원별 결과 파일 또는 통합 피어리뷰 Excel을 한 번에 업로드할 수 있습니다. 현재 과제·팀원과 일치하는 값만 반영됩니다."
          disabled={!ready}
          onClick={() => inputRef.current?.click()}
          onDrop={(event) => { event.preventDefault(); void upload(event.dataTransfer.files) }}
        />}
        {state.peerReviews.length === 0 ? <div className="ui-empty"><p>아직 업로드된 피어리뷰가 없습니다.</p></div> : <>
          <section className="rounded-lg border border-gray-200 bg-white p-4">
            <div><h4 className="text-sm font-semibold text-gray-950">받은 내용 확인·조정</h4><p className="mt-1 text-xs text-gray-500">업로드된 값을 과제와 리뷰어별로 확인하고 필요한 값만 수정합니다.</p></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium text-gray-700">과제<select value={receivedTaskId} onChange={(event) => { setSelectedTaskId(event.target.value); setSelectedReviewerId(''); setReviewSaveMessage('') }} className="ui-field mt-2">{state.tasks.map((task) => <option key={task.id} value={task.id}>{task.name}</option>)}</select></label>
              <label className="text-sm font-medium text-gray-700">리뷰어<select value={receivedReviewerId} onChange={(event) => { setSelectedReviewerId(event.target.value); setReviewSaveMessage('') }} className="ui-field mt-2">{taskParticipants.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
            </div>
            <p className="mt-3 text-xs leading-5 text-gray-500">선택한 리뷰어가 해당 과제 참여자에게 남긴 기여도·수행등급·근거입니다. 비어 있는 값은 저장하지 않습니다.</p>
            <div className="mt-4 divide-y divide-gray-200 rounded-md border border-gray-200">
              {taskParticipants.map((member) => {
                const draft = reviewDrafts[member.id] ?? { contribution: '', grade: '', evidence: '' }
                return <div key={member.id} className="grid items-center gap-3 p-3 lg:grid-cols-[100px_100px_90px_minmax(180px,1fr)]"><strong className="text-sm text-gray-950">{member.name}{member.id === receivedReviewerId && <span className="ml-1 text-xs font-normal text-gray-400">(본인)</span>}</strong><label className="sr-only" htmlFor={`peer-contribution-${member.id}`}>{member.name} 기여도</label><input id={`peer-contribution-${member.id}`} type="number" min="0" max="100" value={draft.contribution} onChange={(event) => updateDraft(member.id, { contribution: event.target.value })} placeholder="기여도 %" className="ui-field" /><label className="sr-only" htmlFor={`peer-grade-${member.id}`}>{member.name} 수행등급</label><select id={`peer-grade-${member.id}`} value={draft.grade} onChange={(event) => updateDraft(member.id, { grade: event.target.value })} className="ui-field"><option value="">-</option>{(['S', 'A', 'B', 'C', 'D'] as PerformanceGrade[]).map((grade) => <option key={grade} value={grade}>{grade}</option>)}</select><label className="sr-only" htmlFor={`peer-evidence-${member.id}`}>{member.name} 근거</label><input id={`peer-evidence-${member.id}`} value={draft.evidence} onChange={(event) => updateDraft(member.id, { evidence: event.target.value })} placeholder="근거(선택)" className="ui-field" /></div>
              })}
            </div>
            <div className="mt-4 flex items-center gap-3"><button type="button" onClick={saveReceivedReviews} className="ui-button ui-button-primary">저장</button>{reviewSaveMessage && <p className={`text-sm ${reviewSaveMessage.includes('0~100') ? 'text-danger' : 'text-success'}`}>{reviewSaveMessage}</p>}</div>
          </section>

          <section>
            <div><h4 className="text-sm font-semibold text-gray-950">팀원별 받은 리뷰</h4><p className="mt-1 text-xs text-gray-500">팀원별로 받은 기여도·등급·근거를 모아 확인합니다.</p></div>
            <div className="mt-3 divide-y divide-gray-200 border-y border-gray-200">
              {state.members.map((member) => {
                const received = state.peerReviews.filter((review) => review.targetMemberId === member.id)
                if (received.length === 0) return null
                return <details key={member.id} className="group py-1"><summary className="flex cursor-pointer list-none items-center justify-between px-2 py-3 text-sm font-semibold text-gray-950"><span>{member.name}</span><span className="text-xs font-medium text-gray-500">받은 리뷰 {received.length}건 <span className="ml-2 group-open:hidden">⌄</span><span className="ml-2 hidden group-open:inline">⌃</span></span></summary><div className="overflow-x-auto pb-3"><table className="ui-table min-w-[620px]"><thead><tr><th>과제</th><th>리뷰어</th><th className="text-right">기여도</th><th className="text-center">등급</th><th>근거</th></tr></thead><tbody>{received.map((review) => <tr key={review.id}><td>{state.tasks.find((task) => task.id === review.taskId)?.name ?? '-'}</td><td>{review.reviewerName}</td><td className="text-right">{review.contributionPercent === null ? '-' : `${review.contributionPercent}%`}</td><td className="text-center">{review.grade ?? '-'}</td><td className="max-w-[320px] whitespace-normal">{review.evidence || '-'}</td></tr>)}</tbody></table></div></details>
              })}
            </div>
          </section>
        </>}
        {uploadMessage && <p className="text-sm text-gray-600">{uploadMessage}</p>}
      </div>}
      {dialogOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4"><div role="dialog" aria-modal="true" aria-labelledby="peer-template-title" className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-lg"><h2 id="peer-template-title" className="text-lg font-semibold text-gray-950">피어리뷰 양식 만들기</h2><dl className="mt-4 grid grid-cols-[110px_1fr] gap-y-2 text-sm"><dt className="text-gray-500">대상 평가기간</dt><dd>{formatEvaluationPeriod(activeProject.period)}</dd><dt className="text-gray-500">과제</dt><dd>{state.tasks.length}개</dd><dt className="text-gray-500">팀원</dt><dd>{expectedCount}명</dd><dt className="text-gray-500">생성 방식</dt><dd className="font-medium">팀원별 개별 파일 생성</dd></dl><p className="mt-4 text-sm leading-6 text-gray-600">모든 과제와 팀원 이름이 자동으로 포함되며, 과제별 기여도 합계는 100%로 균등 배분됩니다.</p>{generatedMembers.length > 0 && <p className="mt-3 text-sm text-success">{generatedMembers.length}명 파일 생성 완료</p>}<div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setDialogOpen(false)} className="ui-button ui-button-secondary">닫기</button><button type="button" onClick={() => void generateFiles()} className="ui-button ui-button-primary">Excel 양식 생성</button></div></div></div>}
    </section>
  )
}
