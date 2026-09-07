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
  const [fileNames, setFileNames] = useState<string[]>([])
  const [result, setResult] = useState<GrowthHistoryImportResult | null>(null)
  const [message, setMessage] = useState('')
  const [dragging, setDragging] = useState(false)
  const [performanceDocuments, setPerformanceDocuments] = useState<Array<{ document: ImportedPerformanceDocument; selectedComments: number[] }>>([])

  async function loadFiles(files: FileList | File[]) {
    if (files.length === 0) return
    let nextProfiles = profiles
    const importedMembers = new Set<string>()
    const errors: string[] = []
    const documents: Array<{ document: ImportedPerformanceDocument; selectedComments: number[] }> = []
    const loadedNames: string[] = []
    for (const file of Array.from(files)) {
      if (!/\.(xlsx?|pdf)$/i.test(file.name)) {
        errors.push(`${file.name}: Excel 또는 성과 PDF 파일만 불러올 수 있습니다.`)
        continue
      }
      try {
        const buffer = await file.arrayBuffer()
        const isPdf = /\.pdf$/i.test(file.name)
        const pdfResult = isPdf
          ? mergePerformancePdfIntoGrowthProfiles(await parsePerformancePdf(buffer, file.name, members), members, nextProfiles)
          : null
        const parsed: GrowthHistoryImportResult = pdfResult ?? parseGrowthHistoryWorkbook(buffer, members, nextProfiles)
        nextProfiles = parsed.profiles
        parsed.importedMembers.forEach((name) => importedMembers.add(name))
        errors.push(...parsed.errors.map((error) => `${file.name}: ${error}`))
        if (pdfResult?.document) {
          documents.push({ document: pdfResult.document, selectedComments: pdfResult.document.comments.map((_, index) => index) })
        }
        loadedNames.push(file.name)
      } catch {
        errors.push(`${file.name}: 파일을 읽는 중 문제가 발생했습니다.`)
      }
    }
    const parsed = { profiles: nextProfiles, importedMembers: Array.from(importedMembers), errors }
    setPerformanceDocuments(documents)
    setFileNames(loadedNames)
    setResult(parsed)
    setMessage(parsed.importedMembers.length > 0 ? '' : '현재 팀원과 일치하는 성과 이력을 찾지 못했습니다.')
  }

  function apply() {
    if (!result || result.importedMembers.length === 0) return
    const selectionByDocumentId = new Map(performanceDocuments.map((item) => [item.document.id, item]))
    onApply(result.profiles.map((profile) => ({
      ...profile,
      importedPerformanceDocuments: (profile.importedPerformanceDocuments ?? []).map((document) => {
        const selection = selectionByDocumentId.get(document.id)
        return selection ? { ...document, selectedComments: document.comments.filter((_, index) => selection.selectedComments.includes(index)) } : document
      }),
    })))
    onClose()
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4">
    <div role="dialog" aria-modal="true" aria-labelledby="growth-history-import-title" className="w-full max-w-xl overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
      <header className="flex items-start justify-between border-b border-gray-200 px-5 py-4"><div><h2 id="growth-history-import-title" className="text-lg font-semibold text-gray-950">지난 성과 파일 불러오기</h2><p className="mt-1 text-sm text-gray-500">팀원 이름이 일치하는 Excel 또는 성과 PDF를 성장·코멘트 기록에 연결합니다.</p></div><ModalCloseButton onClick={onClose} label="지난 성과 파일 불러오기 닫기" /></header>
      <div className="p-5">
        {!result ? <><button type="button" onClick={() => inputRef.current?.click()} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void loadFiles(event.dataTransfer.files) }} className={`flex w-full flex-col items-center justify-center rounded-lg border border-dashed px-5 py-10 text-center transition ${dragging ? 'border-accent bg-orange-50' : 'border-gray-300 bg-gray-50 hover:border-accent hover:bg-white'}`}><svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 fill-none stroke-gray-400" strokeWidth="1.7"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 14h8M8 18h5"/></svg><span className="mt-3 text-sm font-medium text-gray-800">클릭하거나 파일을 끌어다 놓으세요</span><span className="mt-1 text-xs text-gray-400">여러 이전 성과 Excel·성과평가 PDF를 한 번에 선택할 수 있습니다.</span></button><input ref={inputRef} type="file" multiple accept=".xlsx,.xls,.pdf,application/pdf" className="hidden" onChange={(event) => { if (event.target.files) void loadFiles(event.target.files); event.target.value = '' }} /></> : <div className="rounded-lg border border-gray-200"><div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-gray-900">{fileNames.length}개 파일</p><p className="mt-1 text-xs text-gray-500">현재 팀원과 일치한 {result.importedMembers.length}명</p></div><button type="button" onClick={() => { setResult(null); setFileNames([]); setMessage(''); setPerformanceDocuments([]) }} className="ui-button ui-button-ghost ui-button-sm">다른 파일</button></div><ul className="max-h-40 divide-y divide-gray-100 overflow-y-auto">{result.importedMembers.map((name) => <li key={name} className="flex items-center justify-between px-4 py-2.5 text-sm"><span className="font-medium text-gray-800">{name}</span><span className="text-xs font-medium text-success">연결 가능</span></li>)}</ul>{performanceDocuments.map(({ document, selectedComments }) => document.comments.length > 0 ? <section key={document.id} className="border-t border-gray-200 p-4"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-sm font-semibold text-gray-950">{document.memberName} · {document.fileName}</h3><p className="mt-1 text-xs text-gray-500">{document.periodLabel} · 선택한 내용은 면담 기록과 분리하여 저장됩니다.</p></div><span className="shrink-0 text-xs font-medium text-accent">{selectedComments.length}/{document.comments.length}개 선택</span></div><div className="mt-3 max-h-56 overflow-y-auto"><PerformanceCommentSelector comments={document.comments} selected={selectedComments} onToggle={(index) => setPerformanceDocuments((current) => current.map((item) => item.document.id !== document.id ? item : { ...item, selectedComments: item.selectedComments.includes(index) ? item.selectedComments.filter((value) => value !== index) : [...item.selectedComments, index] }))} /></div></section> : null)}</div>}
        {(message || result?.errors.length) ? <div className="mt-3 space-y-1 text-sm text-danger">{message && <p>{message}</p>}{result?.errors.map((error) => <p key={error}>{error}</p>)}</div> : null}
        <div className="mt-4 flex items-center justify-between gap-3"><button type="button" onClick={() => void downloadQuickStartTemplateFile('growth')} className="ui-button ui-button-ghost">입력 양식 받기</button><div className="flex gap-2"><button type="button" onClick={onClose} className="ui-button ui-button-secondary">취소</button><button type="button" disabled={!result || result.importedMembers.length === 0} onClick={apply} className="ui-button ui-button-primary">성과 이력 적용</button></div></div>
      </div>
    </div>
  </div>
}
