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
import { calcAllTaskScores, calcMemberResults, calcPersonalGradeFactor } from './calculations'

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

function zipStoredFileBytes(files: { name: string; data: Uint8Array }[]) {
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
  return output
}

function zipStoredFiles(files: { name: string; data: Uint8Array }[]) {
  return new Blob([zipStoredFileBytes(files).buffer], { type: 'application/zip' })
}

async function unzipFileEntries(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let endOffset = bytes.byteLength - 22
  while (endOffset >= 0 && view.getUint32(endOffset, true) !== 0x06054b50) endOffset -= 1
  if (endOffset < 0) throw new Error('Excel 양식의 ZIP 디렉터리를 찾을 수 없습니다.')
  const entryCount = view.getUint16(endOffset + 10, true)
  let cursor = view.getUint32(endOffset + 16, true)
  const decoder = new TextDecoder()
  const entries = new Map<string, Uint8Array>()
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('Excel 양식의 ZIP 항목이 손상되었습니다.')
    const method = view.getUint16(cursor + 10, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localOffset = view.getUint32(cursor + 42, true)
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength))
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength
    const compressed = bytes.slice(dataOffset, dataOffset + compressedSize)
    let data: Uint8Array
    if (method === 0) data = compressed
    else if (method === 8) {
      const stream = new Blob([compressed.buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      data = new Uint8Array(await new Response(stream).arrayBuffer())
    } else throw new Error(`지원하지 않는 ZIP 압축 방식입니다: ${method}`)
    if (!name.endsWith('/')) entries.set(name, data)
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a'); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export interface DownloadableTemplateFile {
  name: string
  data: Uint8Array
}

export type QuickStartTemplateKind = 'tasks' | 'members' | 'growth' | 'peerReviews'

const STATIC_TEMPLATE_FILENAMES: Record<QuickStartTemplateKind, string> = {
  tasks: '01_과제_입력_양식.xlsx',
  members: '02_팀원_입력_양식.xlsx',
  growth: '03_이전성과_5개년_입력_양식.xlsx',
  peerReviews: '04_피어리뷰_입력_양식.xlsx',
}

async function loadStaticTemplateFile(kind: QuickStartTemplateKind): Promise<DownloadableTemplateFile | null> {
  const baseUrl = import.meta.env.BASE_URL || '/'
  const templateUrl = `${baseUrl}${baseUrl.endsWith('/') ? '' : '/'}templates/${encodeURIComponent(STATIC_TEMPLATE_FILENAMES[kind])}`
  try {
    const response = await fetch(templateUrl)
    if (!response.ok) return null
    return {
      name: STATIC_TEMPLATE_FILENAMES[kind],
      data: new Uint8Array(await response.arrayBuffer()),
    }
  } catch (error) {
    console.warn(`빈 Excel 양식을 불러오지 못했습니다: ${STATIC_TEMPLATE_FILENAMES[kind]}`, error)
    return null
  }
}

function workbookTemplateFile(workbook: XLSX.WorkBook, name: string): DownloadableTemplateFile {
  return {
    name,
    data: new Uint8Array(XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })),
  }
}

