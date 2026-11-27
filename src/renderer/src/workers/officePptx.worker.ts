/// <reference lib="webworker" />
/**
 * pptx 内容预览解析 Worker。
 *
 * 定位是"内容预览"而非拟真渲染（方案文档第 4 节）：
 * - 只提取文本框/占位符的坐标、直出格式（字号/粗体/颜色）、图片与表格文本；
 * - 不解算完整主题级联；占位符坐标缺失时做两跳继承查找
 *  （slide → slideLayout → slideMaster 的同类型占位符），仍无坐标则按阅读顺序瀑布流排布；
 * - 形状 geometry、母版装饰、动画、SmartArt、图表不还原；
 * - 组合形状只按偏移平移子坐标，忽略子坐标系缩放（近似，报告注明）。
 *
 * 解析产物坐标全部保持 EMU 原值，渲染层统一换算与缩放。
 */

import JSZip from 'jszip'

// ---------------------------------------------------------------------------
// 迷你 XML 解析器（worker 环境无 DOMParser）。
// OOXML 是机器生成的规整 XML：标准声明、五类预定义实体、命名空间前缀固定、
// 不用 CDATA/DOCTYPE/实体定义。针对这个输入域做定向解析（标签/属性/文本/注释/PI），
// 输出轻量 Element 树，API 对齐用到的 DOM 子集（localName/children/attributes/textContent）。
// ---------------------------------------------------------------------------

interface MiniElement {
  readonly localName: string
  readonly qualifiedName: string
  readonly attributes: Record<string, string>
  readonly children: MiniElement[]
  text: string
}

const XML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'"
}

function decodeEntities(text: string): string {
  if (!text.includes('&')) return text
  return text.replace(/&(amp|lt|gt|quot|apos|#x[0-9a-fA-F]+|#\d+);/g, (whole, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(parseInt(entity.slice(2), 16))
    }
    if (entity.startsWith('#')) {
      return String.fromCodePoint(parseInt(entity.slice(1), 10))
    }
    return XML_ENTITIES[entity] ?? whole
  })
}

const ATTR_RE = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

function parseAttributes(src: string): Record<string, string> {
  const out: Record<string, string> = {}
  ATTR_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ATTR_RE.exec(src)) !== null) {
    out[match[1]] = decodeEntities(match[2] ?? match[3] ?? '')
  }
  return out
}

function splitQualifiedName(name: string): string {
  const idx = name.indexOf(':')
  return idx === -1 ? name : name.slice(idx + 1)
}

/** 定向解析 OOXML part 文本为 Element 树；解析失败返回 null（调用方按损坏文件兜底） */
function parseXml(xmlText: string): MiniElement | null {
  const len = xmlText.length
  let pos = 0
  const rootChildren: MiniElement[] = []
  const stack: MiniElement[] = []

  const current = (): MiniElement | null => (stack.length > 0 ? stack[stack.length - 1] : null)

  const appendNode = (node: MiniElement): void => {
    const parent = current()
    if (parent) parent.children.push(node)
    else rootChildren.push(node)
  }

  const appendText = (text: string): void => {
    if (!text) return
    const parent = current()
    if (parent) parent.text += decodeEntities(text)
  }

  while (pos < len) {
    const lt = xmlText.indexOf('<', pos)
    if (lt === -1) {
      appendText(xmlText.slice(pos))
      break
    }
    if (lt > pos) appendText(xmlText.slice(pos, lt))

    if (xmlText.startsWith('<!--', lt)) {
      const end = xmlText.indexOf('-->', lt + 4)
      if (end === -1) return null
      pos = end + 3
      continue
    }
    if (xmlText.startsWith('<?', lt)) {
      const end = xmlText.indexOf('?>', lt + 2)
      if (end === -1) return null
      pos = end + 2
      continue
    }
    if (xmlText.startsWith('<![CDATA[', lt)) {
      // OOXML 正文不用 CDATA，但出现时不该直接判死，按纯文本保留
      const end = xmlText.indexOf(']]>', lt + 9)
      if (end === -1) return null
      const parent = current()
      if (parent) parent.text += xmlText.slice(lt + 9, end)
      pos = end + 3
      continue
    }
    if (xmlText.startsWith('<!', lt)) {
      const end = xmlText.indexOf('>', lt + 2)
      if (end === -1) return null
      pos = end + 1
      continue
    }

    const gt = xmlText.indexOf('>', lt + 1)
    if (gt === -1) return null
    const inner = xmlText.slice(lt + 1, gt)

    if (inner.startsWith('/')) {
      // 闭合标签：名字不必严格校验（输入域规整），弹一层即可
      if (stack.length === 0) return null
      stack.pop()
      pos = gt + 1
      continue
    }

    const selfClosing = inner.endsWith('/')
    const body = selfClosing ? inner.slice(0, -1) : inner
    const spaceIdx = body.search(/[\s]/)
    const tagName = (spaceIdx === -1 ? body : body.slice(0, spaceIdx)).trim()
    if (!tagName) return null
    const attrSrc = spaceIdx === -1 ? '' : body.slice(spaceIdx)
    const node: MiniElement = {
      localName: splitQualifiedName(tagName),
      qualifiedName: tagName,
      attributes: parseAttributes(attrSrc),
      children: [],
      text: ''
    }
    appendNode(node)
    if (!selfClosing) stack.push(node)
    pos = gt + 1
  }

  if (stack.length !== 0) return null
  // 文档级：返回第一个元素（其余应为空白/声明，被跳过）
  return rootChildren.length > 0 ? rootChildren[0] : null
}

