import { useCallback, useMemo, type ReactNode } from 'react'
import { FileChipIcon, WorkbenchFileChip } from '../WorkbenchFileChip'
import { AppIcon } from '../../icons/AppIcon'
import { useWorkbenchStore } from '../../../store/workbenchStore'
import { agentChipOpenOptions, resolveAbsolute, toWorkspaceRelative } from './filePathUtils'
import { peekFileExistence, useFileExistenceVersion } from './fileExistenceCache'
import { MARKDOWN_EXTENSIONS, type WorkbenchFileNode } from '../../../../../shared/types/workbench'

/**
 * Agent 消息内的行内文件 chip：
 * - 用户消息正文的 `@path` mention 就地渲染为可点击 chip；
 * - 模型回复正文的 inline-code 路径与裸绝对路径经 MarkdownRenderer 管线
 *   渲染为统一样式的 chip（文件树命中或磁盘存在才可点击）。
 * 点击语义统一：工作区内 openFile，区外 agentRevealFile。
 */

const TRAILING_PUNCT_RE = /[.,;:!?)\]'’”）】]+$/u

/**
 * 目录 chip 用文件夹图标（与 @ 菜单一致），文件按扩展名走 FileChipIcon。
 * onPrimary 用于蓝色用户气泡场景：文件树的 md 图标本色 text-blue-500(#3b82f6)
 * 与气泡底色完全相同会直接隐形，取同色系浅蓝保持色调一致又能在蓝底上辨识。
 */
const renderFileChipIcon = (
  absPath: string,
  name: string,
  isDirectory?: boolean,
  onPrimary?: boolean
): JSX.Element => {
  if (isDirectory) {
    return <AppIcon name="folder" size="1em" className="shrink-0 text-amber-500" />
  }
  if (onPrimary) {
    const dot = name.lastIndexOf('.')
    const ext = dot !== -1 ? name.slice(dot).toLowerCase() : ''
    if (MARKDOWN_EXTENSIONS.has(ext)) {
      return <AppIcon name="description" size="1em" className="shrink-0 text-blue-200" />
    }
  }
  return <FileChipIcon absPath={absPath} name={name} />
}

