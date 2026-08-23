import type { DragEventHandler, MouseEventHandler } from 'react'

interface FileDropZoneProps {
  title?: string
  description: string
  onClick?: MouseEventHandler<HTMLButtonElement>
  onDrop: DragEventHandler<HTMLButtonElement>
  disabled?: boolean
  className?: string
}

export default function FileDropZone({
  title = '파일을 여기에 드래그',
  description,
  onClick,
  onDrop,
  disabled = false,
  className = '',
}: FileDropZoneProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={onDrop}
      className={`flex min-h-32 w-full flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white px-6 py-5 text-center transition-colors hover:border-gray-400 hover:bg-gray-50/50 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-100 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 fill-none stroke-gray-400" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6.75 3.75h6.1L17.25 8v12.25H6.75z" />
        <path d="M12.75 3.75V8h4.5" />
      </svg>
      <span className="mt-3 text-sm font-medium text-gray-700">{title}</span>
      <span className="mt-1 text-xs text-gray-400">{description}</span>
    </button>
  )
}
