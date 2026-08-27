import type { ComponentProps } from 'react'

export const COLLAPSED_PANEL_WIDTH = 60
export const PANEL_SPLITTER_WIDTH = 9

export function PanelToggleIcon({
  collapsed,
  edge = 'left',
  className = 'h-4 w-4',
}: {
  collapsed: boolean
  edge?: 'left' | 'right'
  className?: string
}) {
  if (collapsed) {
    const path = edge === 'left' ? 'm9 5 7 7-7 7' : 'm15 5-7 7 7 7'
    return <svg aria-hidden="true" viewBox="0 0 24 24" className={`${className} fill-none stroke-current`} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>
  }

  return <svg aria-hidden="true" viewBox="0 0 24 24" className={`${className} fill-none stroke-current`} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3.5" y="4" width="17" height="16" rx="3" />
    <path d={edge === 'left' ? 'M9 4v16' : 'M15 4v16'} />
  </svg>
}

export function PanelSplitter({ className = '', ...props }: ComponentProps<'button'>) {
  return <button
    type="button"
    {...props}
    className={`ui-panel-splitter ${className}`}
  ><span aria-hidden="true" /></button>
}
