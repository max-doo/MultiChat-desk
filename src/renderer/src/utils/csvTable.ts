/**
 * CSV/TSV 文本 → 矩形二维网格的定向解析器。
 * 不引第三方库：RFC4180 的核心规则（双引号转义、引号内逗号/换行）实现量小，
 * 体积敏感场景（每次切视图都要跑）用手写状态机更可预期。
 * 边界取舍：ragged 行按最大列数补 '' 矩形化（真实世界 CSV 列数不齐是常态）；
 * 分隔符在 , ; \t 之间按表头行频率自动探测（.tsv 仍以内容为准，对误命名文件更稳）。
 */

export interface CsvGrid {
  rows: string[][]
  colCount: number
}

const DELIMITER_CANDIDATES = [',', '\t', ';']

/** 用第一行的非引号内分隔符频率猜测分隔符。 */
function detectDelimiter(text: string): string {
  const sample = text.slice(0, 8192)
  const firstLineEnd = sample.indexOf('\n')
  const line = firstLineEnd === -1 ? sample : sample.slice(0, firstLineEnd)
  let best = ','
  let bestCount = 0
  for (const delimiter of DELIMITER_CANDIDATES) {
    let count = 0
    let inQuotes = false
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          i += 1
          continue
        }
        inQuotes = !inQuotes
      } else if (!inQuotes && ch === delimiter) {
        count += 1
      }
    }
    if (count > bestCount) {
      bestCount = count
      best = delimiter
    }
  }
  return best
}

/**
 * 解析整段文本为网格。空文本返回空网格；末尾换行不产生多余空行；
 * 引号内换行保留为单元格内 \n（渲染层 title 提示完整内容）。
 */
export function parseCsvText(input: string): CsvGrid {
  if (!input) return { rows: [], colCount: 0 }
  // BOM 剥离（utf-8 BOM 在中文导出的 CSV 里常见）
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const delimiter = detectDelimiter(text)

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const n = text.length

  const pushField = (): void => {
    row.push(field)
    field = ''
  }
  const pushRow = (): void => {
    // 文件以换行结尾不会产生多余空行：最后一个换行只消费而不追加字段，
    // EOF 收尾靠 field/row 双空判断，因此这里的空行（单空字段）全是真实空行，要保留
    if (row.length > 0) rows.push(row)
    row = []
  }

  while (i < n) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }
    if (ch === '"') {
      // 引号只认字段起始位置：字段中间出现的孤立引号按普通字符容错，
      // 避免不规范 CSV 吞掉剩余全部文本
      if (field === '') {
        inQuotes = true
      } else {
        field += ch
      }
      i += 1
      continue
    }
    if (ch === delimiter) {
      pushField()
      i += 1
      continue
    }
    if (ch === '\n' || ch === '\r') {
      pushField()
      pushRow()
      // CRLF 一次性消费
      if (ch === '\r' && text[i + 1] === '\n') i += 2
      else i += 1
      continue
    }
    field += ch
    i += 1
  }
  // 收尾：未闭合引号按宽容处理（内容已有），末尾字段/行落盘
  if (field !== '' || row.length > 0) {
    pushField()
    pushRow()
  }

  let colCount = 0
  for (const r of rows) {
    if (r.length > colCount) colCount = r.length
  }
  // ragged 行矩形化
  for (const r of rows) {
    while (r.length < colCount) r.push('')
  }
  return { rows, colCount }
}
