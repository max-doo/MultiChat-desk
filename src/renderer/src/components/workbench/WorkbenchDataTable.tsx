import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TableVirtuoso } from 'react-virtuoso'
import {
  buildSelectionMarkdown,
  buildMergeCoverIndex,
  expandRangeForMerges,
  extractRangeGrid,
  gridToTsv,
  normalizeCellRange,
  type CellPoint,
  type CellRange,
  type MergeRangeLike
} from '../../utils/workbenchTableSelection'
import { useWorkbenchSelectionAi } from './useWorkbenchSelectionAi'

// 行 × 列 ≤ 5000 走全量 table 渲染（合并单元格视觉正确）；
// 超过后用 TableVirtuoso 虚拟滚动并忽略合并（合并结构与虚拟行高模型冲突，已声明的取舍）。
const SMALL_TABLE_CELL_LIMIT = 5000
const COL_WIDTH_MIN = 60
const COL_WIDTH_MAX = 320
// 列宽采样行数：只扫前几行，避免万行大表加载后又一次全量遍历
const COL_WIDTH_SAMPLE_ROWS = 200
const ROW_NUMBER_WIDTH = 46
// 拖选到视口边缘的自动滚动：边距带宽与最大帧速度（px/帧）
const EDGE_SCROLL_MARGIN = 28
const EDGE_SCROLL_MAX_SPEED = 14

export type TableMergeRange = MergeRangeLike

export interface WorkbenchDataTableProps {
  /** 矩形化后的二维文本；全部行都是数据行，首行没有特殊表头地位（Excel 语义） */
  rows: string[][]
  colCount: number
  /** 合并区域（仅小表全量渲染生效；大表虚拟滚动忽略合并） */
  merges?: TableMergeRange[]
  /**
   * 选区状态复位键：内容整体替换（如 xlsx 切 sheet）时选区坐标已失效，
   * 传变化的 key（如 sheet index）让选区与气泡状态清空。
   */
  resetKey?: string | number
}

interface SelState {
  anchor: CellPoint
  focus: CellPoint
}

/** Excel 列字母：0→A, 25→Z, 26→AA */
export function columnLetter(index: number): string {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

/** CJK 字符按 2 宽、其余按 1 宽估算文本显示宽度，只用于列宽启发。 */
function estimateTextUnits(text: string): number {
  let units = 0
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    // CJK 统一表意文字 + 假名 + 谚文 + 全角：按双宽估算
    units += code > 0x2e7f ? 2 : 1
  }
  return units
}

function estimateColumnWidths(rows: string[][], colCount: number): number[] {
  const widths: number[] = new Array(colCount).fill(0)
  const sampleCount = Math.min(rows.length, COL_WIDTH_SAMPLE_ROWS)
  for (let r = 0; r < sampleCount; r += 1) {
    const row = rows[r]
    for (let c = 0; c < colCount; c += 1) {
      const cell = row?.[c]
      if (!cell) continue
      // 多行文本按最长一行算
      const units = Math.max(...cell.split('\n').map(estimateTextUnits))
      if (units > widths[c]) widths[c] = units
    }
  }
  return widths.map((units) => {
    if (units === 0) return COL_WIDTH_MIN
    // 单元 7px（14px 字号的拉丁字符宽近似）+ px-2 双侧内边距与边框余量
    return Math.min(COL_WIDTH_MAX, Math.max(COL_WIDTH_MIN, units * 7 + 24))
  })
}

/** 合并单元格渲染跳过表：返回每个被覆盖格（非锚点）的 key 集合与锚点 span 映射。 */
function buildMergeRenderLookup(merges: TableMergeRange[]): {
  anchorSpans: Map<string, { colSpan: number; rowSpan: number }>
  covered: Set<string>
} {
  const anchorSpans = new Map<string, { colSpan: number; rowSpan: number }>()
  const covered = new Set<string>()
  for (const merge of merges) {
    const colSpan = Math.max(1, merge.e.c - merge.s.c + 1)
    const rowSpan = Math.max(1, merge.e.r - merge.s.r + 1)
    if (colSpan === 1 && rowSpan === 1) continue
    anchorSpans.set(`${merge.s.r}:${merge.s.c}`, { colSpan, rowSpan })
    for (let r = merge.s.r; r <= merge.e.r; r += 1) {
      for (let c = merge.s.c; c <= merge.e.c; c += 1) {
        if (r === merge.s.r && c === merge.s.c) continue
        covered.add(`${r}:${c}`)
      }
    }
  }
  return { anchorSpans, covered }
}

