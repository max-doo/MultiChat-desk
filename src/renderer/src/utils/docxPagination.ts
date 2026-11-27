/**
 * docx 预览的近似分页引擎。
 *
 * docx-preview 只能按文档内嵌的分页标记（lastRenderedPageBreak / 显式分页符）
 * 切页；很多文档（尤其是 WPS 生成或从未用 Word 重存过的）完全没有这些标记，
 * 整篇内容会挤在一个超长页面里。这里在渲染产物之上按真实布局做贪心分页：
 * 以内容流中每个块级元素（表格细化到行）的高度为计量，按 Word 页面内容区
 * 高度切分成独立的 page section，等价于 Word 打印布局的近似。
 *
 * 已知近似（不影响普通文档）：
 * - 超高且不可拆分的块（整页图片、含纵合并单元格的表格）允许溢出页底，不做行内拆分；
 * - 表格拆分按行进行，含纵合并（rowSpan > 1）的表格不拆，避免破坏合并结构；
 * - 不重复表头行（docx-preview 没有保留 thead 语义）。
 */

interface PageGeometry {
  width: number
  height: number
  paddingTop: number
  paddingBottom: number
  contentHeight: number
}

interface FlowItem {
  node: HTMLElement
  start: number
  end: number
  height: number
  /** 所属表格（表格行项目），用于跨页时重组片段 */
  table?: HTMLTableElement
  /** 表格行项目在原表中的序号 */
  rowIndex?: number
}

// 放置时的容差：亚像素取整误差会导致恰好等高的内容被挤到下一页
const FIT_EPSILON = 1.5
// 行高低于该值时把相邻行合并处理意义不大，但拆分单行表格没有意义
const MIN_SPLITTABLE_ROWS = 3

function readPageGeometry(section: HTMLElement): PageGeometry | null {
  const cs = getComputedStyle(section)
  const width = parseFloat(cs.width)
  // 分页渲染下 minHeight 承载 Word 页高；两者都缺失时无法分页
  const height = parseFloat(cs.minHeight) || parseFloat(cs.height)
  const paddingTop = parseFloat(cs.paddingTop) || 0
  const paddingBottom = parseFloat(cs.paddingBottom) || 0
  if (!width || !height) return null
  return {
    width,
    height,
    paddingTop,
    paddingBottom,
    contentHeight: height - paddingTop - paddingBottom
  }
}

function tableHasVerticalMerge(table: HTMLTableElement): boolean {
  return Array.from(table.querySelectorAll('td')).some((td) => td.rowSpan > 1)
}

/**
 * 把 article 的顶层内容展平成分页计量项。
 * 表格默认展开为行级项目；含纵合并或行数过少的表格保持整体不可拆。
 */
function collectFlowItems(article: HTMLElement, flowTop: number): FlowItem[] {
  const items: FlowItem[] = []
  for (const child of Array.from(article.children)) {
    const el = child as HTMLElement
    const rect = el.getBoundingClientRect()
    const isTable = el.tagName === 'TABLE'
    const rows = isTable ? Array.from(el.querySelectorAll(':scope > tr')) : []
    const splittable =
      isTable && rows.length >= MIN_SPLITTABLE_ROWS && !tableHasVerticalMerge(el as HTMLTableElement)

    if (splittable) {
      rows.forEach((row, rowIndex) => {
        const rowRect = row.getBoundingClientRect()
        if (rowRect.height <= 0) return
        items.push({
          node: row as HTMLElement,
          start: rowRect.top - flowTop,
          end: rowRect.bottom - flowTop,
          height: rowRect.height,
          table: el as HTMLTableElement,
          rowIndex
        })
      })
      continue
    }

    if (rect.height <= 0 && el.tagName !== 'BR') {
      // 零高度元素（空锚点、隐藏节点）不参与分页，但要跟着流走，统一作为 0 高度项保留
      items.push({ node: el, start: rect.top - flowTop, end: rect.top - flowTop, height: 0 })
      continue
    }
    items.push({
      node: el,
      start: rect.top - flowTop,
      end: rect.bottom - flowTop,
      height: rect.height
    })
  }
  return items
}

interface PackedPage {
  items: FlowItem[]
}

/** 贪心装箱：项目按流顺序放入页面，放不下时换页；页首不留前导空白。 */
function packItems(items: FlowItem[], contentHeight: number): PackedPage[] {
  const pages: PackedPage[] = []
  let current: FlowItem[] = []
  let used = 0
  let prevEnd = 0

  for (const item of items) {
    const gap = Math.max(0, item.start - prevEnd)
    const need = (current.length > 0 ? gap : 0) + item.height
    if (current.length > 0 && used + need > contentHeight + FIT_EPSILON) {
      pages.push({ items: current })
      current = []
      used = 0
    }
    current.push(item)
    used += current.length === 1 ? item.height : need
    prevEnd = item.end
  }
  if (current.length > 0) pages.push({ items: current })
  return pages
}

