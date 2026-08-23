import { useState } from 'react'
import { AppProvider, useAppState } from './state/AppContext'
import { WorkspaceProvider, useWorkspace } from './state/WorkspaceContext'
import Navigation, { type TabKey } from './components/Navigation'
import TaskManagement from './components/TaskManagement'
import TeamManagement from './components/TeamManagement'
import EvaluationMatrix from './components/EvaluationMatrix'
import EvaluationResults from './components/EvaluationResults'
import MeetingNotes from './components/MeetingNotes'
import WorkspaceStart from './components/WorkspaceStart'
import GoogleDriveDialog from './components/GoogleDriveDialog'
import ProjectSetupStart from './components/ProjectSetupStart'
import { evaluationPeriodFolderName, formatEvaluationPeriod } from './utils/workspace'
import { CriteriaWorkspaceProvider } from './components/CriteriaWorkspaceLayout'

export default function App() {
  return <WorkspaceProvider><WorkspaceRouter /></WorkspaceProvider>
}

function WorkspaceRouter() {
  const { connected, activeProject, updateProjectState } = useWorkspace()
  if (!connected || !activeProject) return <WorkspaceStart />

  return (
    <AppProvider
      key={activeProject.id}
      initialState={activeProject.appState}
      onStateChange={(state) => updateProjectState(activeProject.id, state)}
    >
      <ProjectApp />
    </AppProvider>
  )
}

function ProjectApp() {
  const { state, dispatch } = useAppState()
  const { activeProject, activeTeam, resetWorkspace } = useWorkspace()
  const [activeTab, setActiveTab] = useState<TabKey>('tasks')
  const [dataManagementOpen, setDataManagementOpen] = useState(false)
  const [quickStartOpen, setQuickStartOpen] = useState(() => state.tasks.length === 0 && state.members.length === 0)
  const [periodName, setPeriodName] = useState(activeProject ? evaluationPeriodFolderName(activeProject.period) : String(new Date().getFullYear()))

  function handleTabChange(tab: TabKey) {
    setActiveTab(tab)
    window.scrollTo(0, 0)
  }

  return (
    <div className="min-h-screen bg-white">
      <Navigation activeTab={activeTab} onTabChange={handleTabChange} onOpenDataManagement={() => setDataManagementOpen(true)} onOpenQuickStart={() => setQuickStartOpen(true)} />
      <CriteriaWorkspaceProvider><main className="mx-auto w-full max-w-[1920px] px-4 py-8 sm:px-6">
        {activeTab === 'tasks' && <TaskManagement />}
        {activeTab === 'members' && <TeamManagement />}
        {activeTab === 'matrix' && <EvaluationMatrix />}
        {activeTab === 'results' && <EvaluationResults />}
        {activeTab === 'notes' && <MeetingNotes />}
      </main></CriteriaWorkspaceProvider>
      <GoogleDriveDialog open={dataManagementOpen} state={state} periodName={periodName} onPeriodNameChange={setPeriodName} onRestore={(restoredState) => dispatch({ type: 'LOAD_STATE', payload: restoredState })} onResetWorkspace={resetWorkspace} teamName={activeTeam?.name} projectId={activeProject?.id ?? ''} periodLabel={activeProject ? formatEvaluationPeriod(activeProject.period) : periodName} onClose={() => setDataManagementOpen(false)} />
      <ProjectSetupStart open={quickStartOpen} onClose={() => setQuickStartOpen(false)} />
    </div>
  )
}