export function downloadTemplateFile(file: DownloadableTemplateFile) {
  downloadBlob(
    new Blob([file.data.buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    file.name,
  )
}

export function downloadTemplateFilesZip(files: DownloadableTemplateFile[], filename: string) {
  downloadBlob(zipStoredFiles(files), filename)
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
  const isPersonnelRecord = rows.slice(0, 8).flat().some((value) => compactPersonnelLabel(value).includes('종합인사기록카드'))
  if (labels.has('과제명') && labels.has('과제등급')) return 'tasks'
  if (isPersonnelRecord) return 'members'
  if (labels.has('이름') && (labels.has('직급') || labels.has('직책')) && !labels.has('평가연도')) return 'members'
  return 'unknown'
}

export function createTaskTemplateFile(tasks: Task[] = []) {
  const taskRows = tasks.length > 0
    ? tasks.map((task) => [
        task.name,
        task.importance,
        task.workload,
        task.objective,
        task.achievement,
        task.performanceGrade,
      ])
    : [
        ['', '', '', '', '', ''],
        ['', '', '', '', '', ''],
        ['', '', '', '', '', ''],
      ]
  const rows = [
    [...TASK_HEADERS],
    ...taskRows,
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 24 }, { wch: 10 }, { wch: 8 }, { wch: 28 }, { wch: 28 }, { wch: 10 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '과제양식')
  return workbookTemplateFile(wb, STATIC_TEMPLATE_FILENAMES.tasks)
}

export async function downloadTaskTemplate() {
  await downloadQuickStartTemplateFile('tasks')
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

export function createMemberTemplateFile(members: TeamMember[] = []) {
  const memberRows = members.length > 0
    ? members.map((member) => [
        member.name,
        member.position,
        member.level,
        member.yearsOfService ?? '',
        member.role,
        member.comment,
      ])
    : [
        ['', '', '', '', '', ''],
        ['', '', '', '', '', ''],
        ['', '', '', '', '', ''],
        ['', '', '', '', '', ''],
        ['', '', '', '', '', ''],
      ]
  const rows = [
    [...MEMBER_HEADERS],
    ...memberRows,
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 16 }, { wch: 30 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '팀원양식')
  return workbookTemplateFile(wb, STATIC_TEMPLATE_FILENAMES.members)
}

export async function downloadMemberTemplate() {
  await downloadQuickStartTemplateFile('members')
}

function templateMembers(members: TeamMember[]) {
  if (members.length > 0) return members
  return Array.from({ length: 5 }, (_, index) => ({
    id: `template-member-${index + 1}`,
    name: '',
    active: true,
    position: '',
    level: '',
    yearsOfService: null,
    role: '',
    comment: '',
  })) satisfies TeamMember[]
}

function templateTasks(tasks: Task[]) {
  if (tasks.length > 0) return tasks
  return Array.from({ length: 3 }, (_, index) => ({
    id: `template-task-${index + 1}`,
    name: '',
    importance: '일반',
    workload: '중',
    objective: '',
    achievement: '',
    performanceGrade: 'B',
  })) satisfies Task[]
}

export function createGrowthHistoryTemplateFile(members: TeamMember[] = [], currentYear = new Date().getFullYear()) {
  const targetMembers = templateMembers(members)
  const rows: (string | number)[][] = [
    ['이름', '직급', '승진심사 시기', '평가연도', '업적(상)', '업적(하)', '역량'],
    ...targetMembers.flatMap((member) => Array.from({ length: 5 }, (_, index) => [
      index === 0 ? member.name : '',
      index === 0 ? member.level : '',
      index === 0 ? `${currentYear + 3}-03` : '',
      currentYear - index,
      '',
      '',
      '',
    ])),
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 15 }, { wch: 11 }, { wch: 17 }, { wch: 12 }, { wch: 13 }, { wch: 13 }, { wch: 13 }]
  ws['!autofilter'] = { ref: `A1:G${rows.length}` }
  ;(ws as XLSX.WorkSheet & { '!freeze'?: unknown })['!freeze'] = { xSplit: 4, ySplit: 1, topLeftCell: 'E2', activePane: 'bottomRight', state: 'frozen' }
  ;(ws as XLSX.WorkSheet & { '!dataValidation'?: unknown[] })['!dataValidation'] = [{
    sqref: `E2:G${rows.length}`,
    type: 'list',
    formula1: '"S,A,B,C,D,-"',
    allowBlank: true,
  }]
  const guide = XLSX.utils.aoa_to_sheet([
    ['이전 성과 입력 안내'],
    ['1', '팀원별 최근 5년 업적(상/하)과 역량 등급을 입력합니다.'],
    ['2', '등급은 S/A/B/C/D 또는 -를 입력합니다.'],
    ['3', '같은 팀원은 첫 행에만 이름·직급·승진심사 시기를 입력합니다.'],
  ])
  guide['!cols'] = [{ wch: 8 }, { wch: 72 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, guide, '안내')
  XLSX.utils.book_append_sheet(wb, ws, '성과입력')
  return workbookTemplateFile(wb, STATIC_TEMPLATE_FILENAMES.growth)
}

export function createIntegratedPeerReviewTemplateFile(tasks: Task[] = [], members: TeamMember[] = []) {
  const targetTasks = templateTasks(tasks)
  const targetMembers = templateMembers(members)
  const percentages = evenlyDistributedPercentages(targetMembers.length)
  const rows: (string | number)[][] = [
    ['과제명', '리뷰어', '대상팀원', '기여도(%)', '수행등급', '근거'],
    ...targetTasks.flatMap((task) => targetMembers.flatMap((reviewer) => targetMembers.map((target, targetIndex) => [
      task.name,
      reviewer.name,
      target.name,
      percentages[targetIndex],
      '',
      '',
    ]))),
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 13 }, { wch: 12 }, { wch: 48 }]
  ws['!autofilter'] = { ref: `A1:F${rows.length}` }
  ;(ws as XLSX.WorkSheet & { '!freeze'?: unknown })['!freeze'] = { ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' }
  ;(ws as XLSX.WorkSheet & { '!dataValidation'?: unknown[] })['!dataValidation'] = [
    { sqref: `D2:D${rows.length}`, type: 'whole', operator: 'between', formula1: '0', formula2: '100', allowBlank: true },
    { sqref: `E2:E${rows.length}`, type: 'list', formula1: '"S,A,B,C,D"', allowBlank: true },
  ]
  const guide = XLSX.utils.aoa_to_sheet([
    ['피어리뷰 입력 안내'],
    ['1', '과제별 리뷰어가 각 팀원의 기여도·수행등급·근거를 입력합니다.'],
    ['2', '과제와 팀원이 이미 등록된 프로젝트에서 받으면 현재 명단으로 양식이 채워집니다.'],
    ['3', '기여도는 과제별 대상팀원 합계가 100%가 되도록 확인합니다.'],
  ])
  guide['!cols'] = [{ wch: 8 }, { wch: 82 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, guide, '안내')
  XLSX.utils.book_append_sheet(wb, ws, '피어리뷰')
  return workbookTemplateFile(wb, STATIC_TEMPLATE_FILENAMES.peerReviews)
}

export function createQuickStartTemplateFiles(
  tasks: Task[] = [],
  members: TeamMember[] = [],
  currentYear = new Date().getFullYear(),
) {
  return [
    createTaskTemplateFile(tasks),
    createMemberTemplateFile(members),
    createGrowthHistoryTemplateFile(members, currentYear),
    createIntegratedPeerReviewTemplateFile(tasks, members),
  ]
}

export async function downloadQuickStartTemplateFile(
  kind: QuickStartTemplateKind,
  _tasks: Task[] = [],
  _members: TeamMember[] = [],
  currentYear = new Date().getFullYear(),
) {
  const fileByKind: Record<QuickStartTemplateKind, DownloadableTemplateFile> = {
    tasks: createTaskTemplateFile(),
    members: createMemberTemplateFile(),
    growth: createGrowthHistoryTemplateFile([], currentYear),
    peerReviews: createIntegratedPeerReviewTemplateFile(),
  }
  downloadTemplateFile(await loadStaticTemplateFile(kind) ?? fileByKind[kind])
}

export async function downloadQuickStartTemplateBundle(
  _tasks: Task[] = [],
  _members: TeamMember[] = [],
  currentYear = new Date().getFullYear(),
) {
  const fallbackFiles = createQuickStartTemplateFiles([], [], currentYear)
  const fallbackByKind: Record<QuickStartTemplateKind, DownloadableTemplateFile> = {
    tasks: fallbackFiles[0],
    members: fallbackFiles[1],
    growth: fallbackFiles[2],
    peerReviews: fallbackFiles[3],
  }
  const kinds: QuickStartTemplateKind[] = ['tasks', 'members', 'growth', 'peerReviews']
  const files = await Promise.all(kinds.map(async (kind) => await loadStaticTemplateFile(kind) ?? fallbackByKind[kind]))
  downloadTemplateFilesZip(
    files,
    '성과평가_입력양식_전체.zip',
  )
}

export interface MemberImportResult {
  members: TeamMember[]
  errors: string[]
  importedCount: number
  addedCount: number
  updatedCount: number
  addedIds: string[]
  sourceType?: 'member-template' | 'personnel-record'
  importedHistoryCount?: number
}

function compactPersonnelLabel(value: unknown) {
  return String(value ?? '').normalize('NFC').replace(/\s+/g, '').trim()
}

function personnelDate(value: unknown) {
  const match = String(value ?? '').match(/(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})/)
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : ''
}

function personnelMonth(value: unknown) {
  const match = String(value ?? '').match(/(\d{4})[.\/-](\d{1,2})/)
  return match ? `${match[1]}-${match[2].padStart(2, '0')}` : ''
}

function valueAfterPersonnelLabel(rows: unknown[][], label: string) {
  const wanted = compactPersonnelLabel(label)
  for (const row of rows) {
    const index = row.findIndex((value) => compactPersonnelLabel(value) === wanted)
    if (index < 0) continue
    const value = row.slice(index + 1).find((item) => String(item ?? '').trim())
    if (value !== undefined) return String(value).trim()
  }
  return ''
}

function parsePersonnelRecordWorkbook(buffer: ArrayBuffer, existingMembers: TeamMember[]): MemberImportResult | null {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) return null
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
  if (!rows.slice(0, 8).flat().some((value) => compactPersonnelLabel(value).includes('종합인사기록카드'))) return null

  const employeeRow = rows.find((row) => row.some((value) => compactPersonnelLabel(value) === '사번')) ?? []
  const employeeLabelIndex = employeeRow.findIndex((value) => compactPersonnelLabel(value) === '사번')
  const name = employeeRow.slice(0, employeeLabelIndex).map((value) => String(value ?? '').trim()).find(Boolean) ?? ''
  if (!name) return { members: existingMembers, errors: ['인사기록카드에서 이름을 찾지 못했습니다.'], importedCount: 0, addedCount: 0, updatedCount: 0, addedIds: [], sourceType: 'personnel-record', importedHistoryCount: 0 }

  const appointments = rows.flatMap((row) => {
    const date = personnelDate(row[0])
    const type = String(row[4] ?? '').trim()
    if (!date || !type || compactPersonnelLabel(type) === '발령종류') return []
    return [{ date, type, company: String(row[12] ?? '').trim(), department: String(row[18] ?? '').trim(), employmentType: String(row[25] ?? '').trim(), jobTitle: String(row[33] ?? '').trim(), position: String(row[39] ?? '').trim(), workplace: String(row[46] ?? '').trim() }]
  })
  const education = rows.flatMap((row) => {
    const startDate = personnelDate(row[28])
    const courseName = String(row[39] ?? '').trim()
    if (!startDate || !courseName || compactPersonnelLabel(courseName) === '과정명') return []
    return [{ startDate, endDate: personnelDate(row[35]) || startDate, courseName, score: String(row[52] ?? '').trim() }]
  })
  const careerHeader = rows.findIndex((row) => row.some((value) => compactPersonnelLabel(value) === '경력사항'))
  const careerEnd = rows.findIndex((row, index) => index > careerHeader && row.some((value) => compactPersonnelLabel(value) === '자격사항'))
  const careers = rows.slice(Math.max(0, careerHeader + 2), careerEnd < 0 ? rows.length : careerEnd).flatMap((row) => {
    const startDate = personnelMonth(row[0])
    const company = String(row[14] ?? '').trim()
    if (!startDate || !company) return []
    return [{ startDate, endDate: personnelMonth(row[2]), duration: String(row[8] ?? '').trim(), company, jobTitle: String(row[22] ?? '').trim(), duty: String(row[26] ?? '').trim() }]
  })
  const awards = rows.flatMap((row) => {
    const date = personnelDate(row[3])
    const nameValue = String(row[16] ?? '').trim()
    if (!date || !nameValue || compactPersonnelLabel(nameValue) === '포상명') return []
    return [{ date, organization: String(row[9] ?? '').trim(), name: nameValue, reason: String(row[24] ?? '').trim() }]
  })
  const hireDate = personnelDate(valueAfterPersonnelLabel(rows, '당사입사'))
  const latestAppointment = appointments[0]
  const currentDuty = rows.map((row) => ({ startDate: personnelDate(row[34]), duty: String(row[39] ?? '').trim() })).find((item) => item.startDate && item.duty)?.duty ?? ''
  const yearsOfService = hireDate ? Math.max(0, Math.round(((Date.now() - new Date(`${hireDate}T00:00:00`).getTime()) / 31_557_600_000) * 10) / 10) : null
  const currentPosition = valueAfterPersonnelLabel(rows, '직책')
  const existing = existingMembers.find((member) => member.name.normalize('NFC').trim() === name.normalize('NFC').trim())
  const member: TeamMember = {
    ...(existing ?? { id: uuidv4(), name, active: true, position: '', level: '', yearsOfService: null, role: '', comment: '' }),
    name,
    position: existing?.position || (POSITION_OPTIONS.includes(currentPosition as Position) ? currentPosition as Position : ''),
    yearsOfService: existing?.yearsOfService ?? yearsOfService,
    role: existing?.role || currentDuty,
    personnelRecord: {
      employeeNumber: valueAfterPersonnelLabel(rows, '사번'),
      company: valueAfterPersonnelLabel(rows, '회사'),
      department: latestAppointment?.department || '',
      hireDate,
      lastPromotionDate: personnelDate(valueAfterPersonnelLabel(rows, '최종승진일')),
      employeeGrade: valueAfterPersonnelLabel(rows, '직급'),
      jobTitle: valueAfterPersonnelLabel(rows, '직위'),
      duty: currentPosition,
      appointments,
      education,
      careers,
      awards,
      importedAt: new Date().toISOString(),
    },
  }
  return {
    members: existing ? existingMembers.map((item) => item.id === existing.id ? member : item) : [...existingMembers, member],
    errors: [],
    importedCount: 1,
    addedCount: existing ? 0 : 1,
    updatedCount: existing ? 1 : 0,
    addedIds: existing ? [] : [member.id],
    sourceType: 'personnel-record',
    importedHistoryCount: appointments.length + education.length + careers.length + awards.length,
  }
}

export function parseMemberWorkbook(buffer: ArrayBuffer, existingMembers: TeamMember[]): MemberImportResult {
  const personnelResult = parsePersonnelRecordWorkbook(buffer, existingMembers)
  if (personnelResult) return personnelResult
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

  return { members: Array.from(byName.values()), errors, importedCount, addedCount, updatedCount, addedIds, sourceType: 'member-template' }
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
  let taskSheetParsed = false
  let memberSheetParsed = false
  const errors: string[] = []

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) return
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', range: 0 })
    const labels = new Set(rows.slice(0, 8).flat().map((value) => normalizedLabel(value)))
    const isPersonnelRecord = rows.slice(0, 8).flat().some((value) => compactPersonnelLabel(value).includes('종합인사기록카드'))
    const singleSheetWorkbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(singleSheetWorkbook, sheet, sheetName)
    const singleSheetBuffer = XLSX.write(singleSheetWorkbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer

    if (labels.has('과제명') && labels.has('과제등급') && !taskSheetParsed) {
      const result = parseTaskWorkbook(singleSheetBuffer, tasks)
      tasks = result.tasks
      taskCount += result.importedCount
      taskSheetParsed = true
      errors.push(...result.errors.map((error) => `${sheetName}: ${error}`))
    } else if (!memberSheetParsed && (isPersonnelRecord || (labels.has('이름') && (labels.has('직급') || labels.has('직책')) && !labels.has('평가연도')))) {
      const result = parseMemberWorkbook(singleSheetBuffer, members)
      members = result.members
      memberCount += result.importedCount
      memberSheetParsed = true
      errors.push(...result.errors.map((error) => `${sheetName}: ${error}`))
    }
  })

  return { tasks, members, taskCount, memberCount, errors }
}

