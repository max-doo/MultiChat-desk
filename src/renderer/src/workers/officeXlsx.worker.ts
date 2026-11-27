/// <reference lib="webworker" />
/**
 * xlsx 解析 Worker。
 * 大表 XML 解包与字符串处理在主线程会造成可感卡顿，因此 read 与 sheet_to_json
 * 全部在这里完成；workbook 常驻 worker 内存不回传主线程，
 * sheet 按 index 惰性 JSON 化（sheet_to_json 是全量字符串化，惰性避免打开即解析所有 sheet）。
 * 协议与 gitDiff.worker 同款：seq 回显供主线程乱序丢弃，异常统一回传 error 不悬挂。
 */
import * as XLSX from '@e965/xlsx'

export interface XlsxMergeRange {
  s: { r: number; c: number }
  e: { r: number; c: number }
}

export type OfficeXlsxWorkerRequest =
  | { seq: number; type: 'init'; buffer: ArrayBuffer }
  | { seq: number; type: 'parseSheet'; sheetIndex: number }

export type OfficeXlsxWorkerResponse =
  | { seq: number; type: 'init'; ok: true; sheetNames: string[] }
  | { seq: number; type: 'init'; ok: false; error: string }
  | {
      seq: number
      type: 'parseSheet'
      ok: true
      sheetIndex: number
      rows: string[][]
      merges: XlsxMergeRange[]
      colCount: number
    }
  | { seq: number; type: 'parseSheet'; ok: false; sheetIndex: number; error: string }

let workbook: XLSX.WorkBook | null = null

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function handleInit(seq: number, buffer: ArrayBuffer): OfficeXlsxWorkerResponse {
  try {
    // xlsx 解析器对非 zip 输入会静默降级成 CSV 文本解析，损坏/加密文件会被"成功"解析成乱码单格。
    // OOXML 必然是 zip 容器（PK 魔数）；加密 xlsx 是 OLE 复合文档（非 PK），同样拒绝——
    // 拒绝后走渲染层的错误兜底卡片，不给用户展示伪解析结果。
    const magic = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength))
    if (magic.length < 4 || magic[0] !== 0x50 || magic[1] !== 0x4b) {
      throw new Error('文件已损坏或已被加密，不支持内嵌预览')
    }
    workbook = XLSX.read(buffer, { type: 'array' })
    return { seq, type: 'init', ok: true, sheetNames: workbook.SheetNames }
  } catch (err) {
    workbook = null
    return { seq, type: 'init', ok: false, error: errorMessage(err) }
  }
}

function handleParseSheet(seq: number, sheetIndex: number): OfficeXlsxWorkerResponse {
  try {
    if (!workbook) throw new Error('workbook 尚未初始化')
    const name = workbook.SheetNames[sheetIndex]
    const sheet = name ? workbook.Sheets[name] : undefined
    if (!sheet) throw new Error(`工作表不存在：index ${sheetIndex}`)

    // raw:false 走格式化文本——公式显示缓存的计算值，不解析公式本身；
    // defval:'' 把空格单元格补齐成矩形网格。
    const rawRows = XLSX.utils.sheet_to_json<unknown>(sheet, {
      header: 1,
      raw: false,
      defval: ''
    }) as unknown[][]

    let colCount = 0
    const rows: string[][] = new Array(rawRows.length)
    for (let r = 0; r < rawRows.length; r += 1) {
      const rawRow = Array.isArray(rawRows[r]) ? rawRows[r] : []
      if (rawRow.length > colCount) colCount = rawRow.length
      const row: string[] = new Array(rawRow.length)
      for (let c = 0; c < rawRow.length; c += 1) {
        const value = rawRow[c]
        row[c] = typeof value === 'string' ? value : value == null ? '' : String(value)
      }
      rows[r] = row
    }

    // 合并区域可能超出数据列数（标题行合并到空列），colCount 取并集
    const merges: XlsxMergeRange[] = []
    const rawMerges = sheet['!merges']
    if (Array.isArray(rawMerges)) {
      for (const merge of rawMerges) {
        if (!merge || !merge.s || !merge.e) continue
        merges.push({
          s: { r: merge.s.r, c: merge.s.c },
          e: { r: merge.e.r, c: merge.e.c }
        })
        if (merge.e.c + 1 > colCount) colCount = merge.e.c + 1
      }
    }

    return { seq, type: 'parseSheet', ok: true, sheetIndex, rows, merges, colCount }
  } catch (err) {
    return { seq, type: 'parseSheet', ok: false, sheetIndex, error: errorMessage(err) }
  }
}

self.onmessage = (event: MessageEvent<OfficeXlsxWorkerRequest>): void => {
  const request = event.data
  if (!request || typeof request.seq !== 'number') return
  let response: OfficeXlsxWorkerResponse
  try {
    if (request.type === 'init') {
      response = handleInit(request.seq, request.buffer)
    } else {
      response = handleParseSheet(request.seq, request.sheetIndex)
    }
  } catch (err) {
    // 防御：read/sheet_to_json 之外的意外异常（OOM 等）也不能让主线程悬挂
    response =
      request.type === 'init'
        ? { seq: request.seq, type: 'init', ok: false, error: errorMessage(err) }
        : { seq: request.seq, type: 'parseSheet', ok: false, sheetIndex: -1, error: errorMessage(err) }
  }
  self.postMessage(response)
}
