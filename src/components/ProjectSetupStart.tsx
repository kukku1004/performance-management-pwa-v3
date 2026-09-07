import { useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useAppState } from '../state/AppContext'
import { syncAutoDistribution } from '../state/appReducer'
import { useWorkspace } from '../state/WorkspaceContext'
import type { ImportedPerformanceDocument, Task, TeamMember } from '../types'
import {
  detectManagedWorkbookKind,
  downloadQuickStartTemplateBundle,
  downloadQuickStartTemplateFile,
  parseIntegratedPeerReviewWorkbook,
  parseProjectPeerReviewWorkbook,
  parseQuickStartWorkbook,
  type QuickStartTemplateKind,
} from '../utils/excel'
import { containsGrowthHistoryData, parseGrowthHistoryWorkbook } from '../utils/growthExcel'
import { mergePerformancePdfIntoGrowthProfiles, parsePerformancePdf, performanceDocumentMatchesPeriod, type PerformancePdfParseResult } from '../utils/performancePdf'
import { mergePeerReviews } from '../utils/peerReview'
import { formatEvaluationPeriod } from '../utils/workspace'
import FileDropZone from './FileDropZone'
import Badge from './Badge'
import ModalCloseButton from './ModalCloseButton'
import PerformanceCommentSelector from './PerformanceCommentSelector'

type StartMode = 'direct' | 'excel' | 'previous'
type DirectTarget = 'tasks' | 'members'

const QUICK_START_REMOVE_ICON = `${import.meta.env.BASE_URL}assets/quick-start-remove.svg`

const QUICK_START_TEMPLATES: { kind: QuickStartTemplateKind; label: string; description: string }[] = [
  { kind: 'tasks', label: '과제 입력 양식', description: '과제명·중요도·업무량·성과정보' },
  { kind: 'members', label: '팀원 입력 양식', description: '이름·직책·직급·연차·역할' },
  { kind: 'growth', label: '이전 성과 입력 양식', description: '팀원별 최근 5년 업적·역량 이력' },
  { kind: 'peerReviews', label: '피어리뷰 입력 양식', description: '과제별 리뷰어·대상팀원·기여도·근거' },
]

interface ProjectSetupStartProps {
  open: boolean
  onClose: () => void
  onStartEvaluation?: () => void
}

type UploadResultStatus = 'success' | 'warning' | 'error'

interface ExcelUploadResult {
  id: string
  name: string
  details: string[]
  errorCount: number
  status: UploadResultStatus
}

interface ExcelUploadAccumulator {
  id: string
  name: string
  taskCount: number
  memberCount: number
  growthMemberCount: number
  peerReviewCount: number
  performancePdfCount: number
  errorCount: number
}

interface PendingPdfComments {
  document: ImportedPerformanceDocument
  memberId: string
  selected: number[]
}

function namesFromText(value: string) {
  return Array.from(new Set(value.split(/\r?\n|,/).map((name) => name.trim()).filter(Boolean)))
}

function normalizedName(value: string) {
  return value.normalize('NFC').trim()
}

function normalizedTaskName(value: string) {
  return normalizedName(value).replace(/\s+/g, '').toLowerCase()
}

function mergeNames(current: string[], additions: string[]) {
  const existing = new Set(current.map(normalizedName))
  return [...current, ...additions.filter((name) => !existing.has(normalizedName(name)))]
}

