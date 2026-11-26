import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { flushSync } from 'react-dom'
import { createPortal } from 'react-dom'
import { AppIcon } from '../../icons/AppIcon'
import { FileChipIcon, WorkbenchFileChip } from '../WorkbenchFileChip'
import { useWorkbenchStore } from '../../../store/workbenchStore'
import type { WorkbenchFileNode } from '../../../../../shared/types/workbench'
import { mentionTokenMatchesPath, normalizePath, resolveAbsolute, toMentionToken } from './filePathUtils'

/**
 * Agent 输入框的 contenteditable 编辑器：
 * - 文本模型仍然是纯字符串 `@token`（与发送链路、消息气泡完全一致）；
 *   chip 只是把"已登记为附件的 @token"在视觉上替换为内联文件 chip。
 * - DOM 为镜像层：输入事件序列化回纯文本写入 store；store 文本变化后
 *   按 canonical 段序列重建 DOM。普通文本输入时序列化结果与模型一致，
 *   不会触发重建，因此光标与 IME 组合输入不受影响。
 * - chip 宿主为 contenteditable=false 的原子节点，退格/删除按整体移除；
 *   悬停出现的 × 直接移除该文件引用。
 */

export interface AgentComposerEditorHandle {
  focus: () => void
}

interface AgentComposerEditorProps {
  value: string
  attachments: string[]
  workspacePath: string | null
  placeholder: string
  disabled: boolean
  onInputChange: (value: string, caret: number) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void
  onPaste: (e: React.ClipboardEvent<HTMLDivElement>) => void
}

interface Segment {
  type: 'text' | 'chip'
  /** text 段：原始文本；chip 段：token（不含 @）。 */
  value: string
}

/** 递归收集文件树里所有目录节点的归一化绝对路径，用于 chip 图标分派。 */
function collectDirectoryKeys(nodes: WorkbenchFileNode[], out: Set<string>): Set<string> {
  for (const node of nodes) {
    if (node.isDirectory) {
      const full = node.fullPath || node.path
      const key = normalizePath(full)
      if (key) out.add(key)
    }
    if (node.children?.length) collectDirectoryKeys(node.children, out)
  }
  return out
}

const MENTION_TOKEN_RE = /@([^\s@]+)/g

/** canonical 分段：只有命中已登记附件的 @token 才渲染为 chip。 */
function buildSegments(
  input: string,
  attachments: string[],
  workspacePath: string | null
): Segment[] {
  if (!input) return []
  const segments: Segment[] = []
  let cursor = 0
  let textBuf = ''
  const flushText = (): void => {
    if (textBuf) {
      segments.push({ type: 'text', value: textBuf })
      textBuf = ''
    }
  }
  for (const match of input.matchAll(MENTION_TOKEN_RE)) {
    const token = match[1]
    const isChip =
      Boolean(token) &&
      attachments.some((path) => mentionTokenMatchesPath(token, path, workspacePath))
    if (!isChip) continue
    textBuf += input.slice(cursor, match.index)
    flushText()
    segments.push({ type: 'chip', value: token })
    cursor = match.index + match[0].length
  }
  textBuf += input.slice(cursor)
  flushText()
  return segments
}

interface DomSnapshot {
  text: string
  chips: string[]
}

/** 序列化编辑器 DOM：文本节点原样、chip 还原为 @token、br 与块级边界还原为 \n。 */
function serializeDom(root: HTMLElement): DomSnapshot {
  let text = ''
  const chips: string[] = []
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.nodeValue ?? ''
      return
    }
    if (!(node instanceof HTMLElement)) return
    const token = node.dataset?.mentionToken
    if (token) {
      text += `@${token}`
      chips.push(token)
      return
    }
    if (node.tagName === 'BR') {
      text += '\n'
      return
    }
    const isBlock = node.tagName === 'DIV' || node.tagName === 'P'
    if (isBlock && text.length > 0 && !text.endsWith('\n')) text += '\n'
    for (const child of Array.from(node.childNodes)) walk(child)
    if (isBlock && !text.endsWith('\n')) text += '\n'
  }
  for (const child of Array.from(root.childNodes)) walk(child)
  return { text, chips }
}

