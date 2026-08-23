import * as XLSX from 'xlsx'
import { v4 as uuidv4 } from 'uuid'
import type {
  Contribution,
  Criteria,
  Importance,
  Level,
  MeetingNote,
  PeerReview,
  PerformanceGrade,
  Position,
  Task,
  TeamMember,
  Workload,
} from '../types'
import { IMPORTANCE_OPTIONS, LEVEL_OPTIONS, PERFORMANCE_GRADE_OPTIONS, POSITION_OPTIONS, WORKLOAD_OPTIONS } from '../types'
import { calcAllTaskScores, calcMemberResults } from './calculations'

// Claude's Artifact preview blocks raw browser downloads and only allows
// files to leave the frame through window.claude.downloads.save(), which
// does not support the .xlsx extension -- so inside that preview we fall
// back to a CSV rendering of the same workbook. The real deployed app
// (no window.claude present) always gets the full .xlsx file.
function workbookToCsvText(wb: XLSX.WorkBook): string {
  return wb.SheetNames.map((name) => `# ${name}\n${XLSX.utils.sheet_to_csv(wb.Sheets[name])}`).join(
    '\n\n',
  )
}

async function saveViaClaudeDownloads(wb: XLSX.WorkBook, filename: string): Promise<boolean> {
  const downloads = window.claude?.downloads
  if (!downloads) return false

  const text = '﻿' + workbookToCsvText(wb) // U+FEFF BOM so Excel reads Korean text correctly

  // .csv is in the "extended" allowlist, which may not be enabled for this
  // view -- if so, retry with .txt, which is always in the base allowlist.
  try {
    await downloads.save({ filename: filename.replace(/\.xlsx$/i, '.csv'), data: text })
    return true
  } catch (err) {
    const code = (err as ClaudeDownloadsError | undefined)?.code
    if (code === 'declined') return false // user dismissed the prompt, nothing to report
    if (code !== 'extension_not_enabled' && code !== 'rejected_extension') {
      console.error('다운로드 실패:', err)
      alert('다운로드에 실패했습니다: ' + ((err as ClaudeDownloadsError | undefined)?.message ?? '알 수 없는 오류'))
      return false
    }
  }

  try {
    await downloads.save({ filename: filename.replace(/\.xlsx$/i, '.txt'), data: text })
    return true
  } catch (err) {
    const code = (err as ClaudeDownloadsError | undefined)?.code
    if (code === 'declined') return false
    console.error('다운로드 실패:', err)
    alert('다운로드에 실패했습니다: ' + ((err as ClaudeDownloadsError | undefined)?.message ?? '알 수 없는 오류'))
    return false
  }
}

function downloadWorkbookAsFile(wb: XLSX.WorkBook, filename: string): boolean {
  try {
    const wbArray = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([wbArray], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return true
  } catch (err) {
    console.error('엑셀 다운로드 실패:', err)
    alert(
      '엑셀 다운로드에 실패했습니다. 이 창이 미리보기(임베드) 화면이라면 브라우저 새 탭에서 열어 다시 시도해주세요.',
    )
    return false
  }
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function zipStoredFiles(files: { name: string; data: Uint8Array }[]) {
  const encoder = new TextEncoder()
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const name = encoder.encode(file.name)
    const checksum = crc32(file.data)
    const local = new Uint8Array(30 + name.length + file.data.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true)
    lv.setUint32(14, checksum, true); lv.setUint32(18, file.data.length, true); lv.setUint32(22, file.data.length, true); lv.setUint16(26, name.length, true)
    local.set(name, 30); local.set(file.data, 30 + name.length)
    localParts.push(local)
    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true)
    cv.setUint32(16, checksum, true); cv.setUint32(20, file.data.length, true); cv.setUint32(24, file.data.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true)
    central.set(name, 46); centralParts.push(central); offset += local.length
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22); const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true)
  const parts = [...localParts, ...centralParts, end]
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let cursor = 0
  parts.forEach((part) => { output.set(part, cursor); cursor += part.length })
  return new Blob([output.buffer], { type: 'application/zip' })
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a'); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function downloadWorkbook(wb: XLSX.WorkBook, filename: string): Promise<boolean> {
  if (window.claude?.downloads) return saveViaClaudeDownloads(wb, filename)
  return downloadWorkbookAsFile(wb, filename)
}