export interface IntegratedPeerReviewImportResult {
  reviews: PeerReview[]
  importedCount: number
  errors: string[]
}

const INTEGRATED_PEER_HEADERS = {
  task: ['과제명', '과제'],
  reviewer: ['리뷰어', '평가자'],
  target: ['대상팀원', '평가대상', '대상자'],
  contribution: ['기여도(%)', '기여도', '기여도 %'],
  grade: ['수행등급', '개인수행등급', '등급'],
  evidence: ['근거', '코멘트', '의견'],
}

function findHeaderColumn(row: unknown[], aliases: string[]) {
  return row.findIndex((value) => aliases.includes(normalizedLabel(value)))
}

export function parseIntegratedPeerReviewWorkbook(
  buffer: ArrayBuffer,
  tasks: Task[],
  members: TeamMember[],
): IntegratedPeerReviewImportResult {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const taskByName = new Map(tasks.map((task) => [normalizedLabel(task.name), task]))
  const memberByName = new Map(members.map((member) => [normalizedLabel(member.name), member]))
  const reviews: PeerReview[] = []
  const errors: string[] = []

  workbook.SheetNames.forEach((sheetName) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: '' })
    const headerIndex = rows.slice(0, 10).findIndex((row) => (
      findHeaderColumn(row, INTEGRATED_PEER_HEADERS.task) >= 0
      && findHeaderColumn(row, INTEGRATED_PEER_HEADERS.reviewer) >= 0
      && findHeaderColumn(row, INTEGRATED_PEER_HEADERS.target) >= 0
    ))
    if (headerIndex < 0) return
    const header = rows[headerIndex]
    const taskColumn = findHeaderColumn(header, INTEGRATED_PEER_HEADERS.task)
    const reviewerColumn = findHeaderColumn(header, INTEGRATED_PEER_HEADERS.reviewer)
    const targetColumn = findHeaderColumn(header, INTEGRATED_PEER_HEADERS.target)
    const contributionColumn = findHeaderColumn(header, INTEGRATED_PEER_HEADERS.contribution)
    const gradeColumn = findHeaderColumn(header, INTEGRATED_PEER_HEADERS.grade)
    const evidenceColumn = findHeaderColumn(header, INTEGRATED_PEER_HEADERS.evidence)

    rows.slice(headerIndex + 1).forEach((row, rowOffset) => {
      const rowNumber = headerIndex + rowOffset + 2
      if (!row.some((value) => normalizedLabel(value))) return
      const taskName = normalizedLabel(row[taskColumn])
      const reviewerName = normalizedLabel(row[reviewerColumn])
      const targetName = normalizedLabel(row[targetColumn])
      const task = taskByName.get(taskName)
      const reviewer = memberByName.get(reviewerName)
      const target = memberByName.get(targetName)
      if (!task) { errors.push(`${sheetName} ${rowNumber}행: 과제 '${taskName}'을(를) 찾을 수 없습니다.`); return }
      if (!reviewer) { errors.push(`${sheetName} ${rowNumber}행: 리뷰어 '${reviewerName}'을(를) 찾을 수 없습니다.`); return }
      if (!target) { errors.push(`${sheetName} ${rowNumber}행: 대상팀원 '${targetName}'을(를) 찾을 수 없습니다.`); return }
      const contributionRaw = contributionColumn >= 0 ? row[contributionColumn] : ''
      const contribution = contributionRaw === '' ? null : Number(contributionRaw)
      if (contribution !== null && (!Number.isFinite(contribution) || contribution < 0 || contribution > 100)) {
        errors.push(`${sheetName} ${rowNumber}행: 기여도는 0~100 숫자여야 합니다.`)
        return
      }
      const gradeRaw = gradeColumn >= 0 ? normalizedLabel(row[gradeColumn]).toUpperCase() : ''
      if (gradeRaw && !PERFORMANCE_GRADE_OPTIONS.includes(gradeRaw as PerformanceGrade)) {
        errors.push(`${sheetName} ${rowNumber}행: 수행등급은 S/A/B/C/D 중 하나여야 합니다.`)
        return
      }
      reviews.push({
        id: uuidv4(),
        taskId: task.id,
        reviewerMemberId: reviewer.id,
        reviewerName: reviewer.name,
        targetMemberId: target.id,
        contributionPercent: contribution,
        grade: gradeRaw ? gradeRaw as PerformanceGrade : null,
        evidence: evidenceColumn >= 0 ? String(row[evidenceColumn] ?? '').trim() : '',
      })
    })
  })

  return { reviews, importedCount: reviews.length, errors }
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
  ;(ws as XLSX.WorkSheet & { '!dataValidation'?: unknown[] })['!dataValidation'] = [
    { sqref: `B4:B${lastDataRow}`, type: 'whole', operator: 'between', formula1: '0', formula2: '100', allowBlank: true },
    ...(includeGrade ? [{ sqref: `C4:C${lastDataRow}`, type: 'list', formula1: '"S,A,B,C,D"', allowBlank: true }] : []),
  ]
  const style = (
    cellAddress: string,
    fill: string,
    color: string,
    bold = false,
    horizontal: 'left' | 'center' | 'right' = 'left',
    fontSize = 10,
  ) => {
    const cell = ws[cellAddress]
    if (!cell) return
    cell.s = {
      fill: { patternType: 'solid', fgColor: { rgb: fill } },
      font: { name: 'Arial', sz: fontSize, color: { rgb: color }, bold },
      alignment: { vertical: 'center', horizontal, wrapText: true },
      border: {
        top: { style: 'thin', color: { rgb: 'D9DEE7' } },
        bottom: { style: 'thin', color: { rgb: 'D9DEE7' } },
        left: { style: 'thin', color: { rgb: 'D9DEE7' } },
        right: { style: 'thin', color: { rgb: 'D9DEE7' } },
      },
    }
  }
  style('A1', '17233B', 'FFFFFF', true, 'left', 16)
  style('A2', 'EEF2F7', '526071', false, 'left', 10)
  for (let column = 0; column < (includeGrade ? 4 : 3); column += 1) {
    style(XLSX.utils.encode_cell({ r: 2, c: column }), 'F3F4F6', '111827', true, 'center', 11)
  }
  for (let row = 3; row < totalRow - 1; row += 1) {
    style(XLSX.utils.encode_cell({ r: row, c: 0 }), 'FFFFFF', '111827')
    style(XLSX.utils.encode_cell({ r: row, c: 1 }), 'FFF4E8', '111827', false, 'right')
    if (includeGrade) style(XLSX.utils.encode_cell({ r: row, c: 2 }), 'FFF4E8', '111827', false, 'center')
    style(XLSX.utils.encode_cell({ r: row, c: includeGrade ? 3 : 2 }), 'FFF4E8', '6B7280')
  }
  for (let column = 0; column < (includeGrade ? 4 : 3); column += 1) {
    style(XLSX.utils.encode_cell({ r: totalRow - 1, c: column }), 'EAF6EA', '205B35', true, column === 1 ? 'right' : 'left')
  }
}