/** 以纯文本偏移量度量光标位置（chip 按 `@token` 长度计）。 */
function measureCaretOffset(root: HTMLElement): number {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return 0
  const range = sel.getRangeAt(0)
  if (!root.contains(range.endContainer)) return 0
  let offset = 0
  let found = false
  const walk = (node: Node): void => {
    if (found) return
    if (node === range.endContainer) {
      if (node.nodeType === Node.TEXT_NODE) {
        offset += range.endOffset
      } else {
        // 容器是元素：累加 endOffset 之前的子节点序列化长度
        const children = Array.from(node.childNodes).slice(0, range.endOffset)
        for (const child of children) offset += nodeSerializedLength(child)
      }
      found = true
      return
    }
    if (node.nodeType === Node.TEXT_NODE) {
      offset += (node.nodeValue ?? '').length
      return
    }
    if (!(node instanceof HTMLElement)) return
    const token = node.dataset?.mentionToken
    if (token) {
      offset += token.length + 1
      return
    }
    if (node.tagName === 'BR') {
      offset += 1
      return
    }
    for (const child of Array.from(node.childNodes)) {
      walk(child)
      if (found) return
    }
  }
  walk(root)
  return offset
}

function nodeSerializedLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return (node.nodeValue ?? '').length
  if (!(node instanceof HTMLElement)) return 0
  const token = node.dataset?.mentionToken
  if (token) return token.length + 1
  if (node.tagName === 'BR') return 1
  let len = 0
  for (const child of Array.from(node.childNodes)) len += nodeSerializedLength(child)
  return len
}

/** 把光标恢复到指定纯文本偏移量；越界时收敛到末尾。 */
function restoreCaretOffset(root: HTMLElement, target: number): void {
  const sel = window.getSelection()
  if (!sel) return
  let acc = 0
  const walk = (node: Node): { node: Node; offset: number } | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node.nodeValue ?? '').length
      if (target <= acc + len) {
        return { node, offset: target - acc }
      }
      acc += len
      return null
    }
    if (!(node instanceof HTMLElement)) return null
    const token = node.dataset?.mentionToken
    if (token) {
      const len = token.length + 1
      if (target <= acc + len) {
        // 命中 chip 内部：原子节点不可进入，放到 chip 之后
        const parent = node.parentNode
        if (parent) {
          const idx = Array.from(parent.childNodes).indexOf(node as ChildNode)
          return { node: parent, offset: idx + 1 }
        }
        return null
      }
      acc += len
      return null
    }
    if (node.tagName === 'BR') {
      if (target <= acc + 1) {
        const parent = node.parentNode
        if (parent) {
          const idx = Array.from(parent.childNodes).indexOf(node as ChildNode)
          return { node: parent, offset: idx + 1 }
        }
        return null
      }
      acc += 1
      return null
    }
    for (const child of Array.from(node.childNodes)) {
      const hit = walk(child)
      if (hit) return hit
    }
    return null
  }
  const position = walk(root)
  const range = document.createRange()
  if (position) {
    range.setStart(position.node, position.offset)
  } else {
    range.selectNodeContents(root)
    range.collapse(false)
  }
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}

function placeCaretAtEnd(root: HTMLElement): void {
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  range.selectNodeContents(root)
  range.collapse(false)
  sel.removeAllRanges()
  sel.addRange(range)
}