// ---------- Task template / import ----------

const TASK_HEADERS = ['과제명', '과제등급', '업무량', '목표', '성과', '성과등급'] as const

export type ManagedWorkbookKind = 'tasks' | 'members' | 'peerReviews' | 'unknown'

export function detectManagedWorkbookKind(buffer: ArrayBuffer): ManagedWorkbookKind {
  const workbook = XLSX.read(buffer, { type: 'array', sheetRows: 12 })
  if (workbook.SheetNames.includes('_메타')) return 'peerReviews'
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!firstSheet) return 'unknown'
  const rows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, defval: '' })
  const labels = new Set(rows.slice(0, 8).flat().map((value) => normalizedLabel(value)))
  if (labels.has('과제명') && labels.has('과제등급')) return 'tasks'
  if (labels.has('이름') && (labels.has('직급') || labels.has('직책'))) return 'members'
  return 'unknown'
}

export async function downloadTaskTemplate() {
  const rows = [
    [...TASK_HEADERS],
    ['신규 랜딩페이지 제작', '핵심', '대', '전환율 15% 개선', '전환율 18% 달성', 'A'],
    ['내부 협업툴 정비', '일반', '소', '', '', ''],
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 24 }, { wch: 10 }, { wch: 8 }, { wch: 28 }, { wch: 28 }, { wch: 10 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '과제양식')
  await downloadWorkbook(wb, '과제_업로드_양식.xlsx')
}

export async function downloadQuickStartTemplate() {
  const taskSheet = XLSX.utils.aoa_to_sheet([
    [...TASK_HEADERS],
    ['신규 랜딩페이지 제작', '핵심', '대', '전환율 15% 개선', '', ''],
    ['내부 협업툴 정비', '일반', '소', '', '', ''],
  ])
  taskSheet['!cols'] = [{ wch: 24 }, { wch: 10 }, { wch: 8 }, { wch: 28 }, { wch: 28 }, { wch: 10 }]
  const memberSheet = XLSX.utils.aoa_to_sheet([
    [...MEMBER_HEADERS],
    ['김민준', '팀장', '과장', 7, '기획', ''],
    ['이서연', '', '대리', 3, '디자인', ''],
  ])
  memberSheet['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 16 }, { wch: 30 }]
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, taskSheet, '과제양식')
  XLSX.utils.book_append_sheet(workbook, memberSheet, '팀원양식')
  await downloadWorkbook(workbook, '성과평가_빠른시작_통합양식.xlsx')
}

export interface TaskImportResult {
  tasks: Task[]
  errors: string[]
  importedCount: number
  addedCount: number
  updatedCount: number
  addedIds: string[]
}

export function parseTaskWorkbook(buffer: ArrayBuffer, existingTasks: Task[]): TaskImportResult {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' })

  const errors: string[] = []
  const byName = new Map(existingTasks.map((t) => [t.name, t]))
  let importedCount = 0
  let addedCount = 0
  let updatedCount = 0
  const addedIds: string[] = []

  rows.forEach((row, index) => {
    const rowNum = index + 2
    const name = String(row['과제명'] ?? '').trim()
    const importanceRaw = String(row['과제등급'] ?? '').trim()
    const workloadRaw = String(row['업무량'] ?? '').trim()
    const objective = String(row['목표'] ?? '').trim()
    const achievement = String(row['성과'] ?? '').trim()
    const performanceGradeRaw = String(row['성과등급'] ?? '').trim().toUpperCase()

    const importance = (importanceRaw || '일반') as Importance
    const workload = (workloadRaw || '중') as Workload
    const performanceGrade = (performanceGradeRaw || 'B') as PerformanceGrade

    if (!name) {
      errors.push(`${rowNum}행: 과제명이 비어 있어 건너뛰었습니다.`)
      return
    }
    if (importanceRaw && !IMPORTANCE_OPTIONS.includes(importance)) {
      errors.push(`${rowNum}행 '${name}': 과제등급 '${row['과제등급']}'은(는) 유효하지 않습니다. (중점/핵심/일반/지원)`)
      return
    }
    if (workloadRaw && !WORKLOAD_OPTIONS.includes(workload)) {
      errors.push(`${rowNum}행 '${name}': 업무량 '${row['업무량']}'은(는) 유효하지 않습니다. (대/중/소)`)
      return
    }
    if (performanceGradeRaw && !PERFORMANCE_GRADE_OPTIONS.includes(performanceGrade)) {
      errors.push(`${rowNum}행 '${name}': 성과등급 '${row['성과등급']}'은(는) 유효하지 않습니다. (S/A/B/C/D)`)
      return
    }

    const existing = byName.get(name)
    const task: Task = {
      id: existing?.id ?? uuidv4(),
      name,
      importance,
      workload,
      objective,
      achievement,
      performanceGrade,
    }
    byName.set(name, task)
    importedCount += 1
    if (existing) {
      updatedCount += 1
    } else {
      addedCount += 1
      addedIds.push(task.id)
    }
  })

  return { tasks: Array.from(byName.values()), errors, importedCount, addedCount, updatedCount, addedIds }
}

