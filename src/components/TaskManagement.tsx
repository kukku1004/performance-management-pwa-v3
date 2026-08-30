import { useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useAppState } from '../state/AppContext'
import type { Importance, PerformanceGrade, Task, Workload } from '../types'
import { IMPORTANCE_OPTIONS, PERFORMANCE_GRADE_OPTIONS, WORKLOAD_OPTIONS } from '../types'
import ConfirmDialog from './ConfirmDialog'
import ImportFeedback from './ImportFeedback'
import Badge from './Badge'
import FileDropZone from './FileDropZone'
import { downloadTaskTemplate, parseTaskWorkbook, type TaskImportResult } from '../utils/excel'
import CriteriaWorkspaceLayout from './CriteriaWorkspaceLayout'

interface TaskForm {
  name: string
  importance: Importance
  performanceGrade: PerformanceGrade
  workload: Workload
  objective: string
  achievement: string
}

const EMPTY_TASK_FORM: TaskForm = { name: '', importance: '일반', performanceGrade: 'B', workload: '중', objective: '', achievement: '' }

export default function TaskManagement() {
  const { state, dispatch } = useAppState()
  const [newForm, setNewForm] = useState<TaskForm>(EMPTY_TASK_FORM)
  const [newFormError, setNewFormError] = useState('')
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<TaskForm>(EMPTY_TASK_FORM)
  const [editFormError, setEditFormError] = useState('')
  const [deletingTask, setDeletingTask] = useState<Task | null>(null)
  const [importResult, setImportResult] = useState<TaskImportResult | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [recentlyAddedIds, setRecentlyAddedIds] = useState<Set<string>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)

  function addTask() {
    const name = newForm.name.trim()
    if (!name || !newForm.objective.trim()) { setNewFormError(!name ? '과제명을 입력하세요.' : '목표를 입력하세요.'); return }
    if (state.tasks.some((task) => task.name === name)) { setNewFormError(`과제명 '${name}'은(는) 이미 존재합니다.`); return }
    const task: Task = { id: uuidv4(), ...newForm, name, objective: newForm.objective.trim(), achievement: newForm.achievement.trim() }
    dispatch({ type: 'ADD_TASK', payload: task })
    setRecentlyAddedIds((current) => new Set(current).add(task.id))
    setNewForm(EMPTY_TASK_FORM)
    setNewFormError('')
  }

  function startEdit(task: Task) {
    setEditingTaskId(task.id)
    setEditForm({ name: task.name, importance: task.importance, performanceGrade: task.performanceGrade, workload: task.workload, objective: task.objective, achievement: task.achievement })
    setEditFormError('')
  }

  function saveEdit(task: Task) {
    const name = editForm.name.trim()
    if (!name || !editForm.objective.trim()) { setEditFormError(!name ? '과제명을 입력하세요.' : '목표를 입력하세요.'); return }
    if (state.tasks.some((item) => item.id !== task.id && item.name === name)) { setEditFormError(`과제명 '${name}'은(는) 이미 존재합니다.`); return }
    dispatch({ type: 'UPDATE_TASK', payload: { ...task, ...editForm, name, objective: editForm.objective.trim(), achievement: editForm.achievement.trim() } })
    setEditingTaskId(null)
    setEditFormError('')
  }

  function handleDeleteConfirm() {
    if (deletingTask) {
      dispatch({ type: 'DELETE_TASK', payload: { id: deletingTask.id } })
      setDeletingTask(null)
    }
  }

  async function importTaskFile(file: File | undefined) {
    if (!file) return
    const buffer = await file.arrayBuffer()
    const result = parseTaskWorkbook(buffer, state.tasks)
    dispatch({ type: 'IMPORT_TASKS', payload: result.tasks })
    setImportResult(result)
    setRecentlyAddedIds(new Set(result.addedIds))
    setUploadOpen(false)
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    await importTaskFile(file)
  }

  return (
    <CriteriaWorkspaceLayout>
    <div className="ui-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-black">과제 관리</h3>
        <div className="flex flex-wrap items-center gap-2"><button onClick={downloadTaskTemplate} className="ui-button ui-button-secondary">엑셀 양식 다운로드</button><button type="button" aria-expanded={uploadOpen} onClick={() => setUploadOpen((open) => !open)} className="ui-button ui-button-secondary">엑셀로 업로드</button><input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileSelected} /></div>
      </div>
      <section className="mt-4 rounded-lg border border-gray-200 bg-white p-4" aria-label="과제 추가">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr_2fr_2fr_auto]">
          <label className="text-sm font-medium text-black">과제명 <span className="text-danger">*</span><input value={newForm.name} onChange={(event) => setNewForm((form) => ({ ...form, name: event.target.value }))} placeholder="예: 신규 랜딩페이지 제작" className={`ui-field mt-1 ${newFormError && !newForm.name.trim() ? 'border-danger' : ''}`} /></label>
          <label className="text-sm font-medium text-black">과제등급<select value={newForm.importance} disabled={state.criteria.taskGradeWeight === 0} onChange={(event) => setNewForm((form) => ({ ...form, importance: event.target.value as Importance }))} className="ui-field mt-1 disabled:bg-gray-100">{IMPORTANCE_OPTIONS.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="text-sm font-medium text-black">업무량<select value={newForm.workload} disabled={state.criteria.workloadWeight === 0} onChange={(event) => setNewForm((form) => ({ ...form, workload: event.target.value as Workload }))} className="ui-field mt-1 disabled:bg-gray-100">{WORKLOAD_OPTIONS.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="text-sm font-medium text-black">성과등급<select value={newForm.performanceGrade} disabled={state.criteria.performanceGradeWeight === 0} onChange={(event) => setNewForm((form) => ({ ...form, performanceGrade: event.target.value as PerformanceGrade }))} className="ui-field mt-1 disabled:bg-gray-100">{PERFORMANCE_GRADE_OPTIONS.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="text-sm font-medium text-black">목표 <span className="text-danger">*</span><input value={newForm.objective} onChange={(event) => setNewForm((form) => ({ ...form, objective: event.target.value }))} placeholder="예: 전환율 15% 개선" className="ui-field mt-1" /></label>
          <label className="text-sm font-medium text-black">성과<input value={newForm.achievement} onChange={(event) => setNewForm((form) => ({ ...form, achievement: event.target.value }))} placeholder="예: 전환율 18% 달성 (선택)" className="ui-field mt-1" /></label>
          <button type="button" onClick={addTask} className="ui-button ui-button-primary self-end whitespace-nowrap">+ 과제 추가</button>
        </div>
        {newFormError && <p className="mt-2 text-xs text-danger">{newFormError}</p>}
      </section>

      {uploadOpen && <FileDropZone
        title="과제 Excel 파일을 여기에 드래그"
        description="과제명·과제등급·업무량·목표·성과·성과등급을 현재 평가에 반영합니다."
        onClick={() => fileInputRef.current?.click()}
        onDrop={(event) => { event.preventDefault(); void importTaskFile(event.dataTransfer.files[0]) }}
      />}

      {importResult && (
        <ImportFeedback
          addedCount={importResult.addedCount}
          updatedCount={importResult.updatedCount}
          errors={importResult.errors}
          onDismiss={() => {
            setImportResult(null)
            setRecentlyAddedIds(new Set())
          }}
        />
      )}

      {state.tasks.length === 0 ? (
        <p className="ui-empty">
          등록된 과제가 없습니다.
          <br />
          위 입력 영역에서 직접 등록하거나,
          <br />
          위의 '엑셀로 업로드' 버튼으로 여러 과제를 한 번에 등록할 수 있습니다.
        </p>
      ) : (
      <div className="ui-table-wrap">
        <table className="ui-table min-w-[820px]">
          <thead>
            <tr>
              <th className="px-4 py-3 font-semibold">과제명</th>
              <th className="px-4 py-3 font-semibold">과제등급</th>
              <th className="px-4 py-3 font-semibold">성과등급</th>
              <th className="px-4 py-3 font-semibold">업무량</th>
              <th className="px-4 py-3 font-semibold">목표</th>
              <th className="px-4 py-3 font-semibold">성과</th>
              <th className="px-4 py-3 font-semibold">관리</th>
            </tr>
          </thead>
          <tbody>
            {state.tasks.map((task) => editingTaskId === task.id ? (
              <tr key={task.id} className="border-t border-gray-200 bg-orange-50/30 text-black">
                <td className="px-3 py-2"><input value={editForm.name} onChange={(event) => setEditForm((form) => ({ ...form, name: event.target.value }))} className="ui-field ui-field-sm" />{editFormError && <p className="mt-1 text-xs text-danger">{editFormError}</p>}</td>
                <td className="px-3 py-2"><select value={editForm.importance} disabled={state.criteria.taskGradeWeight === 0} onChange={(event) => setEditForm((form) => ({ ...form, importance: event.target.value as Importance }))} className="ui-field ui-field-sm disabled:bg-gray-100">{IMPORTANCE_OPTIONS.map((value) => <option key={value}>{value}</option>)}</select></td>
                <td className="px-3 py-2"><select value={editForm.performanceGrade} disabled={state.criteria.performanceGradeWeight === 0} onChange={(event) => setEditForm((form) => ({ ...form, performanceGrade: event.target.value as PerformanceGrade }))} className="ui-field ui-field-sm disabled:bg-gray-100">{PERFORMANCE_GRADE_OPTIONS.map((value) => <option key={value}>{value}</option>)}</select></td>
                <td className="px-3 py-2"><select value={editForm.workload} disabled={state.criteria.workloadWeight === 0} onChange={(event) => setEditForm((form) => ({ ...form, workload: event.target.value as Workload }))} className="ui-field ui-field-sm disabled:bg-gray-100">{WORKLOAD_OPTIONS.map((value) => <option key={value}>{value}</option>)}</select></td>
                <td className="px-3 py-2"><input value={editForm.objective} onChange={(event) => setEditForm((form) => ({ ...form, objective: event.target.value }))} className="ui-field ui-field-sm" /></td>
                <td className="px-3 py-2"><input value={editForm.achievement} onChange={(event) => setEditForm((form) => ({ ...form, achievement: event.target.value }))} className="ui-field ui-field-sm" /></td>
                <td className="px-3 py-2"><div className="flex gap-1"><button type="button" onClick={() => saveEdit(task)} className="ui-button ui-button-primary ui-button-sm">저장</button><button type="button" onClick={() => setEditingTaskId(null)} className="ui-button ui-button-ghost ui-button-sm">취소</button></div></td>
              </tr>
            ) : (
              <tr key={task.id} className="border-t border-gray-200 text-black">
                <td className="px-4 py-3 font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    {task.name}
                    {recentlyAddedIds.has(task.id) && (
                      <Badge tone="accent">N</Badge>
                    )}
                  </span>
                </td>
                <td className={`px-4 py-3 ${state.criteria.taskGradeWeight === 0 ? 'text-gray-400' : ''}`}>{state.criteria.taskGradeWeight === 0 ? '미사용' : task.importance}</td>
                <td className={`px-4 py-3 ${state.criteria.performanceGradeWeight === 0 ? 'text-gray-400' : ''}`}>{state.criteria.performanceGradeWeight === 0 ? '미사용' : task.performanceGrade}</td>
                <td className={`px-4 py-3 ${state.criteria.workloadWeight === 0 ? 'text-gray-400' : ''}`}>{state.criteria.workloadWeight === 0 ? '미사용' : task.workload}</td>
                <td className="px-4 py-3 text-gray-600">{task.objective || '-'}</td>
                <td className="px-4 py-3 text-gray-600">{task.achievement || '-'}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button
                      onClick={() => startEdit(task)}
                      className="ui-button ui-button-secondary ui-button-sm"
                    >
                      수정
                    </button>
                    <button
                      onClick={() => setDeletingTask(task)}
                      className="ui-button ui-button-danger ui-button-sm"
                    >
                      삭제
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      <ConfirmDialog
        open={deletingTask !== null}
        title="과제 삭제"
        message={`'${deletingTask?.name}' 과제를 삭제하시겠습니까? 관련된 기여도 데이터도 함께 삭제됩니다.`}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeletingTask(null)}
      />
    </div>
    </CriteriaWorkspaceLayout>
  )
}