function applyPeerReviewGuideLayout(ws: XLSX.WorkSheet) {
  ws['!cols'] = [{ wch: 14 }, { wch: 68 }]
  ws['!rows'] = [{ hpt: 34 }, { hpt: 28 }, { hpt: 24 }, { hpt: 10 }, { hpt: 26 }, { hpt: 30 }, { hpt: 30 }, { hpt: 30 }]
  ws['!merges'] = [XLSX.utils.decode_range('A1:B1')]
  const style = (address: string, fill: string, color: string, bold = false, size = 10) => {
    const cell = ws[address]
    if (!cell) return
    cell.s = {
      fill: { patternType: 'solid', fgColor: { rgb: fill } },
      font: { name: 'Arial', sz: size, color: { rgb: color }, bold },
      alignment: { vertical: 'center', horizontal: 'left', wrapText: true },
      border: {
        top: { style: 'thin', color: { rgb: 'D9DEE7' } },
        bottom: { style: 'thin', color: { rgb: 'D9DEE7' } },
        left: { style: 'thin', color: { rgb: 'D9DEE7' } },
        right: { style: 'thin', color: { rgb: 'D9DEE7' } },
      },
    }
  }
  style('A1', '17233B', 'FFFFFF', true, 18)
  style('A2', 'EEF2F7', '526071')
  style('B2', 'EEF2F7', '111827', true)
  style('A3', 'EEF2F7', '526071')
  style('B3', 'EEF2F7', '111827', true)
  style('A5', 'F3F4F6', '111827', true, 11)
  style('B5', 'F3F4F6', '111827', true, 11)
  for (let row = 6; row <= 8; row += 1) {
    style(`A${row}`, 'FFFFFF', '111827', true)
    style(`B${row}`, 'FFFFFF', '111827')
  }
}

