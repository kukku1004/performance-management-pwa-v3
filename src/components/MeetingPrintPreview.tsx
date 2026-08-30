import { useState } from 'react'
import type { MeetingNote, TeamMember } from '../types'
import type { MemberEvaluationHistory } from '../utils/growth'
import type { MemberInsight } from '../utils/memberInsights'
import ModalCloseButton from './ModalCloseButton'

type PrintOption = 'profile' | 'performance' | 'insights' | 'questions' | 'lastMeeting' | 'growth' | 'draft' | 'memo' | 'followUp'

const OPTION_LABELS: Array<[PrintOption, string]> = [
  ['profile', '팀원 기본정보'], ['performance', '현재 성과 요약'], ['insights', '핵심 인사이트'], ['questions', '추천 면담 질문'],
  ['lastMeeting', '지난 면담 요약'], ['growth', '육성 포인트'], ['draft', '작성 중인 면담 내용'], ['memo', '빈 메모 공간'], ['followUp', '후속 확인사항 작성란'],
]

const DEFAULT_OPTIONS: Record<PrintOption, boolean> = { profile: true, performance: true, insights: true, questions: true, lastMeeting: true, growth: false, draft: false, memo: true, followUp: true }

function escapeHtml(value: unknown) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') }

export default function MeetingPrintPreview({ member, history, insights, latestNote, draft, growthPoints, onClose }: { member: TeamMember; history: MemberEvaluationHistory[]; insights: MemberInsight[]; latestNote: MeetingNote | null; draft: string; growthPoints: { strength: string; improvement: string; challenge: string; careerGoal: string }; onClose: () => void }) {
  const [options, setOptions] = useState(DEFAULT_OPTIONS)
  const latest = history[0]
  const previous = history[1]
  const toggle = (key: PrintOption) => setOptions((current) => ({ ...current, [key]: !current[key] }))
  const growthRows = [['강점', growthPoints.strength], ['보완 필요', growthPoints.improvement], ['다음 도전 경험', growthPoints.challenge], ['Career Goal', growthPoints.careerGoal]].filter(([, value]) => value.trim())

  function bodyHtml() {
    return `${options.profile ? `<header><div><p class="eyebrow">1:1 면담 준비지</p><h1>${escapeHtml(member.name)}</h1><p>${escapeHtml(member.level || '직급 미설정')} · ${member.yearsOfService ?? '-'}년차</p></div><p>면담일 __________________</p></header>` : ''}
    ${options.performance ? `<section><h2>현재 상황</h2><div class="summary"><strong>${latest ? `${escapeHtml(latest.label)} · ${latest.score.toFixed(1)}점 · ${latest.grade}` : '성과 데이터 없음'}</strong>${latest && previous ? `<span>직전 대비 ${(latest.score - previous.score) >= 0 ? '+' : ''}${(latest.score - previous.score).toFixed(1)}점</span>` : ''}</div></section>` : ''}
    ${options.insights ? `<section><h2>핵심 인사이트</h2>${insights.map((item, index) => `<div class="insight"><strong>${index + 1}. ${escapeHtml(item.title)}</strong>${options.questions ? `<p>질문 · ${escapeHtml(item.question)}</p>` : ''}</div>`).join('')}</section>` : options.questions ? `<section><h2>추천 면담 질문</h2>${insights.map((item) => `<p class="line">• ${escapeHtml(item.question)}</p>`).join('')}</section>` : ''}
    ${options.lastMeeting ? `<section><h2>지난 면담 요약</h2><p class="text">${latestNote ? escapeHtml(latestNote.comment) : '지난 면담 기록이 없습니다.'}</p></section>` : ''}
    ${options.growth ? `<section><h2>육성 포인트</h2>${growthRows.length ? growthRows.map(([label, value]) => `<div class="row"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`).join('') : '<p class="muted">작성된 육성 포인트가 없습니다.</p>'}</section>` : ''}
    ${options.draft ? `<section><h2>작성 중인 면담 내용</h2><p class="text">${draft.trim() ? escapeHtml(draft) : '작성 중인 내용이 없습니다.'}</p></section>` : ''}
    ${options.memo ? '<section><h2>면담 메모</h2><div class="writing-lines"></div></section>' : ''}
    ${options.followUp ? '<section><h2>후속 확인사항</h2><div class="follow">내용 ____________________________________ 확인일 ______________</div><div class="follow">내용 ____________________________________ 확인일 ______________</div></section>' : ''}`
  }

  function print() {
    const frame = document.createElement('iframe')
    frame.style.cssText = 'position:fixed;width:1px;height:1px;right:0;bottom:0;opacity:0;pointer-events:none'
    document.body.appendChild(frame)
    const doc = frame.contentDocument
    if (!doc) { frame.remove(); return }
    doc.open()
    doc.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(member.name)} 면담 준비지</title><style>@page{size:A4;margin:14mm}*{box-sizing:border-box}body{margin:0;color:#111827;font:11px/1.55 Arial,"Apple SD Gothic Neo",sans-serif}header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111827;padding-bottom:10px}h1{margin:2px 0;font-size:22px}.eyebrow{font-size:10px;font-weight:700;color:#ea580c}section{margin-top:14px}h2{margin:0 0 7px;border-bottom:1px solid #d1d5db;padding-bottom:4px;font-size:12px}.summary{display:flex;justify-content:space-between}.insight{padding:5px 0}.insight p{margin:2px 0 0;color:#4b5563}.line,.text,.muted{margin:4px 0;white-space:pre-wrap}.muted{color:#9ca3af}.row{display:grid;grid-template-columns:110px 1fr;border-bottom:1px solid #e5e7eb;padding:5px}.writing-lines{height:92px;background:repeating-linear-gradient(to bottom,transparent 0,transparent 22px,#e5e7eb 23px)}.follow{border-bottom:1px solid #d1d5db;padding:7px 0}</style></head><body>${bodyHtml()}</body></html>`)
    doc.close()
    window.setTimeout(() => { frame.contentWindow?.focus(); frame.contentWindow?.print(); window.setTimeout(() => frame.remove(), 1000) }, 80)
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4"><section role="dialog" aria-modal="true" aria-labelledby="meeting-print-title" className="flex max-h-[calc(100vh-32px)] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
    <header className="flex items-center justify-between border-b border-gray-200 px-5 py-4"><div><h2 id="meeting-print-title" className="text-lg font-semibold text-gray-950">면담용지 미리보기</h2><p className="mt-1 text-sm text-gray-500">출력할 항목만 선택하세요.</p></div><ModalCloseButton onClick={onClose} label="면담용지 미리보기 닫기" /></header>
    <div className="grid min-h-0 flex-1 lg:grid-cols-[240px_minmax(0,1fr)]"><aside className="overflow-y-auto border-r border-gray-200 bg-gray-50 p-4"><p className="text-xs font-semibold text-gray-500">출력 항목</p><div className="mt-3 space-y-1">{OPTION_LABELS.map(([key, label]) => <label key={key} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-gray-700 hover:bg-white"><input type="checkbox" checked={options[key]} onChange={() => toggle(key)} className="h-4 w-4 accent-orange-600" />{label}</label>)}</div></aside>
      <main className="overflow-auto bg-gray-200 p-5"><article className="meeting-print-sheet mx-auto min-h-[880px] w-full max-w-[680px] bg-white px-10 py-9 text-[11px] leading-5 text-gray-900 shadow-sm" dangerouslySetInnerHTML={{ __html: `<style>.meeting-print-sheet header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111827;padding-bottom:10px}.meeting-print-sheet h1{margin:2px 0;font-size:22px;font-weight:700}.meeting-print-sheet .eyebrow{font-size:10px;font-weight:700;color:#ea580c}.meeting-print-sheet section{margin-top:14px}.meeting-print-sheet h2{margin:0 0 7px;border-bottom:1px solid #d1d5db;padding-bottom:4px;font-size:12px;font-weight:700}.meeting-print-sheet .summary{display:flex;justify-content:space-between}.meeting-print-sheet .insight{padding:5px 0}.meeting-print-sheet .insight p{margin:2px 0 0;color:#4b5563}.meeting-print-sheet .line,.meeting-print-sheet .text,.meeting-print-sheet .muted{margin:4px 0;white-space:pre-wrap}.meeting-print-sheet .muted{color:#9ca3af}.meeting-print-sheet .row{display:grid;grid-template-columns:110px 1fr;border-bottom:1px solid #e5e7eb;padding:5px}.meeting-print-sheet .writing-lines{height:92px;background:repeating-linear-gradient(to bottom,transparent 0,transparent 22px,#e5e7eb 23px)}.meeting-print-sheet .follow{border-bottom:1px solid #d1d5db;padding:7px 0}</style>${bodyHtml()}` }} /></main></div>
    <footer className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4"><button type="button" onClick={onClose} className="ui-button ui-button-secondary">취소</button><button type="button" onClick={print} className="ui-button ui-button-primary">인쇄하기</button></footer>
  </section></div>
}
