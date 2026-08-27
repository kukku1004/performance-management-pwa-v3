import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AppState, EvaluationPeriod, EvaluationProject, MeetingNote, MemberGrowthProfile, Team, WorkspaceState } from '../types'
import {
  connectGoogleDrive,
  disconnectGoogleDrive,
  getConnectedGoogleAccount,
  getRememberedGoogleAccount,
  hasGoogleDriveConnectionHint,
  isGoogleDriveConfigured,
  isGoogleDriveConnected,
  loadWorkspaceFromDrive,
  saveWorkspaceToDrive,
  type GoogleAccount,
} from '../utils/googleDrive'
import {
  createEmptyWorkspace,
  createEvaluationProject,
  migrateLegacyWorkspace,
  migrateWorkspace,
  updateEvaluationProjectState,
  type CreateProjectInput,
} from '../utils/workspace'

const STORAGE_KEY = 'performance-management-v3-workspace'
const LEGACY_STORAGE_KEY = 'ux-performance-evaluation-state'

function loadWorkspace() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const migrated = migrateWorkspace(JSON.parse(stored))
      if (migrated) return migrated
    }
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (legacy) return migrateLegacyWorkspace(JSON.parse(legacy)) ?? createEmptyWorkspace()
  } catch {
    // Continue with an empty local workspace.
  }
  return createEmptyWorkspace()
}

interface WorkspaceContextValue {
  workspace: WorkspaceState
  connected: boolean
  configured: boolean
  account: GoogleAccount | null
  rememberedAccount: GoogleAccount | null
  activeProject: EvaluationProject | null
  activeTeam: Team | null
  restoringConnection: boolean
  saveStatus: 'saved' | 'unsaved' | 'saving' | 'error'
  connect: (accountMode?: 'remembered' | 'default') => Promise<void>
  switchAccount: () => Promise<void>
  logout: () => Promise<void>
  createTeam: (name: string) => Team
  updateTeam: (teamId: string, name: string) => void
  deleteTeam: (teamId: string) => void
  createProject: (input: CreateProjectInput) => EvaluationProject
  selectProject: (projectId: string | null) => void
  updateProjectPeriod: (projectId: string, period: EvaluationPeriod) => void
  deleteProject: (projectId: string) => void
  resetWorkspace: () => void
  updateProjectState: (projectId: string, state: AppState) => void
  saveMeetingNote: (note: MeetingNote) => void
  deleteMeetingNote: (noteId: string) => void
  saveGrowthProfile: (profile: MemberGrowthProfile) => void
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<WorkspaceState>(loadWorkspace)
  const [connected, setConnected] = useState(isGoogleDriveConnected())
  const [account, setAccount] = useState<GoogleAccount | null>(getConnectedGoogleAccount())
  const [rememberedAccount, setRememberedAccount] = useState<GoogleAccount | null>(getRememberedGoogleAccount())
  const [saveStatus, setSaveStatus] = useState<'saved' | 'unsaved' | 'saving' | 'error'>('saved')
  const [restoringConnection, setRestoringConnection] = useState(() => isGoogleDriveConfigured() && !isGoogleDriveConnected() && hasGoogleDriveConnectionHint())
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const workspaceRef = useRef(workspace)
  const changeVersionRef = useRef(0)
  const restoreAttemptedRef = useRef(false)
  workspaceRef.current = workspace

  const markUnsaved = useCallback(() => {
    changeVersionRef.current += 1
    setHasUnsavedChanges(true)
    setSaveStatus('unsaved')
  }, [])

