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
import ModalCloseButton from './ModalCloseButton'
import { backupToJsonBlob, createFullBackupEnvelope, createFullBackupWorkbook, downloadBlob, parseFullBackupJson, sanitizePeriodName, workbookToBlob } from '../utils/fullBackup'
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

interface BackupDirectoryHandle {
  name: string
  getFileHandle: (name: string, options: { create: boolean }) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }>
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
}: GoogleDriveDialogProps) {
  const [connected, setConnected] = useState(isGoogleDriveConnected())
  const [driveEmail, setDriveEmail] = useState(getConnectedGoogleAccount()?.email ?? '')
  const [activeTab, setActiveTab] = useState<'local' | 'drive' | 'reset'>('local')
  const [saveMode, setSaveMode] = useState<'update' | 'version'>('update')
  const [backups, setBackups] = useState<SavedDriveBackup[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [resetOpen, setResetOpen] = useState(false)
  const [backupDirectory, setBackupDirectory] = useState<BackupDirectoryHandle | null>(null)
  const [localFormats, setLocalFormats] = useState({ json: true, excel: true })
  const restoreInputRef = useRef<HTMLInputElement>(null)

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

  async function chooseBackupDirectory() {
    const picker = (window as Window & { showDirectoryPicker?: () => Promise<BackupDirectoryHandle> }).showDirectoryPicker
    if (!picker) {
      setError('이 브라우저에서는 저장 폴더 선택을 지원하지 않습니다. 기본 다운로드 폴더에 저장됩니다.')
      return
    }
    try {
      const directory = await picker()
      setBackupDirectory(directory)
      setMessage('')
      setError('')
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return
      setError(caught instanceof Error ? caught.message : '저장 위치를 선택하지 못했습니다.')
    }
  }

  async function saveLocalBackup(kind: 'json' | 'excel', quiet = false) {
    const safePeriodName = sanitizePeriodName(periodName)
    if (!safePeriodName) {
      setError('평가기간명을 입력하세요.')
      return false
    }
    const filename = kind === 'json' ? `${safePeriodName}_성장관리_data.json` : `${safePeriodName}_성과관리.xlsx`
    const blob = kind === 'json'
      ? backupToJsonBlob(createFullBackupEnvelope(state, periodName.trim()))
      : workbookToBlob(createFullBackupWorkbook(state, periodName.trim()))
    if (!backupDirectory) {
      downloadBlob(blob, filename)
      if (!quiet) setMessage(`${filename} 파일을 기본 다운로드 폴더에 저장했습니다.`)
      return true
    }
    try {
      const file = await backupDirectory.getFileHandle(filename, { create: true })
      const writable = await file.createWritable()
      await writable.write(blob)
      await writable.close()
      if (!quiet) setMessage(`${backupDirectory.name}/${filename} 저장 완료`)
      setError('')
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '백업 파일을 저장하지 못했습니다.')
      return false
    }
  }

  async function saveSelectedLocalBackups() {
    const selected = (Object.entries(localFormats) as Array<['json' | 'excel', boolean]>).filter(([, checked]) => checked).map(([kind]) => kind)
    if (selected.length === 0) {
      setError('백업할 파일 형식을 하나 이상 선택하세요.')
      return
    }
    setError('')
    const results = await Promise.all(selected.map((kind) => saveLocalBackup(kind, true)))
    const saved = selected.filter((_, index) => results[index])
    if (saved.length > 0) setMessage(`${saved.map((kind) => kind === 'json' ? 'JSON' : 'Excel').join(' · ')} 백업을 완료했습니다.`)
  }

  return (
    <div className="ui-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="drive-dialog-title">
      <div className="ui-modal-panel flex h-[min(780px,calc(100vh-2rem))] max-w-5xl flex-col overflow-hidden">
        <div className="flex shrink-0 items-start justify-between gap-4">
          <div>
            <h3 id="drive-dialog-title" className="ui-modal-title">데이터 백업</h3>
            <p className="mt-1 text-sm text-gray-600">현재 평가 프로젝트의 전체 데이터를 백업하거나 이전 백업으로 복원합니다.</p>
          </div>
          <ModalCloseButton onClick={onClose} label="데이터 백업 닫기" />
        </div>

        <div className="mt-5 flex shrink-0 items-center border-y border-gray-200 px-2" role="tablist" aria-label="데이터 백업 방식">
          <button type="button" role="tab" aria-selected={activeTab === 'local'} onClick={() => setActiveTab('local')} className={`inline-flex h-[62px] items-center gap-2 border-b-2 px-4 text-sm font-medium transition ${activeTab === 'local' ? 'border-gray-950 text-gray-950' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
            로컬 파일
          </button>
          <button type="button" role="tab" aria-selected={activeTab === 'drive'} onClick={() => setActiveTab('drive')} className={`inline-flex h-[62px] items-center gap-2 border-b-2 px-4 text-sm font-medium transition ${activeTab === 'drive' ? 'border-gray-950 text-gray-950' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none"><path d="M8.2 4h5.1l6.2 10.7H14.4z" fill="#FBBC04"/><path d="M8.2 4 2.5 14l2.6 4.5L10.8 8.6z" fill="#0F9D58"/><path d="M5.1 18.5h11.5l2.9-3.8H8z" fill="#4285F4"/></svg>
            Google Drive
          </button>
          <button type="button" role="tab" aria-selected={activeTab === 'reset'} onClick={() => setActiveTab('reset')} className={`ml-auto inline-flex h-[62px] items-center border-b-2 px-4 text-sm font-semibold transition ${activeTab === 'reset' ? 'border-red-500 text-[#c84b31]' : 'border-transparent text-gray-400 hover:text-[#c84b31]'}`}>데이터 초기화</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {activeTab === 'drive' && !isGoogleDriveConfigured() && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Google Cloud OAuth Client ID를 `VITE_GOOGLE_CLIENT_ID` 환경변수에 설정해야 연결할 수 있습니다.
          </div>
        )}

        {activeTab === 'local' ? (
          <div className="mx-auto mt-5 w-full max-w-4xl space-y-4 px-1">
            <section className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"><div className="min-w-0"><h4 className="ui-section-title">저장 위치</h4>{backupDirectory ? <p className="mt-1 truncate text-sm font-medium text-success" title={`브라우저 보안상 상위 폴더 경로는 표시되지 않습니다. 선택 폴더: ${backupDirectory.name}`}><span className="text-gray-400">내 컴퓨터 › … › </span>{backupDirectory.name}</p> : <p className="ui-section-description">지정하지 않으면 브라우저 기본 다운로드 폴더에 저장됩니다.</p>}</div><button type="button" onClick={() => { void chooseBackupDirectory() }} className="ui-button ui-button-secondary">위치 지정</button></section>
            <section className="space-y-4 rounded-lg border border-gray-200 p-4"><div><h4 className="ui-section-title">지금 데이터 백업</h4><p className="ui-section-description">현재 계정에 저장된 모든 팀·프로젝트 데이터를 선택한 형식으로 함께 내보냅니다.</p></div><div><label htmlFor="local-period-name" className="ui-label">평가기간명</label><input id="local-period-name" value={periodName} onChange={(event) => onPeriodNameChange(event.target.value)} className="ui-field" /></div><fieldset><legend className="ui-label">백업 파일</legend><div className="mt-2 flex flex-wrap gap-x-6 gap-y-2"><label className="flex cursor-pointer items-center gap-2 text-sm text-gray-900"><input type="checkbox" checked={localFormats.json} onChange={(event) => setLocalFormats((current) => ({ ...current, json: event.target.checked }))} className="h-4 w-4 accent-[#d4772c]" />JSON <span className="text-xs text-gray-500">복원용 원본</span></label><label className="flex cursor-pointer items-center gap-2 text-sm text-gray-900"><input type="checkbox" checked={localFormats.excel} onChange={(event) => setLocalFormats((current) => ({ ...current, excel: event.target.checked }))} className="h-4 w-4 accent-[#d4772c]" />Excel <span className="text-xs text-gray-500">확인·보관용</span></label></div></fieldset><button type="button" onClick={() => { void saveSelectedLocalBackups() }} disabled={busy || (!localFormats.json && !localFormats.excel)} className="ui-button ui-button-primary">선택 항목 백업</button></section>
            <section className="space-y-3 rounded-lg border border-gray-200 p-4"><div><h4 className="ui-section-title">백업 파일 복원</h4><p className="ui-section-description">이 앱에서 내려받은 JSON 백업으로 현재 프로젝트를 복원합니다.</p></div><input ref={restoreInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => { void handleLocalRestore(event.target.files?.[0]); event.target.value = '' }} /><button type="button" onClick={() => restoreInputRef.current?.click()} disabled={busy} className="ui-button ui-button-secondary">JSON 백업 선택</button></section>
            <div className="rounded-md bg-gray-50 px-4 py-3 text-sm text-gray-600">현재 데이터: 과제 {state.tasks.length}개 · 팀원 {state.members.length}명 · 피어리뷰 {state.peerReviews.length}건</div>
          </div>
        ) : activeTab === 'drive' ? <div className="mx-auto mt-5 w-full max-w-4xl px-1">
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
        </div> : <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-8">
          <section className="rounded-xl border border-[#f3d0d0] bg-[#faf0f0] p-6">
            <h4 className="text-base font-bold text-[#c84b31]">전체 데이터 초기화</h4>
            <div className="mt-5 text-sm leading-6 text-gray-900"><p><strong className="text-[#c84b31]">이 브라우저에 저장된 모든 팀·프로젝트 데이터</strong><span className="text-[#c84b31]">가 삭제됩니다.</span></p><p className="text-[#c84b31]">(지금 열려 있는 프로젝트 하나가 아닙니다.)</p><p>브라우저 저장소만 지우므로 다른 기기나 브라우저의 데이터에는 영향이 없지만, 이 브라우저에서는 되돌릴 수 없습니다.</p><p className="text-[#c84b31]">아래에서 먼저 백업하세요.</p></div>
            <div className="mt-5 border-t border-[#f3d0d0] pt-5"><div className="flex flex-wrap gap-3"><button type="button" onClick={() => { void saveLocalBackup('json') }} className="ui-button ui-button-secondary">로컬 파일로 백업 (JSON)</button><button type="button" onClick={() => { void saveLocalBackup('excel') }} className="ui-button ui-button-secondary">엑셀로 백업</button></div><p className="mt-4 text-xs leading-5 text-gray-600">JSON 백업은 그대로 복원할 수 있는 원본이고, Excel 백업은 사람이 보기 좋은 사본입니다(복원용 아님).</p></div>
          </section>
          <button type="button" onClick={() => setResetOpen(true)} className="ui-button ui-button-danger self-end px-6">전체 데이터 초기화</button>
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
