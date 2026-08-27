import type { AppState, WorkspaceState } from '../types'
import {
  backupToJsonBlob,
  createFullBackupEnvelope,
  createFullBackupWorkbook,
  parseFullBackupJson,
  sanitizePeriodName,
  workbookToBlob,
} from './fullBackup'
import { evaluationPeriodFolderName, migrateWorkspace } from './workspace'

const GOOGLE_SCOPE = 'openid email https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar'
const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet'
const APP_ID = 'performance-management-pwa-v3'
const GOOGLE_SESSION_KEY = 'performance-management-v3-google-session'
const GOOGLE_CONNECTION_HINT_KEY = 'performance-management-v3-google-connected'
const GOOGLE_ACCOUNT_KEY = 'performance-management-v3-google-account'

interface StoredGoogleSession {
  accessToken: string
  expiresAt: number
  email: string
}

function readStoredGoogleSession(): StoredGoogleSession | null {
  try {
    const raw = sessionStorage.getItem(GOOGLE_SESSION_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<StoredGoogleSession>
    if (!value.accessToken || !value.email || !value.expiresAt || value.expiresAt <= Date.now() + 60_000) {
      sessionStorage.removeItem(GOOGLE_SESSION_KEY)
      return null
    }
    return value as StoredGoogleSession
  } catch {
    return null
  }
}

const storedGoogleSession = readStoredGoogleSession()
let accessToken = storedGoogleSession?.accessToken ?? ''
let accessTokenExpiresAt = storedGoogleSession?.expiresAt ?? 0
let tokenClient: GoogleTokenClient | null = null
let connectedAccount: GoogleAccount | null = storedGoogleSession ? { email: storedGoogleSession.email } : null

export interface GoogleAccount {
  email: string
}

interface GoogleTokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface GoogleTokenClient {
  requestAccessToken: (options?: { prompt?: string }) => void
}

interface GoogleIdentityServices {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string
        scope: string
        callback: (response: GoogleTokenResponse) => void
        error_callback?: (error: unknown) => void
      }) => GoogleTokenClient
      revoke: (token: string, callback?: () => void) => void
    }
  }
}

declare global {
  interface Window {
    google?: GoogleIdentityServices
  }
}

interface DriveFile {
  id: string
  name: string
  mimeType: string
  createdTime?: string
  modifiedTime?: string
  webViewLink?: string
  appProperties?: Record<string, string>
}

interface DriveListResponse {
  files: DriveFile[]
}

export interface SavedDriveBackup {
  id: string
  name: string
  periodName: string
  createdTime: string
  modifiedTime: string
  status: '정상'
  webViewLink?: string
}

export interface DriveSaveResult {
  rootFolder: DriveFile
  periodFolder: DriveFile
  excelFile: DriveFile
  jsonFile: DriveFile
  sheetFile: DriveFile
}

export async function getEvaluationDriveFolder(periodName: string, teamName?: string): Promise<DriveFile> {
  const safePeriodName = sanitizePeriodName(periodName)
  if (!safePeriodName) throw new Error('평가기간명을 입력하세요.')
  const rootFolder = await findOrCreateFolder('성장관리', null, 'root-folder')
  const parentFolder = teamName
    ? await findOrCreateFolder(sanitizePeriodName(teamName), rootFolder.id, 'team-folder')
    : rootFolder
  return findOrCreateFolder(safePeriodName, parentFolder.id, 'period-folder', periodName.trim())
}

function loadIdentityScript(): Promise<void> {
  if (window.google?.accounts.oauth2) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity-services]')
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Google 인증 모듈을 불러오지 못했습니다.')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.dataset.googleIdentityServices = 'true'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Google 인증 모듈을 불러오지 못했습니다.'))
    document.head.appendChild(script)
  })
}

export function isGoogleDriveConfigured(): boolean {
  return Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID)
}

