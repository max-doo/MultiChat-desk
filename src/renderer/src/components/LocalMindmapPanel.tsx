import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Markmap, globalCSS } from 'markmap-view'
import type { INode } from 'markmap-common'

export interface MindNode {
  id: string
  content: string
  children: MindNode[]
  fold?: boolean
}

const STORAGE_KEY = 'multichat_local_mindmap_markdown'

const DEFAULT_MARKDOWN = `# b端和c端产品的区别

## 目标相同
- 创造价值并完成商业价值交换

## 价值决策主体不同
- C端: 使用、决策和付费主体相对一致，用户是个人
- B端: 使用、决策和付费主体相对一致，用户是组织

## 产品价值不同
- 产品价值≈单用户价值x用户规模x价值发生次数
- 产品价值≈业务价值x流程覆盖度x组织采用率

## 差异点
- 需求分析的方法不同
  - C 端: 从"人"出发 —— 用户是谁、在什么场景、有什么需求
  - B 端: 从"业务"出发 —— 业务流程、角色、业务对象、状态、规则
- 工作方法区别
  - C 端靠实验 —— 假设 → MVP → 实验 → 数据 → 迭代
  - B 端靠建模 —— 业务理解 → 抽象建模 → 产品方案 → 实施 → 验证
- 对于"用户体验"的理解
  - B端体验更强调完成任务的效率，降低业务操作成本
  - C端体验经常是好看、好理解、顺手、有爽感

## 核心问题
- C端: 用户为什么用? 为什么持续用?
- B端: 业务为什么这样运行? 系统怎样让它运行得更高效、更稳定?`

let idSeed = 1
function generateId(): string {
  return `node-${Date.now()}-${idSeed++}`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

interface D3NodeDatum {
  content?: string
  state?: {
    path?: string
    rect?: {
      x: number
      y: number
      width: number
      height: number
    }
  }
}

interface D3LinkData {
  source?: D3NodeDatum
  target?: D3NodeDatum
}

/**
 * 依据真实 DOM 节点边界与 D3 坐标计算紧密贴合、绝对居中的正交折线
 * 彻底消除虚增宽度与缝隙：源节点右边缘 (x1, y1) -> midX -> 垂直分支 -> 目标节点左边缘 (x2, y2)
 */
export function getOrthogonalStepPath(pathEl: SVGPathElement, d: string): string {
  if (!d) return d

  // 1. 尝试从 D3 __data__ 中提取节点信息与精确物理边界
  const data = (pathEl as unknown as { __data__?: D3LinkData }).__data__
  if (data?.source?.state?.rect && data?.target?.state?.rect) {
    const src = data.source.state.rect
    const tgt = data.target.state.rect

    let realSrcWidth = src.width
    let realSrcHeight = src.height
    let realTgtHeight = tgt.height
    let srcLevel = 2 // 0: root, 1: level 1, 2: level 2+
    let tgtLevel = 2

    const svg = pathEl.ownerSVGElement
    if (svg) {
      const srcIdMatch = data.source.content?.match(/data-node-id="([^"]+)"/)
      const srcId = srcIdMatch ? srcIdMatch[1] : null
      const tgtIdMatch = data.target.content?.match(/data-node-id="([^"]+)"/)
      const tgtId = tgtIdMatch ? tgtIdMatch[1] : null

      if (srcId) {
        const srcEl = svg.querySelector<HTMLElement>(`.mm-node-item[data-node-id="${srcId}"]`)
        if (srcEl && srcEl.offsetWidth > 0) {
          // offsetWidth 为纯物理元素宽度（绝不包含浮动操作按钮等溢出内容）
          realSrcWidth = srcEl.offsetWidth
          realSrcHeight = srcEl.offsetHeight
          if (srcEl.classList.contains('mm-node-root')) srcLevel = 0
          else if (srcEl.classList.contains('mm-node-l1')) srcLevel = 1
        }
      }

      if (tgtId) {
        const tgtEl = svg.querySelector<HTMLElement>(`.mm-node-item[data-node-id="${tgtId}"]`)
        if (tgtEl && tgtEl.offsetHeight > 0) {
          realTgtHeight = tgtEl.offsetHeight
          if (tgtEl.classList.contains('mm-node-l1')) tgtLevel = 1
          else if (tgtEl.classList.contains('mm-node-root')) tgtLevel = 0
        }
      }
    }

    // 源节点右侧边垂直居中点：
    // 若源为卡片（根或一级），微调 -1px 穿透进入边框内部；若为纯文本，微调 -2px 紧贴末字；绝不在右侧留下断裂空隙
    const srcOffset = srcLevel <= 1 ? -1 : -2
    const x1 = Math.round(src.x + realSrcWidth + srcOffset)
    const y1 = Math.round(src.y + realSrcHeight / 2)

    // 目标节点左侧边垂直居中点：
    // 若目标为一级节点（卡片边框），连线进入 tgt.x + 1 闭合入边框内；
    // 若目标为二级纯文字（padding-left: 2px），连线进入 tgt.x + 2 紧密贴合文字左沿，彻底闭合悬空空隙！
    const tgtOffset = tgtLevel === 1 ? 1 : 2
    const x2 = Math.round(tgt.x + tgtOffset)
    const y2 = Math.round(tgt.y + realTgtHeight / 2)

    // 同一水平高度直接一条直线闭合
    if (Math.abs(y1 - y2) < 1.5) {
      return `M${x1},${y1}L${x2},${y2}`
    }

    // 垂直总线拐点 midX：在源节点右侧紧凑引出，折角后直通目标节点
    const deltaX = x2 - x1
    let midX: number
    if (deltaX > 20) {
      midX = Math.round(x1 + Math.max(14, Math.min(20, deltaX * 0.42)))
    } else if (deltaX < -20) {
      midX = Math.round(x1 - Math.max(14, Math.min(20, Math.abs(deltaX) * 0.42)))
    } else {
      midX = Math.round((x1 + x2) / 2)
    }

    return `M${x1},${y1}L${midX},${y1}L${midX},${y2}L${x2},${y2}`
  }

  // 2. 兜底方案：从 d 字符串提取端点并向上平移校准至垂直居中
  return curveToStepPath(d)
}

/**
 * 将曲线 path d 转换为幕布风格的正交折线（带垂直居中校准兜底）
 */
