import { useEffect, useRef, useState } from 'react'
import type { MeetingNote, TeamMember } from '../types'
import type { MemberEvaluationHistory } from '../utils/growth'
import type { MemberInsight } from '../utils/memberInsights'
import ModalCloseButton from './ModalCloseButton'

type PrintOption = 'profile' | 'date' | 'performance' | 'insights' | 'questions' | 'evidence' | 'lastMeeting' | 'growth' | 'draft' | 'memo' | 'memoLines'

const OPTION_LABELS: Array<[PrintOption, string]> = [
  ['profile', '팀원 기본정보'], ['date', '면담일'], ['performance', '현재 성과 요약'], ['insights', '핵심 인사이트'], ['questions', '추천 면담 질문'], ['evidence', '인사이트 근거'],
  ['lastMeeting', '지난 면담 요약'], ['growth', '육성 포인트 작성란'], ['draft', '작성 중인 면담 내용 포함'], ['memo', '면담 내용 영역'], ['memoLines', '면담 내용 필기선'],
]

const DEFAULT_OPTIONS: Record<PrintOption, boolean> = { profile: true, date: true, performance: true, insights: true, questions: true, evidence: false, lastMeeting: true, growth: false, draft: false, memo: true, memoLines: true }

function escapeHtml(value: unknown) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') }