export function isGoogleDriveConnected(): boolean {
  if (!accessToken || accessTokenExpiresAt <= Date.now() + 60_000) {
    accessToken = ''
    accessTokenExpiresAt = 0
    connectedAccount = null
    try { sessionStorage.removeItem(GOOGLE_SESSION_KEY) } catch { /* Ignore unavailable storage. */ }
    return false
  }
  return true
}

export function hasGoogleDriveConnectionHint(): boolean {
  try { return localStorage.getItem(GOOGLE_CONNECTION_HINT_KEY) === '1' } catch { return false }
}

export function getRememberedGoogleAccount(): GoogleAccount | null {
  try {
    const email = localStorage.getItem(GOOGLE_ACCOUNT_KEY)?.trim()
    return email ? { email } : null
  } catch {
    return null
  }
}

export function getConnectedGoogleAccount(): GoogleAccount | null {
  return connectedAccount
}

export async function connectGoogleDrive(prompt: 'consent' | 'select_account' | '' = 'consent', rememberConnection = true): Promise<void> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID가 설정되지 않았습니다.')
  await loadIdentityScript()
  if (!window.google) throw new Error('Google 인증 모듈을 초기화하지 못했습니다.')

  await new Promise<void>((resolve, reject) => {
    tokenClient = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SCOPE,
      callback: (response) => {
        if (!response.access_token) {
          reject(new Error(response.error_description || response.error || 'Google Drive 연결에 실패했습니다.'))
          return
        }
        accessToken = response.access_token
        accessTokenExpiresAt = Date.now() + (response.expires_in ?? 3600) * 1000
        fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
          .then(async (accountResponse) => {
            if (!accountResponse.ok) throw new Error('Google 계정 정보를 확인하지 못했습니다.')
            const account = await accountResponse.json() as { email?: string }
            if (!account.email) throw new Error('Google 계정 이메일을 확인하지 못했습니다.')
            connectedAccount = { email: account.email }
            try {
              if (rememberConnection) {
                sessionStorage.setItem(GOOGLE_SESSION_KEY, JSON.stringify({ accessToken, expiresAt: accessTokenExpiresAt, email: account.email }))
                localStorage.setItem(GOOGLE_CONNECTION_HINT_KEY, '1')
                localStorage.setItem(GOOGLE_ACCOUNT_KEY, account.email)
              } else {
                sessionStorage.removeItem(GOOGLE_SESSION_KEY)
                localStorage.removeItem(GOOGLE_CONNECTION_HINT_KEY)
                localStorage.removeItem(GOOGLE_ACCOUNT_KEY)
              }
            } catch { /* Connection still works when storage is unavailable. */ }
            resolve()
          })
          .catch((error) => {
            accessToken = ''
            accessTokenExpiresAt = 0
            reject(error)
          })
      },
      error_callback: () => reject(new Error('Google 로그인이 취소되었거나 실패했습니다.')),
    })
    tokenClient.requestAccessToken({ prompt })
  })
}

export function disconnectGoogleDrive() {
  if (accessToken && window.google) window.google.accounts.oauth2.revoke(accessToken)
  accessToken = ''
  accessTokenExpiresAt = 0
  tokenClient = null
  connectedAccount = null
  try {
    sessionStorage.removeItem(GOOGLE_SESSION_KEY)
    localStorage.removeItem(GOOGLE_CONNECTION_HINT_KEY)
  } catch { /* Ignore unavailable storage. */ }
}

async function driveFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  if (!accessToken) throw new Error('먼저 Google Drive를 연결하세요.')
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers || {}),
    },
  })
  if (!response.ok) {
    if (response.status === 401) accessToken = ''
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new Error(body?.error?.message || `Google Drive 요청에 실패했습니다. (${response.status})`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export async function googleAuthorizedFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  if (!accessToken) throw new Error('먼저 Google 계정을 연결하세요.')
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new Error(body?.error?.message || `Google API 요청에 실패했습니다. (${response.status})`)
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}

function escapeQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

async function listFiles(query: string): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    q: `${query} and trashed = false`,
    spaces: 'drive',
    pageSize: '100',
    orderBy: 'modifiedTime desc',
    fields: 'files(id,name,mimeType,createdTime,modifiedTime,webViewLink,appProperties)',
  })
  const result = await driveFetch<DriveListResponse>(`${DRIVE_API}/files?${params}`)
  return result.files
}

