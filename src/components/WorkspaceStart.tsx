import { useEffect, useMemo, useState } from 'react'
import type { EvaluationPeriodType, EvaluationProject, Team } from '../types'
import { useWorkspace } from '../state/WorkspaceContext'
import { formatEvaluationPeriod, getPeriodOptions } from '../utils/workspace'
import Badge from './Badge'
import ConfirmDialog from './ConfirmDialog'
import { isAdminEmail } from '../utils/admin'

const PERIOD_LABELS: Record<EvaluationPeriodType, string> = {
  half: '반기',
  quarter: '분기',
  annual: '년간',
  custom: '사용자 지정',
}

const MEMBER_COLORS = [
  'bg-orange-500',
  'bg-sky-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-rose-500',
]

function ProjectCard({ project, onOpen, onEdit, onDelete }: { project: EvaluationProject; onOpen: () => void; onEdit: () => void; onDelete: () => void }) {
  const members = project.appState.members.slice(0, 5)
  const remaining = project.appState.members.length - members.length
  return <article className="group overflow-hidden rounded-lg border border-gray-200 bg-white transition hover:border-gray-300 hover:shadow-sm"><button type="button" onClick={onOpen} className="block w-full px-4 pb-3 pt-4 text-left"><div className="flex items-start justify-between gap-3"><div><h4 className="text-base font-semibold text-gray-950">{formatEvaluationPeriod(project.period)}</h4><p className="mt-1 text-xs text-gray-500">최근 수정 {new Date(project.updatedAt).toLocaleDateString('ko-KR')}</p></div><span className="text-xs text-gray-400">팀원 {project.appState.members.length}명</span></div><div className="mt-4 flex min-h-9 items-center gap-1.5">{members.length > 0 ? <>{members.map((member, index) => <span key={member.id} title={`${member.name} · ${member.level || '직급 미설정'}`} className={`flex h-8 w-8 items-center justify-center rounded-full border-2 border-white text-[11px] font-semibold text-white shadow-sm ${MEMBER_COLORS[index % MEMBER_COLORS.length]}`}>{member.name.slice(0, 2)}</span>)}{remaining > 0 && <span className="ml-1 text-xs font-medium text-gray-500">+{remaining}</span>}</> : <span className="text-sm text-gray-400">등록된 팀원 없음</span>}</div></button><div className="flex items-center justify-between border-t border-gray-100 px-4 py-2"><span className="text-xs text-gray-400">프로젝트 열기</span><div className="flex gap-1"><button type="button" onClick={onEdit} className="ui-button ui-button-ghost ui-button-sm">수정</button><button type="button" onClick={onDelete} className="ui-button ui-button-ghost ui-button-sm text-danger">삭제</button></div></div></article>
}