interface MemberPeerReviewTemplateInput {
  projectId: string
  periodLabel: string
  periodFileName: string
  tasks: Task[]
  members: TeamMember[]
  contributions: Contribution[]
  includeGrade: boolean
  participantIdsByTask?: Record<string, string[]>
}

function xmlEscape(value: unknown) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function peerReviewGuideXml() {
  return `<?xml version="1.0" encoding="utf-8"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetViews><x:sheetView showGridLines="0" workbookViewId="0" /></x:sheetViews><x:sheetFormatPr defaultRowHeight="15" /><x:cols><x:col min="1" max="1" width="12" hidden="0" customWidth="1" /><x:col min="2" max="2" width="76" hidden="0" customWidth="1" /></x:cols><x:sheetData><x:row r="1" ht="34" customHeight="1"><x:c r="A1" s="4" t="str"><x:v>피어리뷰 입력 안내</x:v></x:c><x:c r="B1" s="4" /></x:row><x:row r="2" ht="30" customHeight="1"><x:c r="A2" s="9" t="str"><x:v>과제별로 평가 대상 팀원의 기여도·수행등급·근거를 입력합니다.</x:v></x:c><x:c r="B2" s="9" /></x:row><x:row r="4"><x:c r="A4" s="14" t="str"><x:v>구분</x:v></x:c><x:c r="B4" s="14" t="str"><x:v>입력 안내</x:v></x:c></x:row><x:row r="5" ht="28" customHeight="1"><x:c r="A5" s="17" t="str"><x:v>1</x:v></x:c><x:c r="B5" s="17" t="str"><x:v>평가기간·평가자·과제·대상 팀원은 현재 데이터로 입력되어 있습니다.</x:v></x:c></x:row><x:row r="6" ht="28" customHeight="1"><x:c r="A6" s="17" t="str"><x:v>2</x:v></x:c><x:c r="B6" s="17" t="str"><x:v>과제별 시트의 연한 주황색 칸에 기여도·수행등급·근거를 입력합니다.</x:v></x:c></x:row><x:row r="7" ht="28" customHeight="1"><x:c r="A7" s="17" t="str"><x:v>3</x:v></x:c><x:c r="B7" s="17" t="str"><x:v>과제별 평가 대상의 기여도 합계가 100%인지 확인합니다.</x:v></x:c></x:row></x:sheetData><x:mergeCells><x:mergeCell ref="A1:B1" /><x:mergeCell ref="A2:B2" /></x:mergeCells><x:pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3" /></x:worksheet>`
}