export function curveToStepPath(d: string): string {
  if (!d) return d
  const nums = d.match(/-?[\d.]+/g)
  if (!nums || nums.length < 4) return d

  const x1 = parseFloat(nums[0])
  let y1 = parseFloat(nums[1])
  const x2 = parseFloat(nums[nums.length - 2])
  let y2 = parseFloat(nums[nums.length - 1])

  if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) return d

  // Markmap 默认连线落在节点底部，若无 __data__ 则向上偏移校准至垂直居中
  if (d.includes('C')) {
    y1 = Math.round(y1 - 13)
    y2 = Math.round(y2 - 13)
  }

  if (Math.abs(y1 - y2) < 1.5) {
    return `M${x1},${y1}L${x2},${y2}`
  }

  const deltaX = x2 - x1
  let midX: number
  if (deltaX > 20) {
    midX = Math.round(x1 + Math.max(16, Math.min(22, deltaX * 0.42)))
  } else if (deltaX < -20) {
    midX = Math.round(x1 - Math.max(16, Math.min(22, Math.abs(deltaX) * 0.42)))
  } else {
    midX = Math.round((x1 + x2) / 2)
  }

  return `M${x1},${y1}L${midX},${y1}L${midX},${y2}L${x2},${y2}`
}

// ── 全局拦截 SVGPathElement.setAttribute，确保 D3 / Markmap 写入的所有 d 属性即时转为垂直居中折线 ──
if (
  typeof window !== 'undefined' &&
  window.SVGPathElement &&
  !(window as unknown as { __mm_step_path_patched?: boolean }).__mm_step_path_patched
) {
  const win = window as unknown as { __mm_step_path_patched?: boolean }
  win.__mm_step_path_patched = true

  const origSetAttribute = SVGPathElement.prototype.setAttribute
  SVGPathElement.prototype.setAttribute = function (name: string, value: string): void {
    if (name === 'd' && typeof value === 'string') {
      if (this.classList.contains('markmap-link') || this.closest?.('svg.markmap')) {
        value = getOrthogonalStepPath(this, value)
      }
    }
    origSetAttribute.call(this, name, value)
  }

  const origSetAttributeNS = SVGPathElement.prototype.setAttributeNS
  SVGPathElement.prototype.setAttributeNS = function (
    ns: string | null,
    name: string,
    value: string
  ): void {
    if (name === 'd' && typeof value === 'string') {
      if (this.classList.contains('markmap-link') || this.closest?.('svg.markmap')) {
        value = getOrthogonalStepPath(this, value)
      }
    }
    origSetAttributeNS.call(this, ns, name, value)
  }
}

/**
 * 递归深拷贝 MindNode 树
 */
export function cloneTree(root: MindNode): MindNode {
  return {
    ...root,
    children: root.children.map((c) => cloneTree(c))
  }
}

/**
 * 递归查找指定 ID 节点
 */
export function findNode(root: MindNode, id: string): MindNode | null {
  if (root.id === id) return root
  for (const child of root.children) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
}

/**
 * 将 Markdown 文本解析为规范的 MindNode 树
 */
