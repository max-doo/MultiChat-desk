import { app, BrowserWindow } from 'electron'
import type Store from 'electron-store'

export interface UpdateResult {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string
  releaseUrl: string
}

export type UpdateStatus = 'idle' | 'checking' | 'ready' | 'error'

export interface UpdateState {
  status: UpdateStatus
  result?: UpdateResult
  lastAttemptAt?: number
  lastSuccessAt?: number
  error?: string
}

export interface UpdateCheckResponse {
  success: boolean
  data?: UpdateState
  error?: string
}

interface PersistedUpdateState {
  result?: UpdateResult
  lastAttemptAt?: number
  lastSuccessAt?: number
  error?: string
}

const GITHUB_API_URL = 'https://api.github.com/repos/max-doo/MultiChat-desk/releases/latest'
const GITHUB_LATEST_URL = 'https://github.com/max-doo/MultiChat-desk/releases/latest'
const UPDATE_CACHE_KEY = 'updateCheckCache'
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const STARTUP_DELAY_MS = 3000
const REQUEST_TIMEOUT_MS = 10000

let store: Store<Record<string, unknown>> | null = null
let getMainWindow: (() => BrowserWindow | null) | null = null
let initialized = false
let inFlight: Promise<UpdateCheckResponse> | null = null
let state: UpdateState = { status: 'idle' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseUpdateResult(value: unknown): UpdateResult | undefined {
  if (!isRecord(value)) return undefined
  if (
    typeof value.hasUpdate !== 'boolean' ||
    typeof value.currentVersion !== 'string' ||
    typeof value.latestVersion !== 'string' ||
    typeof value.releaseUrl !== 'string'
  ) {
    return undefined
  }

  return {
    hasUpdate: value.hasUpdate,
    currentVersion: value.currentVersion,
    latestVersion: value.latestVersion,
    releaseUrl: value.releaseUrl
  }
}

function reconcileResultWithCurrentVersion(result: UpdateResult | undefined): UpdateResult | undefined {
  if (!result) return undefined

  const currentVersion = normalizeVersion(app.getVersion())
  const latestVersion = normalizeVersion(result.latestVersion)
  if (!currentVersion || !latestVersion) return result

  return {
    ...result,
    currentVersion,
    latestVersion,
    hasUpdate: isLaterVersion(currentVersion, latestVersion)
  }
}

function loadState(): UpdateState {
  if (!store) return { status: 'idle' }

  const cached = store.get(UPDATE_CACHE_KEY)
  if (!isRecord(cached)) return { status: 'idle' }

  const result = reconcileResultWithCurrentVersion(parseUpdateResult(cached.result))
  const error = typeof cached.error === 'string' ? cached.error : undefined

  return {
    status: error ? 'error' : result ? 'ready' : 'idle',
    result,
    lastAttemptAt: isFiniteNumber(cached.lastAttemptAt) ? cached.lastAttemptAt : undefined,
    lastSuccessAt: isFiniteNumber(cached.lastSuccessAt) ? cached.lastSuccessAt : undefined,
    error
  }
}

function persistState(): void {
  if (!store) return

  const cached: PersistedUpdateState = {
    lastAttemptAt: state.lastAttemptAt,
    lastSuccessAt: state.lastSuccessAt
  }
  if (state.result) cached.result = state.result
  if (state.error) cached.error = state.error
  store.set(UPDATE_CACHE_KEY, cached)
}

function cloneState(): UpdateState {
  return {
    ...state,
    result: state.result ? { ...state.result } : undefined
  }
}

function broadcastState(): void {
  const window = getMainWindow?.()
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
  window.webContents.send('update:state', cloneState())
}

function normalizeVersion(raw: string): string | null {
  const normalized = raw.trim().replace(/^v/i, '')
  const parts = normalized.split('.')
  if (parts.length !== 3 || parts.some((part) => !/^\d+$/.test(part))) return null
  return normalized
}

function isLaterVersion(current: string, latest: string): boolean {
  const currentParts = current.split('.').map(Number)
  const latestParts = latest.split('.').map(Number)

  for (let index = 0; index < 3; index += 1) {
    if (latestParts[index] > currentParts[index]) return true
    if (latestParts[index] < currentParts[index]) return false
  }
  return false
}

function isReleaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'github.com'
  } catch {
    return false
  }
}

function getFailureMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') {
    return '检查超时，请稍后重试'
  }
  return '检查失败，请检查网络后重试'
}

interface LatestRelease {
  tagName: string
  releaseUrl: string
}

async function fetchLatestRelease(signal: AbortSignal): Promise<LatestRelease> {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'MultiChat-Desk'
  }
  const response = await fetch(GITHUB_API_URL, { headers, signal })

  if (response.status === 403) {
    // API 未认证限流时，使用 GitHub 的 latest 页面重定向获取同一正式 Release。
    const redirectResponse = await fetch(GITHUB_LATEST_URL, {
      headers: { 'User-Agent': 'MultiChat-Desk' },
      signal
    })
    if (!redirectResponse.ok) throw new Error('UPDATE_RATE_LIMITED')

    const releaseUrl = redirectResponse.url
    const pathname = new URL(releaseUrl).pathname
    const tagMatch = pathname.match(/\/releases\/tag\/([^/]+)\/?$/i)
    if (!tagMatch) throw new Error('UPDATE_INVALID_RESPONSE')

    return {
      tagName: decodeURIComponent(tagMatch[1]),
      releaseUrl
    }
  }

  if (!response.ok) throw new Error('UPDATE_HTTP_ERROR')

  const json: unknown = await response.json()
  if (!isRecord(json)) throw new Error('UPDATE_INVALID_RESPONSE')

  const tagName = json.tag_name
  const releaseUrl = json.html_url
  if (
    typeof tagName !== 'string' ||
    typeof releaseUrl !== 'string' ||
    !isReleaseUrl(releaseUrl)
  ) {
    throw new Error('UPDATE_INVALID_RESPONSE')
  }

  return { tagName, releaseUrl }
}

async function runCheck(): Promise<UpdateCheckResponse> {
  const attemptAt = Date.now()
  state = {
    ...state,
    status: 'checking',
    lastAttemptAt: attemptAt,
    error: undefined
  }
  persistState()
  broadcastState()

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const release = await fetchLatestRelease(controller.signal)

    const currentVersion = normalizeVersion(app.getVersion())
    const latestVersion = normalizeVersion(release.tagName)
    if (!currentVersion || !latestVersion) {
      throw new Error('UPDATE_INVALID_VERSION')
    }

    state = {
      status: 'ready',
      result: {
        hasUpdate: isLaterVersion(currentVersion, latestVersion),
        currentVersion,
        latestVersion,
        releaseUrl: release.releaseUrl
      },
      lastAttemptAt: attemptAt,
      lastSuccessAt: Date.now()
    }
    persistState()
    broadcastState()
    return { success: true, data: cloneState() }
  } catch (error: unknown) {
    const message = error instanceof Error && error.message === 'UPDATE_RATE_LIMITED'
      ? '更新服务繁忙，请稍后再试'
      : getFailureMessage(error)

    state = {
      ...state,
      status: 'error',
      lastAttemptAt: attemptAt,
      error: message
    }
    persistState()
    broadcastState()
    return { success: false, data: cloneState(), error: message }
  } finally {
    clearTimeout(timeout)
  }
}

export function initUpdateChecker(
  updateStore: Store<Record<string, unknown>>,
  mainWindowGetter: () => BrowserWindow | null
): void {
  if (initialized) return

  initialized = true
  store = updateStore
  getMainWindow = mainWindowGetter
  state = loadState()
  // 应用版本可能在缓存有效期内发生变化，启动时将缓存结果按当前版本校正。
  persistState()

  setTimeout(() => {
    void checkForUpdate()
  }, STARTUP_DELAY_MS)
}

export function getUpdateState(): UpdateState {
  return cloneState()
}

export function checkForUpdate(force = false): Promise<UpdateCheckResponse> {
  if (!store) {
    return Promise.resolve({ success: false, error: '更新检查服务未初始化' })
  }

  const lastAttemptAt = state.lastAttemptAt
  if (!force && lastAttemptAt && Date.now() - lastAttemptAt < CHECK_INTERVAL_MS) {
    return Promise.resolve({ success: true, data: getUpdateState() })
  }

  if (inFlight) return inFlight

  inFlight = runCheck().finally(() => {
    inFlight = null
  })
  return inFlight
}
