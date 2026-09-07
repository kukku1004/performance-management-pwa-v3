import type { ImportedPerformanceDocument, MeetingNote } from '../types'

export function performanceDocumentMeetingDate(document: ImportedPerformanceDocument) {
  return document.half === 'first' ? `${document.year}-06-30` : `${document.year}-12-31`
}

export function createPerformanceMeetingNote(
  document: ImportedPerformanceDocument,
  memberId: string,
  selectedComments: string[],
): MeetingNote | null {
  const comments = selectedComments.map((comment) => comment.trim()).filter(Boolean)
  if (comments.length === 0) return null
  return {
    id: `meeting-${document.id}`,
    memberId,
    date: performanceDocumentMeetingDate(document),
    comment: comments.join('\n\n'),
    source: 'performance-pdf',
    sourcePeriod: document.periodLabel,
    sourceFileName: document.fileName,
  }
}