async function createFolder(name: string, parentId: string | null, kind: string, periodName = ''): Promise<DriveFile> {
  return driveFetch<DriveFile>(`${DRIVE_API}/files?fields=id,name,mimeType,createdTime,modifiedTime,webViewLink,appProperties`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      ...(parentId ? { parents: [parentId] } : {}),
      appProperties: { appId: APP_ID, kind, ...(periodName ? { periodName } : {}) },
    }),
  })
}

async function findOrCreateFolder(name: string, parentId: string | null, kind: string, periodName = '') {
  const parentQuery = parentId ? `'${escapeQueryValue(parentId)}' in parents` : "'root' in parents"
  const files = await listFiles(
    `mimeType = '${FOLDER_MIME}' and name = '${escapeQueryValue(name)}' and ${parentQuery} and appProperties has { key='appId' and value='${APP_ID}' } and appProperties has { key='kind' and value='${escapeQueryValue(kind)}' }`,
  )
  return files[0] ?? createFolder(name, parentId, kind, periodName)
}

async function uploadFile(
  metadata: Record<string, unknown>,
  content: Blob,
  existingId?: string,
): Promise<DriveFile> {
  const boundary = `codex-v3-${crypto.randomUUID()}`
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${content.type || 'application/octet-stream'}\r\n\r\n`,
    content,
    `\r\n--${boundary}--`,
  ], { type: `multipart/related; boundary=${boundary}` })
  const path = existingId ? `${DRIVE_UPLOAD_API}/files/${existingId}` : `${DRIVE_UPLOAD_API}/files`
  return driveFetch<DriveFile>(`${path}?uploadType=multipart&fields=id,name,mimeType,createdTime,modifiedTime,webViewLink,appProperties`, {
    method: existingId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
}

async function findManagedFile(parentId: string, kind: string): Promise<DriveFile | undefined> {
  const files = await listFiles(
    `'${escapeQueryValue(parentId)}' in parents and appProperties has { key='appId' and value='${APP_ID}' } and appProperties has { key='kind' and value='${escapeQueryValue(kind)}' }`,
  )
  return files[0]
}

function versionSuffix() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

export async function saveFullBackupToDrive(
  state: AppState,
  periodName: string,
  mode: 'update' | 'version',
  teamName?: string,
): Promise<DriveSaveResult> {
  const safePeriodName = sanitizePeriodName(periodName)
  if (!safePeriodName) throw new Error('평가기간명을 입력하세요.')

  const rootFolder = await findOrCreateFolder('성장관리', null, 'root-folder')
  const parentFolder = teamName
    ? await findOrCreateFolder(sanitizePeriodName(teamName), rootFolder.id, 'team-folder')
    : rootFolder
  const periodFolder = await findOrCreateFolder(safePeriodName, parentFolder.id, 'period-folder', periodName.trim())
  await findOrCreateFolder('개인리포트', periodFolder.id, 'personal-reports-folder', periodName.trim())

  const workbookBlob = workbookToBlob(createFullBackupWorkbook(state, periodName.trim()))
  const backup = createFullBackupEnvelope(state, periodName.trim())
  const jsonBlob = backupToJsonBlob(backup)
  const suffix = mode === 'version' ? `_${versionSuffix()}` : ''
  const commonProperties = { appId: APP_ID, periodName: periodName.trim() }

  const existingExcel = mode === 'update' ? await findManagedFile(periodFolder.id, 'backup-xlsx') : undefined
  const excelFile = await uploadFile(
    {
      name: `${safePeriodName}_성과관리${suffix}.xlsx`,
      mimeType: workbookBlob.type,
      parents: existingExcel ? undefined : [periodFolder.id],
      appProperties: { ...commonProperties, kind: 'backup-xlsx' },
    },
    workbookBlob,
    existingExcel?.id,
  )

  const existingJson = mode === 'update' ? await findManagedFile(periodFolder.id, 'backup-json') : undefined
  const jsonFile = await uploadFile(
    {
      name: `${safePeriodName}_성장관리_data${suffix}.json`,
      mimeType: 'application/json',
      parents: existingJson ? undefined : [periodFolder.id],
      appProperties: { ...commonProperties, kind: 'backup-json', schemaVersion: String(backup.schemaVersion) },
    },
    jsonBlob,
    existingJson?.id,
  )

  const existingSheet = mode === 'update' ? await findManagedFile(periodFolder.id, 'backup-sheet') : undefined
  const sheetFile = await uploadFile(
    {
      name: `${safePeriodName}_성과관리_GoogleSheet${suffix}`,
      mimeType: SHEET_MIME,
      parents: existingSheet ? undefined : [periodFolder.id],
      appProperties: { ...commonProperties, kind: 'backup-sheet' },
    },
    workbookBlob,
    existingSheet?.id,
  )

  return { rootFolder, periodFolder, excelFile, jsonFile, sheetFile }
}

export async function loadWorkspaceFromDrive(): Promise<WorkspaceState | null> {
  const rootFolder = await findOrCreateFolder('성장관리', null, 'root-folder')
  const file = await findManagedFile(rootFolder.id, 'workspace-index')
  if (!file) return null
  const response = await fetch(`${DRIVE_API}/files/${encodeURIComponent(file.id)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new Error(`팀/평가 프로젝트 정보를 불러오지 못했습니다. (${response.status})`)
  return migrateWorkspace(await response.json())
}

export async function saveWorkspaceToDrive(workspace: WorkspaceState): Promise<void> {
  const rootFolder = await findOrCreateFolder('성장관리', null, 'root-folder')
  for (const team of workspace.teams) {
    const teamFolder = await findOrCreateFolder(sanitizePeriodName(team.name), rootFolder.id, 'team-folder')
    for (const project of workspace.projects.filter((item) => item.teamId === team.id)) {
      await findOrCreateFolder(
        sanitizePeriodName(evaluationPeriodFolderName(project.period)),
        teamFolder.id,
        'period-folder',
        evaluationPeriodFolderName(project.period),
      )
    }
  }
  const existing = await findManagedFile(rootFolder.id, 'workspace-index')
  const content = new Blob([JSON.stringify(workspace, null, 2)], { type: 'application/json' })
  await uploadFile(
    {
      name: 'workspace_data.json',
      mimeType: 'application/json',
      parents: existing ? undefined : [rootFolder.id],
      appProperties: { appId: APP_ID, kind: 'workspace-index', schemaVersion: String(workspace.schemaVersion) },
    },
    content,
    existing?.id,
  )
}

export async function listDriveBackups(): Promise<SavedDriveBackup[]> {
  const files = await listFiles(
    `appProperties has { key='appId' and value='${APP_ID}' } and appProperties has { key='kind' and value='backup-json' }`,
  )
  return files.map((file) => ({
    id: file.id,
    name: file.name,
    periodName: file.appProperties?.periodName || file.name.replace(/_성장관리_data.*\.json$/, ''),
    createdTime: file.createdTime || '',
    modifiedTime: file.modifiedTime || '',
    status: '정상',
    webViewLink: file.webViewLink,
  }))
}

export async function loadBackupFromDrive(fileId: string) {
  if (!accessToken) throw new Error('먼저 Google Drive를 연결하세요.')
  const response = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    if (response.status === 401) accessToken = ''
    throw new Error(`Drive 백업을 불러오지 못했습니다. (${response.status})`)
  }
  const text = await response.text()
  return parseFullBackupJson(text)
}