  useEffect(() => {
    if (restoreAttemptedRef.current || !restoringConnection) return
    restoreAttemptedRef.current = true
    void connectGoogleDrive('')
      .then(async () => {
        const remote = await loadWorkspaceFromDrive()
        if (remote) setWorkspace(remote)
        setAccount(getConnectedGoogleAccount())
        setConnected(true)
        setHasUnsavedChanges(false)
        setSaveStatus('saved')
      })
      .catch(() => setConnected(false))
      .finally(() => setRestoringConnection(false))
  }, [restoringConnection])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace))
    if (!connected || !hasUnsavedChanges) return
    const timer = window.setTimeout(() => {
      const savingVersion = changeVersionRef.current
      setSaveStatus('saving')
      void saveWorkspaceToDrive({ ...workspace, activeProjectId: null })
        .then(() => {
          if (changeVersionRef.current === savingVersion) {
            setHasUnsavedChanges(false)
            setSaveStatus('saved')
          }
        })
        .catch(() => setSaveStatus('error'))
    }, 800)
    return () => window.clearTimeout(timer)
  }, [connected, hasUnsavedChanges, workspace])

  const connect = useCallback(async (accountMode: 'remembered' | 'default' = 'default') => {
    await connectGoogleDrive(accountMode === 'remembered' ? '' : 'consent', true)
    const remote = await loadWorkspaceFromDrive()
    if (remote) setWorkspace(remote)
    const nextAccount = getConnectedGoogleAccount()
    setAccount(nextAccount)
    setRememberedAccount(nextAccount)
    setConnected(true)
    setHasUnsavedChanges(false)
    setSaveStatus('saved')
  }, [])

  const switchAccount = useCallback(async () => {
    if (connected) await saveWorkspaceToDrive({ ...workspaceRef.current, activeProjectId: null })
    await connectGoogleDrive('select_account', true)
    const remote = await loadWorkspaceFromDrive()
    const nextWorkspace = remote ?? createEmptyWorkspace()
    workspaceRef.current = nextWorkspace
    setWorkspace(nextWorkspace)
    setAccount(getConnectedGoogleAccount())
    setRememberedAccount(getConnectedGoogleAccount())
    setConnected(true)
    setHasUnsavedChanges(false)
    setSaveStatus('saved')
  }, [connected])

  const logout = useCallback(async () => {
    if (connected) await saveWorkspaceToDrive({ ...workspace, activeProjectId: null }).catch(() => undefined)
    disconnectGoogleDrive()
    setWorkspace((current) => ({ ...current, activeProjectId: null }))
    setAccount(null)
    setConnected(false)
    setHasUnsavedChanges(false)
    setSaveStatus('saved')
  }, [connected, workspace])

  const createTeam = useCallback((name: string) => {
    const team: Team = {
      id: crypto.randomUUID(),
      name: name.trim(),
      members: [],
      growthProfiles: [],
      meetingNotes: [],
      createdAt: new Date().toISOString(),
    }
    setWorkspace((current) => ({ ...current, teams: [...current.teams, team] }))
    markUnsaved()
    return team
  }, [markUnsaved])

  const updateTeam = useCallback((teamId: string, name: string) => {
    const trimmedName = name.trim()
    if (!trimmedName) return
    setWorkspace((current) => ({
      ...current,
      teams: current.teams.map((team) => team.id === teamId ? { ...team, name: trimmedName } : team),
    }))
    markUnsaved()
  }, [markUnsaved])

  const deleteTeam = useCallback((teamId: string) => {
    setWorkspace((current) => {
      const projectIds = new Set(current.projects.filter((project) => project.teamId === teamId).map((project) => project.id))
      return {
        ...current,
        teams: current.teams.filter((team) => team.id !== teamId),
        projects: current.projects.filter((project) => project.teamId !== teamId),
        activeProjectId: current.activeProjectId && projectIds.has(current.activeProjectId) ? null : current.activeProjectId,
      }
    })
    markUnsaved()
  }, [markUnsaved])

  const createProject = useCallback((input: CreateProjectInput) => {
    let created!: EvaluationProject
    setWorkspace((current) => {
      created = createEvaluationProject(current, input)
      const team = current.teams.find((item) => item.id === input.teamId)
      const source = current.projects.find((item) => item.id === input.sourceProjectId)
      const members = source && input.copyMembers ? source.appState.members.map((member) => ({ ...member })) : (team?.members ?? [])
      return {
        ...current,
        teams: current.teams.map((item) => item.id === input.teamId ? { ...item, members } : item),
        projects: [...current.projects, created],
        activeProjectId: created.id,
      }
    })
    markUnsaved()
    return created
  }, [markUnsaved])

  const selectProject = useCallback((projectId: string | null) => {
    setWorkspace((current) => ({ ...current, activeProjectId: projectId }))
  }, [])

  const updateProjectPeriod = useCallback((projectId: string, period: EvaluationPeriod) => {
    setWorkspace((current) => ({ ...current, projects: current.projects.map((project) => project.id === projectId ? { ...project, period, updatedAt: new Date().toISOString() } : project) }))
    markUnsaved()
  }, [markUnsaved])

  const deleteProject = useCallback((projectId: string) => {
    setWorkspace((current) => ({ ...current, projects: current.projects.filter((project) => project.id !== projectId), activeProjectId: current.activeProjectId === projectId ? null : current.activeProjectId }))
    markUnsaved()
  }, [markUnsaved])

  const resetWorkspace = useCallback(() => {
    const empty = createEmptyWorkspace()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(empty))
    workspaceRef.current = empty
    setWorkspace(empty)
    setHasUnsavedChanges(false)
    setSaveStatus('saved')
  }, [])

  const updateProjectState = useCallback((projectId: string, state: AppState) => {
    const currentProject = workspaceRef.current.projects.find((item) => item.id === projectId)
    if (!currentProject || JSON.stringify(currentProject.appState) === JSON.stringify(state)) return
    setWorkspace((current) => updateEvaluationProjectState(current, projectId, state))
    markUnsaved()
  }, [markUnsaved])

  const saveMeetingNote = useCallback((note: MeetingNote) => {
    const teamId = workspaceRef.current.projects.find((project) => project.id === workspaceRef.current.activeProjectId)?.teamId
    if (!teamId) return
    setWorkspace((current) => ({
      ...current,
      teams: current.teams.map((team) => team.id !== teamId ? team : {
        ...team,
        meetingNotes: team.meetingNotes.some((item) => item.id === note.id)
          ? team.meetingNotes.map((item) => item.id === note.id ? note : item)
          : [...team.meetingNotes, note],
      }),
    }))
    markUnsaved()
  }, [markUnsaved])

  const deleteMeetingNote = useCallback((noteId: string) => {
    const teamId = workspaceRef.current.projects.find((project) => project.id === workspaceRef.current.activeProjectId)?.teamId
    if (!teamId) return
    setWorkspace((current) => ({
      ...current,
      teams: current.teams.map((team) => team.id === teamId
        ? { ...team, meetingNotes: team.meetingNotes.filter((note) => note.id !== noteId) }
        : team),
    }))
    markUnsaved()
  }, [markUnsaved])

  const saveGrowthProfile = useCallback((profile: MemberGrowthProfile) => {
    const teamId = workspaceRef.current.projects.find((project) => project.id === workspaceRef.current.activeProjectId)?.teamId
    if (!teamId) return
    setWorkspace((current) => ({
      ...current,
      teams: current.teams.map((team) => team.id !== teamId ? team : {
        ...team,
        growthProfiles: team.growthProfiles.some((item) => item.memberId === profile.memberId)
          ? team.growthProfiles.map((item) => item.memberId === profile.memberId ? profile : item)
          : [...team.growthProfiles, profile],
      }),
    }))
    markUnsaved()
  }, [markUnsaved])

  const activeProject = workspace.projects.find((project) => project.id === workspace.activeProjectId) ?? null
  const activeTeam = workspace.teams.find((team) => team.id === activeProject?.teamId) ?? null
  const value = useMemo<WorkspaceContextValue>(() => ({
    workspace,
    connected,
    configured: isGoogleDriveConfigured(),
    account,
    rememberedAccount,
    activeProject,
    activeTeam,
    restoringConnection,
    saveStatus,
    connect,
    switchAccount,
    logout,
    createTeam,
    updateTeam,
    deleteTeam,
    createProject,
    selectProject,
    updateProjectPeriod,
    deleteProject,
    resetWorkspace,
    updateProjectState,
    saveMeetingNote,
    deleteMeetingNote,
    saveGrowthProfile,
  }), [account, activeProject, activeTeam, connect, connected, createProject, createTeam, deleteMeetingNote, deleteProject, deleteTeam, logout, rememberedAccount, resetWorkspace, restoringConnection, saveGrowthProfile, saveMeetingNote, saveStatus, selectProject, switchAccount, updateProjectPeriod, updateProjectState, updateTeam, workspace])

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('useWorkspace must be used within WorkspaceProvider')
  return value
}
