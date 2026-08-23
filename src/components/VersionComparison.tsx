const VERSIONS = [
  { label: '기존', href: 'https://kukkkuku.github.io/desktop-tutorial/preview/' },
  { label: 'Claude V2', href: 'https://kukkkuku.github.io/desktop-tutorial/preview-v2/' },
  { label: 'Codex V3', href: 'https://kukku1004.github.io/performance-management-pwa-v3/' },
]

export default function VersionComparison({ className = '' }: { className?: string }) {
  return (
    <nav aria-label="버전 비교" className={`flex items-center gap-1 ${className}`}>
      {VERSIONS.map((version) => (
        <a
          key={version.label}
          href={version.href}
          target="_blank"
          rel="noopener noreferrer"
          className="ui-button ui-button-ghost ui-button-sm"
        >
          {version.label}
        </a>
      ))}
    </nav>
  )
}
