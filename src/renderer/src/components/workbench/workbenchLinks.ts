import {
  CODE_EXTENSIONS,
  DOCUMENT_EXTENSIONS,
  IMAGE_EXTENSIONS,
  MARKDOWN_EXTENSIONS,
  PDF_EXTENSIONS,
  TEXT_EXTENSIONS
} from '../../../../shared/types/workbench'

const LOCAL_FILE_EXTENSIONS = new Set([
  ...MARKDOWN_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
  ...PDF_EXTENSIONS,
  ...DOCUMENT_EXTENSIONS,
  ...CODE_EXTENSIONS,
  ...TEXT_EXTENSIONS
])

const EXPLICIT_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i
const RELATIVE_PATH_RE = /^\.{1,2}[\\/]/
const WINDOWS_ABSOLUTE_RE = /^(?:[a-z]:[\\/]|\\\\)/i
const HOST_LIKE_SEGMENT_RE = /^[^/\\\s]+\.[^/\\\s]+$/

function hasKnownFileExtension(value: string): boolean {
  const pathPart = value.split(/[?#]/, 1)[0].replace(/\\/g, '/')
  const baseName = (pathPart.split('/').pop() || '').toLowerCase()
  if (baseName === 'dockerfile' || baseName.startsWith('.env')) return true
  const dot = baseName.lastIndexOf('.')
  return dot > 0 && LOCAL_FILE_EXTENSIONS.has(baseName.slice(dot))
}

/** 判断无协议的链接是否是工作区本地文件，而不是省略协议的网址。 */
export function isWorkbenchLocalFileLink(value: string): boolean {
  const link = value.trim()
  if (!link || link === 'about:blank') return false
  if (EXPLICIT_SCHEME_RE.test(link) || WINDOWS_ABSOLUTE_RE.test(link)) return false
  if (link.startsWith('#')) return false
  if (RELATIVE_PATH_RE.test(link)) return true
  if (!hasKnownFileExtension(link)) return false

  if (/[\\/]/.test(link)) {
    const firstSegment = link.split(/[\\/]/, 1)[0]
    if (HOST_LIKE_SEGMENT_RE.test(firstSegment)) return false
  }
  return true
}

/**
 * Markdown 与 Lexical 都会给无协议的普通文本补 `https://`。
 * 本地文件链接必须显式保持相对路径语义。
 */
export function normalizeWorkbenchLocalFileLink(value: string): string | null {
  const link = value.trim()
  if (!isWorkbenchLocalFileLink(link)) return null
  if (link.startsWith('/') || RELATIVE_PATH_RE.test(link)) return link
  return `./${link}`
}

/** 把相对当前文档的本地链接转换为工作区相对路径。 */
export function resolveWorkbenchLocalFileLink(
  value: string,
  activeFilePath: string | null
): string | null {
  const link = value.trim()
  if (!isWorkbenchLocalFileLink(link)) return null

  const pathPart = link.split(/[?#]/, 1)[0]
  let decoded = pathPart
  try {
    decoded = decodeURIComponent(pathPart)
  } catch {
    // 保留原始字符串，交给主进程的工作区路径校验处理
  }

  const normalized = decoded.replace(/\\/g, '/')
  const targetSegments = normalized.startsWith('/')
    ? []
    : activeFilePath?.includes('/')
      ? activeFilePath.slice(0, activeFilePath.lastIndexOf('/')).split('/').filter(Boolean)
      : []

  for (const segment of normalized.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (targetSegments.length === 0) return null
      targetSegments.pop()
      continue
    }
    targetSegments.push(segment)
  }

  return targetSegments.length ? targetSegments.join('/') : null
}

/** 悬停提示不展示为绕过 Lexical 归一化而临时添加的 `./` 前缀。 */
export function formatWorkbenchLinkDisplayUrl(value: string): string {
  return isWorkbenchLocalFileLink(value) ? value.replace(/^\.\/+/, '') : value
}