// ---------- Team member template / import ----------

const MEMBER_HEADERS = ['이름', '직책', '직급', '연차', '역할', '코멘트'] as const

export async function downloadMemberTemplate() {
  const rows = [
    [...MEMBER_HEADERS],
    ['김민준', '팀장', '과장', 7, '기획', ''],
    ['이서연', '', '대리', 3, '디자인', ''],
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 16 }, { wch: 30 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '팀원양식')
  await downloadWorkbook(wb, '팀원_업로드_양식.xlsx')
}

export interface MemberImportResult {
  members: TeamMember[]
  errors: string[]
  importedCount: number
  addedCount: number
  updatedCount: number
  addedIds: string[]
}

export function parseMemberWorkbook(buffer: ArrayBuffer, existingMembers: TeamMember[]): MemberImportResult {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' })

  const errors: string[] = []
  const byName = new Map(existingMembers.map((m) => [m.name, m]))
  let importedCount = 0
  let addedCount = 0
  let updatedCount = 0
  const addedIds: string[] = []

  rows.forEach((row, index) => {
    const rowNum = index + 2
    const name = String(row['이름'] ?? '').trim()
    const positionRaw = String(row['직책'] ?? '').trim()
    const levelRaw = String(row['직급'] ?? '').trim()
    const yearsRaw = row['연차']
    const role = String(row['역할'] ?? '').trim()
    const comment = String(row['코멘트'] ?? '').trim()

    if (!name) {
      errors.push(`${rowNum}행: 이름이 비어 있어 건너뛰었습니다.`)
      return
    }
    if (positionRaw && !POSITION_OPTIONS.includes(positionRaw as Position)) {
      errors.push(`${rowNum}행 '${name}': 직책 '${positionRaw}'은(는) 유효하지 않습니다. (팀장/PM/PL/팀원)`)
      return
    }
    if (levelRaw && !LEVEL_OPTIONS.includes(levelRaw as Level)) {
      errors.push(`${rowNum}행 '${name}': 직급 '${levelRaw}'은(는) 유효하지 않습니다. (사원/대리/과장/차장)`)
      return
    }
    const yearsOfService = yearsRaw === '' || yearsRaw === undefined ? null : Number(yearsRaw)
    if (yearsOfService !== null && Number.isNaN(yearsOfService)) {
      errors.push(`${rowNum}행 '${name}': 연차 '${yearsRaw}'는 숫자여야 합니다.`)
      return
    }

    const existing = byName.get(name)
    const member: TeamMember = {
      id: existing?.id ?? uuidv4(),
      name,
      active: existing?.active ?? true,
      position: (positionRaw as Position) || '',
      level: (levelRaw as Level) || '',
      yearsOfService,
      role,
      comment,
    }
    byName.set(name, member)
    importedCount += 1
    if (existing) {
      updatedCount += 1
    } else {
      addedCount += 1
      addedIds.push(member.id)
    }
  })

  return { members: Array.from(byName.values()), errors, importedCount, addedCount, updatedCount, addedIds }
}

export interface QuickStartImportResult {
  tasks: Task[]
  members: TeamMember[]
  taskCount: number
  memberCount: number
  errors: string[]
}

