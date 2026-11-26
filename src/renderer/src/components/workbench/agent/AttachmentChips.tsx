import { useCallback, useMemo, type ReactNode } from 'react'
import { AppIcon } from '../../icons/AppIcon'
import FileTypeIcon from '../FileTypeIcon'
import type { PiContentPart } from '../../../types/agent'
import { useWorkbenchStore } from '../../../store/workbenchStore'
import { resolveAbsolute, toWorkspaceRelative } from './filePathUtils'
import { MARKDOWN_EXTENSIONS, type WorkbenchFileNode } from '../../../../../shared/types/workbench'

/**
 * 最终回复附件 Chip：
 * - 主数据源：从 image_gen 等工具的 structuredContent.imageFiles /
 *   savedPaths/filePaths/artifacts 等已知字段直接收集路径，保证产物文件
 *   一定会渲染为可点击附件，与模型在正文里怎么写路径解耦。
 * - 兜底数据源：正文任意位置出现的绝对路径（盘符/~/POSIX 开头 +
 *   白名单扩展名）——覆盖 shell 命令、脚本等"非工具产物"场景，
 *   模型忘记反引号、路径嵌在句中时仍能识别。
 * - 点击行为与 ToolGroup 文件名一致：工作区内 openFile，区外 agentRevealFile。
 * - 正文中模型用反引号标记的路径不剥离也不重复消费——保留其自然语言汇报，
 *   Chip 只负责"打开产物"这个动作。
 */

/** 会被识别为附件的扩展名白名单（产物类文件；源码路径太多，不列入避免噪音） */
const ATTACHMENT_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif', '.tiff', '.tif', '.ico',
  '.pdf',
  '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.odt', '.ods', '.odp', '.rtf',
  '.md', '.markdown',
  '.zip', '.7z', '.rar', '.tar', '.gz',
  '.mp3', '.wav', '.flac', '.mp4', '.mov', '.webm',
  '.html', '.htm', '.csv', '.epub'
])

function hasAttachmentExtension(filePath: string): boolean {
  const lastDot = filePath.lastIndexOf('.')
  if (lastDot === -1) return false
  return ATTACHMENT_EXTENSIONS.has(filePath.slice(lastDot).toLowerCase())
}

/**
 * 正文内联绝对路径兜底：
 * - 匹配盘符/~/POSIX 开头的绝对路径，任意位置（句中、反引号、列表项）均可命中；
 * - 限定白名单扩展名，避免把正文里提到的源码/系统路径当成附件；
 * - Windows 路径含空格的情况无法可靠判断边界，这类路径仍依赖反引号约定；
 * - POSIX 分支用 lookbehind/lookahead 排除 URL（https://a.com/x.png 不命中）。
 */
const INLINE_PATH_RE =
  /(?<![\w/])[A-Za-z]:[\\/][^\s`'"*()[\]{}<>|?，。；：！？、]*\.[A-Za-z0-9]{1,10}|(?<![\w:])~[\\/][^\s`'"*()[\]{}<>|?，。；：！？、]*\.[A-Za-z0-9]{1,10}|(?<![\w/:])\/(?!\/)[^\s`'"*()[\]{}<>|?，。；：！？、]*\.[A-Za-z0-9]{1,10}/g

const TRAILING_PUNCT_RE = /[.,;:!?)\]'’”）】]+$/u

/** 从正文任意位置提取带白名单扩展名的绝对路径（去重保序）。 */
export function extractInlineFilePaths(text: string): string[] {
  if (!text) return []
  const found: string[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(INLINE_PATH_RE)) {
    const candidate = match[0].replace(TRAILING_PUNCT_RE, '')
    if (!hasAttachmentExtension(candidate)) continue
    const key = candidate.replace(/\\/g, '/').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    found.push(candidate)
  }
  return found
}