/**
 * 把一页的项目物化为 DOM：连续同表行项目重组进克隆的表壳（携带 colgroup），
 * 非行项目直接移动原节点。
 */
function materializePage(page: PackedPage, article: HTMLElement): void {
  let index = 0
  while (index < page.items.length) {
    const item = page.items[index]
    if (!item.table) {
      article.appendChild(item.node)
      index += 1
      continue
    }
    // 收集连续同表行
    const rows: HTMLElement[] = []
    const sourceTable = item.table
    while (index < page.items.length && page.items[index].table === sourceTable) {
      rows.push(page.items[index].node)
      index += 1
    }
    const fragment = sourceTable.cloneNode(false) as HTMLTableElement
    const colgroup = sourceTable.querySelector(':scope > colgroup')
    if (colgroup) fragment.appendChild(colgroup.cloneNode(true))
    for (const row of rows) fragment.appendChild(row)
    article.appendChild(fragment)
  }
}

/**
 * 修正 docx-preview 对宽浮动表格的定位失真。
 *
 * Word 的浮动表格（tblpPr）相对页边距/页宽锚定居中；docx-preview 一律渲成
 * float:left + 文本边距 margin，导致原本通栏居中的表格明显偏右错位。
 * 宽度接近或超过文本列宽的浮动表格在 Word 里视觉上就是通栏居中，
 * 这里把这类表改回普通块级居中；真正需要文字环绕的窄浮动表保持原样。
 */
export function normalizeWideFloatingTables(wrapper: HTMLElement): void {
  for (const section of Array.from(wrapper.querySelectorAll<HTMLElement>('section.docx'))) {
    const cs = getComputedStyle(section)
    const columnWidth =
      parseFloat(cs.width) - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)
    if (!(columnWidth > 0)) continue
    for (const table of Array.from(section.querySelectorAll<HTMLTableElement>('table'))) {
      const tcs = getComputedStyle(table)
      if (tcs.float === 'none') continue
      const width = table.getBoundingClientRect().width
      if (width < columnWidth * 0.9) continue
      table.style.float = 'none'
      table.style.marginLeft = 'auto'
      table.style.marginRight = 'auto'
    }
  }
}

/**
 * 对单个 section 做重流分页。
 * 返回值：false 表示该 section 无法或不需要分页（保持原样）。
 */
function repaginateSection(section: HTMLElement): boolean {
  const geometry = readPageGeometry(section)
  if (!geometry) return false
  const articles = Array.from(section.querySelectorAll<HTMLElement>(':scope > article'))
  if (articles.length === 0) return false

  // 单 article 是 docx-preview 的固定结构；多 article 场景（分栏节）保持原样不折腾
  if (articles.length !== 1) return false
  const article = articles[0]

  const sectionRect = section.getBoundingClientRect()
  const flowTop = sectionRect.top + geometry.paddingTop
  const items = collectFlowItems(article, flowTop)
  if (items.length === 0) return false

  const lastEnd = Math.max(...items.map((item) => item.end))
  // 内容没超出一页：不需要分页
  if (lastEnd <= geometry.contentHeight + FIT_EPSILON) return false

  const packedPages = packItems(items, geometry.contentHeight)
  if (packedPages.length <= 1) return false

  const footer = section.querySelector(':scope > footer')
  const header = section.querySelector(':scope > header')

  const builtPages: HTMLElement[] = []
  for (const packed of packedPages) {
    const pageShell = section.cloneNode(false) as HTMLElement
    // 清掉 header/footer 的克隆残留（cloneNode(false) 不含子节点，理论上没有，防御一下）
    pageShell.replaceChildren()
    // 固定页高，让每页都是完整的纸张尺寸
    pageShell.style.height = `${geometry.height}px`
    pageShell.style.overflow = 'hidden'
    const pageArticle = document.createElement('article')
    materializePage(packed, pageArticle)
    pageShell.appendChild(pageArticle)
    if (header) pageShell.appendChild(header.cloneNode(true))
    if (footer) pageShell.appendChild(footer.cloneNode(true))
    builtPages.push(pageShell)
  }

  section.replaceWith(...builtPages)
  return true
}

/**
 * 把 docx-preview 渲染产物重流为近似打印分页。
 * 需要节点已插入文档且完成布局（图片加载不影响文本流高度的场景除外）。
 * 返回生成的总页数。
 */
export function paginateDocxFlow(wrapper: HTMLElement): number {
  const sections = Array.from(wrapper.querySelectorAll<HTMLElement>(':scope > section.docx'))
  let changed = 0
  for (const section of sections) {
    if (repaginateSection(section)) changed += 1
  }
  if (changed > 0) {
    return wrapper.querySelectorAll(':scope > section.docx').length
  }
  return sections.length
}
