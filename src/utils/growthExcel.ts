import * as XLSX from 'xlsx'
import type { EvaluationGrade, GrowthAuxiliaryMetrics, GrowthPerformanceRecord, MemberGrowthProfile, TeamMember } from '../types'
import { PERFORMANCE_GRADE_OPTIONS } from '../types'
import { getDefaultGrowthProfile } from './growth'

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

export function containsGrowthHistoryData(buffer: ArrayBuffer) {
  const workbook = XLSX.read(buffer, { type: 'array', sheetRows: 12 })
  return workbook.SheetNames.some((sheetName) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: '' })
    return rows.slice(0, 10).some((row) => {
      const labels = row.map((value) => String(value ?? '').normalize('NFC').trim())
      return labels.includes('이름') && (
        (labels.includes('승진심사 시기') && labels.includes('평가연도'))
        || labels.includes('평가 구분')
        || labels.includes('구분')
      )
    })
  })
}

function grade(value: unknown): EvaluationGrade | null {
  const normalized = String(value ?? '').trim().toUpperCase()
  return PERFORMANCE_GRADE_OPTIONS.includes(normalized as EvaluationGrade) ? normalized as EvaluationGrade : null
}

function normalizeYear(value: unknown): number | null {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  if (numeric > 0 && numeric < 100) return 2000 + numeric
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