export function parseQuickStartWorkbook(buffer: ArrayBuffer, existingTasks: Task[], existingMembers: TeamMember[]): QuickStartImportResult {
  const workbook = XLSX.read(buffer, { type: 'array' })
  let tasks = existingTasks
  let members = existingMembers
  let taskCount = 0
  let memberCount = 0
  const errors: string[] = []

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) return
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', range: 0 })
    const labels = new Set(rows.slice(0, 8).flat().map((value) => normalizedLabel(value)))
    const singleSheetWorkbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(singleSheetWorkbook, sheet, sheetName)
    const singleSheetBuffer = XLSX.write(singleSheetWorkbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer

    if (labels.has('과제명') && labels.has('과제등급')) {
      const result = parseTaskWorkbook(singleSheetBuffer, tasks)
      tasks = result.tasks
      taskCount += result.importedCount
      errors.push(...result.errors.map((error) => `${sheetName}: ${error}`))
    } else if (labels.has('이름') && (labels.has('직급') || labels.has('직책'))) {
      const result = parseMemberWorkbook(singleSheetBuffer, members)
      members = result.members
      memberCount += result.importedCount
      errors.push(...result.errors.map((error) => `${sheetName}: ${error}`))
    }
  })

  if (taskCount === 0 && memberCount === 0) errors.push('과제 또는 팀원 양식을 찾지 못했습니다.')
  return { tasks, members, taskCount, memberCount, errors }
}

// ---------- Peer review template / import ----------

function peerReviewParticipants(taskId: string, members: TeamMember[], contributions: Contribution[]) {
  return members.filter((member) => contributions.some((item) => item.taskId === taskId && item.memberId === member.id && item.contributionPercent > 0))
}

function evenlyDistributedPercentages(count: number) {
  if (count <= 0) return []
  const base = Math.floor(100 / count)
  const remainder = 100 - base * count
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0))
}

function safeSheetName(value: string, index: number) {
  const name = value.replace(/[\\/?*\[\]:]/g, '').slice(0, 25) || `과제${index + 1}`
  return `${index + 1}_${name}`.slice(0, 31)
}

function normalizedLabel(value: unknown) {
  return String(value ?? '').normalize('NFC').trim()
}

function applyPeerReviewSheetLayout(ws: XLSX.WorkSheet, participantCount: number, includeGrade: boolean) {
  const lastColumn = includeGrade ? 'D' : 'C'
  const totalRow = 4 + participantCount
  const lastDataRow = totalRow - 1
  ws['!cols'] = includeGrade
    ? [{ wch: 22 }, { wch: 14 }, { wch: 13 }, { wch: 54 }]
    : [{ wch: 22 }, { wch: 14 }, { wch: 54 }]
  ws['!rows'] = [{ hpt: 30 }, { hpt: 22 }, { hpt: 26 }, ...Array.from({ length: participantCount }, () => ({ hpt: 30 })), { hpt: 24 }]
  ws['!merges'] = [XLSX.utils.decode_range(`A1:${lastColumn}1`), XLSX.utils.decode_range(`A2:${lastColumn}2`)]
  ws['!autofilter'] = { ref: `A3:${lastColumn}${lastDataRow}` }
  ;(ws as XLSX.WorkSheet & { '!freeze'?: unknown })['!freeze'] = { xSplit: 1, ySplit: 3, topLeftCell: 'B4', activePane: 'bottomRight', state: 'frozen' }
  ;(ws as XLSX.WorkSheet & { '!dataValidation'?: unknown[] })['!dataValidation'] = [
    { sqref: `B4:B${lastDataRow}`, type: 'whole', operator: 'between', formula1: '0', formula2: '100', allowBlank: true },
    ...(includeGrade ? [{ sqref: `C4:C${lastDataRow}`, type: 'list', formula1: '"S,A,B,C,D"', allowBlank: true }] : []),
  ]
  const style = (cellAddress: string, fill: string, color: string, bold = false) => {
    const cell = ws[cellAddress]
    if (!cell) return
    cell.s = { fill: { fgColor: { rgb: fill } }, font: { name: 'Arial', sz: 10, color: { rgb: color }, bold }, alignment: { vertical: 'center', wrapText: true } }
  }
  for (let column = 0; column < (includeGrade ? 4 : 3); column += 1) {
    style(XLSX.utils.encode_cell({ r: 2, c: column }), 'F3F4F6', '111827', true)
  }
  for (let row = 3; row < totalRow - 1; row += 1) {
    style(XLSX.utils.encode_cell({ r: row, c: 1 }), 'FFF7ED', '111827')
    if (includeGrade) style(XLSX.utils.encode_cell({ r: row, c: 2 }), 'FFF7ED', '111827')
  }
}

