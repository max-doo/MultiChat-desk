import { MARKDOWN_EXTENSIONS, type WorkbenchFileNode } from '../../../../shared/types/workbench'

/** 双链目标解析结果：工作区相对路径，null 表示未找到 */
export interface WikiLinkResolution {
  path: string | null
  node: WorkbenchFileNode | null
}

/** 面向工作区文件集的 O(1) 双链解析索引（按 fileTree / files 引用缓存复用） */
export interface WikiLinkIndex {
  byExactPath: Map<string, WorkbenchFileNode>
  byLowerPath: Map<string, WorkbenchFileNode>
  byMdStem: Map<string, WorkbenchFileNode>
  byBaseName: Map<string, WorkbenchFileNode>
  resolutionCache: Map<string, WikiLinkResolution>
}

const EMPTY_RESOLUTION: WikiLinkResolution = { path: null, node: null }
const WIKI_EXT_FALLBACKS = ['.md', '.markdown', '.txt'] as const
const treeIndexCache = new WeakMap<readonly WorkbenchFileNode[], WikiLinkIndex>()
const flatIndexCache = new WeakMap<readonly WorkbenchFileNode[], WikiLinkIndex>()

function addFileToWikiLinkIndex(index: WikiLinkIndex, file: WorkbenchFileNode): void {
  if (!index.byExactPath.has(file.path)) {
    index.byExactPath.set(file.path, file)
  }
  const pathLower = file.path.toLowerCase()
  if (!index.byLowerPath.has(pathLower)) {
    index.byLowerPath.set(pathLower, file)
  }
  const nameLower = file.name.toLowerCase()
  const prevBase = index.byBaseName.get(nameLower)
  if (!prevBase || file.path.length < prevBase.path.length) {
    index.byBaseName.set(nameLower, file)
  }
  if (MARKDOWN_EXTENSIONS.has((file.extension || '').toLowerCase())) {
    const stem = nameLower.replace(/\.[^.]+$/, '')
    const prevStem = index.byMdStem.get(stem)
    if (!prevStem || file.path.length < prevStem.path.length) {
      index.byMdStem.set(stem, file)
    }
  }
}

function createEmptyWikiLinkIndex(): WikiLinkIndex {
  return {
    byExactPath: new Map(),
    byLowerPath: new Map(),
    byMdStem: new Map(),
    byBaseName: new Map(),
    resolutionCache: new Map()
  }
}

/** 从已拍平的文件数组获取或构建 O(1) 双链索引。 */
function getWikiLinkIndexForFiles(files: readonly WorkbenchFileNode[]): WikiLinkIndex {
  const cached = flatIndexCache.get(files)
  if (cached) return cached
  const index = createEmptyWikiLinkIndex()
  for (const file of files) {
    addFileToWikiLinkIndex(index, file)
  }
  flatIndexCache.set(files, index)
  return index
}

/** 从工作区文件树获取或构建 O(1) 双链索引（无需排序，随 fileTree 引用自动失效）。 */
export function getWikiLinkIndexForTree(fileTree: readonly WorkbenchFileNode[]): WikiLinkIndex {
  const cached = treeIndexCache.get(fileTree)
  if (cached) return cached
  const index = createEmptyWikiLinkIndex()
  const walk = (nodes: readonly WorkbenchFileNode[]): void => {
    for (const node of nodes) {
      if (node.isDirectory) {
        if (node.children) walk(node.children)
      } else {
        addFileToWikiLinkIndex(index, node)
      }
    }
  }
  walk(fileTree)
  treeIndexCache.set(fileTree, index)
  return index
}

/**
 * 基于预建索引解析 [[target]] 中的双链目标为工作区文件。
 * 保持 Obsidian 风格最短路径语义，单次查询 O(1) 并缓存目标串结果。
 */
export function resolveWikiLinkFromIndex(
  target: string,
  index: WikiLinkIndex
): WikiLinkResolution {
  const normalized = target
    .trim()
    .split('#')[0]
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
  if (!normalized) return EMPTY_RESOLUTION

  const lower = normalized.toLowerCase()
  const cached = index.resolutionCache.get(lower)
  if (cached) return cached

  let resolved: WikiLinkResolution | null = null
  const exact = index.byLowerPath.get(lower)
  if (exact) {
    resolved = { path: exact.path, node: exact }
  } else {
    const hasExt = /\.[^./]+$/.test(normalized)
    if (!hasExt) {
      for (const ext of WIKI_EXT_FALLBACKS) {
        const withExt = index.byLowerPath.get(lower + ext)
        if (withExt) {
          resolved = { path: withExt.path, node: withExt }
          break
        }
      }
    }

    if (!resolved) {
      const baseName = lower.split('/').pop() || lower
      if (!hasExt) {
        const bestStem = index.byMdStem.get(baseName)
        if (bestStem) {
          resolved = { path: bestStem.path, node: bestStem }
        }
      }
      if (!resolved) {
        const bestBase = index.byBaseName.get(baseName)
        resolved = bestBase ? { path: bestBase.path, node: bestBase } : EMPTY_RESOLUTION
      }
    }
  }

  index.resolutionCache.set(lower, resolved)
  return resolved
}

/** 直接按工作区文件树解析双链目标（所有调用方共享同一份按 fileTree 缓存的索引）。 */
export function resolveWikiLinkTargetFromTree(
  target: string,
  fileTree: readonly WorkbenchFileNode[]
): WikiLinkResolution {
  return resolveWikiLinkFromIndex(target, getWikiLinkIndexForTree(fileTree))
}

/**
 * 解析 [[target]] 中的双链目标为工作区文件。
 * Obsidian 风格的最短路径语义：
 * 1. 精确匹配工作区相对路径（含扩展名），无扩展名时先补 .md / .markdown / .txt；
 * 2. 唯一文件名匹配；
 * 3. 多歧义时取路径最短者。
 * 标题/块锚点（[[doc#heading]]、[[doc#^block]]）引用的是文档本身，
 * 解析前先剥离 # 及之后的锚点部分。
 */
export function resolveWikiLinkTarget(
  target: string,
  files: readonly WorkbenchFileNode[]
): WikiLinkResolution {
  return resolveWikiLinkFromIndex(target, getWikiLinkIndexForFiles(files))
}

/** 双链目标的默认显示名：去 markdown 扩展名的文件名；带锚点时为「文档名 > 锚点」（Obsidian 风格）。 */
export function wikiLinkDefaultDisplay(target: string): string {
  const [docPart, ...anchorParts] = target.split('#')
  const baseName = docPart.replace(/\\/g, '/').split('/').pop() || docPart
  const ext = baseName.match(/\.[^.]+$/)?.[0]?.toLowerCase()
  const docDisplay = ext && MARKDOWN_EXTENSIONS.has(ext)
    ? baseName.slice(0, baseName.length - ext.length)
    : baseName
  if (anchorParts.length > 0) {
    const anchor = anchorParts.join('#').trim().replace(/^\^/, '')
    if (anchor) {
      return docDisplay ? `${docDisplay} > ${anchor}` : anchor
    }
  }
  return docDisplay
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
