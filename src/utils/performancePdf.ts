import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type {
  EvaluationGrade,
  EvaluationPeriod,
  GrowthPerformanceRecord,
  ImportedPerformanceDocument,
  ImportedPerformanceTask,
  MemberGrowthProfile,
  TeamMember,
} from '../types'
import { PERFORMANCE_GRADE_OPTIONS } from '../types'
import { getDefaultGrowthProfile } from './growth'

export interface PerformancePdfParseResult {
  document: ImportedPerformanceDocument | null
  errors: string[]
}

export interface PerformancePdfGrowthResult {
  profiles: MemberGrowthProfile[]
  importedMembers: string[]
  errors: string[]
  document: ImportedPerformanceDocument | null
}

interface PdfRow {
  page: number
  y: number
  text: string
}

function normalizeText(value: string) {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim()
}

function normalizeName(value: string) {
  return normalizeText(value).replace(/\s/g, '')
}

function asGrade(value: string | undefined): EvaluationGrade | null {
  const normalized = normalizeText(value ?? '').toUpperCase()
  return PERFORMANCE_GRADE_OPTIONS.includes(normalized as EvaluationGrade) ? normalized as EvaluationGrade : null
}

async function extractRows(buffer: ArrayBuffer): Promise<PdfRow[]> {
  const { GlobalWorkerOptions, getDocument } = await import('pdfjs-dist')
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  const loadingTask = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false })
  const pdf = await loadingTask.promise
  const rows: PdfRow[] = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    const items = content.items.flatMap((item) => 'str' in item && item.str
      ? [{ text: item.str, x: item.transform[4], y: item.transform[5], width: item.width, size: Math.abs(item.transform[0]) }]
      : [])
      .sort((a, b) => Math.abs(b.y - a.y) > 2.5 ? b.y - a.y : a.x - b.x)
    const grouped: Array<{ y: number; items: typeof items }> = []
    for (const item of items) {
      const row = grouped.find((candidate) => Math.abs(candidate.y - item.y) <= 2.5)
      if (row) row.items.push(item)
      else grouped.push({ y: item.y, items: [item] })
    }
    grouped.sort((a, b) => b.y - a.y).forEach((row) => {
      const ordered = row.items.sort((a, b) => a.x - b.x)
      let text = ''
      ordered.forEach((item, index) => {
        const previous = ordered[index - 1]
        const gap = previous ? item.x - (previous.x + previous.width) : 0
        if (previous && gap > Math.max(1.5, Math.min(previous.size, item.size) * 0.28)) text += ' '
        text += item.text
      })
      rows.push({ page: pageNumber, y: row.y, text: normalizeText(text) })
    })
  }
  return rows
}

function findMember(text: string, members: TeamMember[]) {
  const match = text.match(/([가-힣]{2,4})\s*(사원|대리|과장|차장|부장|팀장)/)
  if (match) {
    const exact = members.find((member) => normalizeName(member.name) === normalizeName(match[1]))
    return { name: exact?.name ?? match[1], level: exact?.level || match[2] }
  }
  const exact = members.find((member) => text.includes(member.name.normalize('NFC')))
  return exact ? { name: exact.name, level: exact.level } : null
}

function findPeriod(text: string) {
  const match = text.match(/(\d{2,4})\s*년도?\s*(상반기|하반기|연간)/)
  if (!match) return null
  const rawYear = Number(match[1])
  const year = rawYear < 100 ? 2000 + rawYear : rawYear
  const half = match[2] === '상반기' ? 'first' : match[2] === '하반기' ? 'second' : 'annual'
  return { year, half, periodLabel: `${year}년 ${match[2]}` } as const
}

function findTasks(rows: PdfRow[]): ImportedPerformanceTask[] {
  const result: ImportedPerformanceTask[] = []
  for (const row of rows) {
    const match = row.text.match(/^(?:목표\s*)?(.+?)\s+(\d{1,3})\s*%\s+([SABCD])$/i)
    if (!match) continue
    const name = normalizeText(match[1]).replace(/^목표\s*/, '')
    if (!name || name === '과제명') continue
    result.push({ name, weightPercent: Number(match[2]), grade: asGrade(match[3]) })
  }
  return Array.from(new Map(result.map((task) => [task.name, task])).values())
}

function findComments(rows: PdfRow[]) {
  const commentPage = rows.find((row) => row.text.replace(/\s/g, '').includes('성과평가코멘트'))?.page
  if (!commentPage) return []
  const commentRows = rows.filter((row) => row.page === commentPage && !/^성과평가\s*코멘트$/.test(row.text))
  // 평가자 표시는 PDF에 따라 독립된 행이거나 코멘트 첫 문장과 같은 행에 놓인다.
  // 이전에는 행 간격을 거슬러 올라가 시작점을 찾으면서 간격이 촘촘한 하반기 양식의
  // 모든 평가자 블록이 0번 행으로 합쳐졌다. 각 "비공개" 표식을 경계로 직접 나눈다.
  const starts = commentRows.flatMap((row, index) => /비\s*공\s*개/.test(row.text) ? [index] : [])
  if (starts.length === 0) starts.push(0)
  return starts.flatMap((start, index) => {
    const end = starts[index + 1] ?? commentRows.length
    const text = normalizeText(commentRows.slice(start, end)
      .map((row) => row.text.replace(/^(?:비\s*공\s*개\s*)+/, '').trim())
      .filter((line) => line.length >= 2 && !/^\d+$/.test(line))
      .join(' '))
    return text ? [text] : []
  })
}