function peerReviewMetaXml(periodLabel: string, reviewerName: string) {
  return `<?xml version="1.0" encoding="utf-8"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetFormatPr defaultRowHeight="15" /><x:cols><x:col min="1" max="1" width="18" hidden="0" customWidth="1" /><x:col min="2" max="2" width="30" hidden="0" customWidth="1" /></x:cols><x:sheetData><x:row r="1"><x:c r="A1" s="19" t="str"><x:v>항목</x:v></x:c><x:c r="B1" s="19" t="str"><x:v>값</x:v></x:c></x:row><x:row r="2"><x:c r="A2" s="15" t="str"><x:v>평가기간</x:v></x:c><x:c r="B2" s="15" t="str"><x:v>${xmlEscape(periodLabel)}</x:v></x:c></x:row><x:row r="3"><x:c r="A3" s="15" t="str"><x:v>평가자</x:v></x:c><x:c r="B3" s="15" t="str"><x:v>${xmlEscape(reviewerName)}</x:v></x:c></x:row><x:row r="4"><x:c r="A4" s="15" t="str"><x:v>양식버전</x:v></x:c><x:c r="B4" s="15" t="n"><x:v>5</x:v></x:c></x:row></x:sheetData><x:pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3" /></x:worksheet>`
}

function peerReviewTaskXml(task: Task, periodLabel: string, reviewer: TeamMember, participants: TeamMember[], includeGrade: boolean) {
  const percentages = evenlyDistributedPercentages(participants.length)
  const lastColumn = includeGrade ? 'D' : 'C'
  const totalRow = participants.length + 4
  const lastDataRow = totalRow - 1
  const headerCells = includeGrade
    ? '<x:c r="A3" s="14" t="str"><x:v>평가 대상</x:v></x:c><x:c r="B3" s="14" t="str"><x:v>기여도(%)</x:v></x:c><x:c r="C3" s="14" t="str"><x:v>수행등급</x:v></x:c><x:c r="D3" s="14" t="str"><x:v>근거</x:v></x:c>'
    : '<x:c r="A3" s="14" t="str"><x:v>평가 대상</x:v></x:c><x:c r="B3" s="14" t="str"><x:v>기여도(%)</x:v></x:c><x:c r="C3" s="14" t="str"><x:v>근거</x:v></x:c>'
  const participantRows = participants.map((member, index) => {
    const row = index + 4
    const label = `${member.name}${member.id === reviewer.id ? ' (본인)' : ''}`
    return includeGrade
      ? `<x:row r="${row}" ht="28" customHeight="1"><x:c r="A${row}" s="26" t="str"><x:v>${xmlEscape(label)}</x:v></x:c><x:c r="B${row}" s="30" t="n"><x:v>${percentages[index]}</x:v></x:c><x:c r="C${row}" s="30" t="str" /><x:c r="D${row}" s="29" t="str" /></x:row>`
      : `<x:row r="${row}" ht="28" customHeight="1"><x:c r="A${row}" s="26" t="str"><x:v>${xmlEscape(label)}</x:v></x:c><x:c r="B${row}" s="30" t="n"><x:v>${percentages[index]}</x:v></x:c><x:c r="C${row}" s="29" t="str" /></x:row>`
  }).join('')
  const totalCells = includeGrade
    ? `<x:c r="A${totalRow}" s="34" t="str"><x:v>기여도 합계</x:v></x:c><x:c r="B${totalRow}" s="35" t="n"><x:f>SUM(B4:B${lastDataRow})</x:f><x:v>100</x:v></x:c><x:c r="C${totalRow}" s="35" t="str"><x:v>검증</x:v></x:c><x:c r="D${totalRow}" s="35" t="str"><x:f>IF(B${totalRow}=100,"정상","100% 확인")</x:f><x:v>정상</x:v></x:c>`
    : `<x:c r="A${totalRow}" s="34" t="str"><x:v>기여도 합계</x:v></x:c><x:c r="B${totalRow}" s="35" t="n"><x:f>SUM(B4:B${lastDataRow})</x:f><x:v>100</x:v></x:c><x:c r="C${totalRow}" s="35" t="str"><x:f>IF(B${totalRow}=100,"정상","100% 확인")</x:f><x:v>정상</x:v></x:c>`
  const columns = includeGrade
    ? '<x:col min="1" max="1" width="18" hidden="0" customWidth="1" /><x:col min="2" max="2" width="14" hidden="0" customWidth="1" /><x:col min="3" max="3" width="14" hidden="0" customWidth="1" /><x:col min="4" max="4" width="48" hidden="0" customWidth="1" />'
    : '<x:col min="1" max="1" width="18" hidden="0" customWidth="1" /><x:col min="2" max="2" width="14" hidden="0" customWidth="1" /><x:col min="3" max="3" width="48" hidden="0" customWidth="1" />'
  const gradeValidation = includeGrade ? `<x:dataValidation type="list" sqref="C4:C${lastDataRow}"><x:formula1>"S,A,B,C,D"</x:formula1></x:dataValidation>` : ''
  return `<?xml version="1.0" encoding="utf-8"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetViews><x:sheetView showGridLines="0" workbookViewId="0" /></x:sheetViews><x:sheetFormatPr defaultRowHeight="15" /><x:cols>${columns}</x:cols><x:sheetData><x:row r="1" ht="32" customHeight="1"><x:c r="A1" s="22" t="str"><x:v>과제: ${xmlEscape(task.name)}</x:v></x:c></x:row><x:row r="2" ht="24" customHeight="1"><x:c r="A2" s="24" t="str"><x:v>평가기간: ${xmlEscape(periodLabel)}</x:v></x:c></x:row><x:row r="3" ht="28" customHeight="1">${headerCells}</x:row>${participantRows}<x:row r="${totalRow}" ht="28" customHeight="1">${totalCells}</x:row></x:sheetData><x:autoFilter ref="A3:${lastColumn}${lastDataRow}" /><x:mergeCells><x:mergeCell ref="A1:${lastColumn}1" /><x:mergeCell ref="A2:${lastColumn}2" /></x:mergeCells><x:dataValidations count="${includeGrade ? 2 : 1}"><x:dataValidation type="whole" operator="between" sqref="B4:B${lastDataRow}"><x:formula1>0</x:formula1><x:formula2>100</x:formula2></x:dataValidation>${gradeValidation}</x:dataValidations><x:pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3" /></x:worksheet>`
}