/** 混合文本内容：元素自身 text + 所有后代元素的 text（对齐 DOM textContent 语义） */
function textContentOf(el: MiniElement): string {
  let out = el.text
  for (const child of el.children) out += textContentOf(child)
  return out
}

export interface PptxTextRun {
  text: string
  /** 磅值（OOXML sz/100 换算后）。缺省表示继承自主题/占位符，渲染层用默认字号 */
  fontSizePt?: number
  bold?: boolean
  /** #rrggbb。主题色（schemeClr）不解算，缺省 */
  color?: string
}

export interface PptxParagraph {
  runs: PptxTextRun[]
  align?: 'left' | 'center' | 'right'
  /** a:pPr lvl 缩进层级（0-8），无显式值时缺省 */
  indentLevel?: number
}

interface PptxShapeBase {
  /** EMU 坐标（slide 画布坐标系） */
  x: number
  y: number
  cx: number
  cy: number
  /** true 表示原文档无显式坐标（继承缺失），位置是解析侧瀑布流估算的近似值 */
  flowing?: boolean
}

export interface PptxTextShape extends PptxShapeBase {
  type: 'text'
  paragraphs: PptxParagraph[]
}

export interface PptxImageShape extends PptxShapeBase {
  type: 'image'
  mediaIndex: number
}

export interface PptxTableShape extends PptxShapeBase {
  type: 'table'
  rows: string[][]
}

export type PptxShape = PptxTextShape | PptxImageShape | PptxTableShape

export interface PptxSlideData {
  shapes: PptxShape[]
}

export interface PptxMediaEntry {
  bytes: ArrayBuffer
  mime: string
}

export interface PptxParseResult {
  slideWidthEmu: number
  slideHeightEmu: number
  slides: PptxSlideData[]
  media: PptxMediaEntry[]
}

export type PptxWorkerRequest = {
  seq: number
  type: 'parse'
  buffer: ArrayBuffer
}

export type PptxWorkerResponse =
  | { seq: number; ok: true; result: PptxParseResult }
  | { seq: number; ok: false; error: string }

const MEDIA_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
}

/** 规范化 zip 内相对路径：解析 ../ 与 ./ 段，不做文件系统语义 */
function normalizeZipPath(baseDir: string, target: string): string {
  const raw = target.startsWith('/') ? target.slice(1) : `${baseDir}${target}`
  const parts: string[] = []
  for (const seg of raw.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      parts.pop()
      continue
    }
    parts.push(seg)
  }
  return parts.join('/')
}

/** 按 localName 深度搜索（命名空间前缀差异兼容，不含 root 自身） */
function deepByLocal(root: MiniElement, local: string): MiniElement[] {
  const out: MiniElement[] = []
  const walk = (el: MiniElement): void => {
    for (const child of el.children) {
      if (child.localName === local) out.push(child)
      walk(child)
    }
  }
  walk(root)
  return out
}

