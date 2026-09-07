import { Fragment, useMemo, useState } from 'react'
import { useAppState } from '../state/AppContext'
import { useWorkspace } from '../state/WorkspaceContext'
import type { EvaluationGrade } from '../types'
import {
  calcAllTaskScores,
  calcMemberResults,
  calcPersonalGradeFactor,
  getContribution,
} from '../utils/calculations'
import { downloadFullBackup } from '../utils/fullBackup'
import Badge, { type BadgeTone } from './Badge'
import SectionHeader from './SectionHeader'
import { evaluationPeriodFolderName, formatEvaluationPeriod } from '../utils/workspace'
import CriteriaWorkspaceLayout from './CriteriaWorkspaceLayout'
import DisclosureIcon from './DisclosureIcon'
import { getMemberEvaluationHistory, GRADE_POINTS, mergeProjectHistoryForSimulation } from '../utils/growth'

const GRADE_TONES: Record<EvaluationGrade, BadgeTone> = {
  S: 'grade-s',
  A: 'grade-a',
  B: 'grade-b',
  C: 'grade-c',
  D: 'grade-d',
}

type SortKey = 'name' | 'score-desc' | 'score-asc' | 'grade'

const GRADE_ORDER: Record<EvaluationGrade, number> = {
  S: 0,
  A: 1,
  B: 2,
  C: 3,
  D: 4,
}

interface GradeTrendPoint {
  label: string
  grade: EvaluationGrade
}

