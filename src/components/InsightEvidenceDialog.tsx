import type { MemberInsight } from '../utils/memberInsights'
import ModalCloseButton from './ModalCloseButton'

export default function InsightEvidenceDialog({ insight, onClose }: { insight: MemberInsight | null; onClose: () => void }) {
  if (!insight) return null
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4"><section role="dialog" aria-modal="true" aria-labelledby="insight-evidence-title" className="flex max-h-[min(680px,calc(100vh-32px))] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
    <header className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4"><div><p className="text-xs font-semibold text-accent">인사이트 상세</p><h2 id="insight-evidence-title" className="mt-1 text-lg font-semibold text-gray-950">{insight.title}</h2></div><ModalCloseButton onClick={onClose} label="인사이트 상세 닫기" /></header>
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4"><h3 className="text-xs font-semibold text-gray-500">확인된 근거</h3><div className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200">{insight.evidence.map((item, index) => <div key={`${item.label}-${index}`} className="grid gap-1 px-4 py-3 sm:grid-cols-[120px_minmax(0,1fr)]"><strong className="text-xs text-gray-500">{item.label}</strong><div><p className="text-sm font-medium text-gray-900">{item.value}</p>{item.detail && <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-gray-600">{item.detail}</p>}</div></div>)}</div><section className="mt-5 rounded-md bg-orange-50 px-4 py-3"><h3 className="text-xs font-semibold text-orange-700">면담에서 물어볼 것</h3><p className="mt-1 text-sm font-medium leading-6 text-gray-900">{insight.question}</p></section></div>
  </section></div>
}