export function parseMarkdownToTree(markdown: string): MindNode {
  const lines = markdown.split('\n')
  let root: MindNode | null = null
  const stack: Array<{ level: number; node: MindNode }> = []

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (!line.trim()) continue

    const trimmed = line.trimStart()
    const indent = line.length - trimmed.length

    let content = ''
    let level = 0

    if (trimmed.startsWith('# ')) {
      level = 0
      content = trimmed.replace(/^#\s+/, '').trim()
    } else if (trimmed.startsWith('## ')) {
      level = 1
      content = trimmed.replace(/^##\s+/, '').trim()
    } else if (trimmed.startsWith('### ')) {
      level = 2
      content = trimmed.replace(/^###\s+/, '').trim()
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      level = 2 + Math.floor(indent / 2)
      content = trimmed.replace(/^[-*]\s+/, '').trim()
    } else {
      continue
    }

    const node: MindNode = {
      id: generateId(),
      content: content || '未命名分支',
      children: [],
      fold: false
    }

    if (!root) {
      root = node
      stack.push({ level: 0, node })
      continue
    }

    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop()
    }

    if (stack.length > 0) {
      stack[stack.length - 1].node.children.push(node)
    } else {
      root.children.push(node)
    }

    stack.push({ level, node })
  }

  return root || { id: generateId(), content: '思维导图', children: [], fold: false }
}

/**
 * 将 MindNode 树序列化为干净的标准 Markdown 文本
 */
export function treeToMarkdown(root: MindNode): string {
  if (!root) return '# 思维导图\n'
  const lines: string[] = [`# ${root.content}`, '']

  function walk(node: MindNode, depth: number): void {
    if (!node.children || node.children.length === 0) return
    for (const child of node.children) {
      if (depth === 1) {
        lines.push('')
        lines.push(`## ${child.content}`)
      } else {
        const indent = '  '.repeat(depth - 2)
        lines.push(`${indent}- ${child.content}`)
      }
      walk(child, depth + 1)
    }
  }

  walk(root, 1)
  return lines.join('\n').trim()
}

/**
 * 将 MindNode 树转换为 Markmap INode
 * 节点采用黑白灰层级样式：
 * - 根节点：黑底白字圆角块
 * - 一级节点：浅灰底黑字圆角块
 * - 二级及以上：纯文字透明底
 */
function convertToMarkmapNode(
  node: MindNode,
  depth: number,
  selectedId: string | null = null
): INode {
  const isSelected = node.id === selectedId
  const hasChildren = node.children.length > 0
  const isFolded = Boolean(node.fold)

  let levelClass = 'mm-node-l2'
  if (depth === 0) levelClass = 'mm-node-root'
  else if (depth === 1) levelClass = 'mm-node-l1'

  const foldIconSvg = isFolded
    ? '<svg width="7" height="7" viewBox="0 0 24 24" fill="currentColor" style="pointer-events:none;"><polygon points="7,5 17,12 7,19"></polygon></svg>'
    : '<svg width="7" height="7" viewBox="0 0 24 24" fill="currentColor" style="pointer-events:none;"><polygon points="17,5 7,12 17,19"></polygon></svg>'

  const plusIconSvg = '<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" style="pointer-events:none;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>'

  const contentHtml = `
    <span class="mm-node-item ${levelClass} ${isSelected ? 'mm-selected' : ''}" data-node-id="${node.id}" data-depth="${depth}">
      <span class="mm-node-title" data-node-id="${node.id}" tabindex="-1">${escapeHtml(node.content)}</span>
      <span class="mm-node-btns-anchor">
        <span class="mm-node-btns ${isFolded ? 'has-folded' : ''}">
          <span class="mm-btn mm-btn-add" data-action="add" data-node-id="${node.id}" title="添加子节点 (Tab)">${plusIconSvg}</span>
          ${
            hasChildren
              ? `<span class="mm-btn mm-btn-fold ${isFolded ? 'is-folded' : ''}" data-action="fold" data-node-id="${node.id}" title="${
                  isFolded ? '展开子节点' : '收起子节点'
                }">${foldIconSvg}</span>`
              : ''
          }
        </span>
      </span>
    </span>
  `.trim()

  return {
    content: contentHtml,
    payload: {
      fold: isFolded ? 1 : 0
    },
    state: {},
    children: isFolded
      ? []
      : node.children.map((child) => convertToMarkmapNode(child, depth + 1, selectedId))
  } as unknown as INode
}

export default function LocalMindmapPanel(): JSX.Element {
  const [viewMode, setViewMode] = useState<'mindmap' | 'markdown'>('mindmap')

  // Markdown 与树
  const [markdown, setMarkdown] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved !== null ? saved : DEFAULT_MARKDOWN
    } catch {
      return DEFAULT_MARKDOWN
    }
  })

  const [tree, setTree] = useState<MindNode>(() => parseMarkdownToTree(markdown))
  const treeRef = useRef<MindNode>(tree)
  treeRef.current = tree

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const selectedNodeIdRef = useRef<string | null>(null)
  selectedNodeIdRef.current = selectedNodeId

  // 引用与标志
  const editingNodeIdRef = useRef<string | null>(null)
  const isComposingRef = useRef<boolean>(false)

  // 历史栈 (Undo / Redo)
  const historyRef = useRef<string[]>([markdown])
  const historyIndexRef = useRef<number>(0)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const updateHistoryState = useCallback(() => {
    setCanUndo(historyIndexRef.current > 0)
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1)
  }, [])

  // 提交树变动并保存
  const commitTreeChange = useCallback(
    (newTree: MindNode) => {
      const newMd = treeToMarkdown(newTree)
      setTree(newTree)
      setMarkdown(newMd)

      historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1)
      historyRef.current.push(newMd)
      historyIndexRef.current = historyRef.current.length - 1
      updateHistoryState()

      try {
        localStorage.setItem(STORAGE_KEY, newMd)
      } catch (err) {
        console.warn('[LocalMindmap] 持久化失败:', err)
      }
    },
    [updateHistoryState]
  )

  // 撤回 / 重做
  const handleUndo = useCallback(() => {
    if (historyIndexRef.current <= 0) return
    historyIndexRef.current -= 1
    const prevMd = historyRef.current[historyIndexRef.current]
    const parsed = parseMarkdownToTree(prevMd)
    setTree(parsed)
    setMarkdown(prevMd)
    editingNodeIdRef.current = null
    updateHistoryState()
    try {
      localStorage.setItem(STORAGE_KEY, prevMd)
    } catch {
      // ignore
    }
  }, [updateHistoryState])

  const handleRedo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return
    historyIndexRef.current += 1
    const nextMd = historyRef.current[historyIndexRef.current]
    const parsed = parseMarkdownToTree(nextMd)
    setTree(parsed)
    setMarkdown(nextMd)
    editingNodeIdRef.current = null
    updateHistoryState()
    try {
      localStorage.setItem(STORAGE_KEY, nextMd)
    } catch {
      // ignore
    }
  }, [updateHistoryState])

  // Toast 提示
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null)
  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToastMessage(msg)
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null)
    }, 1800)
  }, [])

  // Markmap 引用
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const markmapRef = useRef<Markmap | null>(null)

  // 强制全量将当前 SVG 内所有曲线转为折线，并校准 foreignObject 起始坐标
  const convertLinksToStep = useCallback(() => {
    if (!svgRef.current) return
    const foreignObjects = svgRef.current.querySelectorAll<SVGForeignObjectElement>('foreignObject.markmap-foreign')
    foreignObjects.forEach((fo) => {
      if (fo.getAttribute('x') !== '0') {
        fo.setAttribute('x', '0')
      }
    })
    const links = svgRef.current.querySelectorAll<SVGPathElement>('path.markmap-link')
    links.forEach((path) => {
      const d = path.getAttribute('d')
      if (d) {
        const stepD = getOrthogonalStepPath(path, d)
        if (stepD !== d) {
          path.setAttribute('d', stepD)
        }
      }
    })
  }, [])

  // ── 提交正在就地编辑的节点 ──
  const commitCurrentEditing = useCallback(
    (customText?: string) => {
      const currentId = editingNodeIdRef.current
      if (!currentId || !svgRef.current) return

      const nodeItem = svgRef.current.querySelector<HTMLElement>(`.mm-node-item[data-node-id="${currentId}"]`)
      const titleEl = svgRef.current.querySelector<HTMLElement>(`.mm-node-title[data-node-id="${currentId}"]`)

      let text = customText !== undefined ? customText : (titleEl?.textContent || '').trim()
      if (!text) {
        text = titleEl?.getAttribute('data-original-text') || '未命名分支'
      }

      if (titleEl) {
        titleEl.removeAttribute('contenteditable')
        titleEl.removeAttribute('data-original-text')
        titleEl.blur()
      }
      if (nodeItem) {
        nodeItem.classList.remove('mm-editing')
      }

      editingNodeIdRef.current = null

      const currentTree = treeRef.current
      const cloned = cloneTree(currentTree)
      const target = findNode(cloned, currentId)
      if (target && target.content !== text) {
        target.content = text
        commitTreeChange(cloned)
      }
    },
    [commitTreeChange]
  )

  // ── 取消就地编辑 ──
  const cancelEditing = useCallback(() => {
    const currentId = editingNodeIdRef.current
    if (!currentId || !svgRef.current) return

    const nodeItem = svgRef.current.querySelector<HTMLElement>(`.mm-node-item[data-node-id="${currentId}"]`)
    const titleEl = svgRef.current.querySelector<HTMLElement>(`.mm-node-title[data-node-id="${currentId}"]`)

    if (titleEl) {
      const orig = titleEl.getAttribute('data-original-text')
      if (orig !== null) {
        titleEl.textContent = orig
      }
      titleEl.removeAttribute('contenteditable')
      titleEl.removeAttribute('data-original-text')
      titleEl.blur()
    }
    if (nodeItem) {
      nodeItem.classList.remove('mm-editing')
    }

    editingNodeIdRef.current = null
  }, [])

  // ── 在节点的形状内部开启就地编辑 ──
  const startEditingNode = useCallback(
    (nodeId: string, initialText?: string, selectAll = true) => {
      if (!svgRef.current) return
      const nodeItem = svgRef.current.querySelector<HTMLElement>(`.mm-node-item[data-node-id="${nodeId}"]`)
      const titleEl = svgRef.current.querySelector<HTMLElement>(`.mm-node-title[data-node-id="${nodeId}"]`)
      if (!nodeItem || !titleEl) return

      // 若之前有节点在编辑，先保存
      if (editingNodeIdRef.current && editingNodeIdRef.current !== nodeId) {
        commitCurrentEditing()
      }

      editingNodeIdRef.current = nodeId
      setSelectedNodeId(nodeId)

      const origText = titleEl.textContent || ''
      titleEl.setAttribute('data-original-text', origText)

      if (initialText !== undefined) {
        titleEl.textContent = initialText
      }

      nodeItem.classList.add('mm-editing')
      titleEl.setAttribute('contenteditable', 'true')
      titleEl.setAttribute('spellcheck', 'false')

      titleEl.focus()

      try {
        const sel = window.getSelection()
        if (sel) {
          sel.removeAllRanges()
          const range = document.createRange()
          if (selectAll) {
            range.selectNodeContents(titleEl)
          } else {
            range.selectNodeContents(titleEl)
            range.collapse(false) // 光标置于末尾
          }
          sel.addRange(range)
        }
      } catch (err) {
        console.warn('[LocalMindmap] selectNodeContents warning:', err)
      }
    },
    [commitCurrentEditing]
  )

  // ── 添加子节点 (就地直接在形状内输入) ──
  const handleAddChild = useCallback(
    (parentId: string) => {
      if (editingNodeIdRef.current) {
        commitCurrentEditing()
      }

      const currentTree = treeRef.current
      const cloned = cloneTree(currentTree)
      const target = findNode(cloned, parentId)
      if (!target) return

      const newId = generateId()
      const newChild: MindNode = {
        id: newId,
        content: '新建节点',
        children: [],
        fold: false
      }
      target.children.push(newChild)
      target.fold = false

      commitTreeChange(cloned)
      setSelectedNodeId(newId)

      // 等待 DOM 更新后就地启动编辑
      requestAnimationFrame(() => {
        setTimeout(() => {
          startEditingNode(newId, '新建节点', true)
        }, 50)
      })
    },
    [commitTreeChange, commitCurrentEditing, startEditingNode]
  )

  // ── 删除节点 ──
  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      const currentTree = treeRef.current
      if (nodeId === currentTree.id) {
        showToast('根节点不能删除')
        return
      }

      const cloned = cloneTree(currentTree)
      const remove = (parent: MindNode): boolean => {
        const idx = parent.children.findIndex((c) => c.id === nodeId)
        if (idx !== -1) {
          parent.children.splice(idx, 1)
          return true
        }
        for (const child of parent.children) {
          if (remove(child)) return true
        }
        return false
      }

      if (remove(cloned)) {
        commitTreeChange(cloned)
        if (selectedNodeIdRef.current === nodeId) {
          setSelectedNodeId(null)
        }
        if (editingNodeIdRef.current === nodeId) {
          editingNodeIdRef.current = null
        }
        showToast('已删除节点')
      }
    },
    [commitTreeChange, showToast]
  )

  // ── 折叠 / 展开单个节点 ──
  const handleToggleFoldNode = useCallback(
    (nodeId: string) => {
      const currentTree = treeRef.current
      const cloned = cloneTree(currentTree)
      const target = findNode(cloned, nodeId)
      if (!target) return

      target.fold = !target.fold
      commitTreeChange(cloned)
    },
    [commitTreeChange]
  )

  // ── 全部展开 ──
  const handleExpandAll = useCallback(() => {
    const currentTree = treeRef.current
    const cloned = cloneTree(currentTree)
    const setExpand = (n: MindNode) => {
      n.fold = false
      n.children.forEach(setExpand)
    }
    setExpand(cloned)
    commitTreeChange(cloned)
    setTimeout(() => {
      markmapRef.current?.fit()
      convertLinksToStep()
    }, 50)
    showToast('已展开所有节点')
  }, [commitTreeChange, convertLinksToStep, showToast])

  // ── 全部收起 ──
  const handleFoldAll = useCallback(() => {
    const currentTree = treeRef.current
    const cloned = cloneTree(currentTree)
    const setFold = (n: MindNode, depth: number) => {
      if (depth >= 1 && n.children.length > 0) {
        n.fold = true
      }
      n.children.forEach((c) => setFold(c, depth + 1))
    }
    setFold(cloned, 0)
    commitTreeChange(cloned)
    setTimeout(() => {
      markmapRef.current?.fit()
      convertLinksToStep()
    }, 50)
    showToast('已收起子节点')
  }, [commitTreeChange, convertLinksToStep, showToast])

  // ── 同步高亮选中状态类名（直接操作 DOM 避免重新渲染销毁输入状态） ──
  const syncSelectionClass = useCallback((nodeId: string | null) => {
    if (!svgRef.current) return
    svgRef.current.querySelectorAll('.mm-node-item.mm-selected').forEach((el) => {
      if (el.getAttribute('data-node-id') !== nodeId) {
        el.classList.remove('mm-selected')
      }
    })
    if (nodeId) {
      const el = svgRef.current.querySelector(`.mm-node-item[data-node-id="${nodeId}"]`)
      el?.classList.add('mm-selected')
    }
  }, [])

  // ── 渲染 Markmap（仅在 tree 或 viewMode 变动时调用 setData，避免编辑时重绘 DOM） ──
  useEffect(() => {
    if (viewMode !== 'mindmap' || !svgRef.current) return

    const markmapRoot = convertToMarkmapNode(tree, 0, selectedNodeIdRef.current)

    if (!markmapRef.current) {
      const mm = Markmap.create(
        svgRef.current,
        {
          autoFit: false, // 彻底禁用内部自动 fit，防止编辑/增删节点时视口跳动缩放
          duration: 0,
          initialExpandLevel: -1,
          color: () => '#a1a1aa',
          paddingX: 0, // 彻底消除 foreignObject 的 8px 空隙，让连线完美贴合节点卡片和文字两端！
          spacingHorizontal: 46, // 大幅缩短水平连线距离，从默认 80px 降至 46px，紧凑协调
          spacingVertical: 6
        },
        markmapRoot
      )
      markmapRef.current = mm
      // 仅在首次挂载创建画布时自适应居中一次
      mm.fit()
    } else {
      markmapRef.current.setOptions({
        paddingX: 0,
        spacingHorizontal: 46,
        spacingVertical: 6
      })
      void markmapRef.current.setData(markmapRoot).then(() => {
        convertLinksToStep()
        syncSelectionClass(selectedNodeIdRef.current)
      })
    }

    convertLinksToStep()
    syncSelectionClass(selectedNodeIdRef.current)
    requestAnimationFrame(() => {
      convertLinksToStep()
      syncSelectionClass(selectedNodeIdRef.current)
    })
  }, [viewMode, tree, convertLinksToStep, syncSelectionClass])

  // ── 选中态变化时即时同步 DOM 类名 ──
  useEffect(() => {
    syncSelectionClass(selectedNodeId)
  }, [selectedNodeId, syncSelectionClass])

  // ── MutationObserver 监听 SVG 内部路径变化，确保任何时刻连线都是垂直居中直角折线 ──
  useEffect(() => {
    if (!svgRef.current) return

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'd') {
          const path = m.target as SVGPathElement
          const d = path.getAttribute('d')
          if (d && d.includes('C')) {
            const stepD = getOrthogonalStepPath(path, d)
            if (stepD !== d) {
              path.setAttribute('d', stepD)
            }
          }
        } else if (m.type === 'childList') {
          m.addedNodes.forEach((node) => {
            if (node instanceof SVGPathElement && node.classList.contains('markmap-link')) {
              const d = node.getAttribute('d')
              if (d) {
                const stepD = getOrthogonalStepPath(node, d)
                if (stepD !== d) {
                  node.setAttribute('d', stepD)
                }
              }
            }
          })
        }
      }
    })

    observer.observe(svgRef.current, {
      subtree: true,
      attributes: true,
      childList: true,
      attributeFilter: ['d']
    })

    return () => observer.disconnect()
  }, [])

  // ── 监听尺寸变化自适应（仅在实际窗口尺寸发生显著变化时才重适应） ──
  useEffect(() => {
    if (!containerRef.current || viewMode !== 'mindmap') return

    let lastW = containerRef.current.clientWidth || 0
    let lastH = containerRef.current.clientHeight || 0

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (lastW > 0 && lastH > 0 && (Math.abs(width - lastW) > 40 || Math.abs(height - lastH) > 40)) {
          lastW = width
          lastH = height
          markmapRef.current?.fit()
          convertLinksToStep()
        } else if (lastW === 0 || lastH === 0) {
          lastW = width
          lastH = height
        }
      }
    })

    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [viewMode, convertLinksToStep])

  // ── 捕获阶段代理鼠标交互（避免 Markmap 内部 stopPropagation 拦截双击与点击） ──
  useEffect(() => {
    const container = containerRef.current
    if (!container || viewMode !== 'mindmap') return

    const handleClickCapture = (e: MouseEvent): void => {
      const target = e.target as HTMLElement

      // 点击了按钮 (+ 或折叠)，精确向上寻找 [data-action]
      const actionBtn = target.closest<HTMLElement>('[data-action]')
      if (actionBtn) {
        const action = actionBtn.getAttribute('data-action')
        const actionNodeId = actionBtn.getAttribute('data-node-id')
        if (action === 'add' && actionNodeId) {
          e.stopPropagation()
          e.preventDefault()
          handleAddChild(actionNodeId)
          return
        }
        if (action === 'fold' && actionNodeId) {
          e.stopPropagation()
          e.preventDefault()
          handleToggleFoldNode(actionNodeId)
          return
        }
      }

      // 智能全方位探测点击的节点元素：支持点击在节点本体、内部文字、或外层容器 div/foreignObject
      const nodeItem =
        target.closest<HTMLElement>('.mm-node-item') ||
        target.closest<HTMLElement>('.markmap-node')?.querySelector<HTMLElement>('.mm-node-item') ||
        target.closest<HTMLElement>('foreignObject')?.querySelector<HTMLElement>('.mm-node-item')

      if (nodeItem) {
        const nodeId = nodeItem.getAttribute('data-node-id')
        if (nodeId) {
          // 如果当前正在编辑此节点，允许原生光标定位
          if (editingNodeIdRef.current === nodeId) {
            return
          }

          // 如果正在编辑其他节点，先提交
          if (editingNodeIdRef.current) {
            commitCurrentEditing()
          }

          // 如果点击的是已经选中的节点，直接进入编辑模式
          if (selectedNodeIdRef.current === nodeId) {
            startEditingNode(nodeId, undefined, false)
          } else {
            setSelectedNodeId(nodeId)
            syncSelectionClass(nodeId)
          }
          return
        }
      }

      // 点击空白背景
      if (editingNodeIdRef.current) {
        commitCurrentEditing()
      }
      setSelectedNodeId(null)
      syncSelectionClass(null)
    }

    const handleDblClickCapture = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      const nodeItem =
        target.closest<HTMLElement>('.mm-node-item') ||
        target.closest<HTMLElement>('.markmap-node')?.querySelector<HTMLElement>('.mm-node-item') ||
        target.closest<HTMLElement>('foreignObject')?.querySelector<HTMLElement>('.mm-node-item')

      if (nodeItem) {
        const nodeId = nodeItem.getAttribute('data-node-id')
        if (nodeId) {
          e.stopPropagation()
          e.preventDefault()
          startEditingNode(nodeId, undefined, true)
        }
      }
    }

    const handleFocusOutCapture = (e: FocusEvent): void => {
      const target = e.target as HTMLElement
      if (target.classList.contains('mm-node-title') && editingNodeIdRef.current) {
        // 如果焦点移出节点外部，提交编辑
        setTimeout(() => {
          if (!document.activeElement?.classList.contains('mm-node-title')) {
            commitCurrentEditing()
          }
        }, 30)
      }
    }

    const handleCompositionStart = (): void => {
      isComposingRef.current = true
    }

    const handleCompositionEnd = (): void => {
      isComposingRef.current = false
    }

    container.addEventListener('click', handleClickCapture, true)
    container.addEventListener('dblclick', handleDblClickCapture, true)
    container.addEventListener('focusout', handleFocusOutCapture, true)
    container.addEventListener('compositionstart', handleCompositionStart, true)
    container.addEventListener('compositionend', handleCompositionEnd, true)

    return () => {
      container.removeEventListener('click', handleClickCapture, true)
      container.removeEventListener('dblclick', handleDblClickCapture, true)
      container.removeEventListener('focusout', handleFocusOutCapture, true)
      container.removeEventListener('compositionstart', handleCompositionStart, true)
      container.removeEventListener('compositionend', handleCompositionEnd, true)
    }
  }, [
    viewMode,
    selectedNodeId,
    handleAddChild,
    handleToggleFoldNode,
    commitCurrentEditing,
    startEditingNode
  ])

  // ── 键盘交互（Tab 新增、Delete 删除、点击选中后直接输入覆盖、Enter 编辑/提交） ──
  useEffect(() => {
    if (viewMode !== 'mindmap') return

    const handleKeyDown = (e: KeyboardEvent): void => {
      // 1. 正在处于就地编辑态
      if (editingNodeIdRef.current) {
        if (e.key === 'Enter' && !isComposingRef.current) {
          e.preventDefault()
          e.stopPropagation()
          commitCurrentEditing()
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          cancelEditing()
          return
        }
        if (e.key === 'Tab') {
          e.preventDefault()
          e.stopPropagation()
          const parentId = editingNodeIdRef.current
          commitCurrentEditing()
          handleAddChild(parentId)
          return
        }
        // 其余按键阻止向外冒泡，避免触发外部快捷键或误删节点
        e.stopPropagation()
        return
      }

      // 2. 非编辑态：撤回 / 重做
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        handleUndo()
        return
      }
      if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault()
        handleRedo()
        return
      }

      // 3. 节点选中状态下的交互
      if (selectedNodeId) {
        // Tab: 新增子节点
        if (e.key === 'Tab') {
          e.preventDefault()
          handleAddChild(selectedNodeId)
          return
        }

        // Delete / Backspace: 删除节点
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault()
          handleDeleteNode(selectedNodeId)
          return
        }

        // Enter: 进入就地编辑
        if (e.key === 'Enter') {
          e.preventDefault()
          startEditingNode(selectedNodeId, undefined, true)
          return
        }

        // 直接点击选中后打字（覆盖原有文字并就地编辑）
        if (
          e.key.length === 1 &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          e.key !== ' '
        ) {
          e.preventDefault()
          startEditingNode(selectedNodeId, e.key, false)
          return
        }

        // 输入法中文打字启动
        if (e.key === 'Process' || e.isComposing) {
          startEditingNode(selectedNodeId, '', false)
          return
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    viewMode,
    selectedNodeId,
    commitCurrentEditing,
    cancelEditing,
    handleAddChild,
    handleDeleteNode,
    handleUndo,
    handleRedo,
    startEditingNode
  ])

  // Markdown 文本域修改
  const handleMarkdownTextareaChange = useCallback(
    (newVal: string) => {
      setMarkdown(newVal)
      try {
        localStorage.setItem(STORAGE_KEY, newVal)
      } catch {
        // ignore
      }
      const parsed = parseMarkdownToTree(newVal)
      setTree(parsed)
      historyRef.current.push(newVal)
      historyIndexRef.current = historyRef.current.length - 1
      updateHistoryState()
    },
    [updateHistoryState]
  )

  // 导出 SVG
  const handleExportSvg = useCallback(() => {
    if (!svgRef.current) return
    try {
      const serializer = new XMLSerializer()
      let svgStr = serializer.serializeToString(svgRef.current)
      if (!svgStr.includes('xmlns="http://www.w3.org/2000/svg"')) {
        svgStr = svgStr.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
      }
      svgStr = svgStr.replace('>', `><style>${globalCSS}</style>`)
      const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `mindmap-${Date.now()}.svg`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast('SVG 已导出')
    } catch {
      showToast('导出失败')
    }
  }, [showToast])

  return (
    <div ref={containerRef} className="h-full w-full flex flex-col bg-white relative overflow-hidden select-text">
      {/* Markmap 基础样式与幕布风格黑白灰折线高质感样式 */}
      <style>{globalCSS}</style>
      <style>{`
        .markmap {
          width: 100%;
          height: 100%;
          background: #ffffff;
        }
        /* 隐藏原生圆形圈，使用末尾自定义展开/添加按钮 */
        .markmap-node > circle {
          display: none !important;
        }
        /* 统一黑白灰正交连线 (pointer-events none 避免遮挡节点点击) */
        .markmap-link {
          stroke: #9ca3af !important;
          stroke-width: 1.25px !important;
          fill: none !important;
          stroke-linejoin: round !important;
          stroke-linecap: round !important;
          pointer-events: none !important;
        }
        /* 隐藏默认节点底部粗线 */
        .markmap-node > line {
          display: none !important;
        }
        /* 彻底消除外层 foreignObject 与包装 div 对下层/右侧节点的透明遮挡，严格禁止竖向折行 */
        foreignObject,
        foreignObject.markmap-foreign {
          overflow: visible !important;
          pointer-events: none !important;
        }
        .markmap-foreign,
        .markmap-foreign > div,
        .markmap-foreign > div > div {
          overflow: visible !important;
          pointer-events: none !important;
          white-space: nowrap !important;
        }
        .markmap-foreign > div {
          width: max-content !important;
          max-width: none !important;
          white-space: nowrap !important;
        }
        .markmap-foreign > div > div {
          width: max-content !important;
          white-space: nowrap !important;
        }

        /* ── 节点通用样式 ── */
        .mm-node-item {
          display: inline-flex !important;
          flex-direction: row !important;
          align-items: center !important;
          position: relative;
          cursor: pointer;
          user-select: none;
          box-sizing: border-box;
          transition: background-color 0.1s ease, border-color 0.1s ease;
          border-radius: 4px;
          white-space: nowrap !important;
          width: max-content !important;
          /* 极微不可见背景，强制生成独立物理 Hit Test 判定面，保障 100% 触发 hover 与点击选中 */
          background-color: rgba(255, 255, 255, 0.001) !important;
          pointer-events: auto !important;
          overflow: visible !important;
        }

        /* 根节点：黑底白字 */
        .mm-node-root {
          background-color: #09090b !important;
          color: #ffffff !important;
          font-weight: 600 !important;
          font-size: 13.5px !important;
          padding: 6px 12px !important;
          border-radius: 4px !important;
        }
        .mm-node-root .mm-node-title {
          color: #ffffff !important;
        }

        /* 一级节点：浅灰底黑字矩形块 */
        .mm-node-l1 {
          background-color: #f4f4f5 !important;
          color: #18181b !important;
          font-weight: 500 !important;
          font-size: 12.5px !important;
          padding: 4px 10px !important;
          border-radius: 4px !important;
          border: 1px solid #e4e4e7 !important;
        }
        .mm-node-l1 .mm-node-title {
          color: #18181b !important;
        }

        /* 二级及更深分支：纯文字，padding 紧贴边缘消除悬空断裂，hover时浅灰高亮 */
        .mm-node-l2 {
          background-color: rgba(255, 255, 255, 0.001) !important;
          color: #27272a !important;
          font-weight: 400 !important;
          font-size: 12.5px !important;
          padding: 2px 3px 2px 2px !important;
          min-height: 20px !important;
          border-radius: 4px !important;
        }
        .mm-node-l2:hover {
          background-color: #f4f4f5 !important;
        }
        .mm-node-l2 .mm-node-title {
          color: #27272a !important;
        }

        /* 选中高亮边框 */
        .mm-node-item.mm-selected {
          outline: 2px solid #2563eb !important;
          outline-offset: 1px !important;
        }

        /* 正在就地编辑状态：继承节点原形原色，微蓝光标轮廓 */
        .mm-node-item.mm-editing {
          outline: 2px solid #3b82f6 !important;
          outline-offset: 1px !important;
        }

        /* 节点标题文本与就地编辑输入 */
        .mm-node-title {
          display: inline-block !important;
          min-width: 14px;
          outline: none !important;
          caret-color: currentColor;
          line-height: normal;
          white-space: nowrap !important;
        }
        .mm-node-title[contenteditable="true"] {
          cursor: text !important;
          user-select: text !important;
          -webkit-user-select: text !important;
          outline: none !important;
        }

        /* 绝对定位锚点：严格 0 宽高，绝不影响节点文本宽度，绝不引起连线起点与长度变化 */
        .mm-node-btns-anchor {
          position: absolute;
          left: 100%;
          top: 50%;
          width: 0;
          height: 0;
          pointer-events: none;
        }

        /* 浮动在节点右边缘外侧、正中覆盖在右侧连线上的按钮栏
           默认彻底 display: none，彻底从文档排版中剥离，绝不导致 scrollWidth 虚增 40px！ */
        .mm-node-btns {
          position: absolute;
          left: 4px;
          top: 0;
          transform: translateY(-50%);
          display: none;
          align-items: center;
          gap: 4px;
          z-index: 30;
          white-space: nowrap;
          pointer-events: none;
        }

        /* hover 节点或选中节点时，按钮显现覆盖在线段上 */
        .mm-node-item:hover .mm-node-btns,
        .mm-node-item.mm-selected .mm-node-btns {
          display: inline-flex !important;
          pointer-events: auto !important;
        }

        /* 若节点当前处于折叠状态，向右展开按钮在末尾常驻显示（提示可展开） */
        .mm-node-btns.has-folded {
          display: inline-flex !important;
          pointer-events: auto !important;
        }
        /* 折叠状态下未 hover 时加号隐藏，只常驻向右展开箭头 */
        .mm-node-item:not(:hover):not(.mm-selected) .mm-node-btns.has-folded .mm-btn-add {
          display: none !important;
        }

        /* 正在就地编辑时隐藏末尾操作按钮，避免遮挡打字 */
        .mm-node-item.mm-editing .mm-node-btns {
          display: none !important;
        }

        /* 圆形按钮：纯白底实心遮盖连线、黑白灰细边框微阴影 */
        .mm-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 17px;
          height: 17px;
          border-radius: 50% !important;
          background-color: #ffffff !important;
          border: 1px solid #d4d4d8 !important;
          color: #3f3f46 !important;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
          cursor: pointer;
          pointer-events: auto;
          user-select: none;
          line-height: 1;
          padding: 0;
          transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease, transform 0.12s ease;
        }
        .mm-btn:hover {
          background-color: #18181b !important;
          border-color: #18181b !important;
          color: #ffffff !important;
          transform: scale(1.12);
          box-shadow: 0 2px 5px rgba(0, 0, 0, 0.16);
        }
        .mm-btn:active {
          transform: scale(0.95);
        }
      `}</style>

      {/* 浮动 Toast 提示 */}
      {toastMessage && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-3.5 py-1.5 rounded-lg bg-gray-900/85 text-white text-xs shadow-lg backdrop-blur-sm pointer-events-none transition-all">
          {toastMessage}
        </div>
      )}

      {/* ── 画布右上角：导图 vs Markdown 切换 Tab ── */}
      <div className="absolute right-3 top-3 z-30 flex items-center bg-white/95 backdrop-blur border border-gray-200/80 p-0.5 rounded-lg shadow-sm">
        <button
          type="button"
          onClick={() => setViewMode('mindmap')}
          className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1 transition-all ${
            viewMode === 'mindmap'
              ? 'bg-gray-100 text-gray-900 font-semibold shadow-2xs'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          <span className="material-symbols-outlined text-sm">hub</span>
          <span>导图</span>
        </button>
        <button
          type="button"
          onClick={() => setViewMode('markdown')}
          className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1 transition-all ${
            viewMode === 'markdown'
              ? 'bg-gray-100 text-gray-900 font-semibold shadow-2xs'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          <span className="material-symbols-outlined text-sm">article</span>
          <span>Markdown</span>
        </button>
      </div>

      {/* ── 视图 A：思维导图交互画布 ── */}
      <div
        className="flex-1 w-full h-full relative"
        style={{ display: viewMode === 'mindmap' ? 'block' : 'none' }}
      >
        <svg
          ref={svgRef}
          className="markmap"
        />

        {/* 右下角工具栏：撤回、重做、放大、缩小、适应、展开、收起、导出 */}
        <div className="absolute right-3 bottom-3 z-20 flex items-center gap-1 p-1 bg-white/90 backdrop-blur border border-gray-200/80 rounded-lg shadow-sm">
          <button
            type="button"
            onClick={handleUndo}
            disabled={!canUndo}
            className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
              canUndo ? 'text-text-secondary hover:text-text-primary hover:bg-gray-100' : 'text-gray-300 cursor-not-allowed'
            }`}
            title="撤回 (Ctrl+Z)"
            aria-label="撤回"
          >
            <span className="material-symbols-outlined text-base">undo</span>
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={!canRedo}
            className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
              canRedo ? 'text-text-secondary hover:text-text-primary hover:bg-gray-100' : 'text-gray-300 cursor-not-allowed'
            }`}
            title="重做 (Ctrl+Y)"
            aria-label="重做"
          >
            <span className="material-symbols-outlined text-base">redo</span>
          </button>

          <div className="w-[1px] h-4 bg-gray-200 mx-0.5" />

          <button
            type="button"
            onClick={() => {
              markmapRef.current?.rescale(1.25)
              convertLinksToStep()
            }}
            className="w-7 h-7 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-gray-100 transition-colors"
            title="放大"
            aria-label="放大"
          >
            <span className="material-symbols-outlined text-base">zoom_in</span>
          </button>
          <button
            type="button"
            onClick={() => {
              markmapRef.current?.rescale(0.8)
              convertLinksToStep()
            }}
            className="w-7 h-7 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-gray-100 transition-colors"
            title="缩小"
            aria-label="缩小"
          >
            <span className="material-symbols-outlined text-base">zoom_out</span>
          </button>
          <button
            type="button"
            onClick={() => {
              markmapRef.current?.fit()
              convertLinksToStep()
            }}
            className="w-7 h-7 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-gray-100 transition-colors"
            title="适应视口居中"
            aria-label="适应视口居中"
          >
            <span className="material-symbols-outlined text-base">center_focus_strong</span>
          </button>

          <div className="w-[1px] h-4 bg-gray-200 mx-0.5" />

          <button
            type="button"
            onClick={handleExpandAll}
            className="w-7 h-7 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-gray-100 transition-colors"
            title="展开所有节点"
            aria-label="展开所有节点"
          >
            <span className="material-symbols-outlined text-base">unfold_more</span>
          </button>
          <button
            type="button"
            onClick={handleFoldAll}
            className="w-7 h-7 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-gray-100 transition-colors"
            title="收起子节点"
            aria-label="收起子节点"
          >
            <span className="material-symbols-outlined text-base">unfold_less</span>
          </button>

          <div className="w-[1px] h-4 bg-gray-200 mx-0.5" />

          <button
            type="button"
            onClick={handleExportSvg}
            className="w-7 h-7 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-gray-100 transition-colors"
            title="导出 SVG"
            aria-label="导出 SVG"
          >
            <span className="material-symbols-outlined text-base">download</span>
          </button>
        </div>

        {/* 底部极简快捷提示 */}
        <div className="absolute left-3 bottom-3 z-20 text-[11px] text-gray-400 bg-white/70 backdrop-blur px-2.5 py-1 rounded-md border border-gray-100 pointer-events-none flex items-center gap-3">
          <span>点击/双击/打字: 就地在节点中编辑</span>
          <span>Tab: 新增分支</span>
          <span>Delete: 删除</span>
        </div>
      </div>

      {/* ── 视图 B：Markdown 纯源码编辑 ── */}
      <div
        className="flex-1 w-full h-full flex flex-col overflow-hidden"
        style={{ display: viewMode === 'markdown' ? 'flex' : 'none' }}
      >
        <div className="px-3 py-2 border-b border-gray-200 bg-gray-50/70 flex items-center justify-between text-xs text-text-secondary select-none">
          <div className="flex items-center gap-1.5 font-medium text-text-primary">
            <span className="material-symbols-outlined text-sm text-zinc-700">edit_note</span>
            <span>Markdown 源码</span>
          </div>

          <div className="flex items-center gap-1 pr-24">
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(markdown)
                showToast('已复制 Markdown')
              }}
              className="p-1.5 rounded hover:bg-gray-200 text-text-secondary hover:text-text-primary transition-colors"
              title="复制 Markdown"
            >
              <span className="material-symbols-outlined text-base">content_copy</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm('确定要恢复默认模板吗？当前内容将被覆盖。')) {
                  handleMarkdownTextareaChange(DEFAULT_MARKDOWN)
                  showToast('已恢复模板')
                }
              }}
              className="p-1.5 rounded hover:bg-gray-200 text-text-secondary hover:text-text-primary transition-colors"
              title="恢复默认模板"
            >
              <span className="material-symbols-outlined text-base">restart_alt</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm('确定清空内容吗？')) {
                  handleMarkdownTextareaChange('# 思维导图\n\n- ')
                  showToast('已清空')
                }
              }}
              className="p-1.5 rounded hover:bg-gray-200 text-text-secondary hover:text-red-500 transition-colors"
              title="清空"
            >
              <span className="material-symbols-outlined text-base">delete_sweep</span>
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col">
          <textarea
            value={markdown}
            onChange={(e) => handleMarkdownTextareaChange(e.target.value)}
            placeholder="# 根节点&#10;## 一级节点&#10;- 二级节点..."
            className="flex-1 w-full h-full p-4 font-mono text-xs leading-relaxed text-text-primary bg-white focus:outline-none resize-none overflow-y-auto"
            spellCheck={false}
          />
          <div className="px-3 py-1 bg-gray-50 border-t border-gray-100 text-[11px] text-text-secondary/70 flex justify-between select-none">
            <span>Markdown 为唯一真实数据源</span>
            <span>{markdown.length} 字符</span>
          </div>
        </div>
      </div>
    </div>
  )
}
