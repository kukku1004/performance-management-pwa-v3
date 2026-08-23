import { useEffect, useRef, useState } from 'react'
import type { AppState } from '../types'
import {
  connectGoogleDrive,
  disconnectGoogleDrive,
  getConnectedGoogleAccount,
  getEvaluationDriveFolder,
  isGoogleDriveConfigured,
  isGoogleDriveConnected,
  listDriveBackups,
  loadBackupFromDrive,
  saveFullBackupToDrive,
  type SavedDriveBackup,
} from '../utils/googleDrive'
import Badge from './Badge'
import FileDropZone from './FileDropZone'
import ModalCloseButton from './ModalCloseButton'
import { downloadFullBackup, downloadFullBackupJson, parseFullBackupJson } from '../utils/fullBackup'
import { detectManagedWorkbookKind, parseMemberWorkbook, parseProjectPeerReviewWorkbook, parseTaskWorkbook } from '../utils/excel'
import { syncAutoDistribution } from '../state/appReducer'
import { mergePeerReviews } from '../utils/peerReview'
import ConfirmDialog from './ConfirmDialog'

interface GoogleDriveDialogProps {
  open: boolean
  state: AppState
  periodName: string
  onPeriodNameChange: (value: string) => void
  onRestore: (state: AppState) => void
  onResetWorkspace: () => void
  onClose: () => void
  teamName?: string
  projectId: string
  periodLabel: string
}

function formatDate(value: string) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function hasWorkingData(state: AppState) {
  return state.tasks.length > 0 || state.members.length > 0 || state.contributions.length > 0
}