export async function downloadMemberPeerReviewTemplates({
  projectId: _projectId, periodLabel, periodFileName, tasks, members, contributions: _contributions, includeGrade,
}: {
  projectId: string
  periodLabel: string
  periodFileName: string
  tasks: Task[]
  members: TeamMember[]
  contributions: Contribution[]
  includeGrade: boolean
}) {
  const generated: string[] = []
  const files: { name: string; data: Uint8Array }[] = []
  for (const reviewer of members) {
    const wb = XLSX.utils.book_new()
    const guide = XLSX.utils.aoa_to_sheet([
      ['피어리뷰 입력 안내'],
      ['평가기간', periodLabel],
      ['평가자', reviewer.name],
      [],
      ['입력 방법'],
      ['1', '과제별 시트의 연한 입력 칸에 기여도와 수행등급을 입력합니다.'],
      ['2', '기여도는 팀원 수에 맞춰 100%로 균등 배분되어 있으며 필요하면 조정할 수 있습니다.'],
      ['3', '근거에는 관찰한 행동이나 결과를 짧고 구체적으로 작성합니다.'],
    ])
    guide['!cols'] = [{ wch: 14 }, { wch: 68 }]
    guide['!rows'] = [{ hpt: 32 }, { hpt: 24 }, { hpt: 24 }, { hpt: 10 }, { hpt: 26 }, { hpt: 28 }, { hpt: 28 }, { hpt: 28 }]
    guide['!merges'] = [XLSX.utils.decode_range('A1:B1')]
    XLSX.utils.book_append_sheet(wb, guide, '안내')
    const meta = XLSX.utils.aoa_to_sheet([
      ['구분', '값'], ['평가기간', periodLabel], ['평가자', reviewer.name], ['양식버전', 5],
    ])
    XLSX.utils.book_append_sheet(wb, meta, '_메타')
    tasks.forEach((task, taskIndex) => {
      const participants = members
      const equalPercentages = evenlyDistributedPercentages(participants.length)
      const headers = includeGrade ? ['평가 대상', '기여도(%)', '수행등급', '근거'] : ['평가 대상', '기여도(%)', '근거']
      const rows: unknown[][] = [
        [`과제: ${task.name}`],
        [`평가기간: ${periodLabel}`],
        headers,
        ...participants.map((member, memberIndex) => includeGrade
          ? [`${member.name}${member.id === reviewer.id ? ' (본인)' : ''}`, equalPercentages[memberIndex], '', '']
          : [`${member.name}${member.id === reviewer.id ? ' (본인)' : ''}`, equalPercentages[memberIndex], ''],
        ),
        includeGrade ? ['기여도 합계', '', '검증', ''] : ['기여도 합계', '', ''],
      ]
      const ws = XLSX.utils.aoa_to_sheet(rows)
      const totalRow = 4 + participants.length
      ws[`B${totalRow}`] = { t: 'n', f: `SUM(B4:B${totalRow - 1})` }
      ws[`${includeGrade ? 'D' : 'C'}${totalRow}`] = { t: 's', f: `IF(B${totalRow}=100,"정상","100% 확인")` }
      applyPeerReviewSheetLayout(ws, participants.length, includeGrade)
      XLSX.utils.book_append_sheet(wb, ws, safeSheetName(task.name, taskIndex))
    })
    wb.Workbook = { Sheets: wb.SheetNames.map((name) => ({ name, Hidden: name === '_메타' ? 1 : 0 })) }
    const filename = `${periodFileName}_피어리뷰_${reviewer.name}.xlsx`
    files.push({ name: filename, data: new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' })) })
    generated.push(reviewer.name)
  }
  if (files.length > 0) downloadBlob(zipStoredFiles(files), `${periodFileName}_피어리뷰_전체.zip`)
  return generated
}

export interface ProjectPeerReviewImportResult {
  reviews: PeerReview[]
  reviewerMemberId: string | null
  reviewerName: string
  errors: string[]
}

export function parseProjectPeerReviewWorkbook(
  buffer: ArrayBuffer,
  _expectedProjectId: string,
  tasks: Task[],
  members: TeamMember[],
  contributions: Contribution[],
  includeGrade: boolean,
  expectedPeriodLabel = '',
): ProjectPeerReviewImportResult {
  const wb = XLSX.read(buffer, { type: 'array' })
  const metaSheet = wb.Sheets._메타
  const metaRows = metaSheet ? XLSX.utils.sheet_to_json<(string | number)[]>(metaSheet, { header: 1, defval: '' }) : []
  const meta = new Map(metaRows.map((row) => [String(row[0]), String(row[1])]))
  const templateVersion = Number(meta.get('양식버전') || 0)
  const reviewerName = normalizedLabel(meta.get('평가자'))
  const errors: string[] = []
  const periodMatches = !expectedPeriodLabel || normalizedLabel(meta.get('평가기간')) === normalizedLabel(expectedPeriodLabel)
  const contextMatches = periodMatches
  if (!contextMatches) errors.push('현재 평가기간과 일치하지 않는 파일입니다.')
  const reviewer = members.find((member) => normalizedLabel(member.name) === reviewerName)
  const reviewerMemberId = reviewer?.id ?? null
  if (!reviewer) errors.push('평가자 정보를 확인할 수 없습니다.')
  if (!contextMatches || !reviewer) return { reviews: [], reviewerMemberId, reviewerName, errors }
  const memberByLabel = new Map(members.flatMap((member) => [[normalizedLabel(member.name), member], [normalizedLabel(`${member.name} (본인)`), member]]))
  const reviews: PeerReview[] = []
  for (const sheetName of wb.SheetNames.filter((name) => name !== '_메타' && name !== '안내')) {
    const ws = wb.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, defval: '' })
    const taskName = normalizedLabel(rows[0]?.[0]).replace(/^과제:\s*/, '')
    const task = tasks.find((item) => normalizedLabel(item.name) === taskName)
    if (!task) { errors.push(`${sheetName}: 과제를 찾을 수 없습니다.`); continue }
    const participants = new Set((templateVersion >= 5 ? members : peerReviewParticipants(task.id, members, contributions)).map((member) => member.id))
    for (const [rowIndex, row] of rows.slice(3).entries()) {
      const targetLabel = normalizedLabel(row[0])
      if (!targetLabel || targetLabel === '기여도 합계') continue
      const target = memberByLabel.get(targetLabel)
      if (!target) { errors.push(`${sheetName} ${rowIndex + 4}행: 평가 대상이 일치하지 않습니다.`); continue }
      if (!participants.has(target.id)) { errors.push(`${sheetName} ${rowIndex + 4}행: 해당 과제 참여자가 아닙니다.`); continue }
      const contribution = row[1] === '' ? null : Number(row[1])
      const gradeCell = includeGrade ? String(row[2] ?? '').toUpperCase() : ''
      const evidence = String(row[includeGrade ? 3 : 2] ?? '').trim()
      if (contribution !== null && (!Number.isFinite(contribution) || contribution < 0 || contribution > 100)) { errors.push(`${sheetName} ${rowIndex + 4}행: 기여도는 0~100 숫자여야 합니다.`); continue }
      if (includeGrade && gradeCell && !PERFORMANCE_GRADE_OPTIONS.includes(gradeCell as PerformanceGrade)) { errors.push(`${sheetName} ${rowIndex + 4}행: 수행등급을 확인해주세요.`); continue }
      reviews.push({ id: uuidv4(), taskId: task.id, reviewerMemberId: reviewerMemberId ?? '', reviewerName: reviewer?.name ?? reviewerName, targetMemberId: target.id, contributionPercent: contribution, grade: gradeCell ? gradeCell as PerformanceGrade : null, evidence })
    }
  }
  return { reviews, reviewerMemberId, reviewerName, errors }
}

