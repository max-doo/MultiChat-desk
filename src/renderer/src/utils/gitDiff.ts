/**
 * Git 行内/块级变更标记的 Diff 计算。
 * - 两侧文本先做 CRLF→LF 归一化再切行（Windows 下工作区与 Index 换行符常不一致）。
 * - 行映射为 32-bit FNV-1a 哈希整数后跑 Myers 最短编辑路径，比逐行字符串比较快且省内存。
 * - 超过行数/字节/单行长度/编辑步数上限时直接熔断返回空标记。
 */

/** 基准与当前文本任一侧超过 1 MiB 或 20,000 行即跳过精细 Diff */
const MAX_DIFF_BYTES = 1024 * 1024
const MAX_DIFF_LINES = 20_000
/** 存在单行超过 10,000 字符（压缩 JS/JSON）时跳过，防止行哈希与渲染抖动 */
const MAX_LINE_LENGTH = 10_000
/** 大文件分流阈值：总行数超过该值时由调用方派发到 Web Worker */
export const GIT_DIFF_WORKER_LINE_THRESHOLD = 4_000
/**
 * Myers 最大编辑距离保护，整体替换/全量格式化时降级为无标记。
 * trace 每层保存 Int32Array(2*max+1)，峰值内存 ~O(max * D)；
 * 5,000 步内最坏 ~40MB（20k 行），再大则无 gutter 价值故熔断。
 */
const MAX_DIFF_STEPS = 5_000

export interface GitLineDiffResult {
  /** 每行（新文件 0-indexed）的标记；无标记为 undefined */
  lineMarks: Array<'added' | 'modified' | undefined>
  /** 纯删除指示：key 为新文件行号，value 为该删除点被移除的旧行数 */
  deletedAfter: Map<number, number>
  /** 因熔断保护被跳过（不显示标记） */
  truncated: boolean
}

function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

function splitLines(text: string): string[] {
  const normalized = normalizeText(text)
  const lines = normalized.split('\n')
  // 末尾换行产生的空串不视为真实行，两侧统一裁掉避免误判新增/删除
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }
  return lines
}

