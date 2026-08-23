import { useWorkspace } from '../state/WorkspaceContext'
import { formatEvaluationPeriod } from '../utils/workspace'
import Badge from './Badge'
import { useState } from 'react'
import { isAdminEmail } from '../utils/admin'

export type TabKey = 'tasks' | 'members' | 'matrix' | 'results' | 'notes'

const TABS: { key: TabKey; label: string; dividerBefore?: boolean }[] = [
  { key: 'tasks', label: '과제관리' },
  { key: 'members', label: '팀원관리' },
  { key: 'matrix', label: '평가하기', dividerBefore: true },
  { key: 'results', label: '평가결과' },
  { key: 'notes', label: '팀원 면담', dividerBefore: true },
]

interface NavigationProps {
  activeTab: TabKey
  onTabChange: (tab: TabKey) => void
  onOpenDataManagement: () => void
}

export default function Navigation({ activeTab, onTabChange, onOpenDataManagement }: NavigationProps) {
  const { workspace, activeProject, activeTeam, account, saveStatus, selectProject, logout, switchAccount } = useWorkspace()
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [accountBusy, setAccountBusy] = useState(false)
  const saveLabel = saveStatus === 'saved' ? '저장됨' : saveStatus === 'saving' ? '저장 중' : saveStatus === 'error' ? '저장 실패' : '저장하지 않은 변경사항'
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex min-h-16 w-full max-w-[1920px] items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative shrink-0">
            <button type="button" onClick={() => setProjectMenuOpen((value) => !value)} className="flex h-10 items-center gap-2 rounded-md px-1.5 text-left hover:bg-gray-50"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-gray-700" strokeWidth="1.8"><path d="M3.5 6.5h6l2 2h9v10h-17z"/><path d="M3.5 8.5v-3h6l2 2"/></svg><span className="text-sm font-semibold tracking-tight text-gray-950">{activeTeam?.name ?? '성과·성장관리'}{activeProject && <span className="ml-1.5 font-normal text-gray-600">{formatEvaluationPeriod(activeProject.period)}</span>}</span><svg aria-hidden="true" viewBox="0 0 20 20" className={`h-4 w-4 fill-current text-gray-400 transition-transform ${projectMenuOpen ? 'rotate-180' : ''}`}><path d="m5.5 7.5 4.5 5 4.5-5z"/></svg></button>
            {projectMenuOpen && <div className="absolute left-0 top-full z-50 mt-2 w-72 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">{workspace.teams.map((team) => <div key={team.id} className="mb-2 last:mb-0"><p className="px-2 py-1 text-xs font-semibold text-gray-500">{team.name}</p>{workspace.projects.filter((project) => project.teamId === team.id).map((project) => <button key={project.id} type="button" onClick={() => { selectProject(project.id); setProjectMenuOpen(false) }} className={`block w-full rounded-md px-3 py-2 text-left text-sm ${project.id === activeProject?.id ? 'bg-orange-50 font-medium text-accent' : 'hover:bg-gray-50'}`}>{formatEvaluationPeriod(project.period)}</button>)}</div>)}<button type="button" onClick={() => selectProject(null)} className="mt-1 w-full border-t border-gray-100 px-3 py-2 text-left text-sm text-gray-500 hover:text-gray-900">프로젝트 관리</button></div>}
          </div>
          <div className="border-l border-gray-200 pl-3">
            <button type="button" onClick={onOpenDataManagement} className="ui-button ui-button-ghost ui-button-sm whitespace-nowrap">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8"><ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></svg>
              데이터 관리
            </button>
          </div>
          <nav className="flex min-w-0 items-center gap-1">
            {TABS.map((tab) => (
              <div key={tab.key} className={`flex items-center ${tab.dividerBefore ? 'ml-2 border-l border-gray-200 pl-2' : ''}`}>
                <button onClick={() => onTabChange(tab.key)} className={`ui-tab whitespace-nowrap ${activeTab === tab.key ? 'ui-tab-active' : ''}`}>
                  {tab.key === 'notes' && <svg aria-hidden="true" viewBox="0 0 24 24" className="mr-1.5 h-4 w-4 fill-none stroke-current" strokeWidth="1.8"><path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/></svg>}
                  {tab.label}
                </button>
              </div>
            ))}
          </nav>
        </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {account?.email && <div className="relative"><button type="button" onClick={() => setAccountMenuOpen((value) => !value)} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-gray-600 hover:bg-gray-50 hover:text-gray-950"><span className="max-w-52 truncate">{account.email}</span>{isAdminEmail(account.email) && <Badge tone="neutral">관리자</Badge>}<svg aria-hidden="true" viewBox="0 0 20 20" className={`h-3.5 w-3.5 fill-current text-gray-400 transition-transform ${accountMenuOpen ? 'rotate-180' : ''}`}><path d="m5.5 7.5 4.5 5 4.5-5z"/></svg></button>{accountMenuOpen && <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-gray-200 bg-white p-2 shadow-lg"><p className="truncate px-3 py-2 text-xs text-gray-500">현재 계정 · {account.email}</p><button type="button" disabled={accountBusy} onClick={() => { setAccountBusy(true); void switchAccount().then(() => setAccountMenuOpen(false)).catch(() => undefined).finally(() => setAccountBusy(false)) }} className="ui-button ui-button-secondary mt-1 w-full justify-center">{accountBusy ? '계정 선택 중…' : '+ 다른 Google 계정 연결'}</button></div>}</div>}
            <Badge tone={saveStatus === 'error' ? 'danger' : saveStatus === 'saved' ? 'success' : 'neutral'}>{saveLabel}</Badge>
            <button type="button" onClick={() => void logout()} className="ui-button ui-button-ghost ui-button-sm">로그아웃</button>
          </div>
      </div>
    </header>
  )
}
