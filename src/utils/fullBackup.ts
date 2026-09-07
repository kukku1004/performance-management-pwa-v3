import * as XLSX from 'xlsx-js-style'
import type { AppState, MemberGrowthProfile, WorkspaceState } from '../types'
import {
  PERSONAL_GRADE_FACTOR,
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
  inputColumns: number[] = [],
) {
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet['!cols'] = widths.map((wch) => ({ wch }))
  sheet['!rows'] = rows.map((row, index) => ({ hpt: index === 0 ? 28 : row.some((value) => String(value).length > 50) ? 38 : 24 }))
  sheet['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' }
  if (rows.length > 0 && widths.length > 0) sheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(widths.length - 1)}${rows.length}` }
  const range = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null
  if (range) {
    for (let row = range.s.r; row <= range.e.r; row += 1) {
      for (let column = range.s.c; column <= range.e.c; column += 1) {
        const address = XLSX.utils.encode_cell({ r: row, c: column })
        const cell = sheet[address]
        if (!cell) continue
        const bodyFill = inputColumns.includes(column) ? 'FFF1E6' : row % 2 === 0 ? 'F7F8FA' : 'FFFFFF'
        const border = { style: 'thin' as const, color: { rgb: 'D9DEE7' } }
        cell.s = {
          font: { name: 'Arial', sz: row === 0 ? 10 : 9, bold: row === 0, color: { rgb: row === 0 ? 'FFFFFF' : '111827' } },
          fill: { patternType: 'solid', fgColor: { rgb: row === 0 ? '17233B' : bodyFill } },
          alignment: { vertical: 'center', horizontal: row === 0 ? 'center' : typeof cell.v === 'number' ? 'right' : 'left', wrapText: true },
          border: { top: border, right: border, bottom: border, left: border },
        }
      }
    }
  }
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

export function createFullBackupWorkbook(state: AppState, periodName: string, growthProfiles: MemberGrowthProfile[] = []): XLSX.WorkBook {
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
    '05_팀원 성과결과',
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
    '01_과제 입력',
    [
      ['과제명', '과제등급', '업무량', '목표', '성과', '성과등급'],
      ...state.tasks.map((task) => [
        task.name,
        task.importance,
        task.workload,
        task.objective || '',
        task.achievement || '',
        task.performanceGrade,
      ]),
    ],
    [26, 12, 10, 34, 34, 12],
    [0, 1, 2, 3, 4, 5],
  )

  appendSheet(
    workbook,
    '02_팀원 입력',
    [
      ['이름', '직책', '직급', '연차', '역할', '코멘트'],
      ...state.members.map((member) => [
        member.name,
        member.position || '',
        member.level || '',
        member.yearsOfService ?? '',
        member.role || '',
        member.comment || '',
      ]),
    ],
    [14, 12, 12, 10, 22, 36],
    [0, 1, 2, 3, 4, 5],
  )

  const detailRows: (string | number | boolean)[][] = [
    ['평가기간', '팀원', '과제명', '과제점수', '기여도(%)', '자동배분 여부', '개인 수행등급', '평가 근거', '원래 수행계수', '실제 적용계수', '개인점수'],
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
        contribution.isAutoDistributed ? '예' : '아니오',
        contribution.personalPerformanceGrade,
        contribution.evaluationNote ?? '',
        PERSONAL_GRADE_FACTOR[contribution.personalPerformanceGrade],
        Number(personalFactor.toFixed(2)),
        Number((taskScore * (contribution.contributionPercent / 100) * personalFactor).toFixed(1)),
      ])
    }
  }
  appendSheet(workbook, '06_개인별 상세', detailRows, [18, 14, 26, 12, 12, 14, 15, 36, 15, 15, 12])

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

  appendSheet(
    workbook,
    '03_이전성과 입력',
    [
      ['이름', '직급', '승진심사 시기', '평가연도', '업적(상)', '업적(하)', '역량'],
      ...growthProfiles.flatMap((profile) => {
        const member = state.members.find((item) => item.id === profile.memberId)
        return (profile.performanceHistory ?? []).map((record, index) => [
          index === 0 ? member?.name ?? '' : '',
          index === 0 ? member?.level ?? '' : '',
          index === 0 ? profile.promotionReviewDate : '',
          record.year,
          record.firstHalf ?? '',
          record.secondHalf ?? '',
          record.competency ?? '',
        ])
      }),
    ],
    [14, 10, 17, 12, 12, 12, 12],
    [0, 1, 2, 3, 4, 5, 6],
  )

  appendSheet(
    workbook,
    '04_피어리뷰 입력',
    [
      ['과제명', '리뷰어', '대상팀원', '기여도(%)', '수행등급', '근거'],
      ...state.peerReviews.map((review) => [
        state.tasks.find((task) => task.id === review.taskId)?.name ?? '',
        review.reviewerName,
        state.members.find((member) => member.id === review.targetMemberId)?.name ?? '',
        review.contributionPercent ?? '',
        review.grade ?? '',
        review.evidence,
      ]),
    ],
    [24, 14, 14, 13, 12, 48],
    [0, 1, 2, 3, 4, 5],
  )

  appendSheet(
    workbook,
    '09_면담기록',
    [
      ['팀원', '면담일', '성과기간', '출처', '원본 파일', '면담 내용'],
      ...state.meetingNotes.filter((note) => note.source !== 'performance-pdf').map((note) => [
        state.members.find((member) => member.id === note.memberId)?.name ?? '',
        note.date,
        note.sourcePeriod ?? '',
        '직접 작성',
        note.sourceFileName ?? '',
        note.comment,
      ]),
    ],
    [14, 13, 18, 12, 28, 52],
  )

  appendSheet(
    workbook,
    '10_코멘트기록',
    [
      ['팀원', '성과기간', '원본 파일', '코멘트'],
      ...growthProfiles.flatMap((profile) => {
        const memberName = state.members.find((member) => member.id === profile.memberId)?.name ?? ''
        return (profile.importedPerformanceDocuments ?? []).flatMap((document) => (document.selectedComments ?? []).map((comment) => [memberName, document.periodLabel, document.fileName, comment]))
      }),
      ...state.meetingNotes.filter((note) => note.source === 'performance-pdf').flatMap((note) => note.comment.split(/\n{2,}/).map((comment) => [state.members.find((member) => member.id === note.memberId)?.name ?? '', note.sourcePeriod ?? '', note.sourceFileName ?? '', comment])),
    ],
    [14, 18, 30, 72],
  )

  workbook.SheetNames = ['01_과제 입력', '02_팀원 입력', '03_이전성과 입력', '04_피어리뷰 입력', '05_팀원 성과결과', '06_개인별 상세', '07_과제별 결과', '08_평가기준', '09_면담기록', '10_코멘트기록']

  return workbook
}

export function workbookToBlob(workbook: XLSX.WorkBook): Blob {
  const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', cellStyles: true })
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
  appendSheet(workbook, '전체 프로젝트 목록', [['번호', '팀', '평가기간', '과제 수', '팀원 수', '수정일'], ...workspace.projects.map((project, index) => [index + 1, teamNameById.get(project.teamId) ?? '-', formatEvaluationPeriod(project.period), project.appState.tasks.length, project.appState.members.length, project.updatedAt])], [8, 22, 18, 12, 12, 24])
  workspace.projects.forEach((project, projectIndex) => {
    const growthProfiles = workspace.teams.find((team) => team.id === project.teamId)?.growthProfiles ?? []
    const projectWorkbook = createFullBackupWorkbook(project.appState, formatEvaluationPeriod(project.period), growthProfiles)
    projectWorkbook.SheetNames.forEach((sheetName) => {
      const prefix = `P${projectIndex + 1}_`
      const name = `${prefix}${sheetName}`.slice(0, 31)
      XLSX.utils.book_append_sheet(workbook, projectWorkbook.Sheets[sheetName], name)
    })
  })
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

export function downloadFullBackup(state: AppState, periodName: string, growthProfiles: MemberGrowthProfile[] = []) {
  const safePeriodName = sanitizePeriodName(periodName)
  if (!safePeriodName) throw new Error('평가기간명을 입력하세요.')
  downloadBlob(
    workbookToBlob(createFullBackupWorkbook(state, periodName.trim(), growthProfiles)),
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