/** FNV-1a 32-bit：把每行内容映射为整数，Myers 比对整数数组 */
function hashLine(line: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < line.length; i++) {
    hash ^= line.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** 空文件统一为空数组，保证 0 行与空文件语义一致 */
function linesToHashes(lines: string[]): Uint32Array {
  const hashes = new Uint32Array(lines.length)
  for (let i = 0; i < lines.length; i++) {
    hashes[i] = hashLine(lines[i])
  }
  return hashes
}

/**
 * 基于整数数组的 Myers 最短编辑路径。
 * 返回操作序列：0=保留，1=删除旧行，2=插入新行，按旧→新遍历顺序。
 * 超过 maxSteps 时返回 null（调用方熔断降级）。
 */
function myersDiff(a: Uint32Array, b: Uint32Array, maxSteps: number): Int8Array | null {
  const n = a.length
  const m = b.length
  if (n === 0 && m === 0) return new Int8Array(0)

  // 去掉首尾公共行，缩小搜索空间
  let start = 0
  while (start < n && start < m && a[start] === b[start]) start++
  let endA = n
  let endB = m
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const aMid = a.subarray(start, endA)
  const bMid = b.subarray(start, endB)
  const midN = aMid.length
  const midM = bMid.length

  const ops: number[] = []
  for (let i = 0; i < start; i++) ops.push(0)

  if (midN === 0) {
    for (let i = 0; i < midM; i++) ops.push(2)
  } else if (midM === 0) {
    for (let i = 0; i < midN; i++) ops.push(1)
  } else {
    const max = midN + midM
    const width = 2 * max + 1
    const v = new Int32Array(width)
    const trace: Int32Array[] = []
    let found = -1

    for (let d = 0; d <= max; d++) {
      if (d > maxSteps) return null
      // 每层仅保存 [-d, +d] 范围的 2d+1 个槽位，避免保存整条 2*max+1 导致 ~1.6GB 内存峰值
      trace.push(v.subarray(max - d, max + d + 1).slice())
      for (let k = -d; k <= d; k += 2) {
        const idx = k + max
        let x: number
        if (k === -d || (k !== d && v[idx - 1] < v[idx + 1])) {
          x = v[idx + 1]
        } else {
          x = v[idx - 1] + 1
        }
        let y = x - k
        while (x < midN && y < midM && aMid[x] === bMid[y]) {
          x++
          y++
        }
        v[idx] = x
        if (x >= midN && y >= midM) {
          found = d
          break
        }
      }
      if (found >= 0) break
    }

    if (found < 0) return null

    // 回溯：从最深 d 层往 0 走，重建删除/插入序列（按 k + d 索引压缩后的层切片）
    const midOps: number[] = []
    let x = midN
    let y = midM
    for (let d = found; d > 0; d--) {
      const vD = trace[d]
      const k = x - y
      const idx = k + d
      let prevK: number
      if (k === -d || (k !== d && vD[idx - 1] < vD[idx + 1])) {
        prevK = k + 1
      } else {
        prevK = k - 1
      }
      const prevX = vD[prevK + d]
      const prevY = prevX - prevK
      while (x > prevX && y > prevY) {
        midOps.push(0)
        x--
        y--
      }
      if (x === prevX) {
        midOps.push(2)
        y--
      } else {
        midOps.push(1)
        x--
      }
    }
    while (x > 0 && y > 0) {
      midOps.push(0)
      x--
      y--
    }
    midOps.reverse()
    ops.push(...midOps)
  }

  for (let i = 0; i < n - endA; i++) ops.push(0)
  return Int8Array.from(ops)
}

/**
 * 把 Myers 操作序列折叠为 VSCode 风格的行标记。
 * 连续 delete+insert 块：前 min(k,m) 行标 modified，多出部分标 added/deleted。
 */
function buildResult(
  ops: Int8Array,
  newLineCount: number
): { lineMarks: Array<'added' | 'modified' | undefined>; deletedAfter: Map<number, number> } {
  const lineMarks: Array<'added' | 'modified' | undefined> = new Array(newLineCount)
  const deletedAfter = new Map<number, number>()
  let newIdx = 0
  let i = 0

  while (i < ops.length) {
    if (ops[i] === 0) {
      newIdx++
      i++
      continue
    }
    // 收集同一块内连续的删除与插入
    let delCount = 0
    let insCount = 0
    const blockNewStart = newIdx
    while (i < ops.length && ops[i] !== 0) {
      if (ops[i] === 1) {
        delCount++
      } else {
        insCount++
        newIdx++
      }
      i++
    }
    const modified = Math.min(delCount, insCount)
    for (let j = 0; j < modified; j++) {
      lineMarks[blockNewStart + j] = 'modified'
    }
    for (let j = modified; j < insCount; j++) {
      lineMarks[blockNewStart + j] = 'added'
    }
    if (delCount > insCount) {
      // 删除多于插入：把红点锚在该块之后仍存在的第一行（或文件末尾上一行）
      const anchor = Math.min(blockNewStart + insCount, newLineCount - 1)
      if (anchor >= 0) {
        deletedAfter.set(anchor, (deletedAfter.get(anchor) ?? 0) + (delCount - insCount))
      }
    }
  }
  return { lineMarks, deletedAfter }
}

/**
 * 计算行级 Diff；两侧文本均需已在外部保证是「可比文本」
 * （基线来自 Git Index 或已保存文本，当前为编辑器内存文本）。
 */
export function computeGitLineDiff(
  baselineText: string,
  currentText: string
): GitLineDiffResult {
  if (
    baselineText.length > MAX_DIFF_BYTES ||
    currentText.length > MAX_DIFF_BYTES
  ) {
    return { lineMarks: [], deletedAfter: new Map(), truncated: true }
  }

  const oldLines = splitLines(baselineText)
  const newLines = splitLines(currentText)

  if (oldLines.length + newLines.length > MAX_DIFF_LINES * 2) {
    return { lineMarks: [], deletedAfter: new Map(), truncated: true }
  }
  if (
    oldLines.some(line => line.length > MAX_LINE_LENGTH) ||
    newLines.some(line => line.length > MAX_LINE_LENGTH)
  ) {
    return { lineMarks: [], deletedAfter: new Map(), truncated: true }
  }

  const ops = myersDiff(linesToHashes(oldLines), linesToHashes(newLines), MAX_DIFF_STEPS)
  if (!ops) {
    return { lineMarks: [], deletedAfter: new Map(), truncated: true }
  }
  const { lineMarks, deletedAfter } = buildResult(ops, newLines.length)
  return { lineMarks, deletedAfter, truncated: false }
}

/** 供 Web Worker 调用的序列化消息格式 */
export interface GitDiffWorkerRequest {
  seq: number
  baselineText: string
  currentText: string
}

export interface GitDiffWorkerResponse {
  seq: number
  lineMarks: Array<'added' | 'modified' | null>
  deletedAfter: Array<[number, number]>
  truncated: boolean
}

export function runWorkerSideDiff(request: GitDiffWorkerRequest): GitDiffWorkerResponse {
  const result = computeGitLineDiff(request.baselineText, request.currentText)
  return {
    seq: request.seq,
    lineMarks: result.lineMarks.map(mark => mark ?? null),
    deletedAfter: Array.from(result.deletedAfter.entries()),
    truncated: result.truncated
  }
}
