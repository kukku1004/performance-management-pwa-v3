import { useState } from 'react'
import DisclosureIcon from './DisclosureIcon'

export default function PerformanceCommentSelector({ comments, selected, onToggle }: {
  comments: string[]
  selected: number[]
  onToggle: (index: number) => void
}) {
  const [expanded, setExpanded] = useState<number[]>([])

  return <div className="space-y-2">{comments.map((comment, index) => {
    const open = expanded.includes(index)
    return <div key={`${index}-${comment}`} className="rounded-md border border-gray-200 bg-white p-3 hover:border-orange-300">
      <div className="flex items-center gap-3">
        <input type="checkbox" checked={selected.includes(index)} onChange={() => onToggle(index)} aria-label={`코멘트 ${index + 1} 선택`} className="h-4 w-4 shrink-0 accent-[#c05621]" />
        <button type="button" onClick={() => setExpanded((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index])} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open}>
          <span className="shrink-0 text-xs font-semibold text-gray-500">코멘트 {index + 1}</span>
          <span className={`${open ? 'whitespace-pre-wrap' : 'truncate'} min-w-0 flex-1 text-sm leading-5 text-gray-700`}>{comment}</span>
          <DisclosureIcon open={open} className="h-4 w-4 shrink-0 text-gray-400" />
        </button>
      </div>
    </div>
  })}</div>
}
