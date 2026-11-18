/**
 * 网页原生"下载"按钮 → Electron will-download 拦截 → 指定目录落盘 的共享框架。
 * 服务对象：
 *   - UI 批量下载（ipcHandlers.ts image:download-via-native:*，dir 来自用户选择的对话框）
 *   - Agent 任务生图落盘（AgentTaskService --gen-image，dir 固定 <data>/.multichat/image）
 *
 * 设计：维护 per-WebContents 的活动下载上下文（nativeCtxByWcId）。
 * 调用方先注册 ctx（填 dir/filePrefix/expectedFromClick），再注入页面点击脚本；
 * will-download 命中该 wcId 时 setSavePath 落盘并累计 savedPaths；
 * 全部到达（arrived >= expectedFromClick）或超时后 finalize 推进暂存区由 await 取回。
 */
import { session } from 'electron'
import { join } from 'path'
import { mkdir } from 'fs/promises'

export interface NativeDownloadResult {
  modelId: string
  saved: number
  failed: number
  errors: string[]
  savedPaths: string[]
}

interface NativeDownloadCtx {
  dir: string
  /** 文件名前缀（不含扩展名），seq 与扩展名由框架拼接 */
  filePrefix: string
  modelId: string
  seq: number
  saved: number
  failed: number
  errors: string[]
  savedPaths: string[]
  timer: NodeJS.Timeout
  expectedFromClick: number
  arrived: number
}

// 活动上下文：will-download 命中这里即拦截 + setSavePath
const nativeCtxByWcId = new Map<number, NativeDownloadCtx>()
// 已完成结果暂存：finalize 后移到这里，wait 来取。消除"will-download 早于 wait 完成"的时序竞态。
const nativeDoneByWcId = new Map<number, NativeDownloadResult>()

function buildResult(ctx: NativeDownloadCtx): NativeDownloadResult {
  return {
    modelId: ctx.modelId,
    saved: ctx.saved,
    failed: ctx.failed,
    errors: ctx.errors,
    savedPaths: ctx.savedPaths
  }
}

function finalizeIfDone(wcId: number): void {
  const ctx = nativeCtxByWcId.get(wcId)
  if (!ctx) return
  if (ctx.arrived >= ctx.expectedFromClick) {
    clearTimeout(ctx.timer)
    nativeDoneByWcId.set(wcId, buildResult(ctx))
    nativeCtxByWcId.delete(wcId)
  }
}

function finalizeForce(wcId: number): void {
  const ctx = nativeCtxByWcId.get(wcId)
  if (!ctx) return
  clearTimeout(ctx.timer)
  nativeDoneByWcId.set(wcId, buildResult(ctx))
  nativeCtxByWcId.delete(wcId)
}

let willDownloadRegistered = false

/** 幂等注册 persist:shared 的 will-download 拦截；App 启动或首个注册时调用一次。 */
export function ensureWillDownloadListener(): void {
  if (willDownloadRegistered) return
  willDownloadRegistered = true
  const shared = session.fromPartition('persist:shared')
  shared.on('will-download', (_event, item, webContents) => {
    const wcId = webContents?.id
    const ctx = wcId ? nativeCtxByWcId.get(wcId) : undefined
    if (!ctx) {
      console.log('[image-dl] will-download miss wcId=%s url=%s', wcId, (item.getURL() || '').slice(0, 120))
      return
    }

    // 不要 preventDefault —— Electron 语义里 preventDefault 会取消下载（done=interrupted/cancelled）。
    // 正确做法：直接 setSavePath 指定落盘路径，系统对话框就不会弹，下载也会继续走。
    const seq = ++ctx.seq

    const url = item.getURL() || ''
    const fn = item.getFilename() || ''
    const ext = /\.(png|jpe?g|webp|gif|bmp)$/i.test(fn) ? fn.match(/\.(png|jpe?g|webp|gif|bmp)$/i)![1].toLowerCase()
             : /\.(png|jpe?g|webp|gif|bmp)$/i.test(url) ? (url.match(/\.(png|jpe?g|webp|gif|bmp)$/i)![1].toLowerCase())
             : 'png'

    const fileName = `${ctx.filePrefix}-${seq}.${ext === 'jpg' ? 'jpg' : ext}`
    const filePath = join(ctx.dir, fileName)
    item.setSavePath(filePath)
    console.log('[image-dl] hit wcId=%s seq=%d url=%s file=%s', wcId, seq, (item.getURL() || '').slice(0, 120), fileName)

    item.on('done', (_e, state) => {
      ctx.arrived++
      if (state === 'completed') {
        ctx.saved++
        ctx.savedPaths.push(filePath)
      } else {
        ctx.failed++
        ctx.errors.push(`图 ${seq}: ${state}`)
      }
      console.log('[image-dl] done wcId=%s seq=%d state=%s', wcId, seq, state)
      finalizeIfDone(wcId!)
    })
  })
}