function GradeTrend({ points }: { points: GradeTrendPoint[] }) {
  const visible = points.slice(-6)
  if (visible.length === 0) return <span className="text-gray-400">-</span>
  const width = 116
  const height = 32
  const padding = 5
  const coordinates = visible.map((point, index) => ({
    ...point,
    x: visible.length === 1 ? width / 2 : padding + (index * (width - padding * 2)) / (visible.length - 1),
    y: padding + ((5 - GRADE_POINTS[point.grade]) * (height - padding * 2)) / 4,
  }))
  return <svg viewBox={`0 0 ${width} ${height}`} className="mx-auto h-8 w-[116px] overflow-visible" role="img" aria-label={`성과 추이: ${visible.map((point) => `${point.label} ${point.grade}`).join(', ')}`}>
    {coordinates.length > 1 && <polyline points={coordinates.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
    {coordinates.map((point, index) => <g key={`${point.label}-${index}`}><title>{point.label} {point.grade}</title><circle cx={point.x} cy={point.y} r={index === coordinates.length - 1 ? 3.5 : 2.5} fill={index === coordinates.length - 1 ? '#f05a1a' : '#94a3b8'} /></g>)}
  </svg>
}

export default function EvaluationResults() {
  const { state } = useAppState()
  const { activeProject, activeTeam, workspace } = useWorkspace()
  const { tasks, members, contributions, criteria, peerReviews } = state
  const [searchQuery, setSearchQuery] = useState('')
  const [levelFilter, setLevelFilter] = useState('all')
  const [gradeFilter, setGradeFilter] = useState<'all' | EvaluationGrade>('all')
  const [sortKey, setSortKey] = useState<SortKey>('score-desc')
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null)
  const periodName = activeProject ? evaluationPeriodFolderName(activeProject.period) : String(new Date().getFullYear())

  const currentYear = new Date().getFullYear()
  const evaluationYear = activeProject?.period.year ?? currentYear
  const taskScores = calcAllTaskScores(tasks, criteria)
  const memberResults = calcMemberResults(members, tasks, contributions, criteria, peerReviews)
  const performanceByMember = useMemo(() => {
    const previousYear = evaluationYear - 1
    return new Map(members.map((member) => {
      const history = activeTeam ? getMemberEvaluationHistory(workspace, activeTeam.id, member.id) : []
      const stored = activeTeam?.growthProfiles.find((profile) => profile.memberId === member.id)?.performanceHistory ?? []
      const records = mergeProjectHistoryForSimulation(history, stored).sort((a, b) => a.year - b.year)
      const previous = records.find((record) => record.year === previousYear)
      const trend = records.flatMap((record) => [
        ...(record.firstHalf ? [{ label: `${record.year} 상`, grade: record.firstHalf }] : []),
        ...(record.secondHalf ? [{ label: `${record.year} 하`, grade: record.secondHalf }] : []),
      ])
      return [member.id, { previous, trend }] as const
    }))
  }, [activeProject?.id, activeTeam, evaluationYear, members, workspace.projects])
  const availableLevels = Array.from(
    new Set(memberResults.map((row) => row.member.level).filter((level) => level !== '')),
  )

  const visibleResults = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase('ko-KR')
    const filtered = memberResults.filter((row) => {
      const matchesName = !normalizedQuery || row.member.name.toLocaleLowerCase('ko-KR').includes(normalizedQuery)
      const matchesLevel = levelFilter === 'all' || row.member.level === levelFilter
      const matchesGrade = gradeFilter === 'all' || row.grade === gradeFilter
      return matchesName && matchesLevel && matchesGrade
    })

    return [...filtered].sort((a, b) => {
      if (sortKey === 'name') return a.member.name.localeCompare(b.member.name, 'ko-KR')
      if (sortKey === 'score-asc') return a.performanceScore - b.performanceScore
      if (sortKey === 'grade') return GRADE_ORDER[a.grade] - GRADE_ORDER[b.grade]
      return b.performanceScore - a.performanceScore
    })
  }, [gradeFilter, levelFilter, memberResults, searchQuery, sortKey])

  return (
    <CriteriaWorkspaceLayout>
    <div className="ui-page">
      <SectionHeader
        title="평가 결과"
        description={`${activeProject ? formatEvaluationPeriod(activeProject.period) : currentYear} 성과평가 · 팀원별 성과점수와 최종 고과를 검토합니다.`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => downloadFullBackup(state, periodName, activeTeam?.growthProfiles ?? [])}
              disabled={memberResults.length === 0}
              className="ui-button ui-button-primary"
            >
              Excel 다운로드
            </button>
          </div>
        }
      />

      <section aria-labelledby="member-results-title">
        <div className="ui-section-header mb-4">
          <div>
            <h3 id="member-results-title" className="ui-section-title">팀원 성과 결과</h3>
            <p className="ui-section-description">
              총 {memberResults.length}명 · 행을 펼치면 참여 과제와 개인별 계산 상세를 확인할 수 있습니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="팀원 검색"
              aria-label="팀원 이름 검색"
              className="ui-field w-40"
            />
            <select
              value={levelFilter}
              onChange={(event) => setLevelFilter(event.target.value)}
              aria-label="직급 필터"
              className="ui-field w-28"
            >
              <option value="all">전체 직급</option>
              {availableLevels.map((level) => <option key={level} value={level}>{level}</option>)}
            </select>
            <select
              value={gradeFilter}
              onChange={(event) => setGradeFilter(event.target.value as 'all' | EvaluationGrade)}
              aria-label="최종 고과 필터"
              className="ui-field w-28"
            >
              <option value="all">전체 고과</option>
              {(['S', 'A', 'B', 'C', 'D'] as EvaluationGrade[]).map((grade) => (
                <option key={grade} value={grade}>{grade}</option>
              ))}
            </select>
            <select
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value as SortKey)}
              aria-label="결과 정렬"
              className="ui-field w-36"
            >
              <option value="score-desc">성과점수 높은순</option>
              <option value="score-asc">성과점수 낮은순</option>
              <option value="name">팀원명순</option>
              <option value="grade">최종 고과순</option>
            </select>
          </div>
        </div>

        <div className="ui-table-wrap">
          <table className="ui-table min-w-[1080px]">
            <thead>
              <tr>
                <th>팀원</th>
                <th>직급</th>
                <th className="text-right">성과점수</th>
                <th className="text-center">최종 고과</th>
                <th className="text-center">전년도 상·하</th>
                <th className="text-center">변화</th>
                <th className="text-center">상태</th>
                <th className="text-right">상세</th>
              </tr>
            </thead>
            <tbody>
              {visibleResults.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-gray-500">
                    {memberResults.length === 0 ? '활성화된 팀원이 없습니다.' : '검색 조건에 맞는 팀원이 없습니다.'}
                  </td>
                </tr>
              )}
              {visibleResults.map((row) => {
                const isExpanded = expandedMemberId === row.member.id
                const performance = performanceByMember.get(row.member.id)
                const detailRows = taskScores.flatMap(({ task, score }) => {
                  const contribution = getContribution(contributions, task.id, row.member.id)
                  if (!contribution || contribution.contributionPercent <= 0) return []
                  const individualScore = score
                    * (contribution.contributionPercent / 100)
                    * calcPersonalGradeFactor(contribution, criteria)
                  return [{ task, taskScore: score, contribution, individualScore }]
                })

                return (
                  <Fragment key={row.member.id}>
                    <tr className={isExpanded ? 'bg-orange-50/40' : ''}>
                      <td>
                        <div className="font-medium text-gray-950">{row.member.name}</div>
                        <div className="mt-0.5 text-xs text-gray-500">{row.member.position || row.member.role || '-'}</div>
                      </td>
                      <td>{row.member.level || '-'}</td>
                      <td className="text-right font-semibold tabular-nums text-gray-950">
                        {row.performanceScore.toFixed(1)}
                      </td>
                      <td className="text-center">
                        <Badge tone={GRADE_TONES[row.grade]}>{row.grade}</Badge>
                      </td>
                      <td className="text-center"><div className="flex items-center justify-center gap-2"><span className="flex items-center gap-1 text-[11px] text-gray-400">상{performance?.previous?.firstHalf ? <Badge tone={GRADE_TONES[performance.previous.firstHalf]}>{performance.previous.firstHalf}</Badge> : <span>-</span>}</span><span className="flex items-center gap-1 text-[11px] text-gray-400">하{performance?.previous?.secondHalf ? <Badge tone={GRADE_TONES[performance.previous.secondHalf]}>{performance.previous.secondHalf}</Badge> : <span>-</span>}</span></div></td>
                      <td className="text-center"><GradeTrend points={performance?.trend ?? []} /></td>
                      <td className="text-center"><Badge tone="neutral">평가중</Badge></td>
                      <td className="text-right">
                        <button
                          type="button"
                          onClick={() => setExpandedMemberId(isExpanded ? null : row.member.id)}
                          aria-expanded={isExpanded}
                          className="ui-button ui-button-ghost ui-button-sm h-8 w-8 px-0"
                          title={isExpanded ? `${row.member.name} 상세 축소` : `${row.member.name} 상세 확장`}
                          aria-label={isExpanded ? `${row.member.name} 상세 축소` : `${row.member.name} 상세 확장`}
                        >
                          <DisclosureIcon open={isExpanded} />
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} className="bg-gray-50/70 p-0">
                          <div className="px-6 py-5">
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                              <h4 className="text-sm font-semibold text-gray-900">{row.member.name} 참여 과제</h4>
                              <span className="text-xs text-gray-500">
                                참여 {row.participatedTaskCount}건 · 누적점수 {row.cumulativeScore.toFixed(1)}
                              </span>
                            </div>
                            {detailRows.length === 0 ? (
                              <p className="text-sm text-gray-500">참여 과제가 없습니다.</p>
                            ) : (
                              <div className="overflow-x-auto border-y border-gray-200">
                                <table className="ui-table min-w-[720px]">
                                  <thead>
                                    <tr>
                                      <th className="px-3 py-2 font-semibold">과제</th>
                                      <th className="px-3 py-2 text-right font-semibold">과제점수</th>
                                      <th className="px-3 py-2 text-right font-semibold">기여도</th>
                                      <th className="px-3 py-2 text-center font-semibold">수행등급</th>
                                      <th className="px-3 py-2 text-right font-semibold">개인점수</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {detailRows.map(({ task, taskScore, contribution, individualScore }) => (
                                      <tr key={task.id} className="border-t border-gray-200 first:border-t-0">
                                        <td className="px-3 py-2.5 font-medium text-gray-900">{task.name}</td>
                                        <td className="px-3 py-2.5 text-right tabular-nums">{taskScore.toFixed(1)}</td>
                                        <td className="px-3 py-2.5 text-right tabular-nums">{contribution.contributionPercent.toFixed(0)}%</td>
                                        <td className="px-3 py-2.5 text-center">{contribution.personalPerformanceGrade}</td>
                                        <td className="px-3 py-2.5 text-right font-medium tabular-nums">{individualScore.toFixed(1)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-gray-200 pt-4 text-xs text-gray-500">
          <span className="font-medium text-gray-700">적용 기준</span>
          <span>성과등급 {criteria.performanceGradeWeight}%</span>
          <span>과제등급 {criteria.taskGradeWeight}%</span>
          <span>업무량 {criteria.workloadWeight}%</span>
          <span>기여도 {criteria.contributionWeight}%</span>
          <span>개인수행등급 {criteria.personalGradeWeight}%</span>
          <span>피어리뷰 {criteria.peerReviewWeight > 0 ? '추천 사용' : '미사용'}</span>
        </div>
      </section>

    </div>
    </CriteriaWorkspaceLayout>
  )
}
