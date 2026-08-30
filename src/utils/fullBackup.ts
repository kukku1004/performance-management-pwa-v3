import * as XLSX from 'xlsx'
import type { AppState, WorkspaceState } from '../types'
import {
  IMPORTANCE_WEIGHT,
  PERFORMANCE_SCORE,
  PERSONAL_GRADE_FACTOR,
  WORKLOAD_FACTOR,
  blendByWeight,
  calcAllTaskScores,
  calcMemberResults,
  calcPersonalGradeFactor,
  getContribution,
} from './calculations'
import { migrateAppState } from './migrate'
import { formatEvaluationPeriod } from './workspace'

export const BACKUP_SCHEMA_VERSION = 1

export interface EvaluationPeriodInfo {
  name: string
}

export interface FullBackupEnvelope {
  schemaVersion: number
  exportedAt: string
  evaluationPeriod: EvaluationPeriodInfo
  appState: AppState
  computedResults: {
    taskScores: ReturnType<typeof calcAllTaskScores>
    memberResults: ReturnType<typeof calcMemberResults>
  }
}

function appendSheet(
  workbook: XLSX.WorkBook,
  name: string,
  rows: (string | number | boolean)[][],
  widths: number[],
) {
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet['!cols'] = widths.map((wch) => ({ wch }))
  sheet['!freeze'] = { xSplit: 0, ySplit: 1 }
  XLSX.utils.book_append_sheet(workbook, sheet, name)
}

export function createFullBackupEnvelope(state: AppState, periodName: string): FullBackupEnvelope {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    evaluationPeriod: { name: periodName },
    appState: state,
    computedResults: {
      taskScores: calcAllTaskScores(state.tasks, state.criteria),
      memberResults: calcMemberResults(
        state.members,
        state.tasks,
        state.contributions,
        state.criteria,
        state.peerReviews,
      ),
    },
  }
}

export function parseFullBackupJson(text: string): FullBackupEnvelope {
  const raw = JSON.parse(text) as Partial<FullBackupEnvelope>
  if (raw.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new Error(`지원하지 않는 백업 버전입니다. (schemaVersion: ${String(raw.schemaVersion)})`)
  }
  if (!raw.evaluationPeriod || typeof raw.evaluationPeriod.name !== 'string' || !raw.evaluationPeriod.name.trim()) {
    throw new Error('평가기간 정보가 없는 백업입니다.')
  }
  const migrated = migrateAppState(raw.appState)
  if (!migrated) throw new Error('앱 상태를 복원할 수 없는 백업입니다.')
  return createFullBackupEnvelope(migrated, raw.evaluationPeriod.name.trim())
}

