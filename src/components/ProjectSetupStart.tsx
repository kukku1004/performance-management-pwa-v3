import { useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useAppState } from '../state/AppContext'
import { useWorkspace } from '../state/WorkspaceContext'
import type { Task, TeamMember } from '../types'
import { downloadQuickStartTemplate, parseQuickStartWorkbook } from '../utils/excel'
import { formatEvaluationPeriod } from '../utils/workspace'
import FileDropZone from './FileDropZone'
import ModalCloseButton from './ModalCloseButton'

type StartMode = 'direct' | 'excel' | 'previous'
type DirectTarget = 'tasks' | 'members'

const QUICK_START_REMOVE_ICON = `${import.meta.env.BASE_URL}assets/quick-start-remove.svg`

interface ProjectSetupStartProps {
  open: boolean
  onClose: () => void
}

function namesFromText(value: string) {
  return Array.from(new Set(value.split(/\r?\n|,/).map((name) => name.trim()).filter(Boolean)))
}

function normalizedName(value: string) {
  return value.normalize('NFC').trim()
}

function mergeNames(current: string[], additions: string[]) {
  const existing = new Set(current.map(normalizedName))
  return [...current, ...additions.filter((name) => !existing.has(normalizedName(name)))]
}

export default function ProjectSetupStart({ open, onClose }: ProjectSetupStartProps) {
  const { state, dispatch } = useAppState()
  const { workspace, activeProject, activeTeam } = useWorkspace()
  const [mode, setMode] = useState<StartMode>('direct')
  const [directTarget, setDirectTarget] = useState<DirectTarget>('tasks')
  const [draftInput, setDraftInput] = useState('')
  const [taskDrafts, setTaskDrafts] = useState<string[]>([])
  const [memberDrafts, setMemberDrafts] = useState<string[]>([])
  const [sourceProjectId, setSourceProjectId] = useState('')
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([])
  const [copyCriteria, setCopyCriteria] = useState(true)
  const [message, setMessage] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)
  const excelInputRef = useRef<HTMLInputElement>(null)

  if (!open) return null

  const sourceProjects = workspace.projects.filter((project) => project.id !== activeProject?.id)
  const sourceProject = sourceProjects.find((project) => project.id === sourceProjectId)

  function selectDirectTarget(target: DirectTarget) {
    setDirectTarget(target)
    window.requestAnimationFrame(() => nameInputRef.current?.focus())
  }

  function addDraft() {
    const names = namesFromText(draftInput)
    if (names.length === 0) return
    if (directTarget === 'tasks') setTaskDrafts((current) => mergeNames(current, names))
    else setMemberDrafts((current) => mergeNames(current, names))
    setDraftInput('')
  }

  function addNames() {
    addDraft()
    const pendingTaskNames = mergeNames(taskDrafts, directTarget === 'tasks' ? namesFromText(draftInput) : [])
    const pendingMemberNames = mergeNames(memberDrafts, directTarget === 'members' ? namesFromText(draftInput) : [])
    const newTaskNames = pendingTaskNames.filter((name) => !state.tasks.some((task) => normalizedName(task.name) === normalizedName(name)))
    const newMemberNames = pendingMemberNames.filter((name) => !state.members.some((member) => normalizedName(member.name) === normalizedName(name)))
    const tasks: Task[] = newTaskNames.map((name) => ({
      id: uuidv4(), name, importance: '일반', performanceGrade: 'B', workload: '중', objective: '', achievement: '',
    }))
    const members: TeamMember[] = newMemberNames.map((name) => {
      const knownMember = activeTeam?.members.find((member) => normalizedName(member.name) === normalizedName(name))
      return knownMember ? { ...knownMember, active: true } : {
        id: uuidv4(), name, active: true, position: '', level: '', yearsOfService: null, role: '', comment: '',
      }
    })
    if (tasks.length) dispatch({ type: 'IMPORT_TASKS', payload: [...state.tasks, ...tasks] })
    if (members.length) dispatch({ type: 'IMPORT_MEMBERS', payload: [...state.members, ...members] })
    setDraftInput('')
    setTaskDrafts([])
    setMemberDrafts([])
    setMessage(`과제 ${tasks.length}개, 팀원 ${members.length}명을 추가했습니다.`)
  }

  async function importExcelFiles(files: FileList | File[]) {
    if (files.length === 0) return
    let tasks = state.tasks
    let members = state.members
    let taskCount = 0
    let memberCount = 0
    const errors: string[] = []

    for (const file of Array.from(files)) {
      try {
        const result = parseQuickStartWorkbook(await file.arrayBuffer(), tasks, members)
        tasks = result.tasks
        members = result.members
        taskCount += result.taskCount
        memberCount += result.memberCount
        errors.push(...result.errors.map((error) => `${file.name}: ${error}`))
      } catch {
        errors.push(`${file.name}: 파일을 읽을 수 없습니다.`)
      }
    }

    const knownByName = new Map((activeTeam?.members ?? []).map((member) => [normalizedName(member.name), member]))
    members = members.map((member) => {
      const known = knownByName.get(normalizedName(member.name))
      return known ? { ...member, id: known.id } : member
    })
    if (taskCount > 0) dispatch({ type: 'IMPORT_TASKS', payload: tasks })
    if (memberCount > 0) dispatch({ type: 'IMPORT_MEMBERS', payload: members })
    setMessage(`과제 ${taskCount}건, 팀원 ${memberCount}건을 확인했습니다.${errors.length ? ` 확인 필요 ${errors.length}건` : ''}`)
  }

  function selectSourceProject(projectId: string) {
    setSourceProjectId(projectId)
    const project = sourceProjects.find((item) => item.id === projectId)
    setSelectedTaskIds(project?.appState.tasks.map((task) => task.id) ?? [])
    setSelectedMemberIds(project?.appState.members.map((member) => member.id) ?? [])
  }

  function toggleSelected(value: string, selected: string[], setSelected: (next: string[]) => void) {
    setSelected(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value])
  }

  function copyPreviousProject() {
    if (!sourceProject) return
    const existingTaskNames = new Set(state.tasks.map((task) => normalizedName(task.name)))
    const copiedTasks = sourceProject.appState.tasks
      .filter((task) => selectedTaskIds.includes(task.id) && !existingTaskNames.has(normalizedName(task.name)))
      .map((task) => ({ ...task, id: uuidv4() }))
    const existingMemberIds = new Set(state.members.map((member) => member.id))
    const existingMemberNames = new Set(state.members.map((member) => normalizedName(member.name)))
    const copiedMembers = sourceProject.appState.members.filter((member) => (
      selectedMemberIds.includes(member.id)
      && !existingMemberIds.has(member.id)
      && !existingMemberNames.has(normalizedName(member.name))
    ))
    if (copiedTasks.length) dispatch({ type: 'IMPORT_TASKS', payload: [...state.tasks, ...copiedTasks] })
    if (copiedMembers.length) dispatch({ type: 'IMPORT_MEMBERS', payload: [...state.members, ...copiedMembers] })
    if (copyCriteria) dispatch({ type: 'SET_CRITERIA', payload: { ...sourceProject.appState.criteria } })
    setMessage(`${workspace.teams.find((team) => team.id === sourceProject.teamId)?.name ?? '선택한 팀'} · ${formatEvaluationPeriod(sourceProject.period)}에서 과제 ${copiedTasks.length}개, 팀원 ${copiedMembers.length}명을 가져왔습니다.`)
  }

  function renderDraftPanel(target: DirectTarget, title: string, drafts: string[]) {
    const selected = directTarget === target
    return (
      <section
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={() => selectDirectTarget(target)}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') selectDirectTarget(target) }}
        className={`h-40 cursor-text overflow-y-auto rounded-lg border p-3 transition-colors ${selected ? 'border-[1.5px] border-accent bg-orange-50/30' : 'border-gray-200 bg-white hover:border-gray-300'}`}
      >
        <h3 className={`text-sm font-semibold ${selected ? 'text-accent' : 'text-gray-950'}`}>{title}</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {drafts.map((name) => (
            <span key={name} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800">
              {name}
              <button
                type="button"
                className="ml-0.5 flex h-5 w-5 items-center justify-center rounded hover:bg-gray-100"
                aria-label={`${name} 삭제`}
                onClick={(event) => {
                  event.stopPropagation()
                  if (target === 'tasks') setTaskDrafts((current) => current.filter((item) => item !== name))
                  else setMemberDrafts((current) => current.filter((item) => item !== name))
                }}
              ><img src={QUICK_START_REMOVE_ICON} alt="" className="h-2.5 w-2.5" /></button>
            </span>
          ))}
          {drafts.length === 0 && <p className="text-sm text-gray-300">{selected ? '아래에 입력하고 Enter' : '눌러서 선택'}</p>}
        </div>
      </section>
    )
  }

  return (
    <div className="ui-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="quick-start-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="ui-modal-panel flex h-[min(680px,calc(100vh-2rem))] max-w-3xl flex-col overflow-hidden">
        <div className="flex shrink-0 items-start justify-between gap-4 pb-3">
          <div><h2 id="quick-start-title" className="text-lg font-semibold leading-6 text-gray-950">빠른 시작</h2><p className="mt-1 text-sm text-gray-500">과제와 팀원을 빠르게 준비합니다. 닫으면 기존 화면에서 각각 입력할 수 있습니다.</p></div>
          <ModalCloseButton onClick={onClose} label="빠른 시작 닫기" />
        </div>

        <div className="flex shrink-0 overflow-x-auto border-b border-gray-200" role="tablist" aria-label="빠른 시작 방식">
          {([['direct', '직접 입력', '선택한 영역에 이름을 빠르게 등록'], ['excel', 'Excel로 시작', '통합 양식으로 내려받고 일괄 등록'], ['previous', '이전 평가 가져오기', '팀과 평가기간을 골라 선택 복사']] as const).map(([value, label, description]) => (
            <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => { setMode(value); setMessage('') }} className={`min-w-[180px] flex-1 border-b-2 px-0 py-3 text-left transition-colors ${mode === value ? 'border-accent' : 'border-transparent hover:bg-gray-50'}`}>
              <span className={`block text-sm font-semibold ${mode === value ? 'text-accent' : 'text-gray-950'}`}>{label}</span>
              <span className="mt-0.5 block truncate text-xs leading-5 text-gray-400">{description}</span>
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pt-6">
          {mode === 'direct' && <div>
            <div className="grid gap-3 sm:grid-cols-2">
              {renderDraftPanel('tasks', '과제', taskDrafts)}
              {renderDraftPanel('members', '팀원', memberDrafts)}
            </div>
            <div className="mt-3">
              <input
                ref={nameInputRef}
                value={draftInput}
                onChange={(event) => setDraftInput(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addDraft() } }}
                placeholder={`${directTarget === 'tasks' ? '과제명' : '팀원명'}을 입력하고 Enter (예: ${directTarget === 'tasks' ? '신규 랜딩페이지 제작' : '김민준'})`}
                className="ui-field !h-10"
                autoFocus
              />
              <div className="mt-4 flex justify-end">
                <button type="button" onClick={addNames} disabled={!draftInput.trim() && taskDrafts.length === 0 && memberDrafts.length === 0} className="ui-button ui-button-primary h-10 shrink-0">시작하기</button>
              </div>
            </div>
          </div>}

          {mode === 'excel' && <section>
            <div className="flex items-start justify-between gap-4">
              <div><h3 className="ui-section-title">통합 Excel</h3><p className="mt-1 text-sm text-gray-500">과제와 팀원을 한 통합 양식으로 관리합니다. 기존 과제·팀원 양식도 함께 올릴 수 있습니다.</p></div>
              <button type="button" onClick={() => { void downloadQuickStartTemplate() }} className="ui-button ui-button-secondary shrink-0">통합 양식 다운로드</button>
            </div>
            <FileDropZone
              className="mt-5"
              onClick={() => excelInputRef.current?.click()}
              onDrop={(event) => { event.preventDefault(); void importExcelFiles(event.dataTransfer.files) }}
              description="통합 양식 또는 기존 과제·팀원 파일 여러 개 업로드 가능 (.xlsx)"
            />
            <input ref={excelInputRef} type="file" multiple accept=".xlsx,.xls" className="hidden" onChange={(event) => { if (event.target.files) void importExcelFiles(event.target.files); event.target.value = '' }} />
          </section>}

          {mode === 'previous' && <section>
            <div><h3 className="ui-section-title">가져올 평가 선택</h3><p className="mt-1 text-sm text-gray-500">팀과 평가기간을 한 번에 선택하세요. 선택한 과제와 팀원만 복사되며 원본은 변경되지 않습니다.</p></div>
            {sourceProjects.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2" role="list" aria-label="가져올 평가 목록">
                {sourceProjects.map((project) => {
                  const teamName = workspace.teams.find((team) => team.id === project.teamId)?.name ?? '팀'
                  const selected = project.id === sourceProjectId
                  return (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => selectSourceProject(project.id)}
                      className={`inline-flex h-9 items-center rounded-full border px-4 text-sm font-medium transition-colors ${selected ? 'border-accent bg-orange-50 text-accent' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:text-gray-950'}`}
                      aria-pressed={selected}
                    >
                      {teamName} · {formatEvaluationPeriod(project.period)}
                    </button>
                  )
                })}
              </div>
            ) : <div className="ui-empty mt-5">가져올 수 있는 이전 평가가 없습니다.</div>}
            {sourceProject && <>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <section className="rounded-lg border border-gray-200 p-4">
                  <div className="flex items-center justify-between"><h4 className="text-sm font-semibold text-gray-900">과제</h4><button type="button" className="ui-button ui-button-ghost ui-button-sm" onClick={() => setSelectedTaskIds(selectedTaskIds.length === sourceProject.appState.tasks.length ? [] : sourceProject.appState.tasks.map((task) => task.id))}>전체 {selectedTaskIds.length === sourceProject.appState.tasks.length ? '해제' : '선택'}</button></div>
                  <div className="mt-3 space-y-1">{sourceProject.appState.tasks.map((task) => <label key={task.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-sm hover:bg-gray-50"><input type="checkbox" checked={selectedTaskIds.includes(task.id)} onChange={() => toggleSelected(task.id, selectedTaskIds, setSelectedTaskIds)} /> <span>{task.name}</span></label>)}{sourceProject.appState.tasks.length === 0 && <p className="text-sm text-gray-400">등록된 과제가 없습니다.</p>}</div>
                </section>
                <section className="rounded-lg border border-gray-200 p-4">
                  <div className="flex items-center justify-between"><h4 className="text-sm font-semibold text-gray-900">팀원</h4><button type="button" className="ui-button ui-button-ghost ui-button-sm" onClick={() => setSelectedMemberIds(selectedMemberIds.length === sourceProject.appState.members.length ? [] : sourceProject.appState.members.map((member) => member.id))}>전체 {selectedMemberIds.length === sourceProject.appState.members.length ? '해제' : '선택'}</button></div>
                  <div className="mt-3 space-y-1">{sourceProject.appState.members.map((member) => <label key={member.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-sm hover:bg-gray-50"><input type="checkbox" checked={selectedMemberIds.includes(member.id)} onChange={() => toggleSelected(member.id, selectedMemberIds, setSelectedMemberIds)} /> <span>{member.name}</span></label>)}{sourceProject.appState.members.length === 0 && <p className="text-sm text-gray-400">등록된 팀원이 없습니다.</p>}</div>
                </section>
              </div>
            </>}
          </section>}
        </div>

        {message && <div className="mt-4 shrink-0 border-t border-gray-200 pt-4"><p className="text-sm text-success">{message}</p></div>}
        {mode === 'previous' && sourceProject && <div className="mt-4 flex shrink-0 items-center justify-between gap-4 border-t border-gray-200 pt-4"><label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={copyCriteria} onChange={(event) => setCopyCriteria(event.target.checked)} /> 평가기준도 가져오기</label><button type="button" onClick={copyPreviousProject} disabled={selectedTaskIds.length === 0 && selectedMemberIds.length === 0 && !copyCriteria} className="ui-button ui-button-primary shrink-0">선택 항목 가져오기</button></div>}
      </div>
    </div>
  )
}
