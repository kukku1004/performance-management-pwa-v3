import { useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useAppState } from '../state/AppContext'
import { useWorkspace } from '../state/WorkspaceContext'
import type { Task, TeamMember } from '../types'
import { downloadMemberTemplate, downloadTaskTemplate, parseMemberWorkbook, parseTaskWorkbook } from '../utils/excel'
import { formatEvaluationPeriod } from '../utils/workspace'

type StartMode = 'direct' | 'excel' | 'previous'

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

export default function ProjectSetupStart({ open, onClose }: ProjectSetupStartProps) {
  const { state, dispatch } = useAppState()
  const { workspace, activeProject, activeTeam } = useWorkspace()
  const [mode, setMode] = useState<StartMode>('direct')
  const [taskNames, setTaskNames] = useState('')
  const [memberNames, setMemberNames] = useState('')
  const [sourceProjectId, setSourceProjectId] = useState('')
  const [message, setMessage] = useState('')
  const taskInputRef = useRef<HTMLInputElement>(null)
  const memberInputRef = useRef<HTMLInputElement>(null)

  if (!open) return null

  const previousProjects = workspace.projects.filter((project) => (
    project.teamId === activeProject?.teamId && project.id !== activeProject?.id
  ))

  function addNames() {
    const newTaskNames = namesFromText(taskNames).filter((name) => !state.tasks.some((task) => normalizedName(task.name) === normalizedName(name)))
    const newMemberNames = namesFromText(memberNames).filter((name) => !state.members.some((member) => normalizedName(member.name) === normalizedName(name)))
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
    setTaskNames('')
    setMemberNames('')
    setMessage(`과제 ${tasks.length}개, 팀원 ${members.length}명을 추가했습니다.`)
  }

  async function importTasks(file: File | undefined) {
    if (!file) return
    const result = parseTaskWorkbook(await file.arrayBuffer(), state.tasks)
    dispatch({ type: 'IMPORT_TASKS', payload: result.tasks })
    setMessage(`과제 ${result.addedCount}개를 추가했습니다.${result.errors.length ? ` 확인 필요 ${result.errors.length}건` : ''}`)
  }

  async function importMembers(file: File | undefined) {
    if (!file) return
    const result = parseMemberWorkbook(await file.arrayBuffer(), state.members)
    const knownByName = new Map((activeTeam?.members ?? []).map((member) => [normalizedName(member.name), member]))
    const members = result.members.map((member) => {
      const known = knownByName.get(normalizedName(member.name))
      return known ? { ...member, id: known.id } : member
    })
    dispatch({ type: 'IMPORT_MEMBERS', payload: members })
    setMessage(`팀원 ${result.addedCount}명을 추가했습니다.${result.errors.length ? ` 확인 필요 ${result.errors.length}건` : ''}`)
  }

  function copyPreviousProject() {
    const source = previousProjects.find((project) => project.id === sourceProjectId)
    if (!source) return
    dispatch({ type: 'IMPORT_TASKS', payload: source.appState.tasks.map((task) => ({ ...task, id: uuidv4() })) })
    dispatch({ type: 'IMPORT_MEMBERS', payload: source.appState.members.map((member) => ({ ...member })) })
    dispatch({ type: 'SET_CRITERIA', payload: { ...source.appState.criteria } })
    setMessage('이전 평가의 과제·팀원·평가기준을 가져왔습니다.')
  }

  return (
    <div className="ui-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="quick-start-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="ui-modal-panel max-h-[calc(100vh-2rem)] max-w-4xl overflow-y-auto">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 pb-4">
          <div><h2 id="quick-start-title" className="ui-modal-title">빠른 시작</h2><p className="mt-1 text-sm text-gray-500">원하는 방식으로 과제와 팀원을 빠르게 준비하세요. 닫으면 기존 화면에서 각각 입력할 수 있습니다.</p></div>
          <button type="button" onClick={onClose} className="ui-button ui-button-ghost ui-button-sm" aria-label="빠른 시작 닫기">×</button>
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-3" role="tablist" aria-label="빠른 시작 방식">
          {([['direct', '직접 입력', '이름만 빠르게 등록'], ['excel', 'Excel로 시작', '기존 양식으로 일괄 등록'], ['previous', '이전 평가 가져오기', '같은 팀의 설정과 명단 복사']] as const).map(([value, label, description]) => (
            <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => { setMode(value); setMessage('') }} className={`rounded-lg border p-4 text-left transition-colors ${mode === value ? 'border-accent bg-orange-50' : 'border-gray-200 hover:border-gray-300'}`}>
              <span className="block text-sm font-semibold text-gray-950">{label}</span><span className="mt-1 block text-xs text-gray-500">{description}</span>
            </button>
          ))}
        </div>

        {mode === 'direct' && <div className="mt-6 grid gap-5 md:grid-cols-2">
          <section><div className="flex items-center justify-between"><h3 className="ui-section-title">과제명</h3><span className="text-xs text-gray-500">현재 {state.tasks.length}개</span></div><textarea value={taskNames} onChange={(event) => setTaskNames(event.target.value)} rows={6} placeholder={'한 줄에 하나씩 입력\n예: 신규 랜딩페이지 제작'} className="ui-field mt-3 resize-y" /></section>
          <section><div className="flex items-center justify-between"><h3 className="ui-section-title">팀원명</h3><span className="text-xs text-gray-500">현재 {state.members.length}명</span></div><textarea value={memberNames} onChange={(event) => setMemberNames(event.target.value)} rows={6} placeholder={'한 줄에 하나씩 입력\n예: 김민준'} className="ui-field mt-3 resize-y" /></section>
          <div className="flex items-center justify-between gap-4 border-t border-gray-200 pt-4 md:col-span-2"><p className="text-sm text-gray-500">과제 또는 팀원만 먼저 추가해도 됩니다.</p><button type="button" onClick={addNames} disabled={!taskNames.trim() && !memberNames.trim()} className="ui-button ui-button-primary">이름 등록</button></div>
        </div>}

        {mode === 'excel' && <div className="mt-6 grid gap-5 md:grid-cols-2">
          <section className="rounded-lg border border-gray-200 p-4"><h3 className="ui-section-title">과제 Excel</h3><p className="mt-1 text-sm text-gray-500">과제 양식을 내려받거나 작성한 파일을 올립니다.</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={downloadTaskTemplate} className="ui-button ui-button-secondary">양식 다운로드</button><button type="button" onClick={() => taskInputRef.current?.click()} className="ui-button ui-button-primary">과제 업로드</button></div><input ref={taskInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => { void importTasks(event.target.files?.[0]); event.target.value = '' }} /></section>
          <section className="rounded-lg border border-gray-200 p-4"><h3 className="ui-section-title">팀원 Excel</h3><p className="mt-1 text-sm text-gray-500">팀원 양식을 내려받거나 작성한 파일을 올립니다.</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={downloadMemberTemplate} className="ui-button ui-button-secondary">양식 다운로드</button><button type="button" onClick={() => memberInputRef.current?.click()} className="ui-button ui-button-primary">팀원 업로드</button></div><input ref={memberInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => { void importMembers(event.target.files?.[0]); event.target.value = '' }} /></section>
        </div>}

        {mode === 'previous' && <section className="mt-6"><h3 className="ui-section-title">이전 평가 선택</h3><p className="mt-1 text-sm text-gray-500">같은 팀의 과제·팀원·평가기준을 복사합니다. 원본은 변경되지 않습니다.</p>{previousProjects.length === 0 ? <p className="ui-empty mt-4">가져올 수 있는 이전 평가가 없습니다.</p> : <div className="mt-4 flex max-w-xl gap-2"><select value={sourceProjectId} onChange={(event) => setSourceProjectId(event.target.value)} className="ui-field"><option value="">이전 평가 선택</option>{previousProjects.map((project) => <option key={project.id} value={project.id}>{formatEvaluationPeriod(project.period)}</option>)}</select><button type="button" onClick={copyPreviousProject} disabled={!sourceProjectId} className="ui-button ui-button-primary shrink-0">가져오기</button></div>}</section>}

        <div className="mt-5 flex min-h-9 items-center justify-between gap-4 border-t border-gray-200 pt-4"><p className="text-sm text-success">{message}</p><button type="button" onClick={onClose} className="ui-button ui-button-secondary">닫기</button></div>
      </div>
    </div>
  )
}
