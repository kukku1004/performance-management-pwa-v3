import type { EvaluationGrade, GrowthPerformanceRecord, Level, MemberGrowthProfile, WorkspaceState } from '../types'
import { calcAllTaskScores, calcMemberResults, calcPersonalGradeFactor, getContribution } from './calculations'
import { formatEvaluationPeriod } from './workspace'

export interface MemberEvaluationHistory {
  projectId: string
  label: string
  year: number
  score: number
  grade: EvaluationGrade
  createdAt: string
}

export const GRADE_POINTS: Record<EvaluationGrade, number> = { S: 5, A: 4, B: 3, C: 2, D: 1 }

export function getMemberEvaluationHistory(
  workspace: WorkspaceState,
  teamId: string,
  memberId: string,
): MemberEvaluationHistory[] {
  return workspace.projects
    .filter((project) => project.teamId === teamId && project.appState.members.some((member) => member.id === memberId))
    .flatMap((project) => {
      const result = calcMemberResults(
        project.appState.members,
        project.appState.tasks,
        project.appState.contributions,
        project.appState.criteria,
        project.appState.peerReviews,
      ).find((row) => row.member.id === memberId)
      if (!result) return []
      return [{
        projectId: project.id,
        label: formatEvaluationPeriod(project.period),
        year: project.period.year,
        score: result.performanceScore,
        grade: result.grade,
        createdAt: project.createdAt,
      }]
    })
    .sort((a, b) => b.year - a.year || b.createdAt.localeCompare(a.createdAt))
}

export function getDefaultGrowthProfile(memberId: string): MemberGrowthProfile {
  return { memberId, promotionReviewDate: '', promotionTargetScore: 50, growthMemo: '', personalNotes: [], positionYears: 5, performanceHistory: [], auxiliaryMetrics: { position: 0, rewardPenalty: 0, tenure: 0, education: 0 } }
}

export function applyMemberTenure(profile: MemberGrowthProfile, member: { yearsOfService: number | null }) {
  const auxiliaryMetrics = profile.auxiliaryMetrics ?? { position: 0, rewardPenalty: 0, tenure: 0, education: 0 }
  const managedTenure = member.yearsOfService !== null && Number.isFinite(member.yearsOfService) ? member.yearsOfService : null
  const tenure = auxiliaryMetrics.tenureOverridden === true
    ? auxiliaryMetrics.tenure
    : managedTenure ?? auxiliaryMetrics.tenure
  return { ...profile, auxiliaryMetrics: { ...auxiliaryMetrics, tenure } }
}

export const PROMOTION_RULES: Record<Exclude<Level, '부장'>, { next: Level; years: number; target: number }> = {
  사원: { next: '대리', years: 3, target: 36 },
  대리: { next: '과장', years: 4, target: 50 },
  과장: { next: '차장', years: 5, target: 66 },
  차장: { next: '부장', years: 5, target: 68 },
}

export const YEAR_WEIGHTS: Record<number, number[]> = {
  3: [1.5, 1, 0.5],
  4: [1.5, 1.15, 0.85, 0.5],
  5: [1.5, 1.25, 1, 0.75, 0.5],
}

export function getPromotionYears(reviewDate: string, fallbackYear = new Date().getFullYear() + 1) {
  const reviewYear = Number(reviewDate.slice(0, 4)) || fallbackYear
  return Array.from({ length: 5 }, (_, index) => reviewYear - index - 1)
}

export function mergeProjectHistoryForSimulation(history: MemberEvaluationHistory[], stored: GrowthPerformanceRecord[] = []) {
  const byYear = new Map<number, GrowthPerformanceRecord>()
  for (const item of [...history].reverse()) {
    const record = byYear.get(item.year) ?? { year: item.year, firstHalf: null, secondHalf: null, competency: null }
    if (item.label.includes('상반기')) record.firstHalf = item.grade
    else if (item.label.includes('하반기')) record.secondHalf = item.grade
    else if (!record.secondHalf) record.secondHalf = item.grade
    byYear.set(item.year, record)
  }
  for (const item of stored) {
    const record = byYear.get(item.year) ?? { year: item.year, firstHalf: null, secondHalf: null, competency: null }
    byYear.set(item.year, {
      year: item.year,
      firstHalf: item.firstHalf ?? record.firstHalf,
      secondHalf: item.secondHalf ?? record.secondHalf,
      competency: item.competency ?? record.competency,
    })
  }
  return Array.from(byYear.values())
}