export const AgentComposerEditor = forwardRef<AgentComposerEditorHandle, AgentComposerEditorProps>(
  function AgentComposerEditor(
    { value, attachments, workspacePath, placeholder, disabled, onInputChange, onKeyDown, onPaste },
    ref
  ) {
    const editorRef = useRef<HTMLDivElement>(null)
    const composingRef = useRef(false)
    const valueRef = useRef(value)
    valueRef.current = value
    const [chipHosts, setChipHosts] = useState<Array<{ host: HTMLElement; token: string }>>([])
    // 订阅文件树：目录 @mention 的 chip 需要渲染文件夹图标。
    const fileTree = useWorkbenchStore((s) => s.fileTree)
    const directoryKeys = useMemo(() => collectDirectoryKeys(fileTree, new Set()), [fileTree])

    useImperativeHandle(ref, () => ({
      focus: () => {
        const el = editorRef.current
        if (!el || disabled) return
        if (document.activeElement === el) return
        el.focus()
        placeCaretAtEnd(el)
      }
    }))

    /** 把当前 DOM 序列化同步进文本模型（结构不变时不触发重建）。 */
    const syncFromDom = useCallback((): void => {
      const el = editorRef.current
      if (!el) return
      const snapshot = serializeDom(el)
      if (snapshot.text !== valueRef.current) {
        const caret = measureCaretOffset(el)
        flushSync(() => onInputChange(snapshot.text, caret))
      }
    }, [onInputChange])

    /** 按 canonical 段序列重建 DOM（仅在文本或 chip 结构与模型不一致时）。 */
    const rebuildIfNeeded = useCallback((): void => {
      const el = editorRef.current
      if (!el) return
      const canonical = buildSegments(valueRef.current, attachments, workspacePath)
      const canonicalChips = canonical.filter((s) => s.type === 'chip').map((s) => s.value)
      const snapshot = serializeDom(el)
      const structureMatch =
        snapshot.chips.length === canonicalChips.length &&
        snapshot.chips.every((t, i) => t === canonicalChips[i])
      if (snapshot.text === valueRef.current && structureMatch) return

      const focused = document.activeElement === el
      const caret = focused ? measureCaretOffset(el) : null

      el.textContent = ''
      const hosts: Array<{ host: HTMLElement; token: string }> = []
      for (const seg of canonical) {
        if (seg.type === 'text') {
          el.appendChild(document.createTextNode(seg.value))
        } else {
          const host = document.createElement('span')
          host.contentEditable = 'false'
          host.dataset.mentionToken = seg.value
          host.className = 'align-baseline'
          el.appendChild(host)
          hosts.push({ host, token: seg.value })
        }
      }
      setChipHosts(hosts)

      if (caret !== null) {
        restoreCaretOffset(el, Math.min(caret, valueRef.current.length))
      }
    }, [attachments, workspacePath])

    useLayoutEffect(() => {
      if (composingRef.current) return
      rebuildIfNeeded()
    }, [value, attachments, workspacePath, rebuildIfNeeded])

    const removeChip = useCallback(
      (host: HTMLElement): void => {
        host.remove()
        syncFromDom()
        editorRef.current?.focus()
      },
      [syncFromDom]
    )

    const handleInput = (): void => {
      syncFromDom()
      if (!composingRef.current) rebuildIfNeeded()
    }

    const handleCompositionStart = (): void => {
      composingRef.current = true
    }

    const handleCompositionEnd = (): void => {
      composingRef.current = false
      syncFromDom()
      rebuildIfNeeded()
    }

    const handleKeyDownInternal = (e: React.KeyboardEvent<HTMLDivElement>): void => {
      onKeyDown(e)
      if (e.defaultPrevented) return
      // Shift+Enter 统一插入 <br>，避免浏览器生成 <div> 块导致序列化分叉。
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault()
        document.execCommand('insertLineBreak')
      }
    }

    const handlePasteInternal = (e: React.ClipboardEvent<HTMLDivElement>): void => {
      // 先交给外层处理图片粘贴；外层接管（preventDefault）后不再走文本逻辑。
      onPaste(e)
      if (e.defaultPrevented) return
      const text = e.clipboardData?.getData('text/plain')
      if (!text) return
      // 纯文本扁平化粘贴：不引入任何 HTML 结构，换行直接进入文本节点。
      e.preventDefault()
      document.execCommand('insertText', false, text)
    }

    return (
      <div className="relative">
        {!value && (
          <div className="pointer-events-none absolute inset-x-0 top-0 text-body leading-relaxed text-text-secondary/70 select-none">
            {placeholder}
          </div>
        )}
        <div
          ref={editorRef}
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={handleInput}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onKeyDown={handleKeyDownInternal}
          onPaste={handlePasteInternal}
          className={`w-full bg-transparent border-none outline-none text-body leading-relaxed text-text-primary font-normal select-text min-h-[48px] max-h-[140px] overflow-y-auto whitespace-pre-wrap break-words ${
            disabled ? 'cursor-not-allowed opacity-60' : 'cursor-text'
          }`}
          style={{ userSelect: 'text' }}
        />
        {chipHosts.map(({ host, token }) => {
          const abs = workspacePath ? resolveAbsolute(workspacePath, token) : token
          const name = token.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || token
          const isDirectory = directoryKeys.has(normalizePath(abs))
          return createPortal(
            <WorkbenchFileChip
              icon={
                isDirectory ? (
                  <AppIcon name="folder" size="1em" className="shrink-0 text-amber-500" />
                ) : (
                  <FileChipIcon absPath={abs} name={name} />
                )
              }
              label={name}
              title={toMentionToken(abs, workspacePath) || token}
              className="bg-slate-100 dark:bg-white/10"
            >
              <button
                type="button"
                tabIndex={-1}
                aria-label="移除文件引用"
                className="-mr-0.5 flex items-center justify-center rounded-full p-px text-text-secondary/70 transition-colors hover:text-text-primary dark:hover:text-gray-100"
                onMouseDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  removeChip(host)
                }}
              >
                <AppIcon name="close" size={10} />
              </button>
            </WorkbenchFileChip>,
            host,
            token
          )
        })}
      </div>
    )
  }
)
