import { app } from 'electron'

/**
 * 更新检查结果（纯提醒版：仅检测与提示，不下载不安装）
 */
export interface UpdateCheckResult {
  hasUpdate: boolean
  currentVersion: string // 去 v 前缀，如 "1.1.0"
  latestVersion: string // 去 v 前缀，如 "1.2.0"
  releaseUrl: string // GitHub Release HTML 页面 URL
  releaseNotes?: string // Release body（markdown 原文），可能为空
}

const GITHUB_API_URL = 'https://api.github.com/repos/max-doo/multichat/releases/latest'
const REQUEST_TIMEOUT_MS = 10000

/**
 * 去除版本号 v 前缀。仅支持 vX.Y.Z / X.Y.Z 三段格式。
 * 返回 null 表示格式异常。
 */
function normalizeVersion(raw: string): string | null {
  const cleaned = raw.trim().replace(/^v/i, '')
  const parts = cleaned.split('.')
  if (parts.length !== 3) return null
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null
  }
  return cleaned
}

/**
 * 三段 semver 数值比较。
 * 前提：current 与 latest 均已 normalize 通过（非 null）。
 * 返回 true 表示 latest 严格大于 current。
 */
function isLaterVersion(current: string, latest: string): boolean {
  const c = current.split('.').map(Number)
  const l = latest.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (l[i] > c[i]) return true
    if (l[i] < c[i]) return false
  }
  return false
}

/**
 * 查询 GitHub Releases 最新版本并与本地版本对比。
 * 网络/HTTP/解析错误统一封装为 { success: false, error }，不抛出。
 */
export async function checkForUpdate(): Promise<{
  success: boolean
  data?: UpdateCheckResult
  error?: string
}> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(GITHUB_API_URL, {
      headers: { 'User-Agent': 'MultiChat-Desk' },
      signal: controller.signal
    })

    if (response.status === 403) {
      return { success: false, error: '更新服务繁忙，请稍后再试' }
    }
    if (!response.ok) {
      return { success: false, error: '暂时无法获取更新信息' }
    }

    const json = (await response.json()) as {
      tag_name?: string
      html_url?: string
      body?: string
    }

    const tagName = json.tag_name
    const htmlUrl = json.html_url
    if (typeof tagName !== 'string' || typeof htmlUrl !== 'string') {
      return { success: false, error: '暂时无法获取更新信息' }
    }

    const currentVersion = normalizeVersion(app.getVersion())
    const latestVersion = normalizeVersion(tagName)
    if (currentVersion === null || latestVersion === null) {
      return { success: false, error: '暂时无法获取更新信息' }
    }

    return {
      success: true,
      data: {
        hasUpdate: isLaterVersion(currentVersion, latestVersion),
        currentVersion,
        latestVersion,
        releaseUrl: htmlUrl,
        releaseNotes:
          typeof json.body === 'string' && json.body.trim() ? json.body : undefined
      }
    }
  } catch (err) {
    // AbortController 触发或网络层错误均归为网络提示
    void err
    return { success: false, error: '检查失败，请检查网络后重试' }
  } finally {
    clearTimeout(timer)
  }
}