function firstDeepByLocal(root: MiniElement, local: string): MiniElement | null {
  const list = deepByLocal(root, local)
  return list.length > 0 ? list[0] : null
}

/** 直接子元素按 localName 过滤（结构导航用，避免误吸嵌套同名节点） */
function directByLocal(el: MiniElement, local: string): MiniElement[] {
  return el.children.filter((child) => child.localName === local)
}

function firstDirectByLocal(el: MiniElement, local: string): MiniElement | null {
  const found = el.children.find((child) => child.localName === local)
  return found ?? null
}

/** r:id / r:embed 等关系属性读取：OOXML 关系命名空间前缀固定为 r */
function relAttr(el: MiniElement, name: string): string {
  return el.attributes[`r:${name}`] ?? ''
}

interface RelEntry {
  type: string
  target: string
}

function parseRels(xmlText: string, baseDir: string): Map<string, RelEntry> {
  const doc = parseXml(xmlText)
  const map = new Map<string, RelEntry>()
  if (!doc) return map
  for (const rel of deepByLocal(doc, 'Relationship')) {
    const id = rel.attributes['Id']
    const target = rel.attributes['Target']
    if (!id || !target) continue
    // 外链（TargetMode=External）不是 zip 内路径，原样保留交由调用方跳过
    const external = rel.attributes['TargetMode'] === 'External'
    map.set(id, {
      type: rel.attributes['Type'] ?? '',
      target: external ? target : normalizeZipPath(baseDir, target)
    })
  }
  return map
}

interface Xfrm {
  x: number
  y: number
  cx: number
  cy: number
}

function numAttr(el: MiniElement | null, name: string): number | null {
  if (!el) return null
  const raw = el.attributes[name]
  if (!raw) return null
  const num = Number(raw)
  return Number.isFinite(num) ? num : null
}

/** xfrm 容器可能是 spPr（a:xfrm）或 graphicFrame（p:xfrm），用 localName 通配 */
function readXfrm(owner: MiniElement): Xfrm | null {
  const xfrm = firstDeepByLocal(owner, 'xfrm')
  if (!xfrm) return null
  const off = firstDirectByLocal(xfrm, 'off')
  const ext = firstDirectByLocal(xfrm, 'ext')
  const x = numAttr(off, 'x')
  const y = numAttr(off, 'y')
  const cx = numAttr(ext, 'cx')
  const cy = numAttr(ext, 'cy')
  if (x === null || y === null || cx === null || cy === null) return null
  return { x, y, cx, cy }
}

interface PlaceholderKey {
  type: string
  idx: string | null
}

function readPlaceholderKey(sp: MiniElement): PlaceholderKey | null {
  const nvPr = firstDeepByLocal(sp, 'nvPr')
  if (!nvPr) return null
  const ph = firstDirectByLocal(nvPr, 'ph')
  if (!ph) return null
  return {
    type: ph.attributes['type'] ?? 'body',
    idx: ph.attributes['idx'] ?? null
  }
}

function readSolidColor(rPr: MiniElement): string | undefined {
  const fill = firstDirectByLocal(rPr, 'solidFill')
  if (!fill) return undefined
  const srgb = firstDirectByLocal(fill, 'srgbClr')
  const val = srgb?.attributes['val']
  return val ? `#${val}` : undefined
}

function readRun(rPrOwner: MiniElement, text: string): PptxTextRun {
  const run: PptxTextRun = { text }
  const rPr = firstDirectByLocal(rPrOwner, 'rPr')
  if (rPr) {
    const sz = numAttr(rPr, 'sz')
    if (sz !== null && sz > 0) run.fontSizePt = sz / 100
    if (rPr.attributes['b'] === '1') run.bold = true
    const color = readSolidColor(rPr)
    if (color) run.color = color
  }
  return run
}

const ALIGN_MAP: Record<string, 'left' | 'center' | 'right'> = {
  l: 'left',
  ctr: 'center',
  r: 'right'
}

