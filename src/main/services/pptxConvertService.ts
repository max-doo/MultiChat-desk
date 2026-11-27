/**
 * PPTX 高保真转换服务：本机 Office（MS Office / WPS）COM 自动化把演示文稿
 * 转成 PDF，供渲染层用 WorkbenchPdfViewer 做像素级还原预览。
 *
 * 方案要点（docs/workbench/pptx-preview-fidelity-analysis.md 方案 B）：
 * - 降级链：COM（PowerPoint.Application → Kwpp.Application，脚本内自探测）
 *   → LibreOffice soffice --headless；都不可用则明确失败，渲染层回落内容预览。
 * - 缓存键 = sha1(绝对路径) + 文件指纹(size + mtime)，指纹变化自动产出新缓存，
 *   命中时零转换开销；过期缓存按 atime 懒清理。
 * - COM 是 attach 语义：脚本在创建 COM 对象前先探测 POWERPNT/wpp 进程，
 *   只在进程是自己拉起时才 Quit，避免关闭用户正在使用的 Office。
 * - 同一时刻只跑一个转换（Office COM 不适合并发），相同 key 的请求共享同一 promise。
 */

import { createHash } from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { app } from 'electron'
import path from 'path'
import { stat, mkdir, writeFile, open, readdir, utimes, unlink, rename } from 'fs/promises'
import { existsSync } from 'fs'
import { assertSafePath } from './workbenchService'

const execFileAsync = promisify(execFile)

/** 单次转换硬超时：29 页 6.6MB 实测 5s 内完成，大文件放宽到 120s */
const CONVERT_TIMEOUT_MS = 120_000
/** 缓存命中有效期兜底：指纹之外再按 atime 清 30 天前的死文件 */
const CACHE_STALE_MS = 30 * 24 * 3600 * 1000
/** PDF 分段读取单次上限与 readPdfRange 保持一致 */
const RANGE_MAX_BYTES = 4 * 1024 * 1024

export interface PptxConvertResult {
  pdfPath: string
  size: number
  converter: 'office-com' | 'libreoffice'
  cached: boolean
}

/** 排队链表尾：转换串行执行，避免并发拉起多个 Office 实例互相干扰 */
let queueTail: Promise<void> = Promise.resolve()
const inflightByKey = new Map<string, Promise<PptxConvertResult>>()

function cacheDir(): string {
  return path.join(app.getPath('userData'), 'pptx-pdf-cache')
}

function escapePsSingleQuoted(value: string): string {
  return value.replace(/'/g, "''")
}

/**
 * COM 转换脚本（UTF-8 BOM 落盘后由 powershell 5.1 执行）。
 * 自探测可用的演示应用 ProgID；转换前快照进程，只有自己拉起的进程才 Quit。
 * 源文件先复制到 temp 再打开：避免 Office 对原文档加锁，也避免 attach 到
 * 用户已打开的同名文档造成干扰。
 */
function buildComScript(srcCopy: string, pdfPath: string): string {
  const src = escapePsSingleQuoted(srcCopy)
  const pdf = escapePsSingleQuoted(pdfPath)
  return `$ErrorActionPreference = 'Stop'
$before = @{}
Get-Process POWERPNT,wpp -ErrorAction SilentlyContinue | ForEach-Object { $before[$_.Id] = $true }
$src = '${src}'
$pdf = '${pdf}'
$app = $null
$progid = $null
foreach ($candidate in @('PowerPoint.Application', 'Kwpp.Application')) {
  try {
    $app = New-Object -ComObject $candidate
    $progid = $candidate
    break
  } catch {}
}
if (-not $app) {
  Write-Output 'NO_COM_CONVERTER'
  exit 3
}
$preOwned = $false
Get-Process POWERPNT,wpp -ErrorAction SilentlyContinue | ForEach-Object { if ($before[$_.Id]) { $preOwned = $true } }
try {
  $pres = $app.Presentations.Open($src, -1, 0, 0)
  try {
    $pres.SaveAs($pdf, 32)
  } finally {
    $pres.Close()
  }
  Write-Output "CONVERTER=$progid"
} finally {
  if (-not $preOwned) {
    try { $app.Quit() } catch {}
  }
}
`
}

async function runComConvert(srcCopy: string, pdfPath: string, tempDir: string): Promise<'ok' | 'no-converter' | 'failed'> {
  const scriptPath = path.join(tempDir, 'convert.ps1')
  // UTF-8 BOM：powershell 5.1 无 BOM 时按 ANSI 读脚本，中文路径会乱码
  await writeFile(scriptPath, '\uFEFF' + buildComScript(srcCopy, pdfPath), 'utf-8')
  try {
    const { stdout } = await execFileAsync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath],
      { timeout: CONVERT_TIMEOUT_MS, windowsHide: true }
    )
    if (stdout.includes('NO_COM_CONVERTER')) return 'no-converter'
    return existsSync(pdfPath) ? 'ok' : 'failed'
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout ?? ''
    if (stdout.includes('NO_COM_CONVERTER')) return 'no-converter'
    console.warn('[PptxConvert] COM 转换失败:', error instanceof Error ? error.message : error)
    return 'failed'
  }
}

