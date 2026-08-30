import { useState } from 'react'
import type { MeetingNote, TeamMember } from '../types'
import type { MemberEvaluationHistory } from '../utils/growth'
import type { MemberInsight } from '../utils/memberInsights'
import ModalCloseButton from './ModalCloseButton'

type PrintOption = 'profile' | 'date' | 'performance' | 'insights' | 'questions' | 'evidence' | 'lastMeeting' | 'growth' | 'draft' | 'memo'

const OPTION_LABELS: Array<[PrintOption, string]> = [
  ['profile', '팀원 기본정보'], ['date', '선택한 면담일 표시'], ['performance', '현재 성과 요약'], ['insights', '핵심 인사이트'], ['questions', '추천 면담 질문'], ['evidence', '인사이트 근거'],
  ['lastMeeting', '지난 면담 요약'], ['growth', '육성 포인트 작성란'], ['draft', '작성 중인 면담 내용 포함'], ['memo', '면담 내용 입력란'],
]

const DEFAULT_OPTIONS: Record<PrintOption, boolean> = { profile: true, date: true, performance: true, insights: true, questions: true, evidence: false, lastMeeting: true, growth: false, draft: false, memo: true }

function escapeHtml(value: unknown) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') }

export default function MeetingPrintPreview({ member, meetingDate, history, insights, latestNote, draft, growthPoints, onClose }: { member: TeamMember; meetingDate: string; history: MemberEvaluationHistory[]; insights: MemberInsight[]; latestNote: MeetingNote | null; draft: string; growthPoints: { strength: string; improvement: string; challenge: string; careerGoal: string }; onClose: () => void }) {
  const [options, setOptions] = useState(DEFAULT_OPTIONS)
  const [extraPages, setExtraPages] = useState(0)
  const latest = history[0]
  const previous = history[1]
  const toggle = (key: PrintOption) => setOptions((current) => ({ ...current, [key]: !current[key] }))
  const growthRows = [['강점', growthPoints.strength], ['보완 필요', growthPoints.improvement], ['다음 경험', growthPoints.challenge], ['Career Goal', growthPoints.careerGoal]]

  function pageHeader(page: number, totalPages: number) {
    return `<header><div><p class="eyebrow">1:1 면담 준비지</p><h1>${escapeHtml(member.name)}</h1><p>${escapeHtml(member.level || '직급 미설정')} · ${member.yearsOfService ?? '-'}년차</p></div><p>면담일 ${options.date && meetingDate ? escapeHtml(meetingDate.replace(/-/g, '. ')) : '__________________'}</p></header>${totalPages > 1 ? `<span class="page-number">${page} / ${totalPages}</span>` : ''}`
  }

  function firstPageHtml(totalPages: number) {
    return `<div class="print-page">${options.profile ? pageHeader(1, totalPages) : totalPages > 1 ? `<span class="page-number">1 / ${totalPages}</span>` : ''}
    ${options.performance ? `<section><h2>현재 상황</h2><div class="summary"><strong>${latest ? `${escapeHtml(latest.label)} · ${latest.score.toFixed(1)}점 · ${latest.grade}` : '성과 데이터 없음'}</strong>${latest && previous ? `<span>직전 대비 ${(latest.score - previous.score) >= 0 ? '+' : ''}${(latest.score - previous.score).toFixed(1)}점</span>` : ''}</div></section>` : ''}
    ${options.insights ? `<section><h2>핵심 인사이트</h2>${insights.map((item, index) => `<div class="insight"><strong>${index + 1}. ${escapeHtml(item.title)}</strong>${options.questions ? `<p>질문 · ${escapeHtml(item.question)}</p>` : ''}${options.evidence ? `<div class="evidence">${item.evidence.map((evidence) => `<p><span>${escapeHtml(evidence.label)}</span> ${escapeHtml(evidence.value)}${evidence.detail ? ` · ${escapeHtml(evidence.detail)}` : ''}</p>`).join('')}</div>` : ''}</div>`).join('')}</section>` : options.questions ? `<section><h2>추천 면담 질문</h2>${insights.map((item) => `<p class="line">• ${escapeHtml(item.question)}</p>`).join('')}</section>` : ''}
    ${options.lastMeeting ? `<section><h2>지난 면담 요약</h2><p class="text">${latestNote ? escapeHtml(latestNote.comment) : '지난 면담 기록이 없습니다.'}</p></section>` : ''}
    ${options.growth ? `<section><h2 class="growth-title">육성 포인트 <span>강점 · 보완 필요 · 다음 경험 · Career Goal</span></h2><div class="growth-content">${growthRows.map(([label, value]) => `<div class="growth-item"><strong>${escapeHtml(label)}</strong>${value.trim() ? `<p>${escapeHtml(value)}</p>` : ''}<div class="growth-writing"></div></div>`).join('')}</div></section>` : ''}
    ${options.memo || (options.draft && draft.trim()) ? `<section class="memo-section"><h2>면담 내용</h2>${options.draft && draft.trim() ? `<p class="meeting-draft">${escapeHtml(draft)}</p>` : ''}${options.memo ? '<div class="writing-lines"></div>' : ''}</section>` : ''}</div>`
  }

  function blankPageHtml(page: number, totalPages: number) {
    return `<div class="print-page blank-page">${pageHeader(page, totalPages)}<section class="memo-section"><h2>면담 내용</h2><div class="writing-lines blank-lines"></div></section></div>`
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
    doc.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(member.name)} 면담 준비지</title><style>@page{size:A4;margin:14mm}*{box-sizing:border-box}body{margin:0;color:#111827;font:11px/1.55 Arial,"Apple SD Gothic Neo",sans-serif}.print-page{position:relative;min-height:269mm;page-break-after:always}.print-page:last-child{page-break-after:auto}header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111827;padding-bottom:10px}h1{margin:2px 0;font-size:22px}.eyebrow{font-size:10px;font-weight:700;color:#ea580c}.page-number{position:absolute;right:0;bottom:0;color:#6b7280;font-size:10px}section{margin-top:14px}h2{margin:0 0 7px;border-bottom:1px solid #d1d5db;padding-bottom:4px;font-size:12px}.growth-title span{margin-left:8px;color:#9ca3af;font-size:10px;font-weight:400}.growth-content{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.growth-item{border:1px solid #e5e7eb;padding:7px}.growth-item p,.meeting-draft{margin:4px 0;white-space:pre-wrap}.growth-writing{height:30px;border-bottom:1px solid #d1d5db}.summary{display:flex;justify-content:space-between}.insight{padding:5px 0}.insight>p{margin:2px 0 0;color:#4b5563}.evidence{margin:4px 0 0;border-left:2px solid #fed7aa;padding-left:7px;color:#6b7280;font-size:10px}.evidence p{margin:1px 0}.evidence span{font-weight:700}.line,.text{margin:4px 0;white-space:pre-wrap}.memo-section{margin-top:18px}.writing-lines{height:180px;background:repeating-linear-gradient(to bottom,transparent 0,transparent 24px,#d1d5db 25px)}.blank-lines{height:205mm}</style></head><body>${pagesHtml()}</body></html>`)
    doc.close()
    window.setTimeout(() => { frame.contentWindow?.focus(); frame.contentWindow?.print(); window.setTimeout(() => frame.remove(), 1000) }, 80)
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4"><section role="dialog" aria-modal="true" aria-labelledby="meeting-print-title" className="flex max-h-[calc(100vh-32px)] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
    <header className="flex items-center justify-between border-b border-gray-200 px-5 py-4"><div><h2 id="meeting-print-title" className="text-lg font-semibold text-gray-950">면담용지 미리보기</h2><p className="mt-1 text-sm text-gray-500">출력할 항목만 선택하세요.</p></div><ModalCloseButton onClick={onClose} label="면담용지 미리보기 닫기" /></header>
    <div className="grid min-h-0 flex-1 lg:grid-cols-[240px_minmax(0,1fr)]"><aside className="overflow-y-auto border-r border-gray-200 bg-gray-50 p-4"><p className="text-xs font-semibold text-gray-500">출력 항목</p><div className="mt-3 space-y-1">{OPTION_LABELS.map(([key, label]) => <label key={key} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-gray-700 hover:bg-white"><input type="checkbox" checked={options[key]} onChange={() => toggle(key)} className="h-4 w-4 accent-orange-600" />{label}</label>)}</div><div className="mt-5 border-t border-gray-200 pt-4"><p className="text-xs font-semibold text-gray-500">빈 면담 페이지</p><p className="mt-1 text-xs leading-5 text-gray-400">메모 공간이 더 필요하면 추가하세요.</p><div className="mt-3 flex items-center justify-between rounded-md border border-gray-200 bg-white p-2"><button type="button" onClick={() => setExtraPages((count) => Math.max(0, count - 1))} disabled={extraPages === 0} className="ui-button ui-button-ghost ui-button-sm h-8 w-8 px-0">−</button><strong className="text-sm tabular-nums text-gray-900">{extraPages}장 추가</strong><button type="button" onClick={() => setExtraPages((count) => Math.min(2, count + 1))} disabled={extraPages === 2} className="ui-button ui-button-ghost ui-button-sm h-8 w-8 px-0">+</button></div></div></aside>
      <main className="overflow-auto bg-gray-200 p-5"><div className="meeting-print-sheet space-y-5" dangerouslySetInnerHTML={{ __html: `<style>.meeting-print-sheet .print-page{position:relative;min-height:880px;width:100%;max-width:680px;margin:0 auto;background:#fff;padding:36px 40px;color:#111827;font-size:11px;line-height:20px;box-shadow:0 1px 3px rgb(0 0 0 / 10%)}.meeting-print-sheet header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111827;padding-bottom:10px}.meeting-print-sheet h1{margin:2px 0;font-size:22px;font-weight:700}.meeting-print-sheet .eyebrow{font-size:10px;font-weight:700;color:#ea580c}.meeting-print-sheet .page-number{position:absolute;right:40px;bottom:24px;color:#6b7280;font-size:10px}.meeting-print-sheet section{margin-top:14px}.meeting-print-sheet h2{margin:0 0 7px;border-bottom:1px solid #d1d5db;padding-bottom:4px;font-size:12px;font-weight:700}.meeting-print-sheet .growth-title span{margin-left:8px;color:#9ca3af;font-size:10px;font-weight:400}.meeting-print-sheet .growth-content{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.meeting-print-sheet .growth-item{border:1px solid #e5e7eb;padding:7px}.meeting-print-sheet .growth-item p,.meeting-print-sheet .meeting-draft{margin:4px 0;white-space:pre-wrap}.meeting-print-sheet .growth-writing{height:30px;border-bottom:1px solid #d1d5db}.meeting-print-sheet .summary{display:flex;justify-content:space-between}.meeting-print-sheet .insight{padding:5px 0}.meeting-print-sheet .insight>p{margin:2px 0 0;color:#4b5563}.meeting-print-sheet .evidence{margin:4px 0 0;border-left:2px solid #fed7aa;padding-left:7px;color:#6b7280;font-size:10px}.meeting-print-sheet .evidence p{margin:1px 0}.meeting-print-sheet .evidence span{font-weight:700}.meeting-print-sheet .line,.meeting-print-sheet .text{margin:4px 0;white-space:pre-wrap}.meeting-print-sheet .memo-section{margin-top:18px}.meeting-print-sheet .writing-lines{height:220px;background:repeating-linear-gradient(to bottom,transparent 0,transparent 24px,#d1d5db 25px)}.meeting-print-sheet .blank-lines{height:690px}</style>${pagesHtml()}` }} /></main></div>
    <footer className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4"><button type="button" onClick={onClose} className="ui-button ui-button-secondary">취소</button><button type="button" onClick={print} className="ui-button ui-button-primary">인쇄하기</button></footer>
  </section></div>
}
