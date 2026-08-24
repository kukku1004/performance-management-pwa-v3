import { useRef, useState } from 'react'
import { useAppState } from '../state/AppContext'
import type { PerformanceGrade } from '../types'
import { PERFORMANCE_GRADE_OPTIONS } from '../types'
import {
  calcTaskScore,
  calcMemberResults,
  getContribution,
  getContributionPercent,
  getPersonalPerformanceGrade,
  getTaskContributionSum,
  isContributionSumValid,
} from '../utils/calculations'
import { summarizePeerReviews } from '../utils/peerReview'
import SectionHeader from './SectionHeader'
import PeerReviewDetailDrawer from './PeerReviewDetailDrawer'
import CriteriaWorkspaceLayout from './CriteriaWorkspaceLayout'
import EvaluationNoteButton from './EvaluationNoteButton'

const TASK_MIN_WIDTH = 180
const TASK_MAX_WIDTH = 520
const CONTRIBUTION_WIDTH = 76
const MEMBER_MIN_WIDTH = 260

export default function EvaluationMatrix() {
  const { state, dispatch } = useAppState()
  const { tasks, members, contributions, criteria } = state
  const [detail, setDetail] = useState<{ taskId: string; memberId: string } | null>(null)
  const [taskWidth, setTaskWidth] = useState(260)
  const taskResizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const contributionEnabled = criteria.contributionWeight > 0
  const personalGradeEnabled = criteria.personalGradeWeight > 0
  const peerReviewEnabled = criteria.peerReviewWeight > 0
  const results = calcMemberResults(members, tasks, contributions, criteria, state.peerReviews)
  const resultByMember = new Map(results.map((result) => [result.member.id, result]))
  const memberTableMinWidth = members.length * MEMBER_MIN_WIDTH

  function startTaskResize(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    taskResizeRef.current = { startX: event.clientX, startWidth: taskWidth }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveTaskResize(event: React.PointerEvent<HTMLButtonElement>) {
    if (!taskResizeRef.current) return
    setTaskWidth(Math.max(TASK_MIN_WIDTH, Math.min(TASK_MAX_WIDTH, taskResizeRef.current.startWidth + event.clientX - taskResizeRef.current.startX)))
  }

  function endTaskResize() { taskResizeRef.current = null }

  function handlePercentChange(taskId: string, memberId: string, value: string) {
    const parsed = value === '' ? 0 : parseFloat(value)
    if (Number.isNaN(parsed)) return
    const clamped = Math.min(100, Math.max(0, parsed))
    dispatch({ type: 'SET_CONTRIBUTION_PERCENT', payload: { taskId, memberId, contributionPercent: clamped } })
  }

  function handleGradeChange(taskId: string, memberId: string, grade: PerformanceGrade) {
    dispatch({
      type: 'SET_CONTRIBUTION_GRADE',
      payload: { taskId, memberId, personalPerformanceGrade: grade },
    })
  }

  function handleNoteSave(taskId: string, memberId: string, evaluationNote: string) {
    dispatch({ type: 'SET_CONTRIBUTION_NOTE', payload: { taskId, memberId, evaluationNote } })
  }

  return (
    <CriteriaWorkspaceLayout>
    <div className="space-y-3">
      <SectionHeader compact title="평가 매트릭스" description={
      <>
        과제(행) × 팀원(열)로 기여도와 개인수행등급을 입력하세요. 참여하지 않은 칸은 비워두면 됩니다.{' '}
        사용 중인 기준만 입력하고, 피어리뷰 추천값은 검토 후 선택적으로 적용하세요. 과제별 기여도 합계는 100%로 맞춰야 합니다.
      </>} />

      {tasks.length === 0 || members.length === 0 ? (
        <p className="ui-empty">
          평가 매트릭스를 입력하려면 먼저 과제와 팀원을 등록하세요.
        </p>
      ) : (
        <>
          <div className="flex overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="ui-table table-fixed shrink-0" style={{ width: taskWidth + (contributionEnabled ? CONTRIBUTION_WIDTH : 0) }}>
              <colgroup><col style={{ width: taskWidth }} />{contributionEnabled && <col style={{ width: CONTRIBUTION_WIDTH }} />}</colgroup>
              <thead><tr className="h-[82px]"><th className="relative border-r border-gray-200 bg-white px-4 align-bottom">과제명<button type="button" aria-label="과제명 열 너비 조절" onPointerDown={startTaskResize} onPointerMove={moveTaskResize} onPointerUp={endTaskResize} onPointerCancel={endTaskResize} style={{ touchAction: 'none' }} className="absolute inset-y-0 right-0 w-2 cursor-col-resize border-r border-gray-300 hover:border-orange-400" /></th>{contributionEnabled && <th className="whitespace-nowrap bg-white px-2 text-center align-bottom">기여도</th>}</tr></thead>
              <tbody>{tasks.map((task) => { const sum = getTaskContributionSum(contributions, task.id); const taskScore = calcTaskScore(task, criteria); const valid = isContributionSumValid(sum); return <tr key={task.id} className="h-16"><td className="border-r border-gray-200 px-4"><div className="line-clamp-2 font-medium">{task.name}</div><div className="mt-0.5 truncate text-xs text-gray-500">{task.importance} · 업무량 {task.workload} · 점수 {taskScore.toFixed(1)}</div></td>{contributionEnabled && <td className={`whitespace-nowrap px-2 text-center font-semibold ${valid ? 'text-success' : 'text-danger'}`}>{sum.toFixed(0)}%</td>}</tr> })}</tbody>
            </table>
            <div className="min-w-0 flex-1 overflow-x-auto">
              <table className="ui-table table-fixed" style={{ width: '100%', minWidth: memberTableMinWidth }}>
                <colgroup>{members.map((member) => <col key={member.id} style={{ width: `${100 / members.length}%` }} />)}</colgroup>
                <thead><tr className="h-[82px]">{members.map((member) => { const result = resultByMember.get(member.id); const rank = result ? results.filter((item) => item.performanceScore > result.performanceScore).length + 1 : '-'; return <th key={member.id} className="border-l border-gray-200 px-4 py-3 text-center align-bottom"><div className="font-semibold normal-case tracking-normal text-gray-950">{member.name}</div><div className="mt-1 whitespace-nowrap text-[11px] font-medium normal-case tracking-normal text-gray-500">{rank}위 · {result?.performanceScore.toFixed(1) ?? '0.0'}점 · {result?.grade ?? '-'}</div></th> })}</tr></thead>
                <tbody>{tasks.map((task) => <tr key={task.id} className="h-16">{members.map((member) => {
                        const percent = getContributionPercent(contributions, task.id, member.id)
                        const grade = getPersonalPerformanceGrade(contributions, task.id, member.id)
                        const contribution = getContribution(contributions, task.id, member.id)
                        const peer = summarizePeerReviews(state.peerReviews, task.id, member.id)
                        return (
                          <td key={member.id} className="border-l border-gray-200 px-3 py-2">
                            <div className="flex items-center justify-center gap-3">
                              <div className={`flex h-12 w-[180px] shrink-0 items-center rounded-[10px] border px-4 ${percent > 0 ? 'border-gray-300 bg-white' : 'border-gray-200 bg-white'}`}>
                                {contributionEnabled && <div className="flex min-w-0 flex-1 items-center gap-2"><input type="number" min={0} max={100} step={1} value={percent || ''} onChange={(event) => handlePercentChange(task.id, member.id, event.target.value)} placeholder="0" className="w-11 shrink-0 appearance-none bg-transparent text-right text-base font-medium tabular-nums outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" /><span className="shrink-0 text-sm text-gray-400">%</span></div>}
                                {contributionEnabled && personalGradeEnabled && <span className="h-6 w-px shrink-0 bg-gray-200" />}
                                {personalGradeEnabled && <select value={grade} onChange={(event) => handleGradeChange(task.id, member.id, event.target.value as PerformanceGrade)} className="h-full w-14 shrink-0 bg-transparent pl-3 text-base font-medium outline-none">{PERFORMANCE_GRADE_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select>}
                              </div>
                              <EvaluationNoteButton note={contribution?.evaluationNote} label={`${member.name} · ${task.name} 평가 근거`} onSave={(note) => handleNoteSave(task.id, member.id, note)} />
                              {peerReviewEnabled && peer.peerCount > 0 && <button type="button" onClick={() => setDetail({ taskId: task.id, memberId: member.id })} title={Math.abs(percent - (peer.peerContribution ?? percent)) >= 10 ? '피어리뷰와 현재 평가 차이 큼' : '피어리뷰 있음'} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:bg-gray-100"><span className={`h-2.5 w-2.5 rounded-full ${Math.abs(percent - (peer.peerContribution ?? percent)) >= 10 ? 'bg-amber-500' : 'bg-blue-500'}`} /></button>}
                            </div>
                          </td>
                        )
                      })}</tr>)}</tbody>
              </table>
            </div>
          </div>

          {contributionEnabled && <div className="mt-3 flex flex-wrap gap-4 text-sm"><span className="text-success">● 기여도 합계 100% 정상</span><span className="text-danger">● 100%가 아닌 과제는 평가 확정 전 조정 필요</span></div>}
          {peerReviewEnabled && <div className="mt-2 flex gap-4 text-xs text-gray-500"><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-500" /> 피어리뷰 있음</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> 현재 평가와 차이 큼</span></div>}
        </>
      )}
      {detail && (() => { const task = tasks.find((item) => item.id === detail.taskId); const member = members.find((item) => item.id === detail.memberId); const summary = summarizePeerReviews(state.peerReviews, detail.taskId, detail.memberId); return <PeerReviewDetailDrawer task={task} member={member} currentContribution={getContributionPercent(contributions, detail.taskId, detail.memberId)} currentGrade={getPersonalPerformanceGrade(contributions, detail.taskId, detail.memberId)} summary={summary} onApplyContribution={() => summary.peerContribution !== null && handlePercentChange(detail.taskId, detail.memberId, String(summary.peerContribution))} onApplyGrade={() => summary.recommendedGrade && handleGradeChange(detail.taskId, detail.memberId, summary.recommendedGrade)} onClose={() => setDetail(null)} /> })()}
    </div>
    </CriteriaWorkspaceLayout>
  )
}