export default function ProjectSetupStart({ open, onClose, onStartEvaluation }: ProjectSetupStartProps) {
  const { state, dispatch } = useAppState()
  const { workspace, activeProject, activeTeam, saveGrowthProfile } = useWorkspace()
  const [mode, setMode] = useState<StartMode>('direct')
  const [directTarget, setDirectTarget] = useState<DirectTarget>('tasks')
  const [draftInput, setDraftInput] = useState('')
  const [taskDrafts, setTaskDrafts] = useState<string[]>([])
  const [memberDrafts, setMemberDrafts] = useState<string[]>([])
  const [sourceProjectId, setSourceProjectId] = useState('')
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([])
  const [copyCriteria, setCopyCriteria] = useState(true)
  const [previousImportComplete, setPreviousImportComplete] = useState(false)
  const [message, setMessage] = useState('')
  const [isImportingExcel, setIsImportingExcel] = useState(false)
  const [excelImportComplete, setExcelImportComplete] = useState(false)
  const [excelUploadResults, setExcelUploadResults] = useState<ExcelUploadResult[]>([])
  const [uploadResultsOpen, setUploadResultsOpen] = useState(false)
  const [pendingPdfComments, setPendingPdfComments] = useState<PendingPdfComments[]>([])
  const nameInputRef = useRef<HTMLInputElement>(null)
  const excelInputRef = useRef<HTMLInputElement>(null)
  const isNameComposingRef = useRef(false)
  const submitAfterCompositionRef = useRef(false)

  useEffect(() => {
    if (!open) setUploadResultsOpen(false)
  }, [open])

  if (!open) return null

  const sourceProjects = workspace.projects.filter((project) => project.id !== activeProject?.id)
  const sourceProject = sourceProjects.find((project) => project.id === sourceProjectId)

  function selectDirectTarget(target: DirectTarget) {
    setDirectTarget(target)
    window.requestAnimationFrame(() => nameInputRef.current?.focus())
  }

  function addDraft(value = draftInput) {
    const names = namesFromText(value)
    if (names.length === 0) return
    if (directTarget === 'tasks') setTaskDrafts((current) => mergeNames(current, names))
    else setMemberDrafts((current) => mergeNames(current, names))
    setDraftInput('')
  }

  function handleNameCompositionEnd(event: React.CompositionEvent<HTMLInputElement>) {
    isNameComposingRef.current = false
    const composedValue = event.currentTarget.value
    setDraftInput(composedValue)
    if (!submitAfterCompositionRef.current) return
    submitAfterCompositionRef.current = false
    window.requestAnimationFrame(() => addDraft(composedValue))
  }

  function handleNameKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    if (event.nativeEvent.isComposing || isNameComposingRef.current || event.keyCode === 229) {
      submitAfterCompositionRef.current = true
      return
    }
    event.preventDefault()
    addDraft()
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
    setIsImportingExcel(true)
    setExcelImportComplete(false)
    setExcelUploadResults([])
    setUploadResultsOpen(false)
    setMessage('')
    setPendingPdfComments([])
    let tasks = state.tasks
    let members = state.members
    let taskCount = 0
    let memberCount = 0
    let peerReviewFileCount = 0
    let peerReviewCount = 0
    let growthMemberCount = 0
    const errors: string[] = []
    const loadedFiles: { file: File; buffer: ArrayBuffer; isPeerReview: boolean; isPdf: boolean }[] = []
    const parsedPdfById = new Map<string, PerformancePdfParseResult>()
    const summaries = new Map<string, ExcelUploadAccumulator>()

    const getSummary = (file: File) => {
      const id = `${file.name}-${file.size}-${file.lastModified}`
      const existing = summaries.get(id)
      if (existing) return existing
      const next: ExcelUploadAccumulator = {
        id,
        name: file.name,
        taskCount: 0,
        memberCount: 0,
        growthMemberCount: 0,
        peerReviewCount: 0,
        performancePdfCount: 0,
        errorCount: 0,
      }
      summaries.set(id, next)
      return next
    }

    try {
      for (const file of Array.from(files)) {
        const summary = getSummary(file)
        if (!/\.(xlsx?|pdf)$/i.test(file.name)) {
          summary.errorCount += 1
          errors.push(`${file.name}: Excel 또는 성과 PDF 파일만 업로드할 수 있습니다.`)
          continue
        }
        try {
          const buffer = await file.arrayBuffer()
          const isPdf = /\.pdf$/i.test(file.name)
          loadedFiles.push({ file, buffer, isPdf, isPeerReview: !isPdf && detectManagedWorkbookKind(buffer) === 'peerReviews' })
        } catch {
          summary.errorCount += 1
          errors.push(`${file.name}: 파일을 읽을 수 없습니다.`)
        }
      }

      for (const { file, buffer, isPeerReview, isPdf } of loadedFiles) {
        if (isPeerReview || isPdf) continue
        const summary = getSummary(file)
        try {
          const result = parseQuickStartWorkbook(buffer, tasks, members)
          tasks = result.tasks
          members = result.members
          taskCount += result.taskCount
          memberCount += result.memberCount
          summary.taskCount += result.taskCount
          summary.memberCount += result.memberCount
          summary.errorCount += result.errors.length
          errors.push(...result.errors.map((error) => `${file.name}: ${error}`))
        } catch {
          summary.errorCount += 1
          errors.push(`${file.name}: 파일을 읽을 수 없습니다.`)
        }
      }

      for (const { file, buffer, isPdf } of loadedFiles) {
        if (!isPdf) continue
        const summary = getSummary(file)
        try {
          const parsed = await parsePerformancePdf(buffer, file.name, members)
          parsedPdfById.set(summary.id, parsed)
          if (!parsed.document) {
            summary.errorCount += parsed.errors.length || 1
            errors.push(...parsed.errors.map((error) => `${file.name}: ${error}`))
            continue
          }
          const document = parsed.document
          if (!members.some((member) => normalizedName(member.name) === normalizedName(document.memberName))) {
            const supportedLevel = ['사원', '대리', '과장', '차장'].includes(document.level) ? document.level as TeamMember['level'] : ''
            members = [...members, { id: uuidv4(), name: document.memberName, active: true, position: '', level: supportedLevel, yearsOfService: null, role: '', comment: '' }]
            memberCount += 1
            summary.memberCount += 1
          }
          if (activeProject && performanceDocumentMatchesPeriod(document, activeProject.period)) {
            for (const importedTask of document.tasks) {
              if (tasks.some((task) => normalizedTaskName(task.name) === normalizedTaskName(importedTask.name))) continue
              tasks = [...tasks, { id: uuidv4(), name: importedTask.name, importance: '일반', performanceGrade: importedTask.grade ?? 'B', workload: '중', objective: '', achievement: '' }]
              taskCount += 1
              summary.taskCount += 1
            }
          }
          summary.performancePdfCount += 1
          summary.errorCount += parsed.errors.length
          errors.push(...parsed.errors.map((error) => `${file.name}: ${error}`))
        } catch {
          summary.errorCount += 1
          errors.push(`${file.name}: 성과 PDF를 읽을 수 없습니다.`)
        }
      }

      const knownByName = new Map((activeTeam?.members ?? []).map((member) => [normalizedName(member.name), member]))
      members = members.map((member) => {
        const known = knownByName.get(normalizedName(member.name))
        return known ? { ...member, id: known.id } : member
      })

      let growthProfiles = activeTeam?.growthProfiles ?? []
      const importedGrowthMembers = new Set<string>()
      for (const { file, buffer, isPeerReview, isPdf } of loadedFiles) {
        if (isPeerReview || isPdf || !containsGrowthHistoryData(buffer)) continue
        const summary = getSummary(file)
        try {
          const result = parseGrowthHistoryWorkbook(buffer, members, growthProfiles)
          growthProfiles = result.profiles
          result.importedMembers.forEach((name) => importedGrowthMembers.add(name))
          summary.growthMemberCount += result.importedMembers.length
          summary.errorCount += result.errors.length
          errors.push(...result.errors.map((error) => `${file.name}: ${error}`))
        } catch {
          summary.errorCount += 1
          errors.push(`${file.name}: 이전 성과 데이터를 읽을 수 없습니다.`)
        }
      }
      for (const { file, isPdf } of loadedFiles) {
        if (!isPdf) continue
        const summary = getSummary(file)
        const parsed = parsedPdfById.get(summary.id)
        if (!parsed) continue
        const result = mergePerformancePdfIntoGrowthProfiles(parsed, members, growthProfiles)
        growthProfiles = result.profiles
        result.importedMembers.forEach((name) => importedGrowthMembers.add(name))
        summary.growthMemberCount += result.importedMembers.length
      }
      growthMemberCount = importedGrowthMembers.size

      let peerReviews = state.peerReviews
      const importContributions = syncAutoDistribution(tasks, members, state.contributions)
      for (const { file, buffer, isPeerReview, isPdf } of loadedFiles) {
        if (isPeerReview || isPdf) continue
        const summary = getSummary(file)
        try {
          const result = parseIntegratedPeerReviewWorkbook(buffer, tasks, members)
          if (result.reviews.length > 0) {
            peerReviews = mergePeerReviews(peerReviews, result.reviews)
            peerReviewFileCount += 1
            peerReviewCount += result.importedCount
            summary.peerReviewCount += result.importedCount
          }
          summary.errorCount += result.errors.length
          errors.push(...result.errors.map((error) => `${file.name}: ${error}`))
        } catch {
          summary.errorCount += 1
          errors.push(`${file.name}: 피어리뷰 데이터를 읽을 수 없습니다.`)
        }
      }
      for (const { file, buffer, isPeerReview, isPdf } of loadedFiles) {
        if (!isPeerReview || isPdf) continue
        const summary = getSummary(file)
        if (!activeProject) {
          summary.errorCount += 1
          errors.push(`${file.name}: 현재 평가를 확인할 수 없습니다.`)
          continue
        }
        try {
          const result = parseProjectPeerReviewWorkbook(
            buffer,
            activeProject.id,
            tasks,
            members,
            importContributions,
            state.criteria.personalGradeWeight > 0,
            formatEvaluationPeriod(activeProject.period),
          )
          if (result.reviews.length > 0) {
            peerReviews = mergePeerReviews(peerReviews, result.reviews)
            peerReviewFileCount += 1
            peerReviewCount += result.reviews.length
            summary.peerReviewCount += result.reviews.length
          }
          summary.errorCount += result.errors.length
          errors.push(...result.errors.map((error) => `${file.name}: ${error}`))
        } catch {
          summary.errorCount += 1
          errors.push(`${file.name}: 파일을 읽을 수 없습니다.`)
        }
      }

      if (taskCount > 0) dispatch({ type: 'IMPORT_TASKS', payload: tasks })
      if (memberCount > 0) dispatch({ type: 'IMPORT_MEMBERS', payload: members })
      if (peerReviewFileCount > 0) dispatch({ type: 'IMPORT_PEER_REVIEWS', payload: peerReviews })
      if (growthMemberCount > 0) growthProfiles.forEach((profile) => saveGrowthProfile(profile))
      if (activeProject) {
        for (const parsed of parsedPdfById.values()) {
          const document = parsed.document
          if (!document || !performanceDocumentMatchesPeriod(document, activeProject.period)) continue
          const member = members.find((item) => normalizedName(item.name) === normalizedName(document.memberName))
          if (!member) continue
          for (const importedTask of document.tasks) {
            const task = tasks.find((item) => normalizedTaskName(item.name) === normalizedTaskName(importedTask.name))
            if (!task) continue
            if (importedTask.grade) dispatch({ type: 'SET_CONTRIBUTION_GRADE', payload: { taskId: task.id, memberId: member.id, personalPerformanceGrade: importedTask.grade } })
          }
        }
      }
      setPendingPdfComments(Array.from(parsedPdfById.values()).flatMap((parsed) => {
        const document = parsed.document
        if (!document || document.comments.length === 0) return []
        const member = members.find((item) => normalizedName(item.name) === normalizedName(document.memberName))
        return member ? [{ document, memberId: member.id, selected: document.comments.map((_, index) => index) }] : []
      }))

      const results = Array.from(summaries.values()).map<ExcelUploadResult>((summary) => {
        const details = [
          summary.taskCount > 0 ? `과제 ${summary.taskCount}건` : '',
          summary.memberCount > 0 ? `팀원 ${summary.memberCount}건` : '',
          summary.growthMemberCount > 0 ? `이전 성과 ${summary.growthMemberCount}명` : '',
          summary.peerReviewCount > 0 ? `피어리뷰 ${summary.peerReviewCount}건` : '',
          summary.performancePdfCount > 0 ? `성과 PDF ${summary.performancePdfCount}건` : '',
        ].filter(Boolean)
        const importedCount = summary.taskCount + summary.memberCount + summary.growthMemberCount + summary.peerReviewCount + summary.performancePdfCount
        return {
          id: summary.id,
          name: summary.name,
          details: details.length > 0 ? details : ['가져올 데이터를 찾지 못했습니다.'],
          errorCount: summary.errorCount,
          status: importedCount === 0 ? 'error' : summary.errorCount > 0 ? 'warning' : 'success',
        }
      })
      const performancePdfCount = Array.from(summaries.values()).reduce((sum, item) => sum + item.performancePdfCount, 0)
      const imported = taskCount + memberCount + growthMemberCount + peerReviewCount + performancePdfCount > 0
    setExcelUploadResults(results)
    setExcelImportComplete(imported)
    setUploadResultsOpen(results.length > 0)
      setMessage(imported
        ? `과제 ${taskCount}건, 팀원 ${memberCount}건, 이전 성과 ${growthMemberCount}명, 피어리뷰 ${peerReviewCount}건, 성과 PDF ${performancePdfCount}건을 가져왔습니다.${errors.length ? ` 확인 필요 ${errors.length}건` : ''}`
        : '업로드한 파일에서 가져올 데이터를 찾지 못했습니다.')
    } finally {
      setIsImportingExcel(false)
    }
  }

  function togglePdfComment(documentId: string, index: number) {
    setPendingPdfComments((current) => current.map((item) => item.document.id !== documentId ? item : {
      ...item,
      selected: item.selected.includes(index) ? item.selected.filter((value) => value !== index) : [...item.selected, index],
    }))
  }

  function saveSelectedPdfComments() {
    let saved = 0
    pendingPdfComments.forEach((item) => {
      const selectedComments = item.document.comments.filter((_, index) => item.selected.includes(index))
      if (selectedComments.length === 0) return
      const profile = activeTeam?.growthProfiles.find((value) => value.memberId === item.memberId)
      if (!profile) return
      saveGrowthProfile({
        ...profile,
        importedPerformanceDocuments: (profile.importedPerformanceDocuments ?? []).map((document) => document.id === item.document.id ? { ...document, selectedComments } : document),
      })
      saved += selectedComments.length
    })
    setPendingPdfComments([])
    setMessage((current) => `${current} 선택한 성과 코멘트 ${saved}건을 코멘트 기록으로 저장했습니다.`)
  }

  function selectSourceProject(projectId: string) {
    setSourceProjectId(projectId)
    setPreviousImportComplete(false)
    setMessage('')
    const project = sourceProjects.find((item) => item.id === projectId)
    setSelectedTaskIds(project?.appState.tasks.map((task) => task.id) ?? [])
    setSelectedMemberIds(project?.appState.members.map((member) => member.id) ?? [])
  }

  function toggleSelected(value: string, selected: string[], setSelected: (next: string[]) => void) {
    setPreviousImportComplete(false)
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
    const teamName = workspace.teams.find((team) => team.id === sourceProject.teamId)?.name ?? '선택한 팀'
    setMessage(`${teamName} · ${formatEvaluationPeriod(sourceProject.period)} 데이터를 가져왔습니다.`)
    setPreviousImportComplete(true)
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
      <div className="ui-modal-panel quick-start-modal flex flex-col overflow-hidden">
        <div className="flex shrink-0 items-start justify-between gap-4 pb-3">
          <div><h2 id="quick-start-title" className="text-lg font-semibold leading-6 text-gray-950">빠른 시작</h2><p className="mt-1 text-sm text-gray-500">과제와 팀원을 빠르게 준비합니다. 닫으면 기존 화면에서 각각 입력할 수 있습니다.</p></div>
          <ModalCloseButton onClick={onClose} label="빠른 시작 닫기" />
        </div>

        <div className="flex shrink-0 overflow-x-auto border-b border-gray-200" role="tablist" aria-label="빠른 시작 방식">
          {([['direct', '직접 입력', '선택한 영역에 이름을 빠르게 등록'], ['excel', 'Excel로 시작', '필요한 양식을 내려받고 일괄 등록'], ['previous', '이전 평가 가져오기', '팀과 평가기간을 골라 선택 복사']] as const).map(([value, label, description]) => (
            <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => { setMode(value); setMessage(''); setPreviousImportComplete(false) }} className={`min-w-[180px] flex-1 border-b-2 px-0 py-3 text-left transition-colors ${mode === value ? 'border-accent' : 'border-transparent hover:bg-gray-50'}`}>
              <span className={`block text-sm font-semibold ${mode === value ? 'text-accent' : 'text-gray-950'}`}>{label}</span>
              <span className="mt-0.5 block truncate text-xs leading-5 text-gray-400">{description}</span>
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1 pt-5">
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
                onCompositionStart={() => { isNameComposingRef.current = true }}
                onCompositionEnd={handleNameCompositionEnd}
                onKeyDown={handleNameKeyDown}
                placeholder={`${directTarget === 'tasks' ? '과제명' : '팀원명'}을 입력하고 Enter (예: ${directTarget === 'tasks' ? '신규 랜딩페이지 제작' : '김민준'})`}
                className="ui-field !h-10"
                autoFocus
              />
              <div className="mt-4 flex justify-end">
                <button type="button" onClick={addNames} disabled={!draftInput.trim() && taskDrafts.length === 0 && memberDrafts.length === 0} className="ui-button ui-button-primary h-10 shrink-0">시작하기</button>
              </div>
            </div>
          </div>}

          {mode === 'excel' && <section className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] lg:gap-0">
            <div className="min-w-0 lg:pr-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="ui-section-title">양식 다운로드</h3>
                  <p className="mt-1 text-sm text-gray-500">필요한 양식을 각각 받거나 ZIP으로 한 번에 받습니다.</p>
                </div>
                <button
                  type="button"
                  onClick={() => { void downloadQuickStartTemplateBundle(state.tasks, state.members, activeProject?.period.year) }}
                  className="ui-button ui-button-primary shrink-0"
                >전체 ZIP 다운로드</button>
              </div>
              <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
                {QUICK_START_TEMPLATES.map((template, index) => (
                  <div key={template.kind} className={`flex min-h-14 items-center gap-3 px-4 py-2.5 ${index > 0 ? 'border-t border-gray-200' : ''}`}>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-50 text-gray-500" aria-hidden="true">
                      <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6.75 3.75h6.1L17.25 8v12.25H6.75z" />
                        <path d="M12.75 3.75V8h4.5M9 12h6M9 15.5h6" />
                      </svg>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900">{template.label}</p>
                      <p className="mt-0.5 text-xs leading-5 text-gray-400">{template.description}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { void downloadQuickStartTemplateFile(template.kind, state.tasks, state.members, activeProject?.period.year) }}
                      className="ui-button ui-button-secondary ui-button-sm shrink-0"
                    >다운로드</button>
                  </div>
                ))}
              </div>
            </div>
            <div className="min-w-0 border-t border-gray-200 pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
              <h3 className="ui-section-title">작성한 양식 업로드</h3>
              <p className="mt-1 text-sm leading-6 text-gray-500">과제·팀원·이전 성과·피어리뷰 Excel과 성과평가 PDF를 함께 올리면 자동으로 구분합니다.</p>
              <FileDropZone
                className="mt-4 min-h-56"
                disabled={isImportingExcel}
                onClick={() => { if (!isImportingExcel) excelInputRef.current?.click() }}
                onDrop={(event) => { event.preventDefault(); void importExcelFiles(event.dataTransfer.files) }}
                title={isImportingExcel ? '파일을 확인하고 있습니다…' : '작성한 양식 파일을 여기에 드래그'}
                description={isImportingExcel ? '데이터 종류와 내용을 확인하는 중입니다.' : 'Excel·성과 PDF 여러 파일 동시 업로드 가능'}
              />
              {!isImportingExcel && excelUploadResults.length === 0 && <p className="mt-3 text-xs leading-5 text-gray-400">드롭 영역을 누르면 파일 선택창이 열립니다.</p>}
              {isImportingExcel && <div className="mt-3 flex items-center gap-2 text-sm text-accent" role="status" aria-live="polite">
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />
                업로드한 파일을 확인하고 있습니다.
              </div>}
              {excelUploadResults.length > 0 && <aside className={`quick-start-upload-drawer ${uploadResultsOpen ? 'is-open' : ''}`} aria-label="업로드 결과">
                <div className="quick-start-upload-drawer-header">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900">업로드 결과</h4>
                    <p className="mt-1 text-xs text-gray-500">{excelUploadResults.length}개 파일</p>
                  </div>
                  <button type="button" className="ui-icon-button" onClick={() => setUploadResultsOpen(false)} aria-label="업로드 결과 닫기">×</button>
                </div>
                <div className="quick-start-upload-drawer-list">
                  {excelUploadResults.map((result, index) => (
                    <div key={result.id} className={`flex items-start gap-3 px-4 py-3 ${index > 0 ? 'border-t border-gray-100' : ''}`}>
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gray-50 text-gray-500" aria-hidden="true">
                        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6.75 3.75h6.1L17.25 8v12.25H6.75z" /><path d="M12.75 3.75V8h4.5" /></svg>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">{result.name}</p>
                        <p className="mt-0.5 text-xs leading-5 text-gray-500">{result.details.join(' · ')}{result.errorCount > 0 ? ` · 확인 필요 ${result.errorCount}건` : ''}</p>
                      </div>
                      <Badge tone={result.status === 'success' ? 'success' : result.status === 'warning' ? 'accent' : 'danger'} className="shrink-0">
                        {result.status === 'success' ? '완료' : result.status === 'warning' ? '확인 필요' : '실패'}
                      </Badge>
                    </div>
                  ))}
                </div>
              </aside>}
              {pendingPdfComments.length > 0 && <section className="mt-4 rounded-lg border border-orange-200 bg-orange-50/40 p-4"><div className="flex items-start justify-between gap-3"><div><h4 className="text-sm font-semibold text-gray-950">코멘트 기록으로 가져오기</h4><p className="mt-1 text-xs leading-5 text-gray-500">각 코멘트는 한 줄로 표시됩니다. 펼쳐본 뒤 선택한 내용만 면담 기록과 분리해 저장합니다.</p></div><span className="shrink-0 text-xs font-medium text-accent">{pendingPdfComments.reduce((sum, item) => sum + item.selected.length, 0)}개 선택</span></div><div className="mt-3 max-h-64 space-y-3 overflow-y-auto">{pendingPdfComments.map((item) => <div key={item.document.id} className="rounded-md border border-gray-200 bg-white p-3"><strong className="text-sm text-gray-900">{item.document.memberName} · {item.document.periodLabel}</strong><p className="mt-0.5 truncate text-xs text-gray-400">{item.document.fileName}</p><div className="mt-2"><PerformanceCommentSelector comments={item.document.comments} selected={item.selected} onToggle={(index) => togglePdfComment(item.document.id, index)} /></div></div>)}</div><div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setPendingPdfComments([])} className="ui-button ui-button-secondary ui-button-sm">코멘트 가져오지 않기</button><button type="button" onClick={saveSelectedPdfComments} disabled={!pendingPdfComments.some((item) => item.selected.length > 0)} className="ui-button ui-button-primary ui-button-sm">선택 코멘트 기록에 저장</button></div></section>}
              <input ref={excelInputRef} type="file" multiple accept=".xlsx,.xls,.pdf,application/pdf" className="hidden" onChange={(event) => { if (event.target.files) void importExcelFiles(event.target.files); event.target.value = '' }} />
            </div>
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
                  <div className="flex items-center justify-between"><h4 className="text-sm font-semibold text-gray-900">과제</h4><button type="button" className="ui-button ui-button-ghost ui-button-sm" onClick={() => { setPreviousImportComplete(false); setSelectedTaskIds(selectedTaskIds.length === sourceProject.appState.tasks.length ? [] : sourceProject.appState.tasks.map((task) => task.id)) }}>전체 {selectedTaskIds.length === sourceProject.appState.tasks.length ? '해제' : '선택'}</button></div>
                  <div className="mt-3 space-y-1">{sourceProject.appState.tasks.map((task) => <label key={task.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-sm hover:bg-gray-50"><input type="checkbox" checked={selectedTaskIds.includes(task.id)} onChange={() => toggleSelected(task.id, selectedTaskIds, setSelectedTaskIds)} /> <span>{task.name}</span></label>)}{sourceProject.appState.tasks.length === 0 && <p className="text-sm text-gray-400">등록된 과제가 없습니다.</p>}</div>
                </section>
                <section className="rounded-lg border border-gray-200 p-4">
                  <div className="flex items-center justify-between"><h4 className="text-sm font-semibold text-gray-900">팀원</h4><button type="button" className="ui-button ui-button-ghost ui-button-sm" onClick={() => { setPreviousImportComplete(false); setSelectedMemberIds(selectedMemberIds.length === sourceProject.appState.members.length ? [] : sourceProject.appState.members.map((member) => member.id)) }}>전체 {selectedMemberIds.length === sourceProject.appState.members.length ? '해제' : '선택'}</button></div>
                  <div className="mt-3 space-y-1">{sourceProject.appState.members.map((member) => <label key={member.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-sm hover:bg-gray-50"><input type="checkbox" checked={selectedMemberIds.includes(member.id)} onChange={() => toggleSelected(member.id, selectedMemberIds, setSelectedMemberIds)} /> <span>{member.name}</span></label>)}{sourceProject.appState.members.length === 0 && <p className="text-sm text-gray-400">등록된 팀원이 없습니다.</p>}</div>
                </section>
              </div>
            </>}
          </section>}
        </div>

        {message && <div className="mt-4 flex shrink-0 items-center justify-between gap-4 border-t border-gray-200 pt-4"><p className={`flex min-w-0 items-center gap-2 text-sm ${mode === 'excel' && !excelImportComplete ? 'text-danger' : 'text-success'}`}>{(previousImportComplete || excelImportComplete) && <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 fill-current"><path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.86-9.78a.75.75 0 0 0-1.22-.88l-3.24 4.48-1.98-1.98a.75.75 0 0 0-1.06 1.06l2.6 2.6a.75.75 0 0 0 1.14-.1l3.76-5.18Z" clipRule="evenodd" /></svg>}<span>{message}</span></p>{mode === 'excel' && excelUploadResults.length > 0 && !uploadResultsOpen && <button type="button" className="ui-button ui-button-secondary ui-button-sm shrink-0" onClick={() => setUploadResultsOpen(true)}>업로드 결과 {excelUploadResults.length}개 보기</button>}</div>}
        {mode === 'excel' && excelUploadResults.length > 0 && !isImportingExcel && <div className="mt-4 flex shrink-0 items-center justify-between gap-4 border-t border-gray-200 pt-4">
          <p className="text-sm text-gray-500">{excelImportComplete ? '가져온 데이터로 평가를 계속할 수 있습니다.' : '파일 내용을 확인한 뒤 다시 업로드해 주세요.'}</p>
          <button
            type="button"
            disabled={!excelImportComplete || pendingPdfComments.length > 0}
            onClick={() => { if (onStartEvaluation) onStartEvaluation(); else onClose() }}
            className="ui-button ui-button-primary shrink-0"
          >평가 시작하기</button>
        </div>}
        {mode === 'previous' && sourceProject && <div className="mt-4 flex shrink-0 items-center justify-between gap-4 border-t border-gray-200 pt-4"><label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={copyCriteria} onChange={(event) => { setCopyCriteria(event.target.checked); setPreviousImportComplete(false) }} /> 평가기준도 가져오기</label><button type="button" onClick={previousImportComplete ? onClose : copyPreviousProject} disabled={!previousImportComplete && selectedTaskIds.length === 0 && selectedMemberIds.length === 0 && !copyCriteria} className={`ui-button ui-button-primary shrink-0 ${previousImportComplete ? 'quick-start-complete' : ''}`}>{previousImportComplete ? '시작하기' : '선택 항목 가져오기'}</button></div>}
      </div>
    </div>
  )
}