const PEER_REVIEW_HEADERS = ['리뷰어', '대상팀원', '등급'] as const

export async function downloadPeerReviewTemplate(members: TeamMember[]) {
  const rows: (string | number)[][] = [[...PEER_REVIEW_HEADERS]]
  for (const member of members) {
    rows.push(['', member.name, ''])
  }
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 8 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '피어리뷰양식')
  await downloadWorkbook(wb, '피어리뷰_업로드_양식.xlsx')
}

export interface PeerReviewImportResult {
  peerReviews: PeerReview[]
  errors: string[]
  importedCount: number
  addedCount: number
  updatedCount: number
  affectedTargetNames: string[]
}

const REVIEWER_HEADER_ALIASES = ['리뷰어', '평가자', '리뷰자']
const TARGET_HEADER_ALIASES = ['대상팀원', '평가대상', '평가 대상', '대상자', '피평가자']
const GRADE_HEADER_ALIASES = ['등급', '평가등급', '점수']

function pickColumn(row: Record<string, unknown>, aliases: string[]): string {
  for (const alias of aliases) {
    const value = row[alias]
    if (value !== undefined && String(value).trim() !== '') return String(value).trim()
  }
  return ''
}

export function parsePeerReviewWorkbook(
  buffer: ArrayBuffer,
  members: TeamMember[],
  existingPeerReviews: PeerReview[],
): PeerReviewImportResult {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' })

  const errors: string[] = []
  const byKey = new Map(existingPeerReviews.map((r) => [`${r.reviewerName}::${r.targetMemberId}`, r]))
  const memberByName = new Map(members.map((m) => [m.name, m]))
  let importedCount = 0
  let addedCount = 0
  let updatedCount = 0
  let contentRowCount = 0
  const affectedTargetNames = new Set<string>()

  rows.forEach((row, index) => {
    const rowNum = index + 2
    const hasAnyContent = Object.values(row).some((v) => String(v ?? '').trim() !== '')
    if (!hasAnyContent) return
    contentRowCount += 1

    const reviewerName = pickColumn(row, REVIEWER_HEADER_ALIASES)
    const targetName = pickColumn(row, TARGET_HEADER_ALIASES)
    const gradeRaw = pickColumn(row, GRADE_HEADER_ALIASES).toUpperCase()

    if (!reviewerName || !targetName || !gradeRaw) {
      errors.push(
        `${rowNum}행: 리뷰어/대상팀원/등급 컬럼을 찾지 못했습니다. 엑셀 헤더가 '리뷰어', '대상팀원', '등급'인지 확인해주세요.`,
      )
      return
    }

    const targetMember = memberByName.get(targetName)
    if (!targetMember) {
      errors.push(`${rowNum}행: 대상팀원 '${targetName}'을(를) 찾을 수 없습니다.`)
      return
    }
    if (!PERFORMANCE_GRADE_OPTIONS.includes(gradeRaw as PerformanceGrade)) {
      errors.push(`${rowNum}행 '${reviewerName}→${targetName}': 등급 '${gradeRaw}'은(는) 유효하지 않습니다. (S/A/B/C/D)`)
      return
    }

    const key = `${reviewerName}::${targetMember.id}`
    const existing = byKey.get(key)
    const review: PeerReview = {
      id: existing?.id ?? uuidv4(),
      taskId: existing?.taskId ?? '',
      reviewerMemberId: existing?.reviewerMemberId ?? '',
      reviewerName,
      targetMemberId: targetMember.id,
      contributionPercent: existing?.contributionPercent ?? null,
      grade: gradeRaw as PerformanceGrade,
      evidence: existing?.evidence ?? '',
    }
    byKey.set(key, review)
    affectedTargetNames.add(targetName)
    importedCount += 1
    if (existing) {
      updatedCount += 1
    } else {
      addedCount += 1
    }
  })

  if (contentRowCount === 0) {
    errors.push('업로드한 파일에 내용이 없습니다. 다운로드한 양식에 리뷰어/대상팀원/등급을 채워 업로드해주세요.')
  }

  return {
    peerReviews: Array.from(byKey.values()),
    errors,
    importedCount,
    addedCount,
    updatedCount,
    affectedTargetNames: Array.from(affectedTargetNames),
  }
}