export default function MeetingPrintPreview({ member, history, insights, latestNote, draft, growthPoints, onClose }: { member: TeamMember; history: MemberEvaluationHistory[]; insights: MemberInsight[]; latestNote: MeetingNote | null; draft: string; growthPoints: { strength: string; improvement: string; challenge: string; careerGoal: string }; onClose: () => void }) {
  const [options, setOptions] = useState(DEFAULT_OPTIONS)
  const [extraPages, setExtraPages] = useState(0)
  const [printDate, setPrintDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [blankDate, setBlankDate] = useState(false)
  const previewAreaRef = useRef<HTMLElement>(null)
  const [previewScale, setPreviewScale] = useState(1)
  const latest = history[0]
  const previous = history[1]
  const toggle = (key: PrintOption) => setOptions((current) => ({ ...current, [key]: !current[key] }))
  const growthRows = [['강점', growthPoints.strength], ['보완 필요', growthPoints.improvement], ['다음 경험', growthPoints.challenge], ['Career Goal', growthPoints.careerGoal]]

  useEffect(() => {
    const element = previewAreaRef.current
    if (!element) return
    const update = () => {
      const style = window.getComputedStyle(element)
      const horizontalPadding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
      const verticalPadding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
      const width = Math.max(320, element.clientWidth - horizontalPadding)
      const height = Math.max(400, element.clientHeight - verticalPadding - (extraPages > 0 ? 48 : 0))
      setPreviewScale(Math.min(width / 680, height / 962))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [extraPages])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  function pageHeader(page: number, totalPages: number) {
    const header = options.profile || options.date ? `<header>${options.profile ? `<div><h1>${escapeHtml(member.name)}</h1><p>${escapeHtml(member.level || '직급 미설정')} · ${member.yearsOfService ?? '-'}년차</p></div>` : '<div></div>'}${options.date ? `<p>면담일 ${!blankDate && printDate ? escapeHtml(printDate.replace(/-/g, '. ')) : '__________________'}</p>` : ''}</header>` : ''
    return `${header}${totalPages > 1 ? `<span class="page-number">${page} / ${totalPages}</span>` : ''}`
  }

  function firstPageHtml(totalPages: number) {
    return `<div class="print-page">${pageHeader(1, totalPages)}
    ${options.performance ? `<section class="status-section"><div class="summary"><strong>${latest ? `${escapeHtml(latest.label)} · ${latest.score.toFixed(1)}점 · ${latest.grade}` : '성과 데이터 없음'}</strong>${latest && previous ? `<span>직전 대비 ${(latest.score - previous.score) >= 0 ? '+' : ''}${(latest.score - previous.score).toFixed(1)}점</span>` : ''}</div></section>` : ''}
    ${options.insights ? `<section class="insights-section">${insights.map((item, index) => `<div class="insight"><strong>${index + 1}. ${escapeHtml(item.title)}</strong>${options.questions ? `<p>질문 · ${escapeHtml(item.question)}</p>` : ''}${options.evidence ? `<div class="evidence">${item.evidence.map((evidence) => `<p><span>${escapeHtml(evidence.label)}</span> ${escapeHtml(evidence.value)}${evidence.detail ? ` · ${escapeHtml(evidence.detail)}` : ''}</p>`).join('')}</div>` : ''}</div>`).join('')}</section>` : options.questions ? `<section><h2>추천 면담 질문</h2>${insights.map((item) => `<p class="line">• ${escapeHtml(item.question)}</p>`).join('')}</section>` : ''}
    ${options.lastMeeting ? `<section><h2>지난 면담 요약</h2><p class="text">${latestNote ? escapeHtml(latestNote.comment) : '지난 면담 기록이 없습니다.'}</p></section>` : ''}
    ${options.growth ? `<section><h2 class="growth-title">육성 포인트 <span>강점 · 보완 필요 · 다음 경험 · Career Goal</span></h2><div class="growth-content">${growthRows.map(([label, value]) => `<div class="growth-item"><strong>${escapeHtml(label)}</strong>${value.trim() ? `<p>${escapeHtml(value)}</p>` : ''}<div class="growth-writing"></div></div>`).join('')}</div></section>` : ''}
    ${options.memo || (options.draft && draft.trim()) ? `<section class="memo-section"><h2>면담 내용</h2>${options.draft && draft.trim() ? `<p class="meeting-draft">${escapeHtml(draft)}</p>` : ''}${options.memo && options.memoLines ? '<div class="writing-lines"></div>' : options.memo ? '<div class="blank-writing-space"></div>' : ''}</section>` : ''}</div>`
  }

  function blankPageHtml(page: number, totalPages: number) {
    return `<div class="print-page blank-page">${pageHeader(page, totalPages)}${options.memo ? `<section class="memo-section"><h2>면담 내용</h2>${options.memoLines ? '<div class="writing-lines blank-lines"></div>' : '<div class="blank-writing-space blank-lines"></div>'}</section>` : ''}</div>`
  }

  function pagesHtml() {
    const totalPages = 1 + extraPages
    return firstPageHtml(totalPages) + Array.from({ length: extraPages }, (_, index) => blankPageHtml(index + 2, totalPages)).join('')
  }

  function print() {
    const frame = document.createElement('iframe')
    frame.style.cssText = 'position:fixed;width:1px;height:1px;right:0;bottom:0;opacity:0;pointer-events:none'
    document.body.appendChild(frame)
    const doc = frame.contentDocument
    if (!doc) { frame.remove(); return }
    doc.open()
    doc.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(member.name)} 면담 준비지</title><style>@page{size:A4;margin:14mm}*{box-sizing:border-box}body{margin:0;color:#111827;font:11px/1.55 Arial,"Apple SD Gothic Neo",sans-serif}.print-page{position:relative;min-height:269mm;page-break-after:always}.print-page:last-child{page-break-after:auto}header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111827;padding-bottom:18px}h1{margin:0 0 4px;font-size:28px;line-height:1.2}.page-number{position:absolute;right:0;bottom:0;color:#6b7280;font-size:10px}section{margin-top:18px}h2{margin:0 0 8px;border-bottom:1px solid #e5e7eb;padding-bottom:8px;font-size:13px}.status-section{padding-bottom:10px;border-bottom:1px solid #e5e7eb}.growth-title span{margin-left:8px;color:#9ca3af;font-size:10px;font-weight:400}.growth-content{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.growth-item{border:1px solid #e5e7eb;padding:7px}.growth-item p,.meeting-draft{margin:4px 0;white-space:pre-wrap}.growth-writing{height:30px;border-bottom:1px solid #d1d5db}.summary{display:flex;justify-content:space-between}.insight{padding:5px 0}.insight>p{margin:2px 0 0;color:#4b5563}.evidence{margin:4px 0 0;border-left:2px solid #fed7aa;padding-left:7px;color:#6b7280;font-size:10px}.evidence p{margin:1px 0}.evidence span{font-weight:700}.line,.text{margin:4px 0;white-space:pre-wrap}.memo-section{margin-top:18px}.writing-lines{height:180px;background:repeating-linear-gradient(to bottom,transparent 0,transparent 24px,#d1d5db 25px)}.blank-writing-space{height:180px}.blank-lines{height:205mm}</style></head><body>${pagesHtml()}</body></html>`)
    doc.close()
    window.setTimeout(() => { frame.contentWindow?.focus(); frame.contentWindow?.print(); window.setTimeout(() => frame.remove(), 1000) }, 80)
  }

  const previewHeight = (962 * (1 + extraPages) + 16 * extraPages) * previewScale
  return <div className="ui-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section role="dialog" aria-modal="true" aria-labelledby="meeting-print-title" className="grid h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-[1440px] grid-cols-[minmax(0,1fr)_minmax(320px,380px)] overflow-hidden rounded-lg border border-gray-300 bg-[#dce1e6] shadow-lg">
    <main ref={previewAreaRef} className={`min-h-0 overflow-x-hidden px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10 ${extraPages > 0 ? 'block overflow-y-auto' : 'flex items-center justify-center overflow-y-hidden'}`}><div className="mx-auto shrink-0" style={{ width: 680 * previewScale, height: previewHeight }}><div className="meeting-print-sheet space-y-4" style={{ width: 680, transform: `scale(${previewScale})`, transformOrigin: 'top left' }} dangerouslySetInnerHTML={{ __html: `<style>.meeting-print-sheet .print-page{position:relative;width:680px;height:962px;background:#fff;padding:48px;color:#111827;font-size:11px;line-height:20px;border-radius:4px;box-shadow:0 4px 16px rgb(0 0 0 / 8%)}.meeting-print-sheet header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111827;padding-bottom:18px}.meeting-print-sheet h1{margin:0 0 4px;font-size:28px;font-weight:800}.meeting-print-sheet .page-number{position:absolute;right:48px;bottom:24px;color:#6b7280;font-size:10px}.meeting-print-sheet section{margin-top:18px}.meeting-print-sheet h2{margin:0 0 8px;border-bottom:1px solid #e5e7eb;padding-bottom:8px;font-size:13px;font-weight:600}.meeting-print-sheet .status-section{padding-bottom:10px;border-bottom:1px solid #e5e7eb}.meeting-print-sheet .growth-title span{margin-left:8px;color:#9ca3af;font-size:10px;font-weight:400}.meeting-print-sheet .growth-content{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.meeting-print-sheet .growth-item{border:1px solid #e5e7eb;padding:7px}.meeting-print-sheet .growth-item p,.meeting-print-sheet .meeting-draft{margin:4px 0;white-space:pre-wrap}.meeting-print-sheet .growth-writing{height:30px;border-bottom:1px solid #d1d5db}.meeting-print-sheet .summary{display:flex;justify-content:space-between}.meeting-print-sheet .insight{padding:5px 0}.meeting-print-sheet .insight>p{margin:2px 0 0;color:#929292;font-size:12px}.meeting-print-sheet .evidence{margin:4px 0 0;border-left:2px solid #fed7aa;padding-left:7px;color:#6b7280;font-size:10px}.meeting-print-sheet .evidence p{margin:1px 0}.meeting-print-sheet .evidence span{font-weight:700}.meeting-print-sheet .line,.meeting-print-sheet .text{margin:4px 0;white-space:pre-wrap}.meeting-print-sheet .memo-section{margin-top:18px}.meeting-print-sheet .writing-lines{height:260px;background:repeating-linear-gradient(to bottom,transparent 0,transparent 28px,#eaeaea 29px)}.meeting-print-sheet .blank-writing-space{height:260px}.meeting-print-sheet .blank-lines{height:calc(100% - 95px)}</style>${pagesHtml()}` }} /></div></main>
    <aside className="flex min-h-0 flex-col px-6 pt-5 lg:px-10"><div className="flex h-[60px] shrink-0 items-center gap-2"><h2 id="meeting-print-title" className="text-[18px] font-bold text-gray-950">면담용지 출력하기</h2><p className="text-[13px] text-gray-500">출력할 항목만 선택</p><div className="ml-auto"><ModalCloseButton onClick={onClose} label="면담용지 출력 닫기" /></div></div><div className="min-h-0 flex-1 overflow-y-auto"><p className="text-[13px] font-bold text-gray-600">면담일</p><input type="date" value={printDate} onChange={(event) => { setPrintDate(event.target.value); setBlankDate(false) }} disabled={blankDate} className="ui-field mt-2 bg-white" /><label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-gray-900"><input type="checkbox" checked={blankDate} onChange={(event) => setBlankDate(event.target.checked)} className="h-[18px] w-[18px] accent-[#d4772c]" />빈 날짜로 출력</label><div className="my-5 h-px bg-gray-200" /><p className="text-[13px] font-bold text-gray-600">출력 항목</p><div className="mt-3 space-y-2">{OPTION_LABELS.map(([key, label]) => <label key={key} className="flex cursor-pointer items-center gap-2.5 text-sm text-gray-900"><input type="checkbox" checked={options[key]} onChange={() => toggle(key)} className="h-[18px] w-[18px] rounded accent-[#d4772c]" />{label}</label>)}</div><div className="my-5 h-px bg-gray-200" /><p className="text-[13px] font-bold text-gray-600">빈 면담 페이지</p><p className="mt-1 text-xs text-gray-400">메모 공간이 더 필요하면 추가하세요.</p><div className="mt-2 grid h-11 grid-cols-[44px_1fr_44px] overflow-hidden rounded-lg border border-gray-200 bg-white"><button type="button" onClick={() => setExtraPages((count) => Math.max(0, count - 1))} disabled={extraPages === 0} className="text-lg text-gray-600 disabled:text-gray-300">−</button><strong className="flex items-center justify-center border-x border-gray-200 text-sm tabular-nums text-gray-900">{extraPages}장 추가</strong><button type="button" onClick={() => setExtraPages((count) => Math.min(2, count + 1))} disabled={extraPages === 2} className="text-lg text-gray-600 disabled:text-gray-300">+</button></div></div><div className="flex shrink-0 gap-3 py-6"><button type="button" onClick={onClose} className="ui-button ui-button-secondary h-[53px] w-[77px]">취소</button><button type="button" onClick={print} className="ui-button ui-button-primary h-[53px] min-w-0 flex-1">인쇄</button></div></aside>
  </section></div>
}