/** 截断或含换行的单元格需要悬浮 title 提示完整内容（多行文本视觉上是折叠的）。 */
function needsTitle(text: string): boolean {
  return text.length > 40 || text.includes('\n')
}

function parseCellKey(value: string | null): CellPoint | null {
  if (!value) return null
  const parts = value.split(':').map((part) => parseInt(part, 10))
  if (parts.length !== 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return null
  return { r: parts[0], c: parts[1] }
}

/**
 * 工作台表格数据预览的共享渲染器（xlsx/csv 同源），交互对齐 Excel 只读语义：
 * - chrome：列字母表头 + 行号 + 左上角全选格，全部 sticky 冻结；
 * - 选中：点选/拖选单元格矩形、行列头整行整列（可拖动横扫）、Shift+点击扩选、
 *   合并单元格触及即整体选中、拖到视口边缘自动滚动；
 * - 动作链：选中后浮出"已选 N 字"气泡与右键菜单（发送 AI 为 Markdown 表格，
 *   复制为 TSV 可直接粘贴进 Excel）；Ctrl+C 直接复制当前选区。
 * 容器本身撑满父级，外层需要 relative 定位供气泡锚定。
 */
export default function WorkbenchDataTable(props: WorkbenchDataTableProps): JSX.Element {
  const { rows, colCount, merges, resetKey } = props
  const contentRef = useRef<HTMLDivElement | null>(null)
  const scrollElRef = useRef<HTMLElement | null>(null)

  const [sel, setSel] = useState<SelState | null>(null)
  // 高频路径（rAF 拖动帧、captureOverride）必须同步读最新选区，不走异步 state
  const selRef = useRef<SelState | null>(null)
  const applySelection = useCallback((next: SelState | null) => {
    selRef.current = next
    setSel(next)
  }, [])

  const columnWidths = useMemo(() => estimateColumnWidths(rows, colCount), [rows, colCount])
  const totalWidth = useMemo(
    () => ROW_NUMBER_WIDTH + columnWidths.reduce((sum, width) => sum + width, 0),
    [columnWidths]
  )
  const mergeRenderLookup = useMemo(
    () => (merges && merges.length > 0 ? buildMergeRenderLookup(merges) : null),
    [merges]
  )
  const mergeCoverIndex = useMemo(
    () => (merges && merges.length > 0 ? buildMergeCoverIndex(merges) : null),
    [merges]
  )
  const isLargeTable = rows.length * colCount > SMALL_TABLE_CELL_LIMIT

  // 渲染用范围：归一化后按合并区域扩张（每次渲染重算成本极低，避免拖动期间状态撕裂）
  const selectionRange = useMemo((): CellRange | null => {
    if (!sel) return null
    const base = normalizeCellRange(sel.anchor, sel.focus, rows.length, colCount)
    return merges && merges.length > 0 ? expandRangeForMerges(base, merges) : base
  }, [sel, rows.length, colCount, merges])
  const selectionRangeRef = useRef<CellRange | null>(null)
  selectionRangeRef.current = selectionRange

  const selectionAi = useWorkbenchSelectionAi({
    containerRef: contentRef,
    captureOverride: () => {
      const state = selRef.current
      if (!state) return null
      const base = normalizeCellRange(state.anchor, state.focus, rows.length, colCount)
      const range = merges && merges.length > 0 ? expandRangeForMerges(base, merges) : base
      const grid = extractRangeGrid(rows, range, mergeCoverIndex)
      if (!gridToTsv(grid).trim()) return null
      return { plain: gridToTsv(grid), aiText: buildSelectionMarkdown(rows, range, mergeCoverIndex) }
    }
  })

  // 同步清选区：内容整体替换后坐标已失效
  const selectionAiRef = useRef(selectionAi)
  selectionAiRef.current = selectionAi
  useEffect(() => {
    applySelection(null)
    selectionAiRef.current.clear()
  }, [resetKey, applySelection])

  // ---- 拖动选区机器：document 级 mouseup 收尾 + rAF 帧驱动边缘自动滚动与 hit-test ----
  const dragModeRef = useRef<'cell' | 'col' | 'row' | null>(null)
  const dragPointerRef = useRef<{ x: number; y: number } | null>(null)

  const hitCell = useCallback((x: number, y: number): CellPoint | null => {
    const container = contentRef.current
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    if (!container || !el || !container.contains(el)) return null
    const cell = el.closest('[data-rc]') as HTMLElement | null
    if (cell) return parseCellKey(cell.getAttribute('data-rc'))
    const colHdr = el.closest('[data-colhdr]') as HTMLElement | null
    if (colHdr) {
      const c = parseInt(colHdr.getAttribute('data-colhdr') ?? '', 10)
      if (!Number.isNaN(c)) return { r: 0, c }
    }
    const rowHdr = el.closest('[data-rowhdr]') as HTMLElement | null
    if (rowHdr) {
      const r = parseInt(rowHdr.getAttribute('data-rowhdr') ?? '', 10)
      if (!Number.isNaN(r)) return { r, c: 0 }
    }
    return null
  }, [])

  const dragTick = useCallback(() => {
    const pointer = dragPointerRef.current
    const state = selRef.current
    const mode = dragModeRef.current
    if (!pointer || !state || !mode) return

    // 边缘自动滚动：指针进入边缘带宽时按深度加速，滚动后下一帧 hit-test
    // 自然推进焦点（指针不必移动），大表虚拟滚动因此可以拖选任意远处。
    const scroller = scrollElRef.current
    if (scroller) {
      const rect = scroller.getBoundingClientRect()
      const edgeSpeed = (distance: number): number =>
        Math.max(1, Math.ceil(((EDGE_SCROLL_MARGIN - Math.max(0, distance)) / EDGE_SCROLL_MARGIN) * EDGE_SCROLL_MAX_SPEED))
      const distLeft = pointer.x - rect.left
      const distRight = rect.right - pointer.x
      const distTop = pointer.y - rect.top
      const distBottom = rect.bottom - pointer.y
      if (distLeft < EDGE_SCROLL_MARGIN) {
        scroller.scrollLeft -= edgeSpeed(distLeft)
      } else if (distRight < EDGE_SCROLL_MARGIN) {
        scroller.scrollLeft += edgeSpeed(distRight)
      }
      if (distTop < EDGE_SCROLL_MARGIN) {
        scroller.scrollTop -= edgeSpeed(distTop)
      } else if (distBottom < EDGE_SCROLL_MARGIN) {
        scroller.scrollTop += edgeSpeed(distBottom)
      }
    }

    // hit-test 探针：Excel 钳制语义——指针落在网格空白区/容器外/滚动条带上时，
    // 探针夹紧到「表格矩形 ∩ 滚动容器客户区」内命中最近的边缘单元格，
    // 而不是让焦点冻结在原位（滚动条带与空白区都没有单元格可直接命中）。
    const container = contentRef.current
    if (container) {
      const containerRect = container.getBoundingClientRect()
      const table = container.querySelector('table')
      const tableRect = table?.getBoundingClientRect() ?? containerRect
      // 滚动容器客户区右/下边界（clientWidth/clientHeight 不含滚动条带）
      let clientRight = containerRect.right
      let clientBottom = containerRect.bottom
      if (scroller) {
        const sr = scroller.getBoundingClientRect()
        clientRight = Math.min(clientRight, sr.left + scroller.clientWidth)
        clientBottom = Math.min(clientBottom, sr.top + scroller.clientHeight)
      }
      const probeX = Math.min(
        Math.max(pointer.x, Math.max(containerRect.left, tableRect.left) + 1),
        Math.min(tableRect.right, clientRight) - 2
      )
      const probeY = Math.min(
        Math.max(pointer.y, Math.max(containerRect.top, tableRect.top) + 1),
        Math.min(tableRect.bottom, clientBottom) - 2
      )
      const hit = hitCell(probeX, probeY)
      if (hit) {
        let focus = hit
        if (mode === 'col') focus = { r: rows.length - 1, c: hit.c }
        else if (mode === 'row') focus = { r: hit.r, c: colCount - 1 }
        const current = state.focus
        if (current.r !== focus.r || current.c !== focus.c) {
          applySelection({ anchor: state.anchor, focus })
        }
      }
    }
  }, [applySelection, colCount, hitCell, rows.length])

  const endDrag = useCallback(() => {
    if (!dragModeRef.current) return
    dragModeRef.current = null
    dragPointerRef.current = null
    selectionAiRef.current.onMouseUp()
  }, [])

  const endDragRef = useRef(endDrag)
  endDragRef.current = endDrag
  const dragTickRef = useRef(dragTick)
  dragTickRef.current = dragTick

  useEffect(() => {
    const frame = (): void => {
      if (!dragModeRef.current) return
      dragTickRef.current()
    }
    const handleMove = (event: MouseEvent): void => {
      if (!dragModeRef.current) return
      dragPointerRef.current = { x: event.clientX, y: event.clientY }
    }
    const handleUp = (): void => endDragRef.current()
    document.addEventListener('mousemove', handleMove, true)
    document.addEventListener('mouseup', handleUp, true)
    const timer = window.setInterval(frame, 32)
    return () => {
      document.removeEventListener('mousemove', handleMove, true)
      document.removeEventListener('mouseup', handleUp, true)
      window.clearInterval(timer)
    }
  }, [])

  // Ctrl+C 复制当前选区（TSV，粘贴进 Excel 直接成结构）
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      // Escape 清空选区高亮：hook 同键收起气泡/菜单，两层状态必须同步，
      // 否则气泡消失后高亮残留，视觉与动作语义脱节
      if (event.key === 'Escape' && selRef.current) {
        applySelection(null)
        return
      }
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'c') return
      const state = selRef.current
      if (!state) return
      // 焦点在可编辑元素时把 Ctrl+C 还给编辑场景
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const base = normalizeCellRange(state.anchor, state.focus, rows.length, colCount)
      const range = merges && merges.length > 0 ? expandRangeForMerges(base, merges) : base
      const grid = extractRangeGrid(rows, range, mergeCoverIndex)
      const tsv = gridToTsv(grid)
      if (!tsv) return
      event.preventDefault()
      void navigator.clipboard.writeText(tsv)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [rows, colCount, merges, mergeCoverIndex, applySelection])

  // ---- 点选/拖选/扩选入口：容器级事件委托，按命中元素角色分发 ----
  const handleGridMouseDown = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (event.button !== 0) return
      const target = event.target as HTMLElement

      const corner = target.closest('[data-corner]')
      if (corner) {
        applySelection({
          anchor: { r: 0, c: 0 },
          focus: { r: rows.length - 1, c: colCount - 1 }
        })
        return
      }

      const colHdr = target.closest('[data-colhdr]') as HTMLElement | null
      if (colHdr) {
        const c = parseInt(colHdr.getAttribute('data-colhdr') ?? '', 10)
        if (Number.isNaN(c)) return
        const anchor: CellPoint =
          event.shiftKey && selRef.current
            ? { r: 0, c: selRef.current.anchor.c }
            : { r: 0, c }
        applySelection({ anchor, focus: { r: rows.length - 1, c } })
        dragModeRef.current = 'col'
        dragPointerRef.current = { x: event.clientX, y: event.clientY }
        return
      }

      const rowHdr = target.closest('[data-rowhdr]') as HTMLElement | null
      if (rowHdr) {
        const r = parseInt(rowHdr.getAttribute('data-rowhdr') ?? '', 10)
        if (Number.isNaN(r)) return
        const anchor: CellPoint =
          event.shiftKey && selRef.current
            ? { r: selRef.current.anchor.r, c: 0 }
            : { r, c: 0 }
        applySelection({ anchor, focus: { r, c: colCount - 1 } })
        dragModeRef.current = 'row'
        dragPointerRef.current = { x: event.clientX, y: event.clientY }
        return
      }

      const cell = target.closest('[data-rc]') as HTMLElement | null
      if (cell) {
        const point = parseCellKey(cell.getAttribute('data-rc'))
        if (!point) return
        if (event.shiftKey && selRef.current) {
          applySelection({ anchor: selRef.current.anchor, focus: point })
          return
        }
        applySelection({ anchor: point, focus: point })
        dragModeRef.current = 'cell'
        dragPointerRef.current = { x: event.clientX, y: event.clientY }
      }
    },
    [applySelection, rows.length, colCount]
  )

  const handleGridContextMenu = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      // 右键落在选区外时先改选该格再弹菜单（Excel 语义）；落在选区内保持原选区
      const target = event.target as HTMLElement
      const cell = target.closest('[data-rc]') as HTMLElement | null
      if (cell) {
        const point = parseCellKey(cell.getAttribute('data-rc'))
        const range = selectionRangeRef.current
        const inside =
          point !== null &&
          range !== null &&
          point.r >= range.minR && point.r <= range.maxR &&
          point.c >= range.minC && point.c <= range.maxC
        if (point && !inside) {
          applySelection({ anchor: point, focus: point })
        }
      }
      selectionAi.onContextMenu(event)
    },
    [applySelection, selectionAi]
  )

  // ---- 渲染样式计算 ----
  const inSelection = useCallback(
    (r: number, c: number): boolean => {
      const range = selectionRange
      if (!range) return false
      return r >= range.minR && r <= range.maxR && c >= range.minC && c <= range.maxC
    },
    [selectionRange]
  )

  // 选中范围的周圈绿框：按单元格所在边缘拼 inset box-shadow（活动格自带完整框）
  const frameShadow = useCallback(
    (r: number, c: number): string => {
      const range = selectionRange
      if (!range || !inSelection(r, c)) return ''
      const parts: string[] = []
      const green = '#107c41'
      if (r === range.minR) parts.push(`inset 0 1px 0 0 ${green}`)
      if (r === range.maxR) parts.push(`inset 0 -1px 0 0 ${green}`)
      if (c === range.minC) parts.push(`inset 1px 0 0 0 ${green}`)
      if (c === range.maxC) parts.push(`inset -1px 0 0 0 ${green}`)
      return parts.join(', ')
    },
    [selectionRange, inSelection]
  )

  const isAnchorCell = useCallback(
    (r: number, c: number): boolean => {
      const state = sel
      return !!state && state.anchor.r === r && state.anchor.c === c
    },
    [sel]
  )

  const colHeaderSelected = useCallback(
    (c: number): boolean => {
      const range = selectionRange
      return !!range && c >= range.minC && c <= range.maxC
    },
    [selectionRange]
  )
  const rowHeaderSelected = useCallback(
    (r: number): boolean => {
      const range = selectionRange
      return !!range && r >= range.minR && r <= range.maxR
    },
    [selectionRange]
  )

  // 注意：背景色不进 base class——Tailwind 类冲突时生效方取决于 CSS 生成顺序而非
  // className 书写顺序（构建产物中 .bg-white 排在 .bg-[#e9e9e9] 之后曾导致选区
  // 灰色遮罩被覆盖丢失）。每种状态必须且只能输出一个背景类。
  const cellBaseClass =
    'border border-black/10 dark:border-white/10 px-2 py-1 text-body whitespace-nowrap overflow-hidden text-ellipsis cursor-cell'
  const chromeBaseClass =
    'border border-black/10 dark:border-white/10 px-1 py-1 text-label text-center text-text-secondary font-normal select-none cursor-cell'

  const dataCellProps = useCallback(
    (r: number, c: number): { rc: string; className: string; boxShadow?: string } => {
      const selected = inSelection(r, c)
      const anchor = isAnchorCell(r, c)
      const shadow = anchor ? 'inset 0 0 0 2px #107c41' : frameShadow(r, c)
      return {
        rc: `${r}:${c}`,
        className: `${cellBaseClass} ${
          selected && !anchor ? 'bg-[#e9e9e9] dark:bg-white/[0.14]' : 'bg-white dark:bg-gray-900'
        }`,
        boxShadow: shadow || undefined
      }
    },
    [inSelection, isAnchorCell, frameShadow, cellBaseClass]
  )

  const colHeaderClass = useCallback(
    (c: number): string =>
      `${chromeBaseClass} sticky top-0 z-10 ${
        colHeaderSelected(c)
          ? 'bg-[#d4d4d4] text-[#107c41] font-semibold dark:bg-white/[0.18]'
          : 'bg-[#f3f3f3] dark:bg-gray-800'
      }`,
    [colHeaderSelected, chromeBaseClass]
  )

  const rowHeaderClass = useCallback(
    (r: number): string =>
      `${chromeBaseClass} sticky left-0 z-[5] ${
        rowHeaderSelected(r)
          ? 'bg-[#d4d4d4] text-[#107c41] font-semibold dark:bg-white/[0.18]'
          : 'bg-[#f3f3f3] dark:bg-gray-800'
      }`,
    [rowHeaderSelected, chromeBaseClass]
  )

  const cornerClass =
    'border border-black/10 dark:border-white/10 sticky left-0 top-0 z-20 bg-[#f3f3f3] dark:bg-gray-800 cursor-cell select-none'

  const largeTableComponents = useMemo(
    () => ({
      Table: (tableProps: React.ComponentProps<'table'>) => (
        <table
          {...tableProps}
          style={{ ...(tableProps.style ?? {}), tableLayout: 'fixed', width: totalWidth, borderCollapse: 'collapse' }}
        />
      )
    }),
    [totalWidth]
  )

  return (
    <div
      ref={contentRef}
      className="w-full h-full select-none bg-white dark:bg-gray-900"
      data-workbench-editor="true"
      onMouseDown={handleGridMouseDown}
      onMouseUp={selectionAi.onMouseUp}
      onContextMenu={handleGridContextMenu}
    >
      {isLargeTable ? (
        <TableVirtuoso
          className="w-full h-full"
          data={rows}
          components={largeTableComponents}
          scrollerRef={(el) => {
            scrollElRef.current = (el as HTMLElement | null) ?? null
          }}
          fixedHeaderContent={() => (
            <tr>
              <th data-corner="true" className={cornerClass} style={{ width: ROW_NUMBER_WIDTH }} />
              {Array.from({ length: colCount }, (_, c) => (
                <th key={c} data-colhdr={String(c)} className={colHeaderClass(c)} style={{ width: columnWidths[c] }}>
                  {columnLetter(c)}
                </th>
              ))}
            </tr>
          )}
          itemContent={(index, row) => (
            <>
              <th data-rowhdr={String(index)} className={rowHeaderClass(index)} style={{ width: ROW_NUMBER_WIDTH }}>
                {index + 1}
              </th>
              {Array.from({ length: colCount }, (_, c) => {
                const cellProps = dataCellProps(index, c)
                return (
                  <td
                    key={c}
                    data-rc={cellProps.rc}
                    className={cellProps.className}
                    style={{ width: columnWidths[c], boxShadow: cellProps.boxShadow }}
                    title={needsTitle(row[c] ?? '') ? row[c] : undefined}
                  >
                    {row[c] ?? ''}
                  </td>
                )
              })}
            </>
          )}
        />
      ) : (
        <div
          ref={(el) => {
            scrollElRef.current = el
          }}
          className="w-full h-full overflow-auto"
        >
          <table style={{ width: totalWidth, tableLayout: 'fixed', borderCollapse: 'collapse' }}>
            <colgroup>
              <col style={{ width: ROW_NUMBER_WIDTH }} />
              {columnWidths.map((width, index) => (
                <col key={index} style={{ width }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th data-corner="true" className={cornerClass} style={{ width: ROW_NUMBER_WIDTH }} />
                {Array.from({ length: colCount }, (_, c) => (
                  <th key={c} data-colhdr={String(c)} className={colHeaderClass(c)} style={{ width: columnWidths[c] }}>
                    {columnLetter(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  <th data-rowhdr={String(r)} className={rowHeaderClass(r)} style={{ width: ROW_NUMBER_WIDTH }}>
                    {r + 1}
                  </th>
                  {Array.from({ length: colCount }, (_, c) => {
                    if (mergeRenderLookup?.covered.has(`${r}:${c}`)) return null
                    const span = mergeRenderLookup?.anchorSpans.get(`${r}:${c}`)
                    const text = row?.[c] ?? ''
                    const cellProps = dataCellProps(r, c)
                    return (
                      <td
                        key={c}
                        data-rc={cellProps.rc}
                        colSpan={span?.colSpan}
                        rowSpan={span?.rowSpan}
                        className={cellProps.className}
                        style={cellProps.boxShadow ? { boxShadow: cellProps.boxShadow } : undefined}
                        title={needsTitle(text) ? text : undefined}
                      >
                        {text}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selectionAi.overlay}
    </div>
  )
}