export async function parsePerformancePdf(
  buffer: ArrayBuffer,
  fileName: string,
  members: TeamMember[] = [],
): Promise<PerformancePdfParseResult> {
  const rows = await extractRows(buffer)
  const fullText = normalizeText(rows.map((row) => row.text).join(' '))
  const errors: string[] = []
  if (!fullText.includes('인사평가') || !fullText.includes('성과평가')) {
    return { document: null, errors: ['지원하는 성과평가 PDF 형식을 찾지 못했습니다.'] }
  }
  const member = findMember(fullText, members)
  const period = findPeriod(fullText)
  if (!member) errors.push('팀원 이름을 찾지 못했습니다.')
  if (!period) errors.push('평가기간을 찾지 못했습니다.')
  if (!member || !period) return { document: null, errors }
  const teamName = fullText.match(/([A-Za-z]+(?:\s+[A-Za-z]+)*팀)/)?.[1]?.trim()
    ?? fullText.match(/([가-힣]{2,20}팀)/)?.[1]?.trim()
    ?? ''
  const finalGrade = asGrade(fullText.match(/성과평가\s*([SABCD])(?:\s|$)/i)?.[1])
  const tasks = findTasks(rows)
  const comments = findComments(rows)
  if (tasks.length === 0) errors.push('과제별 성과를 찾지 못했습니다.')
  if (!finalGrade) errors.push('최종 성과등급을 찾지 못했습니다.')
  const id = `performance-pdf-${period.year}-${period.half}-${normalizeName(member.name)}`
  return {
    document: {
      id,
      fileName,
      importedAt: new Date().toISOString(),
      year: period.year,
      half: period.half,
      periodLabel: period.periodLabel,
      memberName: member.name,
      teamName,
      level: member.level,
      finalGrade,
      tasks,
      comments,
    },
    errors,
  }
}

function mergeRecords(current: GrowthPerformanceRecord[] = [], document: ImportedPerformanceDocument) {
  const byYear = new Map(current.map((record) => [record.year, { ...record }]))
  const previous = byYear.get(document.year) ?? { year: document.year, firstHalf: null, secondHalf: null, competency: null }
  byYear.set(document.year, {
    ...previous,
    ...(document.half === 'first' ? { firstHalf: document.finalGrade } : {}),
    ...(document.half === 'second' ? { secondHalf: document.finalGrade } : {}),
    ...(document.half === 'annual' ? { secondHalf: document.finalGrade } : {}),
  })
  return Array.from(byYear.values()).sort((a, b) => b.year - a.year)
}

export function mergePerformancePdfIntoGrowthProfiles(
  parsed: PerformancePdfParseResult,
  members: TeamMember[],
  profiles: MemberGrowthProfile[],
): PerformancePdfGrowthResult {
  if (!parsed.document) return { profiles, importedMembers: [], errors: parsed.errors, document: null }
  const document = parsed.document
  const member = members.find((item) => normalizeName(item.name) === normalizeName(document.memberName))
  if (!member) return { profiles, importedMembers: [], errors: [...parsed.errors, `현재 팀원과 이름이 일치하지 않아 제외됨: ${document.memberName}`], document }
  const byMemberId = new Map(profiles.map((profile) => [profile.memberId, profile]))
  const current = byMemberId.get(member.id) ?? getDefaultGrowthProfile(member.id)
  const documents = current.importedPerformanceDocuments ?? []
  const previousDocument = documents.find((item) => item.id === document.id)
  const mergedDocument = previousDocument?.selectedComments
    ? { ...document, selectedComments: previousDocument.selectedComments }
    : document
  byMemberId.set(member.id, {
    ...current,
    performanceHistory: mergeRecords(current.performanceHistory, document),
    importedPerformanceDocuments: [...documents.filter((item) => item.id !== document.id), mergedDocument]
      .sort((a, b) => b.year - a.year || b.half.localeCompare(a.half)),
  })
  return { profiles: Array.from(byMemberId.values()), importedMembers: [member.name], errors: parsed.errors, document }
}

export function performanceDocumentMatchesPeriod(document: ImportedPerformanceDocument, period: EvaluationPeriod) {
  if (document.year !== period.year) return false
  if (period.type === 'annual') return document.half === 'annual'
  if (period.type !== 'half') return false
  const value = period.value.toLowerCase().replace(/\s+/g, '')
  const half = /상반기|first|h1/.test(value) || value === '1'
    ? 'first'
    : /하반기|second|h2/.test(value) || value === '2'
      ? 'second'
      : null
  return document.half === half
}
