import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MemberInsightEvidence } from '../utils/memberInsights'

export default function InsightEvidenceButton({ evidence, label }: { evidence: MemberInsightEvidence[]; label: string }) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      const target = event.target as Node
      if (!buttonRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  const rect = open ? buttonRef.current?.getBoundingClientRect() : null
  return <><button ref={buttonRef} type="button" onClick={() => setOpen((value) => !value)} title="근거 확인" aria-label={`${label} 근거 확인`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-accent hover:bg-gray-100">
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8"><path d="M5 3h14v18H5zM8 8h8M8 12h8M8 16h5" /></svg>
  </button>{open && rect && createPortal(<div ref={panelRef} style={{ position: 'fixed', top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 320) }} className="z-[60] max-h-72 w-80 overflow-y-auto rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
    <div className="divide-y divide-gray-100">{evidence.map((item, index) => <div key={`${item.label}-${index}`} className="py-2 first:pt-0 last:pb-0"><div className="flex items-baseline justify-between gap-3"><span className="text-[11px] font-medium text-gray-500">{item.label}</span><strong className="text-right text-xs font-semibold text-gray-900">{item.value}</strong></div>{item.detail && <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-gray-600">{item.detail}</p>}</div>)}</div>
  </div>, document.body)}</>
}
