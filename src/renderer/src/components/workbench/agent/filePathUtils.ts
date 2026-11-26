/**
 * 工具调用/文件变更卡片共享的路径换算：
 * 把 pi-agent 上报的 path（可能为绝对路径、~ 开头或 cwd 相对路径）
 * 归一到当前工作台 workspace 的相对 POSIX 路径，供 openFile/侧边栏定位使用。
 */

export function resolveAbsolute(cwd: string, filePath: string): string {
  // filePath may already be absolute on Windows (C:\...) or POSIX (/...).
  if (/^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('/')) return filePath
  if (filePath === '~' || filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    // Renderer can't resolve ~ without IPC; leave as cwd-relative — the
    // main process' snapshot logic uses the same relative form so hashes
    // still match. Only the "open folder" action may misbehave; acceptable.
    return filePath
  }
  const sep = cwd.includes('\\') ? '\\' : '/'
  return `${cwd.replace(/[\\/]+$/, '')}${sep}${filePath}`
}

export function normalizePath(p: string | null | undefined): string {
  if (!p) return ''
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** 按"绝对路径归一化"去重，保序返回首个出现的条目。 */
export function dedupePathsByAbsolute(paths: string[], cwd?: string | null): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const base = (cwd ?? '').trim()
  for (const raw of paths) {
    if (!raw) continue
    const abs = base ? resolveAbsolute(base, raw) : raw
    const key = normalizePath(abs)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(raw)
  }
  return out
}

/**
 * 按"绝对路径归一化"对 T 数组去重（以 mapKey 提取的路径字符串为准），
 * 保序返回首个出现的元素。
 */
export function dedupeByKey<T>(items: T[], mapKey: (item: T) => string, cwd?: string | null): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  const base = (cwd ?? '').trim()
  for (const item of items) {
    const raw = mapKey(item)
    if (!raw) continue
    const abs = base ? resolveAbsolute(base, raw) : raw
    const key = normalizePath(abs)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

/** Convert a tool-reported path to a workspace-relative POSIX path, or null
 *  when the file lives outside the current workspace. */
export function toWorkspaceRelative(
  workspacePath: string,
  cwd: string,
  filePath: string
): string | null {
  const ws = normalizePath(workspacePath)
  if (!ws) return null
  const isAbsolute = /^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('/')
  if (isAbsolute) {
    const absNorm = normalizePath(filePath)
    if (absNorm === ws) return null
    if (absNorm.startsWith(`${ws}/`)) {
      // 用原始（统一分隔符、未 lower）路径切片，保留文件树 node.path 的
      // 真实大小写 —— openFile 的 activeFilePath 与树高亮严格相等匹配。
      const absRaw = filePath.replace(/\\/g, '/').replace(/\/+$/, '')
      return absRaw.slice(ws.length + 1)
    }
    return null
  }
  // Relative path: resolve against the session cwd, then require it to land
  // inside the workspace.
  const resolved = resolveAbsolute(cwd, filePath)
  const absNorm = normalizePath(resolved)
  if (absNorm.startsWith(`${ws}/`)) {
    const absRaw = resolved.replace(/\\/g, '/').replace(/\/+$/, '')
    return absRaw.slice(ws.length + 1)
  }
  return null
}

/**
 * mentionFile / applyAtMention 共用的 token 换算：
 * 工作区内文件用相对路径（与 @-mention 一致），工作区外用绝对路径。
 */
export function toMentionToken(absPath: string, workspacePath: string | null | undefined): string {
  if (!absPath) return ''
  const normWs = (workspacePath ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
  const normAbs = absPath.replace(/\\/g, '/')
  if (normWs && normAbs.startsWith(`${normWs}/`)) {
    return normAbs.slice(normWs.length + 1)
  }
  return absPath
}

/** composerInput 中是否已存在指向同一路径的 `@token`（区分 @abs 与 @rel）。 */
export function isFileMentioned(
  input: string,
  absPath: string,
  workspacePath: string | null | undefined
): boolean {
  if (!input || !absPath) return false
  const abs = absPath.replace(/\\/g, '/')
  const rel = toMentionToken(absPath, workspacePath)
  const candidates = rel !== abs ? [rel, abs] : [abs]
  return candidates.some((token) => input.includes(`@${token}`))
}

/**
 * 从输入框文本中移除指向某文件的所有 `@token`（相对路径与绝对路径两种形态）。
 * 返回清理后的文本；未命中时返回原文本。
 */
export function removeFileMention(
  input: string,
  absPath: string,
  workspacePath: string | null | undefined
): string {
  if (!input || !absPath) return input
  const abs = absPath.replace(/\\/g, '/')
  const rel = toMentionToken(absPath, workspacePath)
  const candidates = rel !== abs ? [rel, abs] : [abs]
  let out = input
  for (const token of candidates) {
    // token 中可能含正则特殊字符（\ . ~ 等），先做转义再匹配。
    const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`@${esc}\\s*`, 'g'), '')
  }
  // 连续空格收敛 + 首尾 trim；不去触碰非 token 部分的语义空白。
  return out.replace(/[ \t]{2,}/g, ' ').replace(/^[ \t]+|[ \t]+$/g, '')
}

/**
 * 从输入框文本中提取当前所有 @token 原始字面值。
 * 与 applyAtMention / mentionFile 的落盘格式一致：token 可能为
 * `path/to/file.md`（相对）或 `D:\foo\bar.md`（绝对）。
 */
const MENTION_TOKEN_RE = /@([^\s@]+)/g
export function extractMentionTokens(input: string): string[] {
  if (!input) return []
  const tokens: string[] = []
  for (const m of input.matchAll(MENTION_TOKEN_RE)) {
    tokens.push(m[1])
  }
  return tokens
}

/**
 * 判断某个 @token 字面值是否指向给定绝对路径。
 * 工作区内文件既可能以绝对路径（D:\w\foo.md）也可能以相对路径（foo.md）出现。
 */
export function mentionTokenMatchesPath(
  token: string,
  absPath: string,
  workspacePath: string | null | undefined
): boolean {
  if (!token || !absPath) return false
  const absNorm = normalizePath(absPath)
  const tokenNorm = normalizePath(token)
  if (!absNorm || !tokenNorm) return false
  if (tokenNorm === absNorm) return true
  const ws = normalizePath(workspacePath)
  if (ws) {
    // token 是工作区内相对路径：resolveAbsolute 后应等于 absPath。
    const resolved = normalizePath(`${ws}/${tokenNorm}`)
    if (resolved === absNorm) return true
  }
  return false
}

/**
 * Agent 侧栏文件 chip 统一的点击打开语义：
 * - 普通点击走预览标签（与文件树单击一致），连续查看多个文件复用同一个
 *   预览槽位，不刷屏标签栏；编辑内容后预览自动转正。
 * - Ctrl/Cmd+点击或中键点击表示明确的新标签意图，走常驻标签。
 */
export function agentChipOpenOptions(e: {
  ctrlKey: boolean
  metaKey: boolean
  button: number
}): { preview: true } | { forcePermanent: true } {
  return e.ctrlKey || e.metaKey || e.button === 1
    ? { forcePermanent: true }
    : { preview: true }
}
