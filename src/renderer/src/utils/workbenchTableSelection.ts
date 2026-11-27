/**
 * 表格单元格范围选区的数据驱动工具（Excel 交互语义）。
 * 与浏览器 DOM 文本选区无关：选区是 {r,c} 锚点/焦点对，网格化/序列化全部
 * 直接读数据数组，因此大表虚拟滚动下未渲染的行也能正确进入选区与导出。
 * 全部纯函数，便于离线验证网格化数学。
 */

export interface CellPoint {
  /** 数据行索引（0 基，与 rows 数组一致，不存在"表头行"特殊概念） */
  r: number
  c: number
}

export interface CellRange {
  minR: number
  maxR: number
  minC: number
  maxC: number
}

export interface MergeRangeLike {
  s: { r: number; c: number }
  e: { r: number; c: number }
}

/** 锚点/焦点归一化为矩形范围，并夹紧到网格边界内。 */
export function normalizeCellRange(anchor: CellPoint, focus: CellPoint, rowCount: number, colCount: number): CellRange {
  const maxRow = Math.max(0, rowCount - 1)
  const maxCol = Math.max(0, colCount - 1)
  const clampR = (v: number): number => Math.min(Math.max(0, v), maxRow)
  const clampC = (v: number): number => Math.min(Math.max(0, v), maxCol)
  return {
    minR: Math.min(clampR(anchor.r), clampR(focus.r)),
    maxR: Math.max(clampR(anchor.r), clampR(focus.r)),
    minC: Math.min(clampC(anchor.c), clampC(focus.c)),
    maxC: Math.max(clampC(anchor.c), clampC(focus.c))
  }
}

/**
 * 把矩形范围迭代扩张到完整覆盖所有相交合并区域（Excel 语义：
 * 选中触及合并单元格的一部分即选中整个合并单元格）。
 * 最多迭代 8 轮（合并链传递在真实文档里极浅），仍不收敛时以末轮结果为准。
 */
export function expandRangeForMerges(range: CellRange, merges: MergeRangeLike[]): CellRange {
  let current = { ...range }
  for (let round = 0; round < 8; round += 1) {
    let changed = false
    for (const merge of merges) {
      const intersects =
        merge.s.r <= current.maxR && merge.e.r >= current.minR &&
        merge.s.c <= current.maxC && merge.e.c >= current.minC
      if (!intersects) continue
      const next = {
        minR: Math.min(current.minR, merge.s.r),
        maxR: Math.max(current.maxR, merge.e.r),
        minC: Math.min(current.minC, merge.s.c),
        maxC: Math.max(current.maxC, merge.e.c)
      }
      if (
        next.minR !== current.minR || next.maxR !== current.maxR ||
        next.minC !== current.minC || next.maxC !== current.maxC
      ) {
        current = next
        changed = true
      }
    }
    if (!changed) break
  }
  return current
}

/** 为合并区域建覆盖索引：被覆盖格 → 锚点坐标；锚点自身不入选（读 rows 原值即可）。 */
export function buildMergeCoverIndex(merges: MergeRangeLike[]): Map<string, { r: number; c: number }> {
  const cover = new Map<string, { r: number; c: number }>()
  for (const merge of merges) {
    for (let r = merge.s.r; r <= merge.e.r; r += 1) {
      for (let c = merge.s.c; c <= merge.e.c; c += 1) {
        if (r === merge.s.r && c === merge.s.c) continue
        cover.set(`${r}:${c}`, { r: merge.s.r, c: merge.s.c })
      }
    }
  }
  return cover
}

/**
 * 把矩形范围按数据数组铺平成矩形网格。
 * Excel 复制语义：合并区域的值只出现在锚点位置，覆盖格留空
 * （扩张逻辑保证锚点必在范围内）；无合并时即 rows 的子矩形。
 */
export function extractRangeGrid(
  rows: string[][],
  range: CellRange,
  coverIndex: Map<string, { r: number; c: number }> | null
): string[][] {
  const grid: string[][] = []
  for (let r = range.minR; r <= range.maxR; r += 1) {
    const row: string[] = []
    for (let c = range.minC; c <= range.maxC; c += 1) {
      if (coverIndex?.has(`${r}:${c}`)) {
        row.push('')
      } else {
        row.push(rows[r]?.[c] ?? '')
      }
    }
    grid.push(row)
  }
  return grid
}

/** Excel 粘贴板语义：行列用 \t / \n 分隔；单元格内换行折叠为空格保证可粘贴结构稳定。 */
export function gridToTsv(grid: string[][]): string {
  return grid
    .map((row) => row.map((cell) => cell.replace(/\r?\n/g, ' ')).join('\t'))
    .join('\n')
}

function mdCellText(cell: string): string {
  return cell.replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')
}

/** Markdown 表格格式化：显式表头 + 数据行。 */
function formatMarkdownTable(header: string[], bodyRows: string[][]): string {
  const escapedHeader = header.map(mdCellText)
  const lines: string[] = []
  lines.push(`| ${escapedHeader.join(' | ')} |`)
  lines.push(`| ${escapedHeader.map(() => '---').join(' | ')} |`)
  for (const row of bodyRows) {
    lines.push(`| ${row.map(mdCellText).join(' | ')} |`)
  }
  return lines.join('\n')
}

/**
 * 网格 → Markdown 表格：网格首行作表头（Markdown 语法强制），
 * 单行选区也是合法表格（仅表头 + 分隔行）。
 */
export function gridToMarkdown(grid: string[][]): string {
  if (grid.length === 0 || (grid[0]?.length ?? 0) === 0) return ''
  return formatMarkdownTable(grid[0], grid.slice(1))
}

/**
 * 选区 → 发送 AI 的 Markdown 表格：表头固定取表格第 1 行（数据行 0）
 * 在选区列范围内的切片——用户语义里"表格的表头"是文件首行而不是选区首行。
 * 选区本身含第 1 行时二者自然重合（首行进表头，不再重复进数据行）。
 * 表头切片全空时（如 xlsx 合并标题行只覆盖部分列，切片全落在覆盖格）
 * 回退选区首行作表头，保证输出是合法 Markdown 表格。
 */
export function buildSelectionMarkdown(
  rows: string[][],
  range: CellRange,
  coverIndex: Map<string, { r: number; c: number }> | null
): string {
  const grid = extractRangeGrid(rows, range, coverIndex)
  if (grid.length === 0 || (grid[0]?.length ?? 0) === 0) return ''
  if (range.minR === 0) {
    // 选区已含表头行：网格首行即表头
    return formatMarkdownTable(grid[0], grid.slice(1))
  }
  const headerGrid = extractRangeGrid(
    rows,
    { minR: 0, maxR: 0, minC: range.minC, maxC: range.maxC },
    coverIndex
  )
  const header = headerGrid[0] ?? []
  const hasHeaderContent = header.some((cell) => cell.trim() !== '')
  if (!hasHeaderContent) {
    return formatMarkdownTable(grid[0], grid.slice(1))
  }
  return formatMarkdownTable(header, grid)
}
