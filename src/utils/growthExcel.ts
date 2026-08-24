import * as XLSX from 'xlsx'
import type { EvaluationGrade, GrowthAuxiliaryMetrics, GrowthPerformanceRecord, MemberGrowthProfile, TeamMember } from '../types'
import { PERFORMANCE_GRADE_OPTIONS } from '../types'
import { getDefaultGrowthProfile, getPromotionYears } from './growth'

export interface GrowthHistoryImportResult {
  profiles: MemberGrowthProfile[]
  importedMembers: string[]
  errors: string[]
}

interface ParsedGrowthItem {
  name: string
  records: GrowthPerformanceRecord[]
  promotionReviewDate?: string
  positionYears?: number
  auxiliaryMetrics?: GrowthAuxiliaryMetrics
}

function styleCell(
  ws: XLSX.WorkSheet,
  address: string,
  fill: string,
  color = '111827',
  bold = false,
  horizontal: 'left' | 'center' = 'center',
) {
  const cell = ws[address]
  if (!cell) return
  cell.s = {
    ...(cell.s ?? {}),
    fill: { patternType: 'solid', fgColor: { rgb: fill } },
    font: { name: 'Arial', sz: 10, color: { rgb: color }, bold },
    alignment: { vertical: 'center', horizontal, wrapText: true },
    border: {
      top: { style: 'thin', color: { rgb: 'E5E7EB' } },
      bottom: { style: 'thin', color: { rgb: 'E5E7EB' } },
      left: { style: 'thin', color: { rgb: 'E5E7EB' } },
      right: { style: 'thin', color: { rgb: 'E5E7EB' } },
    },
  }
}