export default function GoogleDriveDialog({
  open,
  state,
  periodName,
  onPeriodNameChange,
  onRestore,
  onResetWorkspace,
  onClose,
  teamName,
  projectId,
  periodLabel,
}: GoogleDriveDialogProps) {
  const [connected, setConnected] = useState(isGoogleDriveConnected())
  const [driveEmail, setDriveEmail] = useState(getConnectedGoogleAccount()?.email ?? '')
  const [activeTab, setActiveTab] = useState<'local' | 'drive'>('local')
  const [saveMode, setSaveMode] = useState<'update' | 'version'>('update')
  const [backups, setBackups] = useState<SavedDriveBackup[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [resetOpen, setResetOpen] = useState(false)
  const restoreInputRef = useRef<HTMLInputElement>(null)
  const excelInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setMessage('')
      setError('')
      setResetOpen(false)
    }
  }, [open])

  if (!open) return null

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Google Drive 작업에 실패했습니다.')
      setConnected(isGoogleDriveConnected())
    } finally {
      setBusy(false)
    }
  }

  async function refreshBackups() {
    const items = await listDriveBackups()
    setBackups(items)
    setMessage(items.length > 0 ? `${items.length}개의 앱 백업을 찾았습니다.` : '저장된 앱 백업이 없습니다.')
  }

  function handleConnect() {
    void run(async () => {
      await connectGoogleDrive()
      setConnected(true)
      setDriveEmail(getConnectedGoogleAccount()?.email ?? '')
      setMessage('개인 Google Drive가 연결되었습니다.')
      await refreshBackups()
    })
  }

  function handleOpenFolder() {
    const folderWindow = window.open('about:blank', '_blank')
    if (folderWindow) folderWindow.opener = null
    void run(async () => {
      try {
        const folder = await getEvaluationDriveFolder(periodName, teamName)
        if (!folder.webViewLink) throw new Error('Drive 폴더 링크를 확인하지 못했습니다.')
        if (folderWindow) folderWindow.location.href = folder.webViewLink
        else window.location.assign(folder.webViewLink)
        setMessage('현재 평가의 Drive 폴더를 열었습니다.')
      } catch (caught) {
        folderWindow?.close()
        throw caught
      }
    })
  }

  function handleSave() {
    void run(async () => {
      if (!periodName.trim()) throw new Error('평가기간명을 입력하세요.')
      const result = await saveFullBackupToDrive(state, periodName, saveMode, teamName)
      setMessage(`저장 완료: 성장관리/${teamName ? `${teamName}/` : ''}${result.periodFolder.name}`)
      await refreshBackups()
    })
  }

  function handleLoad(backup: SavedDriveBackup) {
    if (hasWorkingData(state)) {
      const confirmed = window.confirm(
        '현재 데이터를 저장된 데이터로 교체하시겠습니까?\n필요하다면 취소 후 먼저 현재 데이터를 Drive에 백업하세요.',
      )
      if (!confirmed) return
    }
    void run(async () => {
      const restored = await loadBackupFromDrive(backup.id)
      onRestore(restored.appState)
      onPeriodNameChange(restored.evaluationPeriod.name)
      setMessage(`${restored.evaluationPeriod.name} 데이터를 복원했습니다.`)
    })
  }

  async function handleLocalRestore(file: File | undefined) {
    if (!file) return
    if (hasWorkingData(state)) {
      const confirmed = window.confirm('현재 데이터를 선택한 백업으로 교체하시겠습니까?')
      if (!confirmed) return
    }
    await run(async () => {
      const restored = parseFullBackupJson(await file.text())
      onRestore(restored.appState)
      onPeriodNameChange(restored.evaluationPeriod.name)
      setMessage(`${restored.evaluationPeriod.name} 로컬 백업을 복원했습니다.`)
    })
  }

  async function handleBulkExcelUpload(files: FileList | null) {
    if (!files?.length) return
    await run(async () => {
      const loaded = await Promise.all(Array.from(files).map(async (file) => ({ file, buffer: await file.arrayBuffer() })))
      const categorized = loaded.map((item) => ({ ...item, kind: detectManagedWorkbookKind(item.buffer) }))
      let nextState = state
      const summaries: string[] = []
      const issues: string[] = []

      for (const item of categorized.filter(({ kind }) => kind === 'tasks')) {
        const result = parseTaskWorkbook(item.buffer, nextState.tasks)
        nextState = { ...nextState, tasks: result.tasks, contributions: syncAutoDistribution(result.tasks, nextState.members, nextState.contributions) }
        summaries.push(`과제 ${result.importedCount}건`)
        issues.push(...result.errors.map((error) => `${item.file.name}: ${error}`))
      }
      for (const item of categorized.filter(({ kind }) => kind === 'members')) {
        const result = parseMemberWorkbook(item.buffer, nextState.members)
        nextState = { ...nextState, members: result.members, contributions: syncAutoDistribution(nextState.tasks, result.members, nextState.contributions) }
        summaries.push(`팀원 ${result.importedCount}건`)
        issues.push(...result.errors.map((error) => `${item.file.name}: ${error}`))
      }
      for (const item of categorized.filter(({ kind }) => kind === 'peerReviews')) {
        const result = parseProjectPeerReviewWorkbook(item.buffer, projectId, nextState.tasks, nextState.members, nextState.contributions, nextState.criteria.personalGradeWeight > 0, periodLabel)
        if (result.reviews.length > 0) nextState = { ...nextState, peerReviews: mergePeerReviews(nextState.peerReviews, result.reviews) }
        summaries.push(`피어리뷰 ${result.reviews.length}건`)
        issues.push(...result.errors.map((error) => `${item.file.name}: ${error}`))
      }
      const unknownFiles = categorized.filter(({ kind }) => kind === 'unknown').map(({ file }) => file.name)
      issues.push(...unknownFiles.map((name) => `${name}: 지원하는 과제·팀원·피어리뷰 양식이 아닙니다.`))
      if (summaries.length === 0) throw new Error(issues[0] ?? '반영할 수 있는 Excel 파일이 없습니다.')
      onRestore(nextState)
      setMessage(`${files.length}개 파일 처리 · ${summaries.join(' · ')}${issues.length ? ` · 확인 필요 ${issues.length}건` : ''}`)
      if (issues.length) setError(issues.slice(0, 3).join(' / '))
    })
  }

  return (
    <div className="ui-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="drive-dialog-title">
      <div className="ui-modal-panel flex h-[min(680px,calc(100vh-2rem))] max-w-3xl flex-col overflow-hidden">
        <div className="flex shrink-0 items-start justify-between gap-4">
          <div>
            <h3 id="drive-dialog-title" className="ui-modal-title">데이터 관리</h3>
            <p className="mt-1 text-sm text-gray-600">현재 평가 프로젝트의 전체 데이터를 내보내거나 백업·복원합니다.</p>
          </div>
          <ModalCloseButton onClick={onClose} label="데이터 관리 닫기" />
        </div>

        <div className="mt-5 inline-flex w-fit shrink-0 rounded-lg border border-gray-200 bg-gray-100 p-1" role="tablist" aria-label="데이터 관리 방식">
          <button type="button" role="tab" aria-selected={activeTab === 'local'} onClick={() => setActiveTab('local')} className={`inline-flex h-9 items-center gap-2 rounded-md px-4 text-sm font-medium transition ${activeTab === 'local' ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
            로컬 파일
          </button>
          <button type="button" role="tab" aria-selected={activeTab === 'drive'} onClick={() => setActiveTab('drive')} className={`inline-flex h-9 items-center gap-2 rounded-md px-4 text-sm font-medium transition ${activeTab === 'drive' ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none"><path d="M8.2 4h5.1l6.2 10.7H14.4z" fill="#FBBC04"/><path d="M8.2 4 2.5 14l2.6 4.5L10.8 8.6z" fill="#0F9D58"/><path d="M5.1 18.5h11.5l2.9-3.8H8z" fill="#4285F4"/></svg>
            Google Drive
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {activeTab === 'drive' && !isGoogleDriveConfigured() && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Google Cloud OAuth Client ID를 `VITE_GOOGLE_CLIENT_ID` 환경변수에 설정해야 연결할 수 있습니다.
          </div>
        )}

        {activeTab === 'local' ? (
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <section className="space-y-4 border-r-0 border-gray-200 md:border-r md:pr-5">
              <div><h4 className="ui-section-title">전체 데이터 내보내기</h4><p className="ui-section-description">Excel은 검토·보관용 문서이고 JSON은 앱 복원용 백업입니다.</p></div>
              <div><label htmlFor="local-period-name" className="ui-label">평가기간명</label><input id="local-period-name" value={periodName} onChange={(event) => onPeriodNameChange(event.target.value)} className="ui-field" /></div>
              <div className="flex flex-wrap gap-2"><button type="button" onClick={() => downloadFullBackup(state, periodName)} className="ui-button ui-button-primary">전체 Excel 다운로드</button><button type="button" onClick={() => downloadFullBackupJson(state, periodName)} className="ui-button ui-button-secondary">복원용 JSON 다운로드</button></div>
              <p className="text-xs leading-5 text-gray-500">과제·팀원·기여도·수행평가·평가기준·성과결과를 현재 평가기간 기준으로 포함합니다.</p>
              <div className="border-t border-red-200 pt-4">
                <h4 className="ui-section-title text-red-700">데이터 초기화</h4>
                <p className="mt-1 text-xs leading-5 text-red-600">위의 Excel과 JSON 백업을 먼저 내려받으세요. 이 브라우저의 V3 팀·평가 프로젝트·면담·성장·평가 데이터가 모두 삭제됩니다.</p>
                <button type="button" onClick={() => setResetOpen(true)} className="ui-button ui-button-danger mt-3">브라우저 데이터 초기화</button>
              </div>
            </section>
            <section className="space-y-4">
              <div><h4 className="ui-section-title">Excel 일괄 업로드</h4><p className="ui-section-description">과제·팀원·피어리뷰 파일을 함께 선택하면 양식 종류를 자동 구분합니다.</p></div>
              <input ref={excelInputRef} type="file" multiple accept=".xlsx,.xls" className="hidden" onChange={(event) => { void handleBulkExcelUpload(event.target.files); event.target.value = '' }} />
              <button type="button" onClick={() => excelInputRef.current?.click()} disabled={busy} className="ui-button ui-button-primary">전체 일괄 업로드</button>
              <FileDropZone
                onClick={() => excelInputRef.current?.click()}
                onDrop={(event) => { event.preventDefault(); void handleBulkExcelUpload(event.dataTransfer.files) }}
                disabled={busy}
                description="여러 파일 동시 업로드 가능 (.xlsx)"
              />
              <div className="border-t border-gray-200 pt-4"><h4 className="ui-section-title">JSON 백업 복원</h4><p className="ui-section-description">앱에서 내려받은 JSON으로 현재 프로젝트를 정확히 복원합니다.</p></div>
              <input ref={restoreInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => { void handleLocalRestore(event.target.files?.[0]); event.target.value = '' }} />
              <button type="button" onClick={() => restoreInputRef.current?.click()} disabled={busy} className="ui-button ui-button-secondary">JSON 백업 선택</button>
              <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">현재 데이터: 과제 {state.tasks.length}개 · 팀원 {state.members.length}명 · 피어리뷰 {state.peerReviews.length}건</div>
            </section>
          </div>
        ) : <div className="mt-5">
          <div className="mb-5 flex items-center justify-between gap-4 rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2"><span className="truncate text-sm font-medium text-gray-800">{connected ? (driveEmail || 'Google Drive 연결됨') : '아직 연결되지 않음'}</span><Badge tone={connected ? 'success' : 'neutral'}>{connected ? '연결됨' : '미연결'}</Badge></div>
            <button type="button" onClick={handleConnect} disabled={busy || !isGoogleDriveConfigured()} className="ui-button ui-button-secondary ui-button-sm">{connected ? '다시 연결' : 'Drive 연결'}</button>
          </div>
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
          <section className="space-y-4 border-r-0 border-gray-200 md:border-r md:pr-5">
            <div className="flex items-center justify-between gap-3">
              <h4 className="ui-section-title">연결 및 저장</h4>
              <Badge tone={connected ? 'success' : 'neutral'}>{connected ? '연결됨' : '연결 안 됨'}</Badge>
            </div>

            <div>
              <label htmlFor="drive-period-name" className="ui-label">평가기간명</label>
              <input
                id="drive-period-name"
                value={periodName}
                onChange={(event) => onPeriodNameChange(event.target.value)}
                placeholder="예: 2026_상반기, 2026_3분기"
                className="ui-field"
              />
              <p className="mt-1 text-xs text-gray-500">입력한 이름으로 평가기간 폴더와 파일명이 생성됩니다.</p>
            </div>

            <div>
              <label htmlFor="drive-save-mode" className="ui-label">같은 기간 파일 처리</label>
              <select
                id="drive-save-mode"
                value={saveMode}
                onChange={(event) => setSaveMode(event.target.value as 'update' | 'version')}
                className="ui-field"
              >
                <option value="update">기존 앱 파일 업데이트</option>
                <option value="version">새 버전 저장</option>
              </select>
            </div>

            <div className="flex flex-wrap gap-2">
              {connected && (
                <>
                  <button type="button" onClick={handleSave} disabled={busy} className="ui-button ui-button-primary">
                    전체 데이터 저장
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      disconnectGoogleDrive()
                      setConnected(false)
                      setDriveEmail('')
                      setBackups([])
                    }}
                    disabled={busy}
                    className="ui-button ui-button-ghost"
                  >
                    연결 해제
                  </button>
                </>
              )}
            </div>
          </section>

          <section>
            <div className="ui-section-header">
              <div>
                <h4 className="ui-section-title">Drive에서 불러오기</h4>
                <p className="ui-section-description">앱이 만든 JSON 백업만 표시합니다.</p>
              </div>
              <button
                type="button"
                onClick={() => void run(refreshBackups)}
                disabled={busy || !connected}
                className="ui-button ui-button-secondary ui-button-sm"
              >
                저장된 파일 보기
              </button>
            </div>

            <div className="mt-3 max-h-72 overflow-y-auto border-y border-gray-200">
              {backups.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-gray-500">
                  {connected ? '저장된 파일 보기를 눌러 백업을 확인하세요.' : 'Drive를 먼저 연결하세요.'}
                </p>
              ) : (
                backups.map((backup) => (
                  <div key={backup.id} className="flex items-center justify-between gap-4 border-b border-gray-100 px-3 py-3 last:border-b-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-gray-900">{backup.periodName}</p>
                        <Badge tone="success">{backup.status}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        저장 {formatDate(backup.createdTime)} · 수정 {formatDate(backup.modifiedTime)}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {backup.webViewLink && (
                        <a href={backup.webViewLink} target="_blank" rel="noopener noreferrer" className="ui-button ui-button-ghost ui-button-sm">
                          Drive
                        </a>
                      )}
                      <button type="button" onClick={() => handleLoad(backup)} disabled={busy} className="ui-button ui-button-secondary ui-button-sm">
                        불러오기
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
          </div>
          <section className="mt-5 border-t border-gray-200 pt-4"><div className="flex items-center justify-between gap-4"><div><h4 className="ui-section-title">저장된 파일 보기</h4><p className="ui-section-description">성장관리/{teamName ? `${teamName}/` : ''}{periodName} 폴더를 새 탭에서 엽니다.</p></div><button type="button" onClick={handleOpenFolder} disabled={busy || !connected} className="ui-button ui-button-secondary">이 평가의 Drive 폴더 확인</button></div></section>
        </div>}

        {(message || error) && <div className="mt-4 space-y-1 border-t border-gray-200 pt-3 text-sm">{message && <p className="text-success">{message}</p>}{error && <p className="text-danger">{error}</p>}</div>}
        </div>
      </div>
      <ConfirmDialog
        open={resetOpen}
        title="V3 브라우저 데이터 전체 초기화"
        message="이 브라우저에 저장된 V3의 모든 팀, 평가 프로젝트, 과제, 팀원, 기여도, 피어리뷰, 평가결과, 성장관리 및 면담 데이터가 삭제되며 복구할 수 없습니다. 필요한 JSON·Excel 백업을 완료했는지 확인한 후 초기화하세요. Google Drive에 저장된 백업은 삭제되지 않습니다."
        confirmLabel="초기화"
        onCancel={() => setResetOpen(false)}
        onConfirm={() => {
          onResetWorkspace()
          setResetOpen(false)
          onClose()
        }}
      />
    </div>
  )
}
