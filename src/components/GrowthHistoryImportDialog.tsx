import { useRef, useState } from 'react'
import type { ImportedPerformanceDocument, MemberGrowthProfile, TeamMember } from '../types'
import { downloadQuickStartTemplateFile } from '../utils/excel'
import { parseGrowthHistoryWorkbook, type GrowthHistoryImportResult } from '../utils/growthExcel'
import { mergePerformancePdfIntoGrowthProfiles, parsePerformancePdf } from '../utils/performancePdf'
import ModalCloseButton from './ModalCloseButton'
import PerformanceCommentSelector from './PerformanceCommentSelector'

export default function GrowthHistoryImportDialog({ members, profiles, onApply, onClose }: {
  members: TeamMember[]
  profiles: MemberGrowthProfile[]
  onApply: (profiles: MemberGrowthProfile[]) => void
  onClose: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState<GrowthHistoryImportResult | null>(null)
  const [message, setMessage] = useState('')
  const [dragging, setDragging] = useState(false)
  const [performanceDocument, setPerformanceDocument] = useState<ImportedPerformanceDocument | null>(null)
  const [selectedComments, setSelectedComments] = useState<number[]>([])

  async function loadFile(file?: File) {
    if (!file) return
    if (!/\.(xlsx?|pdf)$/i.test(file.name)) { setMessage('Excel 또는 성과 PDF 파일만 불러올 수 있습니다.'); return }
    try {
      const buffer = await file.arrayBuffer()
      const isPdf = /\.pdf$/i.test(file.name)
      const pdfResult = isPdf
        ? mergePerformancePdfIntoGrowthProfiles(await parsePerformancePdf(buffer, file.name, members), members, profiles)
        : null
      const parsed: GrowthHistoryImportResult = pdfResult ?? parseGrowthHistoryWorkbook(buffer, members, profiles)
      const document = pdfResult?.document ?? null
      setPerformanceDocument(document)
      setSelectedComments(document?.comments.map((_, index) => index) ?? [])
      setFileName(file.name)
      setResult(parsed)
      setMessage(parsed.importedMembers.length > 0 ? '' : '현재 팀원과 일치하는 성과 이력을 찾지 못했습니다.')
    } catch {
      setResult(null)
      setMessage('파일을 읽는 중 문제가 발생했습니다. 이전 성과 Excel 또는 성과 PDF인지 확인하세요.')
    }
  }

  function apply() {
    if (!result || result.importedMembers.length === 0) return
    const member = performanceDocument
      ? members.find((item) => item.name.normalize('NFC').trim() === performanceDocument.memberName.normalize('NFC').trim())
      : undefined
    const selected = performanceDocument?.comments.filter((_, index) => selectedComments.includes(index)) ?? []
    const profiles = performanceDocument && member
      ? result.profiles.map((profile) => profile.memberId !== member.id ? profile : {
        ...profile,
        importedPerformanceDocuments: (profile.importedPerformanceDocuments ?? []).map((document) => document.id === performanceDocument.id ? { ...document, selectedComments: selected } : document),
      })
      : result.profiles
    onApply(profiles)
    onClose()
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4">
    <div role="dialog" aria-modal="true" aria-labelledby="growth-history-import-title" className="w-full max-w-xl overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
      <header className="flex items-start justify-between border-b border-gray-200 px-5 py-4"><div><h2 id="growth-history-import-title" className="text-lg font-semibold text-gray-950">지난 성과 파일 불러오기</h2><p className="mt-1 text-sm text-gray-500">팀원 이름이 일치하는 Excel 또는 성과 PDF를 성장·코멘트 기록에 연결합니다.</p></div><ModalCloseButton onClick={onClose} label="지난 성과 파일 불러오기 닫기" /></header>
      <div className="p-5">
        {!result ? <><button type="button" onClick={() => inputRef.current?.click()} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void loadFile(event.dataTransfer.files[0]) }} className={`flex w-full flex-col items-center justify-center rounded-lg border border-dashed px-5 py-10 text-center transition ${dragging ? 'border-accent bg-orange-50' : 'border-gray-300 bg-gray-50 hover:border-accent hover:bg-white'}`}><svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 fill-none stroke-gray-400" strokeWidth="1.7"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 14h8M8 18h5"/></svg><span className="mt-3 text-sm font-medium text-gray-800">클릭하거나 파일을 끌어다 놓으세요</span><span className="mt-1 text-xs text-gray-400">이전 성과 Excel 또는 성과평가 PDF</span></button><input ref={inputRef} type="file" accept=".xlsx,.xls,.pdf,application/pdf" className="hidden" onChange={(event) => { void loadFile(event.target.files?.[0]); event.target.value = '' }} /></> : <div className="rounded-lg border border-gray-200"><div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-gray-900">{fileName}</p><p className="mt-1 text-xs text-gray-500">현재 팀원과 일치한 {result.importedMembers.length}명</p></div><button type="button" onClick={() => { setResult(null); setFileName(''); setMessage(''); setPerformanceDocument(null); setSelectedComments([]) }} className="ui-button ui-button-ghost ui-button-sm">다른 파일</button></div><ul className="max-h-52 divide-y divide-gray-100 overflow-y-auto">{result.importedMembers.map((name) => <li key={name} className="flex items-center justify-between px-4 py-2.5 text-sm"><span className="font-medium text-gray-800">{name}</span><span className="text-xs font-medium text-success">연결 가능</span></li>)}</ul>{performanceDocument?.comments.length ? <section className="border-t border-gray-200 p-4"><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-gray-950">코멘트 기록으로 가져오기</h3><p className="mt-1 text-xs text-gray-500">{performanceDocument.periodLabel} · 선택한 내용은 면담 기록과 분리하여 저장됩니다.</p></div><span className="text-xs font-medium text-accent">{selectedComments.length}/{performanceDocument.comments.length}개 선택</span></div><div className="mt-3 max-h-56 overflow-y-auto"><PerformanceCommentSelector comments={performanceDocument.comments} selected={selectedComments} onToggle={(index) => setSelectedComments((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index])} /></div></section> : null}</div>}
        {(message || result?.errors.length) ? <div className="mt-3 space-y-1 text-sm text-danger">{message && <p>{message}</p>}{result?.errors.map((error) => <p key={error}>{error}</p>)}</div> : null}
        <div className="mt-4 flex items-center justify-between gap-3"><button type="button" onClick={() => void downloadQuickStartTemplateFile('growth')} className="ui-button ui-button-ghost">입력 양식 받기</button><div className="flex gap-2"><button type="button" onClick={onClose} className="ui-button ui-button-secondary">취소</button><button type="button" disabled={!result || result.importedMembers.length === 0} onClick={apply} className="ui-button ui-button-primary">성과 이력 적용</button></div></div>
      </div>
    </div>
  </div>
}