/** 从工具调用 part 的 result 中收集已知字段里的文件路径。 */
function collectPathsFromValue(value: unknown, out: Set<string>): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) collectPathsFromValue(item, out)
    return
  }
  const obj = value as Record<string, unknown>
  for (const key of ['imageFiles', 'files', 'filePaths', 'savedPaths', 'artifacts', 'attachments']) {
    const arr = obj[key]
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (typeof item === 'string' && hasAttachmentExtension(item)) out.add(item)
      }
    }
  }
  for (const key of ['path', 'filePath', 'file', 'imagePath', 'screenshotPath']) {
    const item = obj[key]
    if (typeof item === 'string' && hasAttachmentExtension(item)) out.add(item)
  }
  // 递归一层常见容器：structuredContent / details / data
  for (const key of ['structuredContent', 'details', 'data', 'result']) {
    if (obj[key] && typeof obj[key] === 'object') collectPathsFromValue(obj[key], out)
  }
}

/** 收集本工作段内所有工具调用结果携带的附件路径。 */
export function collectToolAttachmentPaths(messages: { content: PiContentPart[] }[]): string[] {
  const out = new Set<string>()
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type === 'tool-call' && part.result !== undefined) {
        collectPathsFromValue(part.result, out)
      }
    }
  }
  return [...out]
}

const BITMAP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif', '.tiff', '.tif', '.ico'
])

function renderFileChipIcon(absPath: string, name: string): JSX.Element {
  const dot = name.lastIndexOf('.')
  const ext = dot !== -1 ? name.slice(dot).toLowerCase() : ''
  if (BITMAP_EXTENSIONS.has(ext)) {
    return <AppIcon name="image" size={14} className="shrink-0 text-purple-500 dark:text-purple-400" />
  }
  if (ext === '.svg') {
    return <AppIcon name="draw" size={14} className="shrink-0 text-purple-500 dark:text-purple-400" />
  }
  if (MARKDOWN_EXTENSIONS.has(ext)) {
    return <AppIcon name="description" size={14} className="shrink-0 text-blue-500 dark:text-blue-400" />
  }
  return (
    <FileTypeIcon
      node={{ id: absPath, name, path: absPath, fullPath: absPath, isDirectory: false, extension: ext }}
      className="w-3.5 h-3.5"
    />
  )
}

