import { useRef, useState } from 'react'
import { useAppState } from '../state/AppContext'
import type { Task } from '../types'
import TaskModal from './TaskModal'
import ConfirmDialog from './ConfirmDialog'
import ImportFeedback from './ImportFeedback'
import Badge from './Badge'
import SectionHeader from './SectionHeader'
import { downloadTaskTemplate, parseTaskWorkbook, type TaskImportResult } from '../utils/excel'
import CriteriaWorkspaceLayout from './CriteriaWorkspaceLayout'

export default function TaskManagement() {
  const { state, dispatch } = useAppState()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [deletingTask, setDeletingTask] = useState<Task | null>(null)
  const [importResult, setImportResult] = useState<TaskImportResult | null>(null)
  const [recentlyAddedIds, setRecentlyAddedIds] = useState<Set<string>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)

  function openAddModal() {
    setEditingTask(null)
    setModalOpen(true)
  }

  function openEditModal(task: Task) {
    setEditingTask(task)
    setModalOpen(true)
  }

  function handleSave(task: Task) {
    if (editingTask) {
      dispatch({ type: 'UPDATE_TASK', payload: task })
    } else {
      dispatch({ type: 'ADD_TASK', payload: task })
    }
    setModalOpen(false)
    setEditingTask(null)
  }

  function handleDeleteConfirm() {
    if (deletingTask) {
      dispatch({ type: 'DELETE_TASK', payload: { id: deletingTask.id } })
      setDeletingTask(null)
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const buffer = await file.arrayBuffer()
    const result = parseTaskWorkbook(buffer, state.tasks)
    dispatch({ type: 'IMPORT_TASKS', payload: result.tasks })
    setImportResult(result)
    setRecentlyAddedIds(new Set(result.addedIds))
  }

  return (
    <CriteriaWorkspaceLayout>
    <div className="ui-page">
      <SectionHeader
        title="과제 관리"
        description="과제를 추가/삭제하면 평가 매트릭스와 리포트에 즉시 반영됩니다. 삭제 시 관련된 모든 평가 데이터도 함께 제거됩니다."
        action={
        <div className="flex items-center gap-2">
          <button onClick={openAddModal} className="ui-button ui-button-primary">+ 과제 추가</button>
        </div>
        }
      />

      <div className="ui-toolbar">
        <button
          onClick={downloadTaskTemplate}
          className="ui-button ui-button-secondary"
        >
          엑셀 양식 다운로드
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="ui-button ui-button-secondary"
        >
          엑셀로 업로드
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={handleFileSelected}
        />
        <span className="text-sm text-gray-500">
          과제명, 과제등급(중점/핵심/일반/지원), 업무량(대/중/소), 목표, 성과, 성과등급(S/A/B/C/D) 컬럼을 포함한 엑셀 파일을 업로드하세요.
        </span>
      </div>

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
          '+ 과제 추가' 버튼으로 직접 등록하거나,
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
            {state.tasks.map((task) => (
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
                      onClick={() => openEditModal(task)}
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

      {modalOpen && (
        <TaskModal
          criteria={state.criteria}
          initialTask={editingTask}
          existingNames={state.tasks.map((t) => t.name)}
          onSave={handleSave}
          onClose={() => {
            setModalOpen(false)
            setEditingTask(null)
          }}
        />
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