/** 在文件树里按绝对路径（大小写不敏感）查找节点，返回树内真实相对 path。 */
function findTreeNodeByAbs(
  nodes: WorkbenchFileNode[],
  absPath: string
): WorkbenchFileNode | null {
  const target = absPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const stack = [...nodes]
  while (stack.length > 0) {
    const node = stack.pop()!
    const full = (node.fullPath || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    if (full === target) return node
    if (node.children?.length) stack.push(...node.children)
  }
  return null
}

function findTreePathByAbs(
  nodes: WorkbenchFileNode[],
  absPath: string
): string | null {
  return findTreeNodeByAbs(nodes, absPath)?.path ?? null
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
 * 点击语义与行内文件 chip 一致：工作区内 openFile，区外 agentRevealFile。
 */
export function InlineMentionText({ text, cwd }: InlineMentionTextProps): JSX.Element {
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const openFile = useWorkbenchStore((s) => s.openFile)
  // 订阅文件树：目录 mention 需要按真实节点类型渲染文件夹图标。
  const fileTree = useWorkbenchStore((s) => s.fileTree)

  const segments = useMemo(() => splitMentionSegments(text, cwd), [text, cwd])

  const handleMentionClick = useCallback(
    (resolved: string, e: { ctrlKey: boolean; metaKey: boolean; button: number }) => {
      // 优先用文件树里的真实 node.path 打开：token 大小写可能与磁盘不一致，
      // openFile 的 activeFilePath 与树高亮是严格相等匹配。
      const treeRel = findTreePathByAbs(useWorkbenchStore.getState().fileTree, resolved)
      const rel =
        treeRel ??
        (cwd && workspacePath ? toWorkspaceRelative(workspacePath, cwd, resolved) : null)
      if (rel) {
        void openFile(rel, agentChipOpenOptions(e)).then((opened) => {
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
    const isDirectory = findTreeNodeByAbs(fileTree, abs)?.isDirectory ?? false
    return (
      <button
        key={i}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          handleMentionClick(abs, e)
        }}
        onAuxClick={(e) => {
          if (e.button !== 1) return
          e.preventDefault()
          e.stopPropagation()
          handleMentionClick(abs, e)
        }}
        title={abs}
        className="group mx-0.5 -my-0.5 inline-flex items-center gap-1 rounded px-1 py-0.5 align-baseline font-normal text-white transition-colors hover:bg-white/[0.12] [&_img]:saturate-[1.1]"
      >
        {renderFileChipIcon(abs, name, isDirectory, true)}
        <span className="max-w-52 truncate underline decoration-white/[0.45] decoration-1 underline-offset-[3px] group-hover:decoration-white/[0.85]">{name}</span>
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
 * 行内文件 chip 的统一渲染（inline-code 与正文裸路径共用）：
 * - 文件树命中 → openFile 预览/常驻语义；
 * - 树外但磁盘存在（.multichat 隐藏目录、工作区外）→ openFile（区外失败自动回退）或 agentRevealFile；
 * - 磁盘也不存在 → 退化为普通文本/代码，不引入假交互。
 */
export function InlineFileChip({ abs, fallback }: { abs: string; fallback: ReactNode }): JSX.Element {
  const openFile = useWorkbenchStore((s) => s.openFile)
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  // 订阅 fileTree 作为依赖：树可能晚于消息渲染加载，到位后需重算，
  // 否则"本该识别的路径"会因树为空而永久退化成 code。
  const fileTree = useWorkbenchStore((s) => s.fileTree)
  // 订阅磁盘存在性版本：stat 结果到达后触发重算，unknown → chip/code 升级/定型。
  const existenceVersion = useFileExistenceVersion()

  const resolved = useMemo(() => {
    const treeRel = findTreePathByAbs(fileTree, abs)
    if (treeRel) {
      return { abs, name: abs.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || abs, treeRel }
    }
    // 文件树未命中：.multichat 等隐藏目录 / 工作区外路径走磁盘存在性兜底。
    const existence = peekFileExistence(abs)
    if (existence !== 'exists') return null
    const name = abs.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || abs
    return { abs, name, treeRel: null }
    // existenceVersion 必须入依赖：stat 结果到达后 useMemo 需要重算，
    // 否则 unknown 阶段缓存的 null 会永久保留，升级链路断裂。
  }, [abs, fileTree, existenceVersion])

  const handleClick = useCallback((e: { ctrlKey: boolean; metaKey: boolean; button: number }) => {
    if (!resolved) return
    const options = agentChipOpenOptions(e)
    if (resolved.treeRel) {
      void openFile(resolved.treeRel, options).then((opened) => {
        if (!opened) void window.api.agentRevealFile(resolved.abs)
      })
      return
    }
    // 隐藏目录/工作区外：工作区内的仍优先 openFile（复用预览组件），
    // 区外或打开失败统一回退系统方式。
    const rel = workspacePath ? toWorkspaceRelative(workspacePath, '', resolved.abs) : null
    if (rel) {
      void openFile(rel, options).then((opened) => {
        if (!opened) void window.api.agentRevealFile(resolved.abs)
      })
    } else {
      void window.api.agentRevealFile(resolved.abs)
    }
  }, [resolved, openFile, workspacePath])

  if (!resolved) return <>{fallback}</>

  return (
    <WorkbenchFileChip
      icon={renderFileChipIcon(resolved.abs, resolved.name)}
      label={resolved.name}
      onClick={(e) => {
        e.stopPropagation()
        handleClick(e)
      }}
      onAuxClick={(e) => {
        if (e.button !== 1) return
        e.preventDefault()
        e.stopPropagation()
        handleClick(e)
      }}
      title={resolved.abs}
    />
  )
}

/**
 * Agent 正文 inline-code 的路径 chip 化：
 * - 文件树命中或磁盘确认存在时渲染成可点击 chip；
 *   查不到一律退化为普通 <code>，保证"能点的就一定能打开"。
 */
export function InlineFileCode({ text, cwd }: InlineFileCodeProps): JSX.Element {
  if (!cwd || !INLINE_REL_PATH_CANDIDATE(text)) {
    return (
      <code className="px-1.5 py-0.5 mx-0.5 rounded bg-slate-100 text-slate-800 font-mono text-caption border border-slate-200/70 inline-block align-baseline dark:bg-white/10 dark:text-slate-200 dark:border-white/10">
        {text}
      </code>
    )
  }
  const abs = resolveAbsolute(cwd, text.trim())
  return (
    <InlineFileChip
      abs={abs}
      fallback={
        <code className="px-1.5 py-0.5 mx-0.5 rounded bg-slate-100 text-slate-800 font-mono text-caption border border-slate-200/70 inline-block align-baseline dark:bg-white/10 dark:text-slate-200 dark:border-white/10">
          {text}
        </code>
      }
    />
  )
}