/** 在文件树里按绝对路径（大小写不敏感）查找节点，返回树内真实相对 path。 */
function findTreePathByAbs(
  nodes: WorkbenchFileNode[],
  absPath: string
): string | null {
  const target = absPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const stack = [...nodes]
  while (stack.length > 0) {
    const node = stack.pop()!
    const full = (node.fullPath || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    if (full === target) return node.path
    if (node.children?.length) stack.push(...node.children)
  }
  return null
}

interface AttachmentChipsProps {
  paths: string[]
  /** 会话 cwd，用于把相对路径还原成绝对路径。 */
  cwd?: string
}

export function AttachmentChips({ paths, cwd }: AttachmentChipsProps): JSX.Element | null {
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const openFile = useWorkbenchStore((s) => s.openFile)

  const items = useMemo(
    () =>
      paths.map((p) => {
        const abs = cwd ? resolveAbsolute(cwd, p) : p
        const rel = cwd && workspacePath ? toWorkspaceRelative(workspacePath, cwd, p) : null
        const name = abs.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || abs
        return { raw: p, abs, rel, name }
      }),
    [paths, cwd, workspacePath]
  )

  const handleClick = useCallback(
    (item: (typeof items)[number]) => {
      // 优先用文件树里的真实 node.path 打开，保证 activeFilePath 与树高亮
      // 严格相等（rel 的字母大小写可能与磁盘不一致）。
      const treeRel = findTreePathByAbs(useWorkbenchStore.getState().fileTree, item.abs)
      const rel = treeRel ?? item.rel
      if (rel) {
        void openFile(rel).then((opened) => {
          if (!opened) void window.api.agentRevealFile(item.abs)
        })
      } else {
        void window.api.agentRevealFile(item.abs)
      }
    },
    [openFile]
  )

  if (items.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5 pt-0.5">
      {items.map((item) => (
        <button
          key={item.raw}
          type="button"
          onClick={() => handleClick(item)}
          title={item.abs}
          className="inline-flex items-center gap-1.5 max-w-60 rounded-full border border-slate-200/90 bg-slate-50/80 px-2.5 py-1 text-caption text-slate-700 transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary dark:border-white/10 dark:bg-white/5 dark:text-gray-200 dark:hover:border-primary/40 dark:hover:bg-primary/15"
        >
          {renderFileChipIcon(item.abs, item.name)}
          <span className="truncate font-medium">{item.name}</span>
        </button>
      ))}
    </div>
  )
}

/** 用户消息正文分段：text 段原样渲染，mention 段渲染内联 chip。 */
interface MentionSegment {
  type: 'text' | 'mention'
  /** text 段的原始文本；mention 段的 `@token`（含 @）。 */
  value: string
  /** mention 段 resolve 后的绝对路径，用于点击与去重。 */
  resolved?: string
}

const PATH_TOKEN_RE = /@([^\s@]+)/g
const MENTION_PATH_LIKE = (token: string): boolean =>
  /^[A-Za-z]:[\\/]/.test(token) ||
  token.startsWith('/') ||
  token.startsWith('~/') ||
  token.startsWith('~\\') ||
  token.includes('/') ||
  token.includes('\\')

/**
 * 把用户消息正文按 `@path` token 切成 text/mention 段，供内联渲染。
 * - 每个 resolved 路径只保留首个出现的 token；prompt 自动拼接的重复
 *   `@absPath`（attachments 通道追加到末尾的那份）按重复吞掉，同一文件
 *   在气泡里只有一个内联 chip。
 * - 重复 token 删除后若留下孤立的尾随空白行，一并剥除，不留空段。
 */
function splitMentionSegments(text: string, cwd?: string): MentionSegment[] {
  if (!text) return []
  const seen = new Set<string>()
  const segments: MentionSegment[] = []
  let cursor = 0
  for (const match of text.matchAll(PATH_TOKEN_RE)) {
    const token = match[1].replace(TRAILING_PUNCT_RE, '')
    // token 在 match[0] 里的结束位（@ + 剥掉尾随标点的 token），
    // 标点不属于路径，留给后续 text 段原样渲染。
    const tokenEnd = match.index + 1 + token.length
    const isPath = Boolean(token) && MENTION_PATH_LIKE(token)
    const resolved = isPath ? (cwd ? resolveAbsolute(cwd, token) : token) : token
    const key = resolved.replace(/\\/g, '/').toLowerCase()
    const isDup = isPath && seen.has(key)
    if (isPath) seen.add(key)

    if (isDup) {
      // 吞掉重复 token（仅 @token 本体，尾随标点归普通文本），
      // 末尾残留的纯空白段最后再统一 trim。
      if (match.index > cursor) {
        segments.push({ type: 'text', value: text.slice(cursor, match.index) })
      }
      cursor = tokenEnd
      continue
    }

    if (match.index > cursor) {
      segments.push({ type: 'text', value: text.slice(cursor, match.index) })
    }
    if (isPath) {
      segments.push({ type: 'mention', value: `@${token}`, resolved })
    } else {
      segments.push({ type: 'text', value: `@${token}` })
    }
    cursor = tokenEnd
  }
  if (cursor < text.length) {
    segments.push({ type: 'text', value: text.slice(cursor) })
  }
  // 剥除因吞掉重复 token 产生的尾随纯空白 text 段
  while (
    segments.length > 0 &&
    segments[segments.length - 1].type === 'text' &&
    !segments[segments.length - 1].value.trim()
  ) {
    segments.pop()
  }
  return segments
}

interface InlineMentionTextProps {
  text: string
  cwd?: string
}

/**
 * 用户消息正文渲染：`@path` token 就地替换为可点击内联 chip，普通文本原样输出。
 * 点击行为与 AttachmentChips 一致：工作区内 openFile，区外 agentRevealFile。
 */
export function InlineMentionText({ text, cwd }: InlineMentionTextProps): JSX.Element {
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const openFile = useWorkbenchStore((s) => s.openFile)

  const segments = useMemo(() => splitMentionSegments(text, cwd), [text, cwd])

  const handleMentionClick = useCallback(
    (resolved: string) => {
      // 优先用文件树里的真实 node.path 打开：token 大小写可能与磁盘不一致，
      // openFile 的 activeFilePath 与树高亮是严格相等匹配。
      const treeRel = findTreePathByAbs(useWorkbenchStore.getState().fileTree, resolved)
      const rel =
        treeRel ??
        (cwd && workspacePath ? toWorkspaceRelative(workspacePath, cwd, resolved) : null)
      if (rel) {
        void openFile(rel).then((opened) => {
          if (!opened) void window.api.agentRevealFile(resolved)
        })
      } else {
        void window.api.agentRevealFile(resolved)
      }
    },
    [cwd, workspacePath, openFile]
  )

  const nodes: ReactNode[] = segments.map((seg, i) => {
    if (seg.type === 'text') {
      return <span key={i}>{seg.value}</span>
    }
    const abs = seg.resolved ?? seg.value.slice(1)
    const name = abs.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || abs
    return (
      <button
        key={i}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          handleMentionClick(abs)
        }}
        title={abs}
        className="mx-0.5 inline-flex translate-y-px items-center gap-1 rounded-md bg-white/20 px-1.5 py-0.5 align-baseline text-caption font-medium text-white transition-colors hover:bg-white/30 [&_svg]:!text-white/85"
      >
        {renderFileChipIcon(abs, name)}
        <span className="max-w-52 truncate">{name}</span>
      </button>
    )
  })

  return <>{nodes}</>
}

