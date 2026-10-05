import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { Markmap } from 'markmap-view'
import type { INode } from 'markmap-common'
import { cloneTree, findNode, generateId, getSelectedBranches, moveBranches, type MindNode, type MindmapDropPosition } from '../utils/mindmapTree'

interface MindmapCanvasOptions {
  tree: MindNode
  active: boolean
  editingNodeIdRef: MutableRefObject<string | null>
  onTreeChange: (tree: MindNode) => void
  handleUndo: () => void
  handleRedo: () => void
  showToast: (message: string) => void
  readOnly?: boolean
  changedLines?: number[]
  onNodeContextMenu?: (id: string, path: string[], x: number, y: number) => void
}

// 正文默认 12.5px；缩放后小于约 9px 时隐藏节点操作，避免固定尺寸按钮遮住导图。
const NODE_CONTROLS_MIN_ZOOM = 0.75

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
function getOrthogonalStepPath(pathEl: SVGPathElement, d: string): string {
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

    // 垂直总线拐点 midX：源节点与目标节点严格水平对称居中折角，大幅紧凑连线
    const midX = Math.round((x1 + x2) / 2)

    return `M${x1},${y1}L${midX},${y1}L${midX},${y2}L${x2},${y2}`
  }

  // 2. 兜底方案：从 d 字符串提取端点并向上平移校准至垂直居中
  return curveToStepPath(d)
}

/**
 * 将曲线 path d 转换为幕布风格的正交折线（带垂直居中校准兜底）
 */