function readParagraphs(txBody: MiniElement): PptxParagraph[] {
  const paragraphs: PptxParagraph[] = []
  for (const para of directByLocal(txBody, 'p')) {
    const out: PptxParagraph = { runs: [] }
    const pPr = firstDirectByLocal(para, 'pPr')
    const algn = pPr?.attributes['algn']
    if (algn && ALIGN_MAP[algn]) out.align = ALIGN_MAP[algn]
    const lvl = pPr?.attributes['lvl']
    if (lvl) {
      const levelNum = Number(lvl)
      if (Number.isInteger(levelNum) && levelNum > 0 && levelNum <= 8) out.indentLevel = levelNum
    }
    for (let i = 0; i < para.children.length; i += 1) {
      const child = para.children[i]
      if (child.localName === 'r' || child.localName === 'fld') {
        const textNode = firstDirectByLocal(child, 't')
        const text = textNode ? textContentOf(textNode) : ''
        if (text) out.runs.push(readRun(child, text))
      } else if (child.localName === 'br') {
        // 显式换行折进 run 文本，渲染层用 white-space: pre-line 还原
        const last = out.runs[out.runs.length - 1]
        if (last) last.text += '\n'
        else out.runs.push({ text: '\n' })
      }
    }
    paragraphs.push(out)
  }
  return paragraphs
}

/** 段落估算高度（EMU）：瀑布流排布占位用，精度要求低 */
function estimateTextHeightEmu(paragraphs: PptxParagraph[], widthEmu: number): number {
  const widthPt = (widthEmu / 914400) * 72
  let totalPt = 0
  for (const para of paragraphs) {
    const text = para.runs.map((r) => r.text).join('')
    const maxFont = Math.max(...para.runs.map((r) => r.fontSizePt ?? 18), 18)
    const charsPerLine = Math.max(8, Math.floor(widthPt / (maxFont * 0.6)))
    const lines = Math.max(1, Math.ceil(text.length / charsPerLine))
    totalPt += lines * maxFont * 1.4
  }
  return Math.max(1, Math.ceil((totalPt / 72) * 914400))
}

interface SlideContext {
  zip: JSZip
  layoutXfrmCache: Map<string, Promise<Map<string, Xfrm>>>
}

/** 从一份 slideLayout/slideMaster XML 中收集占位符 xfrm */
function extractXfrmMap(doc: MiniElement): Map<string, Xfrm> {
  const map = new Map<string, Xfrm>()
  for (const sp of deepByLocal(doc, 'sp')) {
    const key = readPlaceholderKey(sp)
    if (!key) continue
    const spPr = firstDirectByLocal(sp, 'spPr')
    const xfrm = spPr ? readXfrm(spPr) : null
    if (!xfrm) continue
    // idx 精确键 + 类型键都记，查找时先精确后类型
    if (key.idx !== null) map.set(`${key.type}#${key.idx}`, xfrm)
    if (!map.has(key.type)) map.set(key.type, xfrm)
  }
  return map
}

/**
 * 占位符坐标继承：slide → slideLayout → slideMaster 两跳查找。
 * 真实文件（如 python-pptx / Office 默认模板）里最常用的"标题+内容"版式
 * 连 layout 都不带坐标，坐标落在 master 上，所以必须走到第二跳；
 * 不做第三跳主题级联，缺省仍走瀑布流兜底。
 */
async function loadLayoutXfrmMap(ctx: SlideContext, layoutPath: string): Promise<Map<string, Xfrm>> {
  const cached = ctx.layoutXfrmCache.get(layoutPath)
  if (cached) return cached
  const promise = (async (): Promise<Map<string, Xfrm>> => {
    const map = new Map<string, Xfrm>()
    const file = ctx.zip.file(layoutPath)
    if (!file) return map
    const layoutDoc = parseXml(await file.async('text'))
    if (!layoutDoc) return map
    const layoutMap = extractXfrmMap(layoutDoc)

    // 第二跳：layout rels → slideMaster，master 里缺的键用 layout 的值优先保留
    const layoutDir = layoutPath.slice(0, layoutPath.lastIndexOf('/') + 1)
    const layoutName = layoutPath.slice(layoutPath.lastIndexOf('/') + 1)
    const layoutRelsFile = ctx.zip.file(`${layoutDir}_rels/${layoutName}.rels`)
    let masterMap: Map<string, Xfrm> | null = null
    if (layoutRelsFile) {
      const layoutRels = parseRels(await layoutRelsFile.async('text'), layoutDir)
      const masterRel = Array.from(layoutRels.values()).find((rel) => rel.type.endsWith('/slideMaster'))
      if (masterRel) {
        const masterFile = ctx.zip.file(masterRel.target)
        if (masterFile) {
          const masterDoc = parseXml(await masterFile.async('text'))
          if (masterDoc) masterMap = extractXfrmMap(masterDoc)
        }
      }
    }
    // 合并：layout 精确值优先，master 作为缺省填充
    const keys = new Set<string>()
    layoutMap.forEach((_v, k) => keys.add(k))
    masterMap?.forEach((_v, k) => keys.add(k))
    for (const k of keys) {
      const val = layoutMap.get(k) ?? masterMap?.get(k)
      if (val) map.set(k, val)
    }
    return map
  })()
  ctx.layoutXfrmCache.set(layoutPath, promise)
  return promise
}