// ---------- Results report export ----------

export async function downloadResultsReport(
  members: TeamMember[],
  tasks: Task[],
  contributions: Contribution[],
  criteria: Criteria,
  meetingNotes: MeetingNote[] = [],
  peerReviews: PeerReview[] = [],
) {
  const results = calcMemberResults(members, tasks, contributions, criteria, peerReviews)
  const taskScores = calcAllTaskScores(tasks, criteria)
  const taskScoreMap = new Map(taskScores.map((row) => [row.task.id, row.score]))

  const rankRows = [
    ['순위', '이름', '역할', '직책', '직급', '참여 과제 수', '종합 점수(가중평균)', '누적 점수(단순합)'],
    ...results.map((row, index) => [
      index + 1,
      row.member.name,
      row.member.role || '-',
      row.member.position || '-',
      row.member.level || '-',
      row.participatedTaskCount,
      Number(row.weightedAverageScore.toFixed(1)),
      Number(row.cumulativeScore.toFixed(1)),
    ]),
  ]
  const rankSheet = XLSX.utils.aoa_to_sheet(rankRows)
  rankSheet['!cols'] = [
    { wch: 6 },
    { wch: 12 },
    { wch: 14 },
    { wch: 10 },
    { wch: 10 },
    { wch: 12 },
    { wch: 16 },
    { wch: 16 },
  ]

  const detailRows: (string | number)[][] = [
    ['팀원', '과제명', '과제점수', '기여도(%)', '개인수행등급', '목표', '성과', '성과등급', '가중점수', '기여도합계 100% 여부'],
  ]
  for (const task of tasks) {
    const taskScore = taskScoreMap.get(task.id) ?? 0
    const taskContributions = contributions.filter((c) => c.taskId === task.id && c.contributionPercent > 0)
    const sum = taskContributions.reduce((s, c) => s + c.contributionPercent, 0)
    const sumOk = Math.abs(sum - 100) <= 0.01 ? 'OK' : `${sum.toFixed(1)}%`
    for (const c of taskContributions) {
      const member = members.find((m) => m.id === c.memberId)
      if (!member) continue
      const personalFactor = criteria.personalGradeWeight > 0 ? c.personalPerformanceGrade : '미사용'
      const weighted = taskScore * (c.contributionPercent / 100)
      detailRows.push([
        member.name,
        task.name,
        Number(taskScore.toFixed(1)),
        c.contributionPercent,
        personalFactor,
        task.objective || '-',
        task.achievement || '-',
        task.performanceGrade,
        Number(weighted.toFixed(1)),
        sumOk,
      ])
    }
  }
  const detailSheet = XLSX.utils.aoa_to_sheet(detailRows)
  detailSheet['!cols'] = [
    { wch: 12 },
    { wch: 20 },
    { wch: 10 },
    { wch: 10 },
    { wch: 12 },
    { wch: 24 },
    { wch: 24 },
    { wch: 10 },
    { wch: 10 },
    { wch: 16 },
  ]

  const notesRows: (string | number)[][] = [['팀원', '날짜', '면담 코멘트']]
  const sortedNotes = [...meetingNotes].sort((a, b) => {
    const memberA = members.find((m) => m.id === a.memberId)?.name ?? ''
    const memberB = members.find((m) => m.id === b.memberId)?.name ?? ''
    return memberA.localeCompare(memberB) || a.date.localeCompare(b.date)
  })
  for (const note of sortedNotes) {
    const member = members.find((m) => m.id === note.memberId)
    if (!member) continue
    notesRows.push([member.name, note.date, note.comment])
  }
  const notesSheet = XLSX.utils.aoa_to_sheet(notesRows)
  notesSheet['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 50 }]

  const peerReviewRows: (string | number)[][] = [['대상팀원', '리뷰어', '등급']]
  const sortedReviews = [...peerReviews].sort((a, b) => {
    const targetA = members.find((m) => m.id === a.targetMemberId)?.name ?? ''
    const targetB = members.find((m) => m.id === b.targetMemberId)?.name ?? ''
    return targetA.localeCompare(targetB) || a.reviewerName.localeCompare(b.reviewerName)
  })
  for (const review of sortedReviews) {
    const target = members.find((m) => m.id === review.targetMemberId)
    if (!target) continue
    peerReviewRows.push([target.name, review.reviewerName, review.grade ?? ''])
  }
  const peerReviewSheet = XLSX.utils.aoa_to_sheet(peerReviewRows)
  peerReviewSheet['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 8 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, rankSheet, '순위표')
  XLSX.utils.book_append_sheet(wb, detailSheet, '과제별상세')
  XLSX.utils.book_append_sheet(wb, notesSheet, '면담기록')
  XLSX.utils.book_append_sheet(wb, peerReviewSheet, '피어리뷰')
  await downloadWorkbook(wb, `평가결과_${new Date().toISOString().slice(0, 10)}.xlsx`)
}
