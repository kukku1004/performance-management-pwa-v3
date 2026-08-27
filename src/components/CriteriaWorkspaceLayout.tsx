import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import CriteriaRail from './CriteriaRail'
import { COLLAPSED_PANEL_WIDTH, PANEL_SPLITTER_WIDTH, PanelSplitter } from './PanelControls'

const ICON_WIDTH = COLLAPSED_PANEL_WIDTH
const FULL_WIDTH = 320
const MAX_WIDTH = 480
const COLLAPSE_THRESHOLD = (ICON_WIDTH + FULL_WIDTH) / 2

type CriteriaPanelSize = 'icon' | 'full'
const CriteriaPanelContext = createContext<{ size: CriteriaPanelSize; setSize: (size: CriteriaPanelSize) => void } | null>(null)

export function CriteriaWorkspaceProvider({ children }: { children: ReactNode }) {
  const [size, setSize] = useState<CriteriaPanelSize>('icon')
  return <CriteriaPanelContext.Provider value={{ size, setSize }}>{children}</CriteriaPanelContext.Provider>
}

export default function CriteriaWorkspaceLayout({ children }: { children: ReactNode }) {
  const shared = useContext(CriteriaPanelContext)
  if (!shared) throw new Error('CriteriaWorkspaceLayout must be used within CriteriaWorkspaceProvider')
  const { size, setSize } = shared
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const width = dragWidth ?? (size === 'icon' ? ICON_WIDTH : FULL_WIDTH)

  function startResize(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    resizeRef.current = { startX: event.clientX, startWidth: width }
    setDragWidth(width)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveResize(event: React.PointerEvent<HTMLButtonElement>) {
    if (!resizeRef.current) return
    const nextWidth = Math.max(ICON_WIDTH, Math.min(MAX_WIDTH, resizeRef.current.startWidth + event.clientX - resizeRef.current.startX))
    setDragWidth(nextWidth)
    setSize(nextWidth < COLLAPSE_THRESHOLD ? 'icon' : 'full')
  }

  function endResize() {
    resizeRef.current = null
    setDragWidth(null)
  }

  return <div className="-my-8 grid min-h-[calc(100vh-4rem)] overflow-hidden bg-white" style={{ gridTemplateColumns: `${width}px ${PANEL_SPLITTER_WIDTH}px minmax(0,1fr)` }}>
    <CriteriaRail collapsed={size === 'icon'} onExpand={() => setSize('full')} onCollapse={() => setSize('icon')} />
    <PanelSplitter aria-label="평가기준 영역 너비 조절" onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize} />
    <div className="min-w-0 bg-white py-8 pl-5">{children}</div>
  </div>
}