async function resolveInheritedXfrm(
  ctx: SlideContext,
  slideRels: Map<string, RelEntry>,
  key: PlaceholderKey | null
): Promise<Xfrm | null> {
  if (!key) return null
  const layoutRel = Array.from(slideRels.values()).find((rel) => rel.type.endsWith('/slideLayout'))
  if (!layoutRel) return null
  const map = await loadLayoutXfrmMap(ctx, layoutRel.target)
  if (key.idx !== null) {
    const exact = map.get(`${key.type}#${key.idx}`)
    if (exact) return exact
  }
  return map.get(key.type) ?? null
}

interface RawShape {
  kind: 'text' | 'image' | 'table'
  xfrm: Xfrm | null
  paragraphs?: PptxParagraph[]
  rows?: string[][]
  mediaTarget?: string
  phKey?: PlaceholderKey | null
}

function readTextShape(sp: MiniElement): RawShape | null {
  const txBody = firstDirectByLocal(sp, 'txBody')
  if (!txBody) return null
  const paragraphs = readParagraphs(txBody)
  const hasText = paragraphs.some((p) => p.runs.some((r) => r.text.trim().length > 0))
  if (!hasText) return null
  const spPr = firstDirectByLocal(sp, 'spPr')
  return {
    kind: 'text',
    xfrm: spPr ? readXfrm(spPr) : null,
    paragraphs,
    phKey: readPlaceholderKey(sp)
  }
}

function readPictureShape(pic: MiniElement, slideRels: Map<string, RelEntry>): RawShape | null {
  const blip = firstDeepByLocal(pic, 'blip')
  if (!blip) return null
  const embedId = relAttr(blip, 'embed')
  if (!embedId) return null
  const rel = slideRels.get(embedId)
  if (!rel) return null
  const spPr = firstDirectByLocal(pic, 'spPr')
  return {
    kind: 'image',
    xfrm: spPr ? readXfrm(spPr) : null,
    mediaTarget: rel.target
  }
}

function readTableShape(frame: MiniElement): RawShape | null {
  const tbl = firstDeepByLocal(frame, 'tbl')
  if (!tbl) return null
  const rows: string[][] = []
  for (const tr of directByLocal(tbl, 'tr')) {
    const row: string[] = []
    for (const tc of directByLocal(tr, 'tc')) {
      const txBody = firstDirectByLocal(tc, 'txBody')
      const text = txBody
        ? readParagraphs(txBody)
            .map((p) => p.runs.map((r) => r.text).join(''))
            .join('\n')
            .trim()
        : ''
      row.push(text)
    }
    rows.push(row)
  }
  if (rows.length === 0) return null
  return { kind: 'table', xfrm: readXfrm(frame), rows }
}

/**
 * 遍历 spTree 收集形状。组合形状递归展开：
 * 子坐标系缩放（chExt→ext 映射）不做矩阵换算，只按 grp 偏移量平移——
 * 等比场景（chOff==off 且 chExt==ext，常见）下完全准确，其余为近似。
 */