export function calculatePromotionSimulation(history: MemberEvaluationHistory[], profile: MemberGrowthProfile, level: Level | '') {
  const rule = level && level !== '부장' ? PROMOTION_RULES[level] : { next: '-', years: 5, target: profile.promotionTargetScore || 50 }
  const years = getPromotionYears(profile.promotionReviewDate)
  const records = mergeProjectHistoryForSimulation(history, profile.performanceHistory)
  const byYear = new Map(records.map((item) => [item.year, item]))
  const weights = YEAR_WEIGHTS[rule.years] ?? YEAR_WEIGHTS[5]
  const rows = years.map((year, index) => {
    const record = byYear.get(year) ?? { year, firstHalf: null, secondHalf: null, competency: null }
    const raw = (record.firstHalf ? GRADE_POINTS[record.firstHalf] : 0) + (record.secondHalf ? GRADE_POINTS[record.secondHalf] : 0) + (record.competency ? GRADE_POINTS[record.competency] * 2 : 0)
    const weighted = index < weights.length ? raw * weights[index] : 0
    return { ...record, raw, weight: index < weights.length ? weights[index] : 0, weighted }
  })
  const auxiliary = profile.auxiliaryMetrics ?? { position: 0, rewardPenalty: 0, tenure: 0, education: 0 }
  const auxiliaryScore = auxiliary.position + auxiliary.rewardPenalty + auxiliary.tenure + auxiliary.education
  const historyScore = rows.reduce((sum, row) => sum + row.weighted, 0)
  const currentScore = Math.round((historyScore + auxiliaryScore) * 10) / 10
  const targetScore = rule.target
  const neededScore = Math.max(0, Math.round((targetScore - currentScore) * 10) / 10)
  return {
    consideredCount: rows.filter((row) => row.firstHalf || row.secondHalf || row.competency).length,
    currentScore,
    targetScore,
    neededScore,
    canPromote: rule.next !== '-' && rows.some((row) => row.firstHalf || row.secondHalf || row.competency) && neededScore === 0,
    rows,
    auxiliaryScore,
    nextLevel: rule.next,
  }
}

export function getRecentMemberPerformance(
  workspace: WorkspaceState,
  teamId: string,
  memberId: string,
) {
  const history = getMemberEvaluationHistory(workspace, teamId, memberId)
  const latest = history[0]
  if (!latest) return null
  const detail = getMemberProjectPerformance(workspace, latest.projectId, memberId)
  if (!detail) return null
  return { latest, previous: history[1] ?? null, majorTasks: detail.majorTasks }
}

export function getMemberProjectPerformance(workspace: WorkspaceState, projectId: string, memberId: string) {
  const project = workspace.projects.find((item) => item.id === projectId)
  if (!project) return null
  const taskScores = new Map(calcAllTaskScores(project.appState.tasks, project.appState.criteria).map((row) => [row.task.id, row.score]))
  const majorTasks = project.appState.tasks
    .flatMap((task) => {
      const contribution = getContribution(project.appState.contributions, task.id, memberId)
      if (!contribution || contribution.contributionPercent <= 0) return []
      const individualScore = (taskScores.get(task.id) ?? 0)
        * (contribution.contributionPercent / 100)
        * calcPersonalGradeFactor(contribution, project.appState.criteria)
      return [{ id: task.id, name: task.name, importance: task.importance, contributionPercent: contribution.contributionPercent, grade: contribution.personalPerformanceGrade, evaluationNote: contribution.evaluationNote ?? '', individualScore }]
    })
    .sort((a, b) => b.individualScore - a.individualScore)
  return { majorTasks }
}
