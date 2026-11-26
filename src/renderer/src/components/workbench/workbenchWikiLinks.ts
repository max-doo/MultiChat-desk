import { MARKDOWN_EXTENSIONS, type WorkbenchFileNode } from '../../../../shared/types/workbench'

/** 双链目标解析结果：工作区相对路径，null 表示未找到 */
export interface WikiLinkResolution {
  path: string | null
  node: WorkbenchFileNode | null
}

/**
 * 解析 [[target]] 中的双链目标为工作区文件。
 * Obsidian 风格的最短路径语义：
 * 1. 精确匹配工作区相对路径（含扩展名），无扩展名时先补 .md / .markdown / .txt；
 * 2. 唯一文件名匹配；
 * 3. 多歧义时取路径最短者。
 */
export function resolveWikiLinkTarget(
  target: string,
  files: readonly WorkbenchFileNode[]
): WikiLinkResolution {
  const normalized = target.trim().replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '')
  if (!normalized) return { path: null, node: null }

  const lower = normalized.toLowerCase()
  const exact = files.find((f) => f.path.toLowerCase() === lower)
  if (exact) return { path: exact.path, node: exact }

  const hasExt = /\.[^./]+$/.test(normalized)
  if (!hasExt) {
    for (const ext of ['.md', '.markdown', '.txt']) {
      const withExt = files.find((f) => f.path.toLowerCase() === lower + ext)
      if (withExt) return { path: withExt.path, node: withExt }
    }
  }

  const baseName = lower.split('/').pop() || lower
  if (!hasExt) {
    // 目标无扩展名时按 markdown 文档文件名（去扩展名）匹配
    const stemMatches = files.filter((f) => {
      if (!MARKDOWN_EXTENSIONS.has((f.extension || '').toLowerCase())) return false
      const stem = f.name.toLowerCase().replace(/\.[^.]+$/, '')
      return stem === baseName
    })
    if (stemMatches.length > 0) {
      const best = stemMatches.reduce((a, b) => (a.path.length <= b.path.length ? a : b))
      return { path: best.path, node: best }
    }
  }

  const baseCandidates = files.filter((f) => f.name.toLowerCase() === baseName)
  if (baseCandidates.length === 0) return { path: null, node: null }
  const best = baseCandidates.reduce((a, b) => (a.path.length <= b.path.length ? a : b))
  return { path: best.path, node: best }
}

/** 双链目标的默认显示名：去 markdown 扩展名的文件名。 */
export function wikiLinkDefaultDisplay(target: string): string {
  const baseName = target.replace(/\\/g, '/').split('/').pop() || target
  const ext = baseName.match(/\.[^.]+$/)?.[0]?.toLowerCase()
  if (ext && MARKDOWN_EXTENSIONS.has(ext)) {
    return baseName.slice(0, baseName.length - ext.length)
  }
  return baseName
}

/** 序列化双链：显示名与默认一致时省略别名，否则输出 [[target|display]]。 */
export function composeWikiLinkMarkdown(target: string, display: string): string {
  return display === wikiLinkDefaultDisplay(target) ? `[[${target}]]` : `[[${target}|${display}]]`
}

/**
 * 由工作区文件计算双链目标。
 * markdown 文档优先使用不带扩展名的文件名（Obsidian 风格，最短形态）；
 * 存在同名冲突或非 markdown 文件时回退为带扩展名的相对路径。
 */
export function computeWikiLinkTarget(
  file: WorkbenchFileNode,
  files: readonly WorkbenchFileNode[]
): string {
  const ext = (file.extension || '').toLowerCase()
  if (MARKDOWN_EXTENSIONS.has(ext)) {
    const stem = file.name.replace(/\.[^.]+$/, '')
    if (stem) {
      const conflicts = files.some(
        (other) =>
          other.path !== file.path &&
          MARKDOWN_EXTENSIONS.has((other.extension || '').toLowerCase()) &&
          other.name.toLowerCase().replace(/\.[^.]+$/, '') === stem.toLowerCase()
      )
      if (!conflicts) return stem
    }
  }
  return file.path
}

/** @ 菜单 / 快速打开的共享过滤逻辑：文件名前缀 > 文件名包含 > 路径包含。 */
export function filterWorkspaceFiles(
  allFiles: readonly WorkbenchFileNode[],
  query: string,
  limit = 80
): WorkbenchFileNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return allFiles.slice(0, limit)
  const nameStarts: WorkbenchFileNode[] = []
  const nameContains: WorkbenchFileNode[] = []
  const pathContains: WorkbenchFileNode[] = []
  for (const file of allFiles) {
    const nameLower = file.name.toLowerCase()
    const pathLower = file.path.toLowerCase()
    if (nameLower.startsWith(q)) nameStarts.push(file)
    else if (nameLower.includes(q)) nameContains.push(file)
    else if (pathLower.includes(q)) pathContains.push(file)
  }
  return [...nameStarts, ...nameContains, ...pathContains].slice(0, limit)
}