export default function WorkspaceStart() {
  const { workspace, connected, configured, account, connect, switchAccount, logout, createTeam, createProject, selectProject, updateProjectPeriod, deleteProject } = useWorkspace()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [teamName, setTeamName] = useState('')
  const [creatingTeam, setCreatingTeam] = useState(false)
  const [projectTeam, setProjectTeam] = useState<Team | null>(null)
  const [year, setYear] = useState(new Date().getFullYear())
  const [periodType, setPeriodType] = useState<EvaluationPeriodType>('half')
  const [periodValue, setPeriodValue] = useState('상반기')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [showPeriodOptions, setShowPeriodOptions] = useState(false)
  const [copyMembers, setCopyMembers] = useState(true)
  const [copyTasks, setCopyTasks] = useState(true)
  const [copyCriteria, setCopyCriteria] = useState(true)
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
  const [sourceProjectId, setSourceProjectId] = useState('')
  const [editingProject, setEditingProject] = useState<EvaluationProject | null>(null)
  const [deletingProject, setDeletingProject] = useState<EvaluationProject | null>(null)
  const [selectedTeamId, setSelectedTeamId] = useState('')

  const projectsByTeam = useMemo(() => new Map(workspace.teams.map((team) => [
    team.id,
    workspace.projects
      .filter((project) => project.teamId === team.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  ])), [workspace.projects, workspace.teams])

  const availableSourceProjects = projectTeam ? projectsByTeam.get(projectTeam.id) ?? [] : []
  const sourceProject = availableSourceProjects.find((project) => project.id === sourceProjectId)
  const selectedTeam = workspace.teams.find((team) => team.id === selectedTeamId) ?? workspace.teams[0]

  useEffect(() => {
    if (!workspace.teams.some((team) => team.id === selectedTeamId)) setSelectedTeamId(workspace.teams[0]?.id ?? '')
  }, [selectedTeamId, workspace.teams])

  async function handleConnect() {
    setBusy(true)
    setError('')
    try {
      await connect()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Google 로그인에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function handleSwitchAccount() {
    setBusy(true)
    setError('')
    try {
      await switchAccount()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Google 계정 전환에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  function openProject(team: Team) {
    const source = projectsByTeam.get(team.id)?.[0]
    setProjectTeam(team)
    setYear(new Date().getFullYear())
    setPeriodType('half')
    setPeriodValue('상반기')
    setCopyMembers(Boolean(source))
    setCopyTasks(Boolean(source))
    setCopyCriteria(Boolean(source))
    setSelectedTaskIds(source?.appState.tasks.map((task) => task.id) ?? [])
    setSourceProjectId(source?.id ?? '')
  }

  function handleCreateTeam() {
    if (!teamName.trim()) return
    const team = createTeam(teamName)
    setTeamName('')
    setCreatingTeam(false)
    openProject(team)
  }

  function changePeriodType(type: EvaluationPeriodType) {
    setPeriodType(type)
    setPeriodValue(getPeriodOptions(type)[0])
    setShowPeriodOptions(false)
  }

  function handleCreateProject() {
    if (!projectTeam) return
    const period = {
      year,
      type: periodType,
      value: periodType === 'custom' ? '사용자 지정' : periodValue,
      ...(periodType === 'custom' ? { startDate, endDate } : {}),
    }
    if (periodType === 'custom' && (!startDate || !endDate || startDate > endDate)) {
      setError('사용자 지정 기간의 시작일과 종료일을 확인하세요.')
      return
    }
    const duplicate = workspace.projects.some((project) => project.id !== editingProject?.id &&
      project.teamId === projectTeam.id
      && project.period.year === period.year
      && project.period.type === period.type
      && project.period.value === period.value
      && project.period.startDate === period.startDate
      && project.period.endDate === period.endDate)
    if (duplicate) {
      setError('같은 평가기간의 프로젝트가 이미 있습니다.')
      return
    }
    if (editingProject) {
      updateProjectPeriod(editingProject.id, period)
      setEditingProject(null)
      setProjectTeam(null)
      return
    }
    createProject({
      teamId: projectTeam.id,
      period,
      sourceProjectId: sourceProject?.id,
      copyMembers: Boolean(sourceProject && copyMembers),
      copyCriteria: Boolean(sourceProject && copyCriteria),
      taskIds: sourceProject && copyTasks ? selectedTaskIds : [],
    })
  }

  function openEditProject(team: Team, project: EvaluationProject) {
    setEditingProject(project)
    setProjectTeam(team)
    setYear(project.period.year)
    setPeriodType(project.period.type)
    setPeriodValue(project.period.value)
    setStartDate(project.period.startDate ?? '')
    setEndDate(project.period.endDate ?? '')
    setSourceProjectId('')
  }

  function changeSourceProject(nextId: string) {
    const next = availableSourceProjects.find((project) => project.id === nextId)
    setSourceProjectId(nextId)
    setCopyMembers(Boolean(next))
    setCopyTasks(Boolean(next))
    setCopyCriteria(Boolean(next))
    setSelectedTaskIds(next?.appState.tasks.map((task) => task.id) ?? [])
  }

  if (!connected) {
    return (
      <div className="min-h-screen bg-gray-50">
        <main className="mx-auto flex min-h-[calc(100vh-61px)] max-w-lg items-center px-6 py-16">
          <section className="w-full border-y border-gray-200 bg-white py-12 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-gray-950">성과·성장관리</h1>
            <p className="mt-3 text-sm leading-6 text-gray-600">팀과 평가기간별 데이터를 개인 Google Drive에서 안전하게 관리합니다.</p>
            <button type="button" onClick={() => void handleConnect()} disabled={busy || !configured} className="ui-button ui-button-primary mt-7">
              Google 계정으로 시작
            </button>
            {!configured && <p className="mt-4 text-xs text-amber-700">Google OAuth Client ID 설정이 필요합니다.</p>}
            {error && <p className="mt-4 text-sm text-danger">{error}</p>}
          </section>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div><h1 className="text-xl font-semibold tracking-tight text-gray-950">성과·성장관리</h1><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500"><Badge tone="success">Google Drive 연결됨</Badge><span>{account?.email || '개인 Google 계정'}</span>{isAdminEmail(account?.email) && <Badge tone="neutral">관리자</Badge>}</div></div>
          <div className="flex items-center gap-2"><button type="button" onClick={() => void handleSwitchAccount()} disabled={busy} className="ui-button ui-button-secondary ui-button-sm">+ 다른 계정</button><button type="button" onClick={() => void logout()} className="ui-button ui-button-ghost ui-button-sm">로그아웃</button></div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="ui-section-header border-b border-gray-200 pb-4">
          <div><h2 className="ui-section-title">팀과 평가 프로젝트</h2><p className="ui-section-description">진행할 팀과 평가기간을 선택하세요.</p></div>
          <div className="flex items-center gap-2"><button type="button" onClick={() => setCreatingTeam(true)} className="ui-button ui-button-secondary">+ 새 팀</button></div>
        </div>

        {workspace.teams.length === 0 ? (
          <div className="ui-empty mt-8"><p>첫 팀을 만들어 성과관리를 시작하세요.</p><button type="button" onClick={() => setCreatingTeam(true)} className="ui-button ui-button-primary mt-4">+ 팀 만들기</button></div>
        ) : selectedTeam ? (
          <>
            <div className="mt-5 flex gap-2 overflow-x-auto border-b border-gray-200 pb-0" role="tablist" aria-label="팀 선택">
              {workspace.teams.map((team) => { const count = (projectsByTeam.get(team.id) ?? []).length; const active = team.id === selectedTeam.id; return <button key={team.id} type="button" role="tab" aria-selected={active} onClick={() => setSelectedTeamId(team.id)} className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-semibold transition ${active ? 'border-gray-950 text-gray-950' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-950'}`}>{team.name}<span className="ml-2 text-xs font-medium text-gray-400">{team.members.length}명 · {count}개</span></button> })}
            </div>
            {(() => { const projects = projectsByTeam.get(selectedTeam.id) ?? []; return <section className="py-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-semibold text-gray-950">{selectedTeam.name}</h3><p className="mt-1 text-xs text-gray-500">팀원 {selectedTeam.members.length}명 · 평가 프로젝트 {projects.length}개</p></div><button type="button" onClick={() => openProject(selectedTeam)} className="ui-button ui-button-secondary ui-button-sm">+ 새 평가 프로젝트</button></div>{projects.length === 0 ? <p className="ui-empty mt-5">아직 평가 프로젝트가 없습니다.</p> : <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{projects.map((project) => <ProjectCard key={project.id} project={project} onOpen={() => selectProject(project.id)} onEdit={() => openEditProject(selectedTeam, project)} onDelete={() => setDeletingProject(project)} />)}</div>}</section> })()}
          </>
        ) : null}
      </main>

      {creatingTeam && <div className="ui-modal-backdrop" role="dialog" aria-modal="true"><div className="ui-modal-panel max-w-md"><h2 className="ui-modal-title">새 팀 만들기</h2><label className="ui-label mt-5" htmlFor="new-team-name">팀명</label><input id="new-team-name" autoFocus value={teamName} onChange={(event) => setTeamName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && handleCreateTeam()} placeholder="예: UX디자인팀" className="ui-field" /><div className="ui-modal-actions"><button type="button" onClick={() => setCreatingTeam(false)} className="ui-button ui-button-ghost">취소</button><button type="button" onClick={handleCreateTeam} disabled={!teamName.trim()} className="ui-button ui-button-primary">다음</button></div></div></div>}

      {projectTeam && <div className="ui-modal-backdrop" role="dialog" aria-modal="true"><div className="ui-modal-panel max-w-xl"><div className="flex items-start justify-between"><div><h2 className="ui-modal-title">{editingProject ? '평가 프로젝트 수정' : '새 평가 프로젝트'}</h2><p className="mt-1 text-sm text-gray-500">{projectTeam.name}</p></div><button type="button" onClick={() => { setProjectTeam(null); setEditingProject(null) }} className="ui-button ui-button-ghost ui-button-sm">닫기</button></div>
        <div className="mt-6 grid grid-cols-[120px_minmax(0,1fr)_auto] items-end gap-3"><div><label className="ui-label" htmlFor="project-year">연도</label><select id="project-year" value={year} onChange={(event) => setYear(Number(event.target.value))} className="ui-field">{Array.from({ length: 7 }, (_, index) => new Date().getFullYear() - 2 + index).map((item) => <option key={item}>{item}</option>)}</select></div><div><label className="ui-label" htmlFor="project-period">기간</label>{periodType === 'custom' ? <div className="flex gap-2"><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="ui-field" /><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="ui-field" /></div> : <select id="project-period" value={periodValue} onChange={(event) => setPeriodValue(event.target.value)} className="ui-field">{getPeriodOptions(periodType).map((item) => <option key={item}>{item}</option>)}</select>}</div><div className="relative"><button type="button" aria-label="평가주기 설정" onClick={() => setShowPeriodOptions((value) => !value)} className="ui-button ui-button-secondary px-3">설정</button>{showPeriodOptions && <div className="absolute right-0 top-11 z-10 w-40 rounded-md border border-gray-200 bg-white p-1 shadow-sm">{(Object.keys(PERIOD_LABELS) as EvaluationPeriodType[]).map((type) => <button key={type} type="button" onClick={() => changePeriodType(type)} className={`block w-full rounded px-3 py-2 text-left text-sm ${periodType === type ? 'bg-orange-50 text-accent' : 'hover:bg-gray-50'}`}>{PERIOD_LABELS[type]}</button>)}</div>}</div></div>
        {!editingProject && availableSourceProjects.length > 0 && <section className="mt-6 border-t border-gray-200 pt-5"><h3 className="ui-section-title">이전 평가기간의 데이터를 가져오시겠습니까?</h3><div className="mt-3 flex flex-wrap items-end gap-3"><label className="min-w-[220px] flex-1"><span className="ui-label">가져올 평가기간</span><select value={sourceProjectId} onChange={(event) => changeSourceProject(event.target.value)} className="ui-field mt-1"><option value="">가져오지 않음</option>{availableSourceProjects.map((project) => <option key={project.id} value={project.id}>{formatEvaluationPeriod(project.period)}</option>)}</select></label></div>{sourceProject ? <><p className="ui-section-description">{formatEvaluationPeriod(sourceProject.period)}의 기본정보만 가져옵니다.</p><label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={copyMembers} onChange={(event) => setCopyMembers(event.target.checked)} /> 팀원 가져오기</label><label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={copyCriteria} onChange={(event) => setCopyCriteria(event.target.checked)} /> 평가기준 가져오기</label><label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={copyTasks} onChange={(event) => setCopyTasks(event.target.checked)} /> 기존 과제에서 선택</label>{copyTasks && <div className="mt-3 max-h-40 overflow-y-auto border-y border-gray-200">{sourceProject.appState.tasks.map((task) => <label key={task.id} className="flex items-center gap-2 border-b border-gray-100 px-3 py-2.5 text-sm last:border-0"><input type="checkbox" checked={selectedTaskIds.includes(task.id)} onChange={(event) => setSelectedTaskIds((ids) => event.target.checked ? [...ids, task.id] : ids.filter((id) => id !== task.id))} />{task.name}</label>)}</div>}</> : <p className="mt-3 text-sm text-gray-500">빈 평가 프로젝트로 시작합니다.</p>}</section>}
        {error && <p className="mt-4 text-sm text-danger">{error}</p>}<div className="ui-modal-actions"><button type="button" onClick={() => { setProjectTeam(null); setEditingProject(null) }} className="ui-button ui-button-ghost">취소</button><button type="button" onClick={handleCreateProject} className="ui-button ui-button-primary">{editingProject ? '변경사항 저장' : '평가 프로젝트 만들기'}</button></div>
      </div></div>}
      <ConfirmDialog open={deletingProject !== null} title="평가 프로젝트 삭제" message={`${deletingProject ? formatEvaluationPeriod(deletingProject.period) : ''} 프로젝트를 삭제하면 과제, 기여도, 수행평가, 평가결과, 피어리뷰를 포함한 해당 평가기간 데이터가 모두 삭제되며 복구할 수 없습니다. 필요한 데이터는 먼저 백업하세요. 프로젝트를 삭제하시겠습니까?`} confirmLabel="프로젝트 삭제" onConfirm={() => { if (deletingProject) deleteProject(deletingProject.id); setDeletingProject(null) }} onCancel={() => setDeletingProject(null)} />
    </div>
  )
}