export function createFullBackupWorkbook(state: AppState, periodName: string): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new()
  const taskScores = calcAllTaskScores(state.tasks, state.criteria)
  const taskScoreMap = new Map(taskScores.map(({ task, score }) => [task.id, score]))
  const results = calcMemberResults(
    state.members,
    state.tasks,
    state.contributions,
    state.criteria,
    state.peerReviews,
  )

  appendSheet(
    workbook,
    '01_팀원 성과결과',
    [
      ['평가기간', '순위', '팀원', '직급', '직책', '역할', '참여 과제 수', '성과점수', '누적점수', '최종 고과'],
      ...results.map((row, index) => [
        periodName,
        index + 1,
        row.member.name,
        row.member.level || '-',
        row.member.position || '-',
        row.member.role || '-',
        row.participatedTaskCount,
        Number(row.performanceScore.toFixed(1)),
        Number(row.cumulativeScore.toFixed(1)),
        row.grade,
      ]),
    ],
    [18, 7, 14, 10, 10, 16, 13, 12, 12, 11],
  )

  appendSheet(
    workbook,
    '02_과제관리',
    [
      ['평가기간', '과제명', '과제등급', '중요도 적용계수', '성과등급', '성과등급 점수', '업무량', '업무량 적용계수', '과제점수', '목표', '성과'],
      ...state.tasks.map((task) => [
        periodName,
        task.name,
        task.importance,
        Number(blendByWeight(1, IMPORTANCE_WEIGHT[task.importance], state.criteria.taskGradeWeight).toFixed(2)),
        task.performanceGrade,
        Number(blendByWeight(100, PERFORMANCE_SCORE[task.performanceGrade], state.criteria.performanceGradeWeight).toFixed(1)),
        task.workload,
        Number(blendByWeight(1, WORKLOAD_FACTOR[task.workload], state.criteria.workloadWeight).toFixed(2)),
        Number((taskScoreMap.get(task.id) ?? 0).toFixed(1)),
        task.objective || '-',
        task.achievement || '-',
      ]),
    ],
    [18, 24, 11, 16, 11, 16, 9, 16, 12, 28, 28],
  )

  appendSheet(
    workbook,
    '03_팀원관리',
    [
      ['평가기간', '이름', '직급', '직책', '연차', '역할', '활성여부', '코멘트'],
      ...state.members.map((member) => [
        periodName,
        member.name,
        member.level || '-',
        member.position || '-',
        member.yearsOfService ?? '-',
        member.role || '-',
        member.active ? '사용' : '미사용',
        member.comment || '-',
      ]),
    ],
    [18, 14, 10, 10, 8, 16, 11, 32],
  )

  appendSheet(
    workbook,
    '04_기여도평가',
    [
      ['평가기간', '과제명', '팀원', '기여도(%)', '자동배분 여부'],
      ...state.contributions.map((contribution) => [
        periodName,
        state.tasks.find((task) => task.id === contribution.taskId)?.name ?? '(삭제된 과제)',
        state.members.find((member) => member.id === contribution.memberId)?.name ?? '(삭제된 팀원)',
        contribution.contributionPercent,
        contribution.isAutoDistributed ? '예' : '아니오',
      ]),
    ],
    [18, 24, 14, 12, 14],
  )

  appendSheet(
    workbook,
    '05_개인수행평가',
    [
      ['평가기간', '과제명', '팀원', '개인 수행등급', '평가 근거', '원래 수행계수', '실제 적용계수', '기준 사용여부'],
      ...state.contributions.map((contribution) => [
        periodName,
        state.tasks.find((task) => task.id === contribution.taskId)?.name ?? '(삭제된 과제)',
        state.members.find((member) => member.id === contribution.memberId)?.name ?? '(삭제된 팀원)',
        contribution.personalPerformanceGrade,
        contribution.evaluationNote ?? '',
        PERSONAL_GRADE_FACTOR[contribution.personalPerformanceGrade],
        Number(calcPersonalGradeFactor(contribution, state.criteria).toFixed(2)),
        state.criteria.personalGradeWeight > 0 ? '사용' : '미사용',
      ]),
    ],
    [18, 24, 14, 15, 32, 15, 15, 14],
  )

  const detailRows: (string | number | boolean)[][] = [
    ['평가기간', '팀원', '과제명', '과제점수', '기여도(%)', '개인 수행등급', '평가 근거', '개인 수행계수', '개인점수'],
  ]
  for (const member of state.members) {
    for (const task of state.tasks) {
      const contribution = getContribution(state.contributions, task.id, member.id)
      if (!contribution || contribution.contributionPercent <= 0) continue
      const taskScore = taskScoreMap.get(task.id) ?? 0
      const personalFactor = calcPersonalGradeFactor(contribution, state.criteria)
      detailRows.push([
        periodName,
        member.name,
        task.name,
        Number(taskScore.toFixed(1)),
        contribution.contributionPercent,
        contribution.personalPerformanceGrade,
        contribution.evaluationNote ?? '',
        Number(personalFactor.toFixed(2)),
        Number((taskScore * (contribution.contributionPercent / 100) * personalFactor).toFixed(1)),
      ])
    }
  }
  appendSheet(workbook, '06_개인별 상세', detailRows, [18, 14, 24, 12, 12, 15, 32, 15, 12])

  appendSheet(
    workbook,
    '07_과제별 결과',
    [
      ['평가기간', '과제명', '과제등급', '성과등급', '업무량', '과제점수', '기여도 합계(%)'],
      ...taskScores.map(({ task, score }) => [
        periodName,
        task.name,
        task.importance,
        task.performanceGrade,
        task.workload,
        Number(score.toFixed(1)),
        state.contributions
          .filter((contribution) => contribution.taskId === task.id)
          .reduce((sum, contribution) => sum + contribution.contributionPercent, 0),
      ]),
    ],
    [18, 24, 11, 11, 9, 12, 16],
  )

  appendSheet(
    workbook,
    '08_평가기준',
    [
      ['평가기간', '기준', '사용여부', '반영 비율(%)', '실제 계수/점수'],
      [periodName, '성과등급', state.criteria.performanceGradeWeight > 0 ? '사용' : '미사용', state.criteria.performanceGradeWeight, 'S 100 / A 90 / B 80 / C 70 / D 60'],
      [periodName, '과제등급', state.criteria.taskGradeWeight > 0 ? '사용' : '미사용', state.criteria.taskGradeWeight, '중점 1.3 / 핵심 1.1 / 일반 1.0 / 지원 0.8'],
      [periodName, '업무량', state.criteria.workloadWeight > 0 ? '사용' : '미사용', state.criteria.workloadWeight, '대 1.2 / 중 1.0 / 소 0.8'],
      [periodName, '개인 수행등급', state.criteria.personalGradeWeight > 0 ? '사용' : '미사용', state.criteria.personalGradeWeight, 'S 1.5 / A 1.2 / B 1.0 / C 0.8 / D 0.6'],
      [periodName, '피어리뷰', state.criteria.peerReviewWeight > 0 ? '사용' : '미사용', state.criteria.peerReviewWeight, '수신 등급 평균을 적용'],
      [periodName, '최종 고과 배분', '상대평가', 100, `S ${state.criteria.gradeSPercent}% / A ${state.criteria.gradeAPercent}% / B ${state.criteria.gradeBPercent}% / C ${state.criteria.gradeCPercent}% / D ${state.criteria.gradeDPercent}%`],
      [periodName, '기여도', '필수', 100, '과제별 합계 100%'],
    ],
    [18, 18, 12, 16, 48],
  )

  return workbook
}