export async function downloadGrowthHistoryTemplate(
  members: TeamMember[],
  profiles: MemberGrowthProfile[] = [],
  currentYear = new Date().getFullYear(),
) {
  const profileByMemberId = new Map(profiles.map((profile) => [profile.memberId, profile]))
  const lastColumn = 'G'
  const rows: (string | number)[][] = [
    ['성과 이력 입력'],
    [`팀원별 승진심사 기준 · 팀원 ${members.length}명`],
    [],
    ['이름', '직급', '승진심사 시기', '평가연도', '업적(상)', '업적(하)', '역량'],
    ...members.flatMap((member) => {
      const profile = profileByMemberId.get(member.id)
      const reviewDate = profile?.promotionReviewDate ?? ''
      const years = getPromotionYears(reviewDate, currentYear + 1)
      return years.map((year, index) => [
        index === 0 ? member.name : '',
        index === 0 ? member.level || '' : '',
        index === 0 ? reviewDate : '',
        year,
        '',
        '',
        '',
      ])
    }),
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  members.forEach((_, memberIndex) => {
    const firstRow = 5 + memberIndex * 5
    for (let yearIndex = 0; yearIndex < 5; yearIndex += 1) {
      const row = firstRow + yearIndex
      ws[`D${row}`] = { t: 'n', f: `IF($C${firstRow}="","",VALUE(LEFT($C${firstRow},4))-${yearIndex + 1})` }
    }
  })
  ws['!cols'] = [{ wch: 18 }, { wch: 11 }, { wch: 17 }, { wch: 12 }, { wch: 13 }, { wch: 13 }, { wch: 13 }]
  ws['!rows'] = [
    { hpt: 34 }, { hpt: 23 }, { hpt: 9 }, { hpt: 28 },
    ...Array.from({ length: members.length * 5 }, () => ({ hpt: 27 })),
  ]
  ws['!merges'] = [
    XLSX.utils.decode_range(`A1:${lastColumn}1`),
    XLSX.utils.decode_range(`A2:${lastColumn}2`),
    ...members.flatMap((_, index) => ['A', 'B', 'C'].map((column) => XLSX.utils.decode_range(`${column}${5 + index * 5}:${column}${9 + index * 5}`))),
  ]
  ws['!autofilter'] = { ref: `A4:${lastColumn}${rows.length}` }
  ws['!freeze'] = { xSplit: 4, ySplit: 4, topLeftCell: 'E5', activePane: 'bottomRight', state: 'frozen' }
  const lastRow = rows.length
  styleCell(ws, 'A1', '111827', 'FFFFFF', true, 'left')
  styleCell(ws, 'A2', 'F9FAFB', '6B7280', false, 'left')
  for (let column = 0; column < 7; column += 1) {
    styleCell(ws, XLSX.utils.encode_cell({ r: 3, c: column }), 'F3F4F6', '111827', true)
  }
  for (let row = 4; row < lastRow; row += 1) {
    const groupStart = (row - 4) % 5 === 0
    if (groupStart) styleCell(ws, `A${row + 1}`, 'FFFFFF', '111827', true, 'left')
    if (groupStart) {
      styleCell(ws, `B${row + 1}`, 'FFFFFF', '4B5563', true)
      styleCell(ws, `C${row + 1}`, 'FFF7ED', '111827', true)
    }
    styleCell(ws, `D${row + 1}`, 'F9FAFB', '4B5563', true)
    for (let column = 4; column < 7; column += 1) {
      styleCell(ws, XLSX.utils.encode_cell({ r: row, c: column }), 'FFF7ED', '111827')
    }
  }
  ;(ws as XLSX.WorkSheet & { '!dataValidation'?: unknown[] })['!dataValidation'] = [{
    sqref: `E5:${lastColumn}${lastRow}`,
    type: 'list',
    formula1: '"S,A,B,C,D,-"',
    allowBlank: true,
    showErrorMessage: true,
    errorTitle: '등급 입력 오류',
    error: 'S, A, B, C, D, - 중 하나를 입력하세요.',
  }]
  const guide = XLSX.utils.aoa_to_sheet([
    ['성과 이력 입력 안내'],
    ['양식 생성연도', currentYear],
    ['대상 팀원', `${members.length}명`],
    [],
    ['입력 방법'],
    ['1', '성과입력 시트의 연한 주황색 칸에 승진심사 시기와 등급을 입력합니다.'],
    ['2', '승진심사 시기를 YYYY-MM 형식으로 바꾸면 해당 팀원의 5개 평가연도가 자동 변경됩니다.'],
    ['3', '업적(상), 업적(하), 역량 등급은 S/A/B/C/D 중 하나를 선택합니다.'],
    ['4', '평가가 없었던 기간은 비워두거나 -를 입력합니다.'],
    ['5', '팀원 이름·직급·평가연도 수식은 변경하지 마세요.'],
  ])
  guide['!cols'] = [{ wch: 16 }, { wch: 72 }]
  guide['!rows'] = [{ hpt: 34 }, { hpt: 24 }, { hpt: 24 }, { hpt: 10 }, { hpt: 26 }, { hpt: 28 }, { hpt: 28 }, { hpt: 28 }, { hpt: 28 }, { hpt: 28 }]
  guide['!merges'] = [XLSX.utils.decode_range('A1:B1')]
  styleCell(guide, 'A1', '111827', 'FFFFFF', true, 'left')
  styleCell(guide, 'A5', 'F3F4F6', '111827', true, 'left')
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, guide, '안내')
  XLSX.utils.book_append_sheet(wb, ws, '성과입력')
  const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${currentYear}_성과이력_입력양식.xlsx`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function grade(value: unknown): EvaluationGrade | null {
  const normalized = String(value ?? '').trim().toUpperCase()
  return PERFORMANCE_GRADE_OPTIONS.includes(normalized as EvaluationGrade) ? normalized as EvaluationGrade : null
}

function normalizeYear(value: unknown): number | null {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  if (numeric >= 0 && numeric < 100) return 2000 + numeric
  return numeric >= 1900 && numeric <= 2200 ? numeric : null
}

function mergeRecords(current: GrowthPerformanceRecord[] = [], incoming: GrowthPerformanceRecord[]) {
  const byYear = new Map(current.map((item) => [item.year, { ...item }]))
  for (const item of incoming) {
    const previous = byYear.get(item.year)
    byYear.set(item.year, {
      year: item.year,
      firstHalf: item.firstHalf ?? previous?.firstHalf ?? null,
      secondHalf: item.secondHalf ?? previous?.secondHalf ?? null,
      competency: item.competency ?? previous?.competency ?? null,
    })
  }
  return Array.from(byYear.values()).sort((a, b) => b.year - a.year)
}

function parseCompactSheet(rows: unknown[][], headerIndex: number): ParsedGrowthItem[] {
  const years = (rows[headerIndex] ?? []).slice(2).map(normalizeYear)
  const result: { name: string; records: GrowthPerformanceRecord[] }[] = []
  for (let rowIndex = headerIndex + 1; rowIndex + 2 < rows.length; rowIndex += 1) {
    const name = String(rows[rowIndex]?.[0] ?? '').trim()
    const firstLabel = String(rows[rowIndex]?.[1] ?? '').trim()
    if (!name || !['상', '업적(상)'].includes(firstLabel)) continue
    const records = years.flatMap((year, index) => year ? [{
      year,
      firstHalf: grade(rows[rowIndex]?.[index + 2]),
      secondHalf: grade(rows[rowIndex + 1]?.[index + 2]),
      competency: grade(rows[rowIndex + 2]?.[index + 2]),
    }] : [])
    result.push({ name, records })
    rowIndex += 2
  }
  return result
}

function parseMemberYearRows(rows: unknown[][], headerIndex: number): ParsedGrowthItem[] {
  const byName = new Map<string, ParsedGrowthItem>()
  let currentName = ''
  let currentReviewDate = ''
  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? []
    const nextName = String(row[0] ?? '').trim()
    if (nextName) {
      currentName = nextName
      currentReviewDate = String(row[2] ?? '').trim()
    }
    if (!currentName) continue
    const year = normalizeYear(row[3])
    if (!year) continue
    const item = byName.get(currentName) ?? { name: currentName, records: [], promotionReviewDate: currentReviewDate }
    item.records.push({ year, firstHalf: grade(row[4]), secondHalf: grade(row[5]), competency: grade(row[6]) })
    byName.set(currentName, item)
  }
  return Array.from(byName.values())
}

function parseMemberSheet(rows: unknown[][]): ParsedGrowthItem | null {
  const memberName = String(rows[2]?.[1] ?? '').trim()
  if (!memberName) return null
  const headerIndexes = rows.flatMap((row, index) => row.some((cell) => String(cell ?? '').trim() === '평가등급') ? [index] : [])
  const headerIndex = headerIndexes.length > 0 ? headerIndexes[headerIndexes.length - 1] : undefined
  if (headerIndex === undefined) return null
  const years = (rows[headerIndex] ?? []).slice(6, 11).map(normalizeYear)
  const records = years.flatMap((year, index) => year ? [{
    year,
    firstHalf: grade(rows[headerIndex + 1]?.[index + 6]),
    secondHalf: grade(rows[headerIndex + 2]?.[index + 6]),
    competency: grade(rows[headerIndex + 3]?.[index + 6]),
  }] : [])
  const reviewLabelIndex = rows.findIndex((row) => row.some((cell) => String(cell ?? '').trim() === '승급심사'))
  const reviewRaw = reviewLabelIndex >= 0 ? Number(rows[reviewLabelIndex + 1]?.[2]) : NaN
  const promotionReviewDate = Number.isFinite(reviewRaw) ? `${Math.trunc(reviewRaw)}-${String(Math.round((reviewRaw % 1) * 100) || 1).padStart(2, '0')}` : ''
  const positionYears = Number(rows[21]?.[1]) || undefined
  const auxiliaryMetrics = {
    position: Number(rows[headerIndex + 2]?.[14]) || 0,
    rewardPenalty: Number(rows[headerIndex + 3]?.[14]) || 0,
    tenure: Number(rows[headerIndex + 4]?.[14]) || 0,
    education: Number(rows[headerIndex + 5]?.[14]) || 0,
  }
  return { name: memberName, records, promotionReviewDate, positionYears, auxiliaryMetrics }
}

export function parseGrowthHistoryWorkbook(buffer: ArrayBuffer, members: TeamMember[], existingProfiles: MemberGrowthProfile[]): GrowthHistoryImportResult {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const parsed = workbook.SheetNames.flatMap((sheetName) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: '' })
    const memberYearHeaderIndex = rows.slice(0, 10).findIndex((row) => String(row[0] ?? '').trim() === '이름'
      && String(row[2] ?? '').trim() === '승진심사 시기'
      && String(row[3] ?? '').trim() === '평가연도')
    if (memberYearHeaderIndex >= 0) return parseMemberYearRows(rows, memberYearHeaderIndex)
    const compactHeaderIndex = rows.slice(0, 10).findIndex((row) => String(row[0] ?? '').trim() === '이름'
      && ['구분', '평가 구분'].includes(String(row[1] ?? '').trim()))
    if (compactHeaderIndex >= 0) return parseCompactSheet(rows, compactHeaderIndex)
    const member = parseMemberSheet(rows)
    return member ? [member] : []
  })
  const byMemberName = new Map(members.map((member) => [member.name.normalize('NFC'), member]))
  const byMemberId = new Map(existingProfiles.map((profile) => [profile.memberId, profile]))
  const importedMembers: string[] = []
  const errors: string[] = []
  const unmatchedNames = new Set<string>()
  for (const item of parsed) {
    const member = byMemberName.get(item.name.normalize('NFC'))
    if (!member) {
      unmatchedNames.add(item.name)
      continue
    }
    const current = byMemberId.get(member.id) ?? getDefaultGrowthProfile(member.id)
    byMemberId.set(member.id, {
      ...current,
      performanceHistory: mergeRecords(current.performanceHistory, item.records),
      ...(item.promotionReviewDate ? { promotionReviewDate: item.promotionReviewDate } : {}),
      ...(item.positionYears ? { positionYears: item.positionYears } : {}),
      ...(item.auxiliaryMetrics ? { auxiliaryMetrics: item.auxiliaryMetrics } : {}),
    })
    importedMembers.push(member.name)
  }
  if (unmatchedNames.size > 0) errors.push(`현재 팀원과 이름이 일치하지 않아 제외됨: ${Array.from(unmatchedNames).join(', ')}`)
  if (importedMembers.length === 0) errors.push('현재 팀원 이름과 일치하는 성과 이력을 찾지 못했습니다.')
  return { profiles: Array.from(byMemberId.values()), importedMembers: Array.from(new Set(importedMembers)), errors }
}