function registerContext(
  wcId: number,
  init: Omit<NativeDownloadCtx, 'seq' | 'saved' | 'failed' | 'errors' | 'savedPaths' | 'arrived' | 'timer'>,
  timeoutMs: number,
  onTimeout: (ctx: NativeDownloadCtx) => void
): void {
  ensureWillDownloadListener()
  const stale = nativeCtxByWcId.get(wcId)
  if (stale) {
    clearTimeout(stale.timer)
    nativeCtxByWcId.delete(wcId)
  }
  nativeDoneByWcId.delete(wcId)
  const timer = setTimeout(() => {
    const ctx = nativeCtxByWcId.get(wcId)
    if (!ctx) return
    onTimeout(ctx)
    finalizeForce(wcId)
  }, timeoutMs)
  nativeCtxByWcId.set(wcId, {
    ...init,
    seq: 0,
    saved: 0,
    failed: 0,
    errors: [],
    savedPaths: [],
    timer,
    arrived: 0
  })
}

/**
 * UI 批量下载：dir 由调用方（对话框结果）提供；文件名 {modelId}-{ts}-{seq}.{ext}。
 * `timeoutMs` 沿用 UI 侧 30s 上限。
 */
export function registerBatchDownload(
  wcId: number,
  opts: { modelId: string; dir: string; ts: string; expectedFromClick: number },
  timeoutMs = 30_000
): void {
  registerContext(
    wcId,
    {
      dir: opts.dir,
      filePrefix: `${opts.modelId}-${opts.ts}`,
      modelId: opts.modelId,
      expectedFromClick: opts.expectedFromClick
    },
    timeoutMs,
    (ctx) => {
      ctx.failed += Math.max(0, ctx.expectedFromClick - ctx.arrived)
      ctx.errors.push('超时未触发下载')
    }
  )
}

/**
 * Agent 任务下载：dir 由 AgentTaskService 指定（.multichat/image），
 * 文件名 {platform}-{taskId[:8]}-{seq}.{ext}；clicked=1 时 expectedFromClick=1（一次只落一张）。
 */
export async function registerAgentImageDownload(
  wcId: number,
  opts: { platform: string; taskId: string; dir: string; expectedFromClick: number; filePrefix?: string },
  timeoutMs = 30_000
): Promise<void> {
  await mkdir(opts.dir, { recursive: true })
  registerContext(
    wcId,
    {
      dir: opts.dir,
      filePrefix: opts.filePrefix ?? `${opts.platform}-${opts.taskId.slice(0, 8)}`,
      modelId: opts.platform || 'agent',
      expectedFromClick: opts.expectedFromClick
    },
    timeoutMs,
    (ctx) => {
      ctx.failed += Math.max(0, ctx.expectedFromClick - ctx.arrived)
      ctx.errors.push('超时未触发下载')
    }
  )
}

/** 等待该 wcId 的下载结果（done 暂存区命中即返回；ctx 消失兜底）。 */
export async function awaitImageDownloadResult(wcId: number): Promise<NativeDownloadResult> {
  const done = nativeDoneByWcId.get(wcId)
  if (done) {
    nativeDoneByWcId.delete(wcId)
    return done
  }
  return new Promise<NativeDownloadResult>((resolve) => {
    const check = (): void => {
      const d = nativeDoneByWcId.get(wcId)
      if (d) {
        nativeDoneByWcId.delete(wcId)
        resolve(d)
        return
      }
      const ctx = nativeCtxByWcId.get(wcId)
      if (!ctx) {
        resolve({ modelId: String(wcId), saved: 0, failed: 1, errors: ['上下文已失效'], savedPaths: [] })
        return
      }
      setTimeout(check, 200)
    }
    check()
  })
}
