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
    const abs = normalizePath(filePath)
    if (abs === ws) return null
    if (abs.startsWith(`${ws}/`)) {
      return abs.slice(ws.length + 1)
    }
    return null
  }
  // Relative path: resolve against the session cwd, then require it to land
  // inside the workspace.
  const abs = normalizePath(resolveAbsolute(cwd, filePath))
  if (abs.startsWith(`${ws}/`)) {
    return abs.slice(ws.length + 1)
  }
  return null
}