function sofficeCandidates(): string[] {
  if (process.platform === 'win32') {
    return [
      'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
      'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'
    ]
  }
  if (process.platform === 'darwin') {
    return ['/Applications/LibreOffice.app/Contents/MacOS/soffice']
  }
  return ['/usr/bin/soffice', '/usr/local/bin/soffice', '/snap/bin/libreoffice']
}

async function runSofficeConvert(srcCopy: string, pdfPath: string, tempDir: string): Promise<'ok' | 'no-converter' | 'failed'> {
  const binary = sofficeCandidates().find((candidate) => existsSync(candidate))
  if (!binary) return 'no-converter'
  try {
    await execFileAsync(
      binary,
      ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', tempDir, srcCopy],
      { timeout: CONVERT_TIMEOUT_MS, windowsHide: true }
    )
    // soffice 输出文件名与源同名不同后缀，统一到目标路径
    const produced = path.join(tempDir, `${path.basename(srcCopy, path.extname(srcCopy))}.pdf`)
    if (!existsSync(produced)) return 'failed'
    if (produced !== pdfPath) await rename(produced, pdfPath)
    return 'ok'
  } catch (error) {
    console.warn('[PptxConvert] LibreOffice 转换失败:', error instanceof Error ? error.message : error)
    return 'failed'
  }
}

/** 清理 30 天未触碰的缓存文件；启动式调用，失败静默 */
async function sweepStaleCache(dir: string): Promise<void> {
  try {
    const entries = await readdir(dir)
    const now = Date.now()
    for (const entry of entries) {
      if (!entry.endsWith('.pdf')) continue
      const full = path.join(dir, entry)
      try {
        const fileStat = await stat(full)
        if (now - fileStat.atimeMs > CACHE_STALE_MS) await unlink(full)
      } catch { /* 单文件失败不影响整体 */ }
    }
  } catch { /* 目录不存在等场景静默 */ }
}

async function readWholeFile(target: string): Promise<Buffer> {
  const handle = await open(target, 'r')
  try {
    const fileStat = await handle.stat()
    const buffer = Buffer.allocUnsafe(fileStat.size)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    return buffer.subarray(0, offset)
  } finally {
    await handle.close()
  }
}