async function createStyledMemberPeerReviewTemplateFiles(input: MemberPeerReviewTemplateInput, templateData: Uint8Array) {
  const baseEntries = await unzipFileEntries(templateData)
  const encoder = new TextEncoder()
  const requiredBase = ['_rels/.rels', 'xl/styles.xml', 'xl/theme/theme1.xml', 'xl/sharedStrings.xml']
  const generated: string[] = []
  const files: { name: string; data: Uint8Array }[] = []
  for (const reviewer of input.members) {
    const taskRows = input.tasks.flatMap((task, taskIndex) => {
      const assigned = peerReviewParticipants(task.id, input.members, input.contributions)
      const defaults = assigned.length > 0 ? assigned : input.members
      const selectedIds = input.participantIdsByTask?.[task.id]
      const participants = selectedIds ? input.members.filter((member) => selectedIds.includes(member.id)) : defaults
      return participants.length > 0 ? [{ task, taskIndex, participants }] : []
    })
    const workbookSheets = [
      '<x:sheet name="안내" sheetId="1" r:id="rId1" />',
      '<x:sheet name="_메타" sheetId="2" state="hidden" r:id="rId2" />',
      ...taskRows.map(({ task, taskIndex }, index) => `<x:sheet name="${xmlEscape(safeSheetName(task.name, taskIndex))}" sheetId="${index + 3}" r:id="rId${index + 3}" />`),
    ].join('')
    const workbookXml = `<?xml version="1.0" encoding="utf-8"?><x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><x:sheets>${workbookSheets}</x:sheets></x:workbook>`
    const rels = [
      '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="/xl/styles.xml" Id="rIdStyles" />',
      '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="/xl/theme/theme1.xml" Id="rIdTheme" />',
      '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="/xl/sharedStrings.xml" Id="rIdStrings" />',
      '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml" Id="rId1" />',
      '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet2.xml" Id="rId2" />',
      ...taskRows.map((_, index) => `<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet${index + 3}.xml" Id="rId${index + 3}" />`),
    ].join('')
    const workbookRels = `<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`
    const overrides = Array.from({ length: taskRows.length + 2 }, (_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" />`).join('')
    const contentTypes = `<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml" /><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" /><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" /><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml" /><Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml" /><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml" />${overrides}</Types>`
    const entries: { name: string; data: Uint8Array }[] = requiredBase.map((name) => {
      const data = baseEntries.get(name)
      if (!data) throw new Error(`Excel 기본 양식 구성 요소가 없습니다: ${name}`)
      return { name, data }
    })
    entries.push(
      { name: '[Content_Types].xml', data: encoder.encode(contentTypes) },
      { name: 'xl/workbook.xml', data: encoder.encode(workbookXml) },
      { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(workbookRels) },
      { name: 'xl/worksheets/sheet1.xml', data: encoder.encode(peerReviewGuideXml()) },
      { name: 'xl/worksheets/sheet2.xml', data: encoder.encode(peerReviewMetaXml(input.periodLabel, reviewer.name)) },
      ...taskRows.map(({ task, participants }, index) => ({ name: `xl/worksheets/sheet${index + 3}.xml`, data: encoder.encode(peerReviewTaskXml(task, input.periodLabel, reviewer, participants, input.includeGrade)) })),
    )
    files.push({ name: `${input.periodFileName}_피어리뷰_${reviewer.name}.xlsx`, data: zipStoredFileBytes(entries) })
    generated.push(reviewer.name)
  }
  return { files, generated }
}

export function createMemberPeerReviewTemplateFiles({
  projectId: _projectId, periodLabel, periodFileName, tasks, members, contributions, includeGrade, participantIdsByTask,
}: MemberPeerReviewTemplateInput) {
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
    applyPeerReviewGuideLayout(guide)
    XLSX.utils.book_append_sheet(wb, guide, '안내')
    const meta = XLSX.utils.aoa_to_sheet([
      ['구분', '값'], ['평가기간', periodLabel], ['평가자', reviewer.name], ['양식버전', 5],
    ])
    XLSX.utils.book_append_sheet(wb, meta, '_메타')
    tasks.forEach((task, taskIndex) => {
      const assignedParticipants = peerReviewParticipants(task.id, members, contributions)
      const defaultParticipants = assignedParticipants.length > 0 ? assignedParticipants : members
      const selectedIds = participantIdsByTask?.[task.id]
      const participants = selectedIds
        ? members.filter((member) => selectedIds.includes(member.id))
        : defaultParticipants
      if (participants.length === 0) return
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
    files.push({ name: filename, data: new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })) })
    generated.push(reviewer.name)
  }
  return { files, generated }
}