function curveToStepPath(d: string): string {
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

  const midX = Math.round((x1 + x2) / 2)

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
    ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;"><polyline points="9 18 15 12 9 6"></polyline></svg>'
    : '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;"><polyline points="15 18 9 12 15 6"></polyline></svg>'

  const plusIconSvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" style="pointer-events:none;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>'

  const contentHtml = `
    <span class="mm-node-item ${levelClass} ${isSelected ? 'mm-selected' : ''}" data-node-id="${node.id}">
      <span class="mm-node-title" data-node-id="${node.id}" tabindex="-1">${escapeHtml(node.content)}</span>
      <span class="mm-node-btns-anchor">
        <span class="mm-node-btns ${isFolded ? 'has-folded' : ''}">
          <span class="mm-btn mm-btn-add" data-action="add" data-node-id="${node.id}" title="添加子节点 (Tab)">${plusIconSvg}</span>
          ${
            hasChildren
              ? `<span class="mm-btn mm-btn-fold" data-action="fold" data-node-id="${node.id}" title="${
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

export function useMindmapCanvas({
  tree,
  active,
  editingNodeIdRef,
  onTreeChange,
  handleUndo,
  handleRedo,
  showToast,
  readOnly = false,
  changedLines,
  onNodeContextMenu
}: MindmapCanvasOptions) {
  const treeRef = useRef(tree)
  treeRef.current = tree
  const changedLinesRef = useRef(changedLines)
  changedLinesRef.current = changedLines
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const selectedNodeIdsRef = useRef<string[]>([])
  const selectedNodeId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : null
  const selectedNodeIdRef = useRef<string | null>(null)
  const setSelection = useCallback((ids: string[]) => {
    selectedNodeIdsRef.current = ids
    selectedNodeIdRef.current = ids.length === 1 ? ids[0] : null
    setSelectedNodeIds(ids)
  }, [])
  const setSelectedNodeId = useCallback((id: string | null) => setSelection(id ? [id] : []), [setSelection])
  const isComposingRef = useRef(false)

  // 同步更新镜像树，保证一次事件中的后续操作读取到最新数据。
  const commitTreeChange = useCallback((nextTree: MindNode) => {
    if (readOnly) return
    treeRef.current = nextTree
    onTreeChange(nextTree)
  }, [onTreeChange, readOnly])

  // Markmap 引用
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const markmapRef = useRef<Markmap | null>(null)
  const [canvasVisible, setCanvasVisible] = useState(false)
  const needsInitialFitRef = useRef(true)

  // 隐藏容器的零尺寸会让 fit() 写入 0/NaN 缩放，后续拖动与缩放都无法恢复。
  const fitCanvas = useCallback(async (): Promise<void> => {
    const svg = svgRef.current
    const mm = markmapRef.current
    if (!svg || !mm) return
    const { width, height } = svg.getBoundingClientRect()
    const { x1, y1, x2, y2 } = mm.state.rect
    if (width <= 0 || height <= 0 || ![x1, y1, x2, y2].every(Number.isFinite) || x2 <= x1 || y2 <= y1) return
    await mm.fit()
    if (markmapRef.current === mm) needsInitialFitRef.current = false
  }, [])

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

  // ── 同步按钮尺寸和可见性；节点过小时隐藏整组操作按钮 ──
  const updateZoomCss = useCallback(() => {
    if (!svgRef.current) return
    const zoomData = (svgRef.current as unknown as { __zoom?: { k?: number } }).__zoom
    let k = zoomData?.k
    if (!k || isNaN(k) || k <= 0) {
      const g = svgRef.current.querySelector('g')
      if (g) {
        const transform = g.getAttribute('transform') || ''
        const match = transform.match(/scale\(([\d.]+)\)/)
        if (match) k = parseFloat(match[1])
      }
    }
    if (k && k > 0 && isFinite(k)) {
      const inv = Math.max(0.05, Math.min(20, 1 / k))
      svgRef.current.style.setProperty('--mm-zoom-inv', `${inv}`)
      svgRef.current.classList.toggle('mm-controls-hidden', k < NODE_CONTROLS_MIN_ZOOM)
    }
  }, [])

  // ── 提交正在就地编辑的节点 ──
  const commitCurrentEditing = useCallback(
    () => {
      if (readOnly) return
      const currentId = editingNodeIdRef.current
      if (!currentId || !svgRef.current) return

      const nodeItem = svgRef.current.querySelector<HTMLElement>(`.mm-node-item[data-node-id="${currentId}"]`)
      const titleEl = svgRef.current.querySelector<HTMLElement>(`.mm-node-title[data-node-id="${currentId}"]`)

      let text = (titleEl?.textContent || '').trim()
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
    [commitTreeChange, readOnly]
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
      if (readOnly) return
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

      // 关键：preventScroll: true 严格禁止浏览器在获取焦点时自动滚动页面或父容器，彻底杜绝画面跳动
      try {
        titleEl.focus({ preventScroll: true })
      } catch {
        titleEl.focus()
      }

      // 重置可能产生的任何容器滚动位移，确保画布绝对平稳
      if (containerRef.current) {
        containerRef.current.scrollTop = 0
        containerRef.current.scrollLeft = 0
      }

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
    [commitCurrentEditing, readOnly]
  )

  // ── 添加子节点 (就地直接在形状内输入) ──
  const handleAddChild = useCallback(
    (parentId: string) => {
      let pendingText: string | undefined
      let prevEditingId: string | null = null

      // 如果当前正在编辑某个节点，同步提取其文本并合并提交，避免两次连续更新触发画面跳动
      if (editingNodeIdRef.current && svgRef.current) {
        prevEditingId = editingNodeIdRef.current
        const curTitle = svgRef.current.querySelector<HTMLElement>(`.mm-node-title[data-node-id="${prevEditingId}"]`)
        const curItem = svgRef.current.querySelector<HTMLElement>(`.mm-node-item[data-node-id="${prevEditingId}"]`)
        if (curTitle) {
          pendingText = curTitle.textContent?.trim() || curTitle.getAttribute('data-original-text') || '未命名分支'
          curTitle.removeAttribute('contenteditable')
          curTitle.removeAttribute('data-original-text')
          try {
            curTitle.blur()
          } catch {
            // ignore
          }
        }
        if (curItem) {
          curItem.classList.remove('mm-editing')
        }
        editingNodeIdRef.current = null
      }

      const currentTree = treeRef.current
      const cloned = cloneTree(currentTree)

      if (prevEditingId && pendingText !== undefined) {
        const prevNode = findNode(cloned, prevEditingId)
        if (prevNode && prevNode.content !== pendingText) {
          prevNode.content = pendingText
        }
      }

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

      // 等待 DOM 更新后就地启动编辑，带有多次重试保障
      let retries = 0
      const tryStartEditing = () => {
        if (!svgRef.current) return
        const nodeItem = svgRef.current.querySelector<HTMLElement>(`.mm-node-item[data-node-id="${newId}"]`)
        const titleEl = svgRef.current.querySelector<HTMLElement>(`.mm-node-title[data-node-id="${newId}"]`)
        if (nodeItem && titleEl) {
          startEditingNode(newId, '新建节点', true)
        } else if (retries < 10) {
          retries++
          setTimeout(tryStartEditing, 30)
        }
      }
      setTimeout(tryStartEditing, 30)
    },
    [commitTreeChange, startEditingNode]
  )

  // ── 删除节点 ──
  const handleDeleteSelection = useCallback(
    () => {
      const currentTree = treeRef.current
      const branches = getSelectedBranches(currentTree, new Set(selectedNodeIdsRef.current))
      if (!branches.length) {
        showToast('根节点不能删除')
        return
      }
      const deleting = new Set(branches.map(node => node.id))
      const cloned = cloneTree(currentTree)
      const remove = (parent: MindNode): void => {
        parent.children = parent.children.filter(child => !deleting.has(child.id))
        parent.children.forEach(remove)
      }
      remove(cloned)
      editingNodeIdRef.current = null
      setSelection([])
      commitTreeChange(cloned)
      showToast(`已删除 ${branches.length} 个分支及其子节点`)
    },
    [commitTreeChange, setSelection, showToast]
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
      void fitCanvas().then(() => {
        convertLinksToStep()
        updateZoomCss()
      })
    }, 50)
    showToast('已展开所有节点')
  }, [commitTreeChange, fitCanvas, convertLinksToStep, updateZoomCss, showToast])

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
      void fitCanvas().then(() => {
        convertLinksToStep()
        updateZoomCss()
      })
    }, 50)
    showToast('已收起子节点')
  }, [commitTreeChange, fitCanvas, convertLinksToStep, updateZoomCss, showToast])

  // ── 同步高亮选中状态类名（直接操作 DOM 避免重新渲染销毁输入状态） ──
  const syncSelectionClass = useCallback(() => {
    if (!svgRef.current) return
    const selected = new Set(selectedNodeIdsRef.current)
    const changed = new Set(changedLinesRef.current || [])
    svgRef.current.classList.toggle('mm-readonly', readOnlyRef.current)
    svgRef.current.querySelectorAll('.mm-node-item').forEach((el) => {
      el.classList.toggle('mm-selected', selected.has(el.getAttribute('data-node-id') || ''))
      const node = findNode(treeRef.current, el.getAttribute('data-node-id') || '')
      el.classList.toggle('mm-changed', node?.sourceLine !== undefined && changed.has(node.sourceLine))
    })
  }, [])

  // ── 渲染 Markmap（仅在 tree 或 active 变动时调用 setData，避免编辑时重绘 DOM） ──
  useEffect(() => {
    const svg = svgRef.current
    if (!active || !canvasVisible || !svg) return
    const { width, height } = svg.getBoundingClientRect()
    if (width <= 0 || height <= 0) return

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
          spacingHorizontal: 24, // 水平连线缩减一半，使导图整体更紧凑
          spacingVertical: 6
        }
      )
      markmapRef.current = mm
      // 保留滚轮缩放，鼠标平移仅使用右键；左键由框选与节点拖动处理。
      const defaultZoomFilter = mm.zoom.filter()
      mm.zoom.filter((event: MouseEvent) => event.type === 'mousedown'
        ? event.button === 2 : event.type === 'dblclick' ? false : defaultZoomFilter(event))

      // 滚轮、工具栏缩放和 fit 均通过 D3 zoom 同步按钮可见性。
      mm.zoom.on('zoom.buttonScale', updateZoomCss)

    }

    // 不给 create() 传数据，避免它在异步布局结束后无条件 fit 隐藏画布。
    const mm = markmapRef.current
    let cancelled = false
    void mm.setData(markmapRoot).then(async () => {
      if (cancelled || markmapRef.current !== mm) return
      const transform = (svg as SVGSVGElement & { __zoom?: { k: number; x: number; y: number } }).__zoom
      const invalidTransform = !transform || transform.k <= 0 || ![transform.k, transform.x, transform.y].every(Number.isFinite)
      // 首次显示或恢复失效视口时适配；正常更新保留用户的缩放和位置。
      if (needsInitialFitRef.current || invalidTransform) await fitCanvas()
      if (cancelled || markmapRef.current !== mm) return
      convertLinksToStep()
      const visibleIds = new Set(Array.from(svg.querySelectorAll('.mm-node-item'), el => el.getAttribute('data-node-id')))
      const remaining = selectedNodeIdsRef.current.filter(id => visibleIds.has(id))
      if (remaining.length !== selectedNodeIdsRef.current.length) setSelection(remaining)
      syncSelectionClass()
      updateZoomCss()
    })
    return () => { cancelled = true }
  }, [active, canvasVisible, tree, fitCanvas, convertLinksToStep, syncSelectionClass, updateZoomCss, setSelection])

  // ── 选中态变化时即时同步 DOM 类名 ──
  useEffect(() => {
    syncSelectionClass()
  }, [selectedNodeIds, changedLines, readOnly, syncSelectionClass])

  // ── MutationObserver 监听 SVG 内部路径变化，确保任何时刻连线都是垂直居中直角折线 ──
  useEffect(() => {
    if (!svgRef.current) return

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes') {
          if (m.attributeName === 'd') {
            const path = m.target as SVGPathElement
            const d = path.getAttribute('d')
            if (d && d.includes('C')) {
              const stepD = getOrthogonalStepPath(path, d)
              if (stepD !== d) {
                path.setAttribute('d', stepD)
              }
            }
          } else if (m.attributeName === 'transform') {
            if (m.target === markmapRef.current?.g.node()) updateZoomCss()
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
      attributeFilter: ['d', 'transform']
    })

    return () => observer.disconnect()
  }, [updateZoomCss])

  // ── 监听尺寸变化，校准连线与按钮缩放，保留用户视口 ──
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return

    let lastW = svg.clientWidth || 0
    let lastH = svg.clientHeight || 0

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        setCanvasVisible(width > 0 && height > 0)
        if (width <= 0 || height <= 0) {
          lastW = 0
          lastH = 0
          continue
        }
        if (lastW > 0 && lastH > 0 && (Math.abs(width - lastW) > 10 || Math.abs(height - lastH) > 10)) {
          lastW = width
          lastH = height
          // 仅重新校准连线与按钮缩放比例，绝不调用 fit() 重新居中导致画面跳动！
          convertLinksToStep()
          updateZoomCss()
        } else if (lastW === 0 || lastH === 0) {
          lastW = width
          lastH = height
        }
      }
    })

    // 观察 SVG 本身，才能感知大纲切换和祖先侧栏的 display:none。
    observer.observe(svg)
    return () => observer.disconnect()
  }, [convertLinksToStep, updateZoomCss])

  // ── 捕获阶段代理鼠标交互（避免 Markmap 内部 stopPropagation 拦截双击与点击） ──
  useEffect(() => {
    const container = containerRef.current
    if (!container || !active) return

    let suppressClick = false
    let gesture: {
      startX: number
      startY: number
      nodeId: string | null
      baseSelection: string[]
      originalSelection: string[]
      moving: boolean
      branches: MindNode[]
      overlay: HTMLDivElement | null
      drop: { id: string; position: MindmapDropPosition; element: HTMLElement } | null
    } | null = null

    const clearDrop = (): void => {
      gesture?.drop?.element.removeAttribute('data-drop-position')
      if (gesture) gesture.drop = null
    }
    const cancelGesture = (): void => {
      clearDrop()
      gesture?.overlay?.remove()
      container.classList.remove('mm-gesturing', 'mm-panning')
      container.querySelectorAll('.mm-dragging').forEach(el => el.classList.remove('mm-dragging'))
      gesture = null
    }

    const handleMouseDownCapture = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (!svgRef.current?.contains(target)) return
      suppressClick = false
      if (e.button === 2) {
        if (gesture) cancelGesture()
        if (target.closest('[contenteditable="true"]')) return
        contextStart = { x: e.clientX, y: e.clientY }
        if (editingNodeIdRef.current) commitCurrentEditing()
        container.focus({ preventScroll: true })
        container.classList.add('mm-panning')
        return
      }
      if (readOnly) return
      // 点击了操作按钮，阻止事件向下传递到 D3 zoom（避免被误判为画布拖拽手势）
      if (target.closest('[data-action]') || target.closest('.mm-node-btns')) {
        e.stopPropagation()
        return
      }
      if (e.button !== 0) return
      const nodeId = target.closest('.mm-node-item')?.getAttribute('data-node-id') || null
      if (nodeId && editingNodeIdRef.current === nodeId) {
        e.stopPropagation()
        return
      }
      if (editingNodeIdRef.current) commitCurrentEditing()
      e.preventDefault()
      e.stopPropagation()
      container.focus({ preventScroll: true })
      if (nodeId && (e.ctrlKey || e.metaKey || e.shiftKey)) {
        const ids = selectedNodeIdsRef.current
        setSelection(ids.includes(nodeId) ? ids.filter(id => id !== nodeId) : [...ids, nodeId])
        syncSelectionClass()
        suppressClick = true
        return
      }
      gesture = {
        startX: e.clientX, startY: e.clientY, nodeId,
        baseSelection: e.ctrlKey || e.metaKey || e.shiftKey ? [...selectedNodeIdsRef.current] : [],
        originalSelection: [...selectedNodeIdsRef.current],
        moving: false, branches: [], overlay: null, drop: null
      }
    }

    const handleMouseMove = (e: MouseEvent): void => {
      if (!gesture) return
      const distance = Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY)
      if (!gesture.moving && distance < 4) return
      e.preventDefault()
      if (!gesture.moving) {
        gesture.moving = true
        suppressClick = true
        container.classList.add('mm-gesturing')
        gesture.overlay = document.createElement('div')
        gesture.overlay.className = gesture.nodeId ? 'mm-drag-preview' : 'mm-selection-box'
        container.append(gesture.overlay)
        if (gesture.nodeId) {
          if (!selectedNodeIdsRef.current.includes(gesture.nodeId)) setSelection([gesture.nodeId])
          gesture.branches = getSelectedBranches(treeRef.current, new Set(selectedNodeIdsRef.current))
          gesture.overlay.textContent = gesture.branches.length
            ? `${gesture.branches[0].content}${gesture.branches.length > 1 ? ` 等 ${gesture.branches.length} 个分支` : ''}`
            : '根节点不能移动'
          svgRef.current?.querySelectorAll<HTMLElement>('.mm-node-item').forEach(el => {
            const id = el.getAttribute('data-node-id') || ''
            if (gesture?.branches.some(node => findNode(node, id))) el.classList.add('mm-dragging')
          })
        }
      }
      const bounds = container.getBoundingClientRect()
      const overlay = gesture.overlay!
      if (!gesture.nodeId) {
        const left = Math.min(e.clientX, gesture.startX)
        const top = Math.min(e.clientY, gesture.startY)
        const right = Math.max(e.clientX, gesture.startX)
        const bottom = Math.max(e.clientY, gesture.startY)
        Object.assign(overlay.style, {
          left: `${left - bounds.left}px`, top: `${top - bounds.top}px`,
          width: `${right - left}px`, height: `${bottom - top}px`
        })
        const ids = new Set(gesture.baseSelection)
        svgRef.current?.querySelectorAll<HTMLElement>('.mm-node-item').forEach(el => {
          const rect = el.getBoundingClientRect()
          if (rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom) {
            const id = el.getAttribute('data-node-id')
            if (id) ids.add(id)
          }
        })
        setSelection(Array.from(ids))
        syncSelectionClass()
        return
      }
      Object.assign(overlay.style, { left: `${e.clientX - bounds.left + 12}px`, top: `${e.clientY - bounds.top + 12}px` })
      clearDrop()
      if (!gesture.branches.length) return
      // 使用屏幕坐标检测吸附距离，缩放后仍保持相同的鼠标容差。
      let nearest = 18
      svgRef.current?.querySelectorAll<HTMLElement>('.mm-node-item').forEach(el => {
        const id = el.getAttribute('data-node-id') || ''
        if (gesture!.branches.some(node => findNode(node, id))) return
        const rect = el.getBoundingClientRect()
        const dx = Math.max(rect.left - e.clientX, 0, e.clientX - rect.right)
        const dy = Math.max(rect.top - e.clientY, 0, e.clientY - rect.bottom)
        const distance = Math.hypot(dx, dy)
        if (distance > nearest) return
        nearest = distance
        const ratio = (e.clientY - rect.top) / rect.height
        const position: MindmapDropPosition = id === treeRef.current.id ? 'child'
          : ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'child'
        gesture!.drop = { id, position, element: el }
      })
      if (gesture.drop) {
        gesture.drop.element.setAttribute('data-drop-position', gesture.drop.position)
        overlay.textContent = gesture.drop.position === 'child' ? '松开成为子节点'
          : gesture.drop.position === 'before' ? '松开放到同级上方' : '松开放到同级下方'
      } else overlay.textContent = '拖到节点上吸附；Esc 取消'
    }

    const handleMouseUp = (e: MouseEvent): void => {
      container.classList.remove('mm-panning')
      if (!gesture || e.button !== 0) return
      const { nodeId, moving, drop } = gesture
      if (moving && nodeId && drop) {
        const next = moveBranches(treeRef.current, new Set(selectedNodeIdsRef.current), drop.id, drop.position)
        if (next) {
          commitTreeChange(next)
          showToast('已移动分支')
        }
      }
      cancelGesture()
    }
    const handleGestureKey = (e: KeyboardEvent): void => {
      if (!gesture) return
      if (e.key === 'Escape') {
        suppressClick = true
        setSelection(gesture.originalSelection)
        cancelGesture()
        syncSelectionClass()
      }
      // 手势结束前不执行删除、撤销或输入，避免拖动中的树被键盘改写。
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    const handleWheel = (e: WheelEvent): void => {
      if (gesture) { e.preventDefault(); e.stopPropagation() }
    }
    let contextStart: { x: number; y: number } | null = null
    const handleContextMenu = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (!svgRef.current?.contains(target) || target.closest('[contenteditable="true"]')) return
      e.preventDefault()
      if (contextStart && Math.hypot(e.clientX - contextStart.x, e.clientY - contextStart.y) > 6) return
      const item = target.closest<HTMLElement>('.mm-node-item') || target.closest('.markmap-node')?.querySelector<HTMLElement>('.mm-node-item')
      const id = item?.dataset.nodeId
      if (!id) return
      const path: string[] = []
      const locate = (node: MindNode): boolean => {
        path.push(node.content)
        if (node.id === id || node.children.some(locate)) return true
        path.pop(); return false
      }
      if (!locate(treeRef.current)) return
      setSelectedNodeId(id)
      syncSelectionClass()
      onNodeContextMenu?.(id, path, e.clientX, e.clientY)
    }

    const handleClickCapture = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (!svgRef.current?.contains(target)) return
      if (suppressClick) { e.preventDefault(); e.stopPropagation(); return }

      // 点击了按钮 (+ 或折叠)，精确向上寻找 [data-action]
      const actionBtn = target.closest<HTMLElement>('[data-action]')
      if (actionBtn) {
        if (readOnly) return
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

      // 如果点击在按钮浮动栏范围内（包括间隙或扩展命中区），拦截并停止冒泡，绝不触发选择或编辑节点
      if (target.closest('.mm-node-btns') || target.closest('.mm-node-btns-anchor')) {
        e.stopPropagation()
        e.preventDefault()
        return
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
          if (!readOnly && selectedNodeIdRef.current === nodeId && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
            startEditingNode(nodeId, undefined, false)
          } else {
            setSelectedNodeId(nodeId)
            syncSelectionClass()
          }
          return
        }
      }

      // 点击空白背景
      if (editingNodeIdRef.current) {
        commitCurrentEditing()
      }
      setSelectedNodeId(null)
      syncSelectionClass()
    }

    const handleDblClickCapture = (e: MouseEvent): void => {
      if (readOnly) return
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

    container.addEventListener('mousedown', handleMouseDownCapture, true)
    container.addEventListener('contextmenu', handleContextMenu)
    container.addEventListener('wheel', handleWheel, { capture: true, passive: false })
    window.addEventListener('mousemove', handleMouseMove, true)
    window.addEventListener('mouseup', handleMouseUp, true)
    window.addEventListener('keydown', handleGestureKey, true)
    window.addEventListener('blur', cancelGesture)
    container.addEventListener('click', handleClickCapture, true)
    container.addEventListener('dblclick', handleDblClickCapture, true)
    container.addEventListener('focusout', handleFocusOutCapture, true)
    container.addEventListener('compositionstart', handleCompositionStart, true)
    container.addEventListener('compositionend', handleCompositionEnd, true)

    return () => {
      cancelGesture()
      container.removeEventListener('mousedown', handleMouseDownCapture, true)
      container.removeEventListener('contextmenu', handleContextMenu)
      container.removeEventListener('wheel', handleWheel, true)
      window.removeEventListener('mousemove', handleMouseMove, true)
      window.removeEventListener('mouseup', handleMouseUp, true)
      window.removeEventListener('keydown', handleGestureKey, true)
      window.removeEventListener('blur', cancelGesture)
      container.removeEventListener('click', handleClickCapture, true)
      container.removeEventListener('dblclick', handleDblClickCapture, true)
      container.removeEventListener('focusout', handleFocusOutCapture, true)
      container.removeEventListener('compositionstart', handleCompositionStart, true)
      container.removeEventListener('compositionend', handleCompositionEnd, true)
    }
  }, [
    active,
    readOnly,
    onNodeContextMenu,
    handleAddChild,
    handleToggleFoldNode,
    commitCurrentEditing,
    startEditingNode,
    commitTreeChange,
    setSelection,
    syncSelectionClass,
    showToast
  ])

  // ── 键盘交互（Tab 新增、Delete 删除、点击选中后直接输入覆盖、Enter 编辑/提交） ──
  useEffect(() => {
    if (!active || readOnly) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (!containerRef.current?.contains(document.activeElement)) return
      // 标题、菜单和大纲输入使用各自的键盘行为，避免触发画布节点编辑。
      if (!editingNodeIdRef.current && e.target instanceof HTMLElement && e.target.closest('input,textarea,select,[contenteditable="true"]')) return
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
      if (e.key === 'Escape') { setSelection([]); return }
      if (selectedNodeIdsRef.current.length && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault()
        e.stopPropagation()
        handleDeleteSelection()
        return
      }
      if (selectedNodeId) {
        // Tab: 新增子节点
        if (e.key === 'Tab') {
          e.preventDefault()
          e.stopPropagation()
          handleAddChild(selectedNodeId)
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
    active,
    selectedNodeId,
    readOnly,
    commitCurrentEditing,
    cancelEditing,
    handleAddChild,
    handleDeleteSelection,
    setSelection,
    handleUndo,
    handleRedo,
    startEditingNode
  ])

  const handleZoom = useCallback((scale: number) => {
    const svg = svgRef.current
    if (!svg || svg.clientWidth <= 0 || svg.clientHeight <= 0) return
    const transform = (svg as SVGSVGElement & { __zoom?: { k: number; x: number; y: number } }).__zoom
    if (!transform || transform.k <= 0 || ![transform.k, transform.x, transform.y].every(Number.isFinite)) {
      void fitCanvas().then(updateZoomCss)
      return
    }
    void markmapRef.current?.rescale(scale).then(() => {
      convertLinksToStep()
      updateZoomCss()
    })
  }, [fitCanvas, convertLinksToStep, updateZoomCss])

  const handleFit = useCallback(() => {
    void fitCanvas().then(() => {
      convertLinksToStep()
      updateZoomCss()
    })
  }, [fitCanvas, convertLinksToStep, updateZoomCss])

  useEffect(() => () => {
    markmapRef.current?.destroy()
    markmapRef.current = null
    needsInitialFitRef.current = true
  }, [])

  return {
    containerRef,
    svgRef,
    handleZoom,
    handleFit,
    handleExpandAll,
    handleFoldAll,
    commitCurrentEditing,
    getTarget: () => {
      const node = findNode(treeRef.current, selectedNodeIdRef.current || treeRef.current.id) || treeRef.current
      return { id: node.id, label: node.content }
    },
    insertNode: (parentId: string, text: string): boolean => {
      if (readOnly) return false
      commitCurrentEditing()
      const next = cloneTree(treeRef.current), parent = findNode(next, parentId)
      if (!parent) return false
      const id = generateId()
      parent.children.push({ id, content: text, children: [], fold: false })
      parent.fold = false
      commitTreeChange(next)
      setSelectedNodeId(id)
      setTimeout(() => startEditingNode(id, undefined, true), 50)
      return true
    },
    editNode: startEditingNode,
    addChild: handleAddChild,
    deleteSelection: handleDeleteSelection
  }
}
