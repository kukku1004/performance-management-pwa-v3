import { useRef, useState, type DragEventHandler, type MouseEventHandler } from 'react'

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
  const [isDragging, setIsDragging] = useState(false)
  const dragDepthRef = useRef(0)

  const handleDrop: DragEventHandler<HTMLButtonElement> = (event) => {
    event.preventDefault()
    dragDepthRef.current = 0
    setIsDragging(false)
    if (!disabled) onDrop(event)
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onDragEnter={(event) => {
        event.preventDefault()
        if (disabled) return
        dragDepthRef.current += 1
        setIsDragging(true)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(event) => {
        event.preventDefault()
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
        if (dragDepthRef.current === 0) setIsDragging(false)
      }}
      onDrop={handleDrop}
      aria-label={isDragging ? '파일을 놓아 업로드' : title}
      className={`flex min-h-32 w-full flex-col items-center justify-center rounded-lg border border-dashed px-6 py-5 text-center transition-colors focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-100 disabled:cursor-not-allowed disabled:opacity-50 ${isDragging ? 'border-accent bg-orange-50 ring-2 ring-orange-100' : 'border-gray-300 bg-white hover:border-gray-400 hover:bg-gray-50/50'} ${className}`}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-6 w-6 fill-none transition-colors ${isDragging ? 'stroke-accent' : 'stroke-gray-400'}`} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6.75 3.75h6.1L17.25 8v12.25H6.75z" />
        <path d="M12.75 3.75V8h4.5" />
      </svg>
      <span className={`mt-3 text-sm font-medium ${isDragging ? 'text-accent' : 'text-gray-700'}`}>{isDragging ? '여기에 놓아 업로드' : title}</span>
      <span className={`mt-1 text-xs ${isDragging ? 'text-orange-600' : 'text-gray-400'}`}>{isDragging ? '놓으면 바로 파일을 확인합니다.' : description}</span>
    </button>
  )
}
