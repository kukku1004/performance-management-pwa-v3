import type { ReactNode } from 'react'

interface SectionHeaderProps {
  title: string
  description?: ReactNode
  action?: ReactNode
  compact?: boolean
}

export default function SectionHeader({ title, description, action, compact = false }: SectionHeaderProps) {
  return (
    <header className={compact ? 'flex flex-wrap items-start justify-between gap-3' : 'ui-page-header'}>
      <div>
        <h2 className="ui-page-title">{title}</h2>
        {description && <div className={compact ? 'mt-1 text-sm leading-6 text-gray-600' : 'ui-page-description'}>{description}</div>}
      </div>
      {action}
    </header>
  )
}
