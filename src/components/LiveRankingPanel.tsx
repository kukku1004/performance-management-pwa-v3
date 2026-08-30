import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MemberResultRow } from '../utils/calculations'
import Badge from './Badge'

const PANEL_WIDTH = 232

function DragHandleIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-current"><circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" /><circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" /><circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" /></svg>
}

function CloseIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
}

export default function LiveRankingPanel({ results, open, onClose }: { results: MemberResultRow[]; open: boolean; onClose: () => void }) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; startTop: number; startLeft: number } | null>(null)

  useEffect(() => {
    if (!open) return
    setPosition((current) => current ?? { top: 96, left: Math.max(16, window.innerWidth - PANEL_WIDTH - 24) })
  }, [open])

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!position) return
    dragRef.current = { startX: event.clientX, startY: event.clientY, startTop: position.top, startLeft: position.left }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag) return
    setPosition({
      top: Math.max(0, drag.startTop + event.clientY - drag.startY),
      left: Math.min(Math.max(0, drag.startLeft + event.clientX - drag.startX), window.innerWidth - PANEL_WIDTH),
    })
  }

  function endDrag() { dragRef.current = null }

  if (!open || !position) return null
  return createPortal(
    <section aria-label="실시간 순위" style={{ position: 'fixed', top: position.top, left: position.left, width: PANEL_WIDTH }} className="z-40 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
      <div onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} style={{ touchAction: 'none' }} className="flex cursor-grab items-center gap-1.5 border-b border-gray-100 bg-gray-50 px-2.5 py-2 active:cursor-grabbing">
        <span className="shrink-0 text-gray-300"><DragHandleIcon /></span>
        <h3 className="flex-1 text-xs font-semibold text-gray-600">실시간 순위</h3>
        <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={onClose} title="닫기" aria-label="실시간 순위 닫기" className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-200 hover:text-gray-950"><CloseIcon /></button>
      </div>
      {results.length === 0 ? <p className="px-3 py-4 text-center text-xs text-gray-400">활성 팀원이 없습니다.</p> : <div className="max-h-80 overflow-y-auto">
        <div className="grid grid-cols-[1fr_40px_48px] gap-1 px-2.5 pt-2 text-[11px] font-semibold text-gray-400"><span>팀원</span><span className="text-center">순위</span><span className="text-center">등급</span></div>
        <div className="divide-y divide-gray-100 px-2.5 pb-2">{results.map((result, index) => <div key={result.member.id} className="grid grid-cols-[1fr_40px_48px] items-center gap-1 py-1.5"><span className="truncate text-sm font-medium text-gray-950">{result.member.name}</span><span className="text-center text-sm tabular-nums text-gray-500">{index + 1}위</span><span className="flex justify-center"><Badge tone={`grade-${result.grade.toLowerCase()}` as 'grade-s' | 'grade-a' | 'grade-b' | 'grade-c' | 'grade-d'}>{result.grade}</Badge></span></div>)}</div>
      </div>}
    </section>,
    document.body,
  )
}