function collectShapes(
  container: MiniElement,
  slideRels: Map<string, RelEntry>,
  offsetX: number,
  offsetY: number,
  out: RawShape[]
): void {
  for (let i = 0; i < container.children.length; i += 1) {
    const child = container.children[i]
    if (child.localName === 'sp') {
      const shape = readTextShape(child)
      if (shape) {
        if (shape.xfrm) {
          shape.xfrm.x += offsetX
          shape.xfrm.y += offsetY
        }
        out.push(shape)
      }
    } else if (child.localName === 'pic') {
      const shape = readPictureShape(child, slideRels)
      if (shape) {
        if (shape.xfrm) {
          shape.xfrm.x += offsetX
          shape.xfrm.y += offsetY
        }
        out.push(shape)
      }
    } else if (child.localName === 'graphicFrame') {
      const shape = readTableShape(child)
      if (shape) {
        if (shape.xfrm) {
          shape.xfrm.x += offsetX
          shape.xfrm.y += offsetY
        }
        out.push(shape)
      }
    } else if (child.localName === 'grpSp') {
      const grpSpPr = firstDirectByLocal(child, 'grpSpPr')
      let childOffsetX = offsetX
      let childOffsetY = offsetY
      if (grpSpPr) {
        const xfrm = firstDeepByLocal(grpSpPr, 'xfrm')
        const off = xfrm ? firstDirectByLocal(xfrm, 'off') : null
        const chOff = xfrm ? firstDirectByLocal(xfrm, 'chOff') : null
        const gx = numAttr(off, 'x') ?? 0
        const gy = numAttr(off, 'y') ?? 0
        const cx = numAttr(chOff, 'x') ?? 0
        const cy = numAttr(chOff, 'y') ?? 0
        childOffsetX = offsetX + (gx - cx)
        childOffsetY = offsetY + (gy - cy)
      }
      collectShapes(child, slideRels, childOffsetX, childOffsetY, out)
    }
  }
}