/**
 * 判断 inline-code 文本是否"像相对路径"：含路径分隔符且带扩展名。
 * 仅做候选收敛，不做存在性判断；真正的"能不能打开"由文件树命中决定。
 */
const INLINE_REL_PATH_CANDIDATE = (text: string): boolean => {
  const t = text.trim()
  // 至少要有一段分隔符 + 一个 .ext 结尾；裸单词/正则/代码片段直接过滤。
  return /[/\\]/.test(t) && /\.[A-Za-z0-9]{1,10}$/.test(t)
}

interface InlineFileCodeProps {
  /** inline-code 的原始文本（候选相对/绝对路径）。 */
  text: string
  /** 会话 cwd，用于把相对路径还原成绝对路径。 */
  cwd?: string
}

/**
 * Agent 正文 inline-code 的路径 chip 化：
 * - 仅当文本能在当前文件树中 resolve 到真实节点时才渲染成可点击 chip；
 *   查不到（不存在的路径、目录外、非路径文本）一律退化为普通 <code>，
 *   保证"能点的就一定能打开"，宁可漏认也不出现打不开的假 chip。
 * - 打开链路与 AttachmentChips/InlineMentionText 完全一致：
 *   文件树 node.path → openFile，失败回退 agentRevealFile(abs)。
 */
export function InlineFileCode({ text, cwd }: InlineFileCodeProps): JSX.Element {
  const openFile = useWorkbenchStore((s) => s.openFile)
  // 订阅 fileTree 作为依赖：树可能晚于消息渲染加载，到位后需重算，
  // 否则"本该识别的路径"会因树为空而永久退化成 code。
  const fileTree = useWorkbenchStore((s) => s.fileTree)

  const resolved = useMemo(() => {
    if (!cwd || !INLINE_REL_PATH_CANDIDATE(text)) return null
    const abs = resolveAbsolute(cwd, text.trim())
    const treeRel = findTreePathByAbs(fileTree, abs)
    // 只在文件树里真实存在时才认：这是"点开必然有效"的硬保证。
    if (!treeRel) return null
    const name = abs.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || abs
    return { abs, treeRel, name }
  }, [text, cwd, fileTree])

  const handleClick = useCallback(() => {
    if (!resolved) return
    void openFile(resolved.treeRel).then((opened) => {
      if (!opened) void window.api.agentRevealFile(resolved.abs)
    })
  }, [resolved, openFile])

  // 非路径或文件树查不到：保持原有 inline-code 外观，不引入假交互。
  if (!resolved) {
    return (
      <code className="px-1.5 py-0.5 mx-0.5 rounded bg-slate-100 text-slate-800 font-mono text-caption border border-slate-200/70 inline-block align-baseline dark:bg-white/10 dark:text-slate-200 dark:border-white/10">
        {text}
      </code>
    )
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        handleClick()
      }}
      title={resolved.abs}
      className="mx-0.5 inline-flex items-center gap-1 rounded px-1 -my-0.5 py-0.5 align-baseline text-body font-medium text-primary transition-colors hover:bg-primary/10 dark:text-blue-300 dark:hover:bg-primary/25"
    >
      {renderFileChipIcon(resolved.abs, resolved.name)}
      <span className="max-w-52 truncate">{resolved.name}</span>
    </button>
  )
}