export async function downloadMemberPeerReviewTemplates(input: MemberPeerReviewTemplateInput) {
  const template = await loadStaticTemplateFile('peerReviews')
  const { files, generated } = template
    ? await createStyledMemberPeerReviewTemplateFiles(input, template.data)
    : createMemberPeerReviewTemplateFiles(input)
  if (files.length > 0) downloadBlob(zipStoredFiles(files), `${input.periodFileName}_피어리뷰_전체.zip`)
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
    ['순위', '이름', '역할', '직책', '직급', '참여 과제 수', '성과점수', '누적 점수(개인점수 합)'],
    ...results.map((row, index) => [
      index + 1,
      row.member.name,
      row.member.role || '-',
      row.member.position || '-',
      row.member.level || '-',
      row.participatedTaskCount,
      Number(row.performanceScore.toFixed(1)),
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
    ['팀원', '과제명', '과제점수', '기여도(%)', '개인수행등급', '목표', '성과', '성과등급', '개인점수', '기여도합계 100% 여부'],
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
      const personalScore = taskScore * (c.contributionPercent / 100) * calcPersonalGradeFactor(c, criteria)
      detailRows.push([
        member.name,
        task.name,
        Number(taskScore.toFixed(1)),
        c.contributionPercent,
        personalFactor,
        task.objective || '-',
        task.achievement || '-',
        task.performanceGrade,
        Number(personalScore.toFixed(1)),
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

  const notesRows: (string | number)[][] = [['팀원', '날짜', '성과기간', '출처', '원본 파일', '면담 코멘트']]
  const sortedNotes = [...meetingNotes].sort((a, b) => {
    const memberA = members.find((m) => m.id === a.memberId)?.name ?? ''
    const memberB = members.find((m) => m.id === b.memberId)?.name ?? ''
    return memberA.localeCompare(memberB) || a.date.localeCompare(b.date)
  })
  for (const note of sortedNotes) {
    const member = members.find((m) => m.id === note.memberId)
    if (!member) continue
    notesRows.push([member.name, note.date, note.sourcePeriod ?? '', note.source === 'performance-pdf' ? '성과 PDF' : '직접 작성', note.sourceFileName ?? '', note.comment])
  }
  const notesSheet = XLSX.utils.aoa_to_sheet(notesRows)
  notesSheet['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 12 }, { wch: 28 }, { wch: 50 }]

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