export function workbookToBlob(workbook: XLSX.WorkBook): Blob {
  const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

export function backupToJsonBlob(backup: unknown): Blob {
  return new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
}

export function createWorkspaceBackupEnvelope(workspace: WorkspaceState) {
  return { schemaVersion: 1, backupType: 'workspace', exportedAt: new Date().toISOString(), workspace }
}

export function createWorkspaceBackupWorkbook(workspace: WorkspaceState): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new()
  const teamNameById = new Map(workspace.teams.map((team) => [team.id, team.name]))
  appendSheet(workbook, '01_팀', [['팀명', '팀원 수', '프로젝트 수'], ...workspace.teams.map((team) => [team.name, team.members.length, workspace.projects.filter((project) => project.teamId === team.id).length])], [24, 12, 14])
  appendSheet(workbook, '02_프로젝트', [['팀', '평가기간', '과제 수', '팀원 수', '수정일'], ...workspace.projects.map((project) => [teamNameById.get(project.teamId) ?? '-', formatEvaluationPeriod(project.period), project.appState.tasks.length, project.appState.members.length, project.updatedAt])], [24, 18, 12, 12, 24])
  appendSheet(workbook, '03_팀원', [['팀', '평가기간', '이름', '직급', '직책', '연차', '역할'], ...workspace.projects.flatMap((project) => project.appState.members.map((member) => [teamNameById.get(project.teamId) ?? '-', formatEvaluationPeriod(project.period), member.name, member.level || '-', member.position || '-', member.yearsOfService ?? '-', member.role || '-']))], [20, 18, 14, 10, 10, 8, 18])
  appendSheet(workbook, '04_과제', [['팀', '평가기간', '과제명', '중요도', '성과등급', '업무량', '목표', '성과'], ...workspace.projects.flatMap((project) => project.appState.tasks.map((task) => [teamNameById.get(project.teamId) ?? '-', formatEvaluationPeriod(project.period), task.name, task.importance, task.performanceGrade, task.workload, task.objective || '-', task.achievement || '-']))], [20, 18, 24, 10, 10, 10, 30, 30])
  appendSheet(workbook, '05_성과결과', [['팀', '평가기간', '팀원', '성과점수', '누적점수', '최종 고과'], ...workspace.projects.flatMap((project) => calcMemberResults(project.appState.members, project.appState.tasks, project.appState.contributions, project.appState.criteria, project.appState.peerReviews).map((result) => [teamNameById.get(project.teamId) ?? '-', formatEvaluationPeriod(project.period), result.member.name, Number(result.performanceScore.toFixed(1)), Number(result.cumulativeScore.toFixed(1)), result.grade]))], [20, 18, 14, 12, 12, 12])
  appendSheet(workbook, '06_면담기록', [['팀', '평가기간', '팀원', '면담일', '내용'], ...workspace.projects.flatMap((project) => project.appState.meetingNotes.map((note) => [teamNameById.get(project.teamId) ?? '-', formatEvaluationPeriod(project.period), project.appState.members.find((member) => member.id === note.memberId)?.name ?? '-', note.date, note.comment]))], [20, 18, 14, 14, 48])
  return workbook
}

export function sanitizePeriodName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 80)
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadFullBackup(state: AppState, periodName: string) {
  const safePeriodName = sanitizePeriodName(periodName)
  if (!safePeriodName) throw new Error('평가기간명을 입력하세요.')
  downloadBlob(
    workbookToBlob(createFullBackupWorkbook(state, periodName.trim())),
    `${safePeriodName}_성과관리.xlsx`,
  )
}

export function downloadFullBackupJson(state: AppState, periodName: string) {
  const safePeriodName = sanitizePeriodName(periodName)
  if (!safePeriodName) throw new Error('평가기간명을 입력하세요.')
  downloadBlob(
    backupToJsonBlob(createFullBackupEnvelope(state, periodName.trim())),
    `${safePeriodName}_성장관리_data.json`,
  )
}