async function doConvert(safePath: string, cacheKey: string, pdfPath: string): Promise<PptxConvertResult> {
  const dir = cacheDir()
  await mkdir(dir, { recursive: true })
  void sweepStaleCache(dir)

  // 指纹命中直接返回，零转换成本；atime 顺手刷新供 LRU 清理
  if (existsSync(pdfPath)) {
    const pdfStat = await stat(pdfPath)
    if (pdfStat.size > 0) {
      const now = new Date()
      await utimes(pdfPath, now, now).catch(() => undefined)
      return { pdfPath, size: pdfStat.size, converter: 'office-com', cached: true }
    }
  }

  const tempDir = path.join(dir, `job-${cacheKey}-${Date.now()}`)
  await mkdir(tempDir, { recursive: true })
  const srcCopy = path.join(tempDir, `source${path.extname(safePath)}`)
  await writeFile(srcCopy, await readWholeFile(safePath))

  let converter: PptxConvertResult['converter'] | null = null
  const tempPdf = path.join(tempDir, 'output.pdf')
  if (process.platform === 'win32') {
    const comResult = await runComConvert(srcCopy, tempPdf, tempDir)
    if (comResult === 'ok') converter = 'office-com'
    if (comResult !== 'ok') {
      const loResult = await runSofficeConvert(srcCopy, tempPdf, tempDir)
      if (loResult === 'ok') converter = 'libreoffice'
    }
  } else {
    const loResult = await runSofficeConvert(srcCopy, tempPdf, tempDir)
    if (loResult === 'ok') converter = 'libreoffice'
  }

  if (!converter) {
    throw new Error('本机未检测到可用的 Office / WPS / LibreOffice，无法生成高保真预览')
  }
  await rename(tempPdf, pdfPath)
  const pdfStat = await stat(pdfPath)
  return { pdfPath, size: pdfStat.size, converter, cached: false }
}

/**
 * 转换入口：指纹缓存命中直接返回；未命中排队串行转换。
 * 同 key 并发请求共享同一 promise，切换文件重复点击不会放大转换次数。
 */
export async function convertPptx(workspaceRoot: string, relativePath: string): Promise<PptxConvertResult> {
  const safePath = await assertSafePath(workspaceRoot, relativePath)
  const ext = path.extname(safePath).toLowerCase()
  if (!['.pptx', '.pptm', '.ppsx'].includes(ext)) {
    throw new Error('仅支持转换 .pptx/.pptm/.ppsx 演示文稿')
  }
  const fileStat = await stat(safePath)
  if (fileStat.isDirectory()) throw new Error('目标是目录，无法作为文件读取')
  if (fileStat.size === 0) throw new Error('文件为空')

  const fingerprint = `${fileStat.size}-${Math.round(fileStat.mtimeMs)}`
  const key = createHash('sha1').update(safePath).digest('hex').slice(0, 16)
  const cacheKey = `${key}-${fingerprint}`
  const pdfPath = path.join(cacheDir(), `${cacheKey}.pdf`)

  const inflight = inflightByKey.get(cacheKey)
  if (inflight) return inflight

  const promise = new Promise<PptxConvertResult>((resolvePromise, rejectPromise) => {
    queueTail = queueTail.then(async () => {
      try {
        resolvePromise(await doConvert(safePath, cacheKey, pdfPath))
      } catch (error) {
        rejectPromise(error)
      } finally {
        inflightByKey.delete(cacheKey)
      }
    })
  })
  inflightByKey.set(cacheKey, promise)
  return promise
}

/**
 * 读取转换产物 PDF 的一段字节，供渲染层 PDF.js range transport 使用。
 * 路径必须落在缓存目录内且为 .pdf，防止借道读取任意文件。
 */
export async function readConvertedPdfRange(
  pdfPath: string,
  start: number,
  end: number
): Promise<{ bytes: Uint8Array; size: number; mtime: number }> {
  const resolved = path.resolve(pdfPath)
  const dir = path.resolve(cacheDir())
  if (!resolved.startsWith(dir + path.sep) || path.extname(resolved).toLowerCase() !== '.pdf') {
    throw new Error('非法的缓存文件路径')
  }
  const fileStat = await stat(resolved)
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
    throw new Error('PDF 读取范围无效')
  }
  const from = Math.max(0, start)
  const to = Math.min(fileStat.size - 1, end)
  if (from > to) throw new Error('PDF 读取范围无效')
  if (to - from + 1 > RANGE_MAX_BYTES) throw new Error('PDF 单次读取范围超过 4MB')

  const handle = await open(resolved, 'r')
  try {
    const buffer = Buffer.allocUnsafe(to - from + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, from + offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    return {
      bytes: new Uint8Array(buffer.buffer, buffer.byteOffset, offset),
      size: fileStat.size,
      mtime: fileStat.mtimeMs
    }
  } finally {
    await handle.close()
  }
}