async function parsePresentation(buffer: ArrayBuffer): Promise<{ result: PptxParseResult; transfer: ArrayBuffer[] }> {
  const zip = await JSZip.loadAsync(buffer)
  const presentationFile = zip.file('ppt/presentation.xml')
  if (!presentationFile) throw new Error('缺少 ppt/presentation.xml，不是有效的演示文稿')
  const presentationDoc = parseXml(await presentationFile.async('text'))
  if (!presentationDoc) throw new Error('presentation.xml 解析失败，文件可能已损坏')

  const sldSz = firstDeepByLocal(presentationDoc, 'sldSz')
  const slideWidthEmu = numAttr(sldSz, 'cx') ?? 12192000
  const slideHeightEmu = numAttr(sldSz, 'cy') ?? 6858000

  const presentationRelsFile = zip.file('ppt/_rels/presentation.xml.rels')
  if (!presentationRelsFile) throw new Error('缺少 presentation.xml.rels，文件结构不完整')
  const presentationRels = parseRels(await presentationRelsFile.async('text'), 'ppt/')

  // 幻灯片顺序以 sldIdLst 的 r:id 顺序为准，经 rels 映射到具体 slideN.xml；
  // 不能假设 slide1.xml..slideN.xml 的顺序与编号连续。
  const slidePaths: string[] = []
  const sldIdLst = firstDeepByLocal(presentationDoc, 'sldIdLst')
  if (sldIdLst) {
    for (const sldId of directByLocal(sldIdLst, 'sldId')) {
      const rid = relAttr(sldId, 'id')
      const rel = rid ? presentationRels.get(rid) : undefined
      if (rel && !slidePaths.includes(rel.target)) slidePaths.push(rel.target)
    }
  }
  if (slidePaths.length === 0) throw new Error('演示文稿不包含任何幻灯片')

  const media: PptxMediaEntry[] = []
  const mediaIndexByPath = new Map<string, number>()
  const transfer: ArrayBuffer[] = []
  const ctx: SlideContext = { zip, layoutXfrmCache: new Map() }

  const slides: PptxSlideData[] = []
  for (const slidePath of slidePaths) {
    const slideFile = zip.file(slidePath)
    if (!slideFile) continue
    const slideDoc = parseXml(await slideFile.async('text'))
    if (!slideDoc) {
      slides.push({ shapes: [] })
      continue
    }

    const slideDir = slidePath.slice(0, slidePath.lastIndexOf('/') + 1)
    const slideName = slidePath.slice(slidePath.lastIndexOf('/') + 1)
    const relsPath = `${slideDir}_rels/${slideName}.rels`
    const slideRelsFile = zip.file(relsPath)
    const slideRels = slideRelsFile
      ? parseRels(await slideRelsFile.async('text'), slideDir)
      : new Map<string, RelEntry>()

    const spTree = firstDeepByLocal(slideDoc, 'spTree')
    if (!spTree) {
      slides.push({ shapes: [] })
      continue
    }

    const rawShapes: RawShape[] = []
    collectShapes(spTree, slideRels, 0, 0, rawShapes)

    // 无坐标形状：先做 layout→master 两跳继承查找，仍无坐标则瀑布流兜底。
    // 瀑布流游标从"已定位形状的最低下缘"起算，避免与继承/显式形状重叠；
    // 只看不重叠就满足内容预览的"能读清"水位，不追求原版式排布。
    let flowCursorY = Math.round(slideHeightEmu * 0.08)
    for (const raw of rawShapes) {
      if (raw.xfrm && raw.xfrm.y + raw.xfrm.cy > flowCursorY) {
        flowCursorY = raw.xfrm.y + raw.xfrm.cy
      }
    }
    const flowX = Math.round(slideWidthEmu * 0.07)
    const flowCx = Math.round(slideWidthEmu * 0.86)
    const shapes: PptxShape[] = []
    for (const raw of rawShapes) {
      let xfrm = raw.xfrm
      let flowing = false
      if (!xfrm) {
        xfrm = (await resolveInheritedXfrm(ctx, slideRels, raw.phKey ?? null)) ?? null
      }
      if (xfrm && xfrm.y + xfrm.cy > flowCursorY) {
        flowCursorY = xfrm.y + xfrm.cy
      }
      if (!xfrm) {
        const estHeight =
          raw.kind === 'text' && raw.paragraphs
            ? estimateTextHeightEmu(raw.paragraphs, flowCx)
            : Math.round(slideHeightEmu * 0.2)
        xfrm = { x: flowX, y: flowCursorY, cx: flowCx, cy: estHeight }
        flowCursorY += estHeight + Math.round(slideHeightEmu * 0.03)
        flowing = true
      }

      if (raw.kind === 'text' && raw.paragraphs) {
        shapes.push({ type: 'text', ...xfrm, flowing, paragraphs: raw.paragraphs })
      } else if (raw.kind === 'table' && raw.rows) {
        shapes.push({ type: 'table', ...xfrm, flowing, rows: raw.rows })
      } else if (raw.kind === 'image' && raw.mediaTarget) {
        const target = raw.mediaTarget
        let mediaIndex = mediaIndexByPath.get(target)
        if (mediaIndex === undefined) {
          const ext = target.slice(target.lastIndexOf('.')).toLowerCase()
          const mime = MEDIA_MIME_BY_EXT[ext]
          const mediaFile = zip.file(target)
          // emf/wmf 等浏览器无法显示的格式直接跳过（shape 一并丢弃）
          if (!mime || !mediaFile) continue
          const bytes = await mediaFile.async('arraybuffer')
          mediaIndex = media.length
          media.push({ bytes, mime })
          transfer.push(bytes)
          mediaIndexByPath.set(target, mediaIndex)
        }
        shapes.push({ type: 'image', ...xfrm, flowing, mediaIndex })
      }
    }
    slides.push({ shapes })
  }

  return {
    result: { slideWidthEmu, slideHeightEmu, slides, media },
    transfer
  }
}

self.onmessage = async (event: MessageEvent<PptxWorkerRequest>): Promise<void> => {
  const { seq } = event.data
  try {
    const { result, transfer } = await parsePresentation(event.data.buffer)
    const scope = self as unknown as Worker
    scope.postMessage({ seq, ok: true, result } satisfies PptxWorkerResponse, transfer)
  } catch (error) {
    // 解析异常（非 zip / 加密 / 结构损坏）统一回传 error，主线程落兜底卡片，
    // 避免 Promise 悬挂与 worker 残留。
    const scope = self as unknown as Worker
    scope.postMessage({
      seq,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    } satisfies PptxWorkerResponse)
  }
}
