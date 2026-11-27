import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { OFFICE_PREVIEW_MAX_BYTES } from '../../../../shared/types/workbench'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { formatFileSize } from '../../utils/formatBytes'
import type { OfficeXlsxWorkerRequest, OfficeXlsxWorkerResponse, XlsxMergeRange } from '../../workers/officeXlsx.worker'
import { AppIcon } from '../icons/AppIcon'
import FileTypeIcon from './FileTypeIcon'
import WorkbenchDataTable from './WorkbenchDataTable'
import WorkbenchSendToAiButton from './WorkbenchSendToAiButton'
import {
  PreviewFallbackState,
  PreviewHeader,
  PreviewMetaPill
} from './WorkbenchPreviewChrome'

interface SheetData {
  rows: string[][]
  merges: XlsxMergeRange[]
  colCount: number
}

type LoadState = 'loading' | 'ready' | 'error'

/**
 * Worker 请求管理：seq 回显 + 回调表，terminate/onerror 时统一 reject 悬挂请求，
 * 避免 Promise 永远 pending 卡住加载态。
 */
class XlsxWorkerClient {
  private worker: Worker
  private seq = 0
  private callbacks = new Map<number, (response: OfficeXlsxWorkerResponse) => void>()

  constructor() {
    this.worker = new Worker(new URL('../../workers/officeXlsx.worker.ts', import.meta.url), {
      type: 'module'
    })
    this.worker.onmessage = (event: MessageEvent<OfficeXlsxWorkerResponse>) => {
      const callback = this.callbacks.get(event.data.seq)
      if (callback) {
        this.callbacks.delete(event.data.seq)
        callback(event.data)
      }
    }
    this.worker.onerror = () => {
      this.rejectAll(new Error('表格解析线程异常终止'))
    }
  }

  private rejectAll(error: Error): void {
    const callbacks = Array.from(this.callbacks.values())
    this.callbacks.clear()
    // 用异常响应而不是直接 reject：消费侧统一走 ok:false 分支
    for (const callback of callbacks) {
      callback({ seq: -1, type: 'parseSheet', ok: false, sheetIndex: -1, error: error.message })
    }
  }

  private post(message: OfficeXlsxWorkerRequest, transfer?: Transferable[]): Promise<OfficeXlsxWorkerResponse> {
    return new Promise((resolve) => {
      this.callbacks.set(message.seq, resolve)
      this.worker.postMessage(message, transfer ?? [])
    })
  }

  init(buffer: ArrayBuffer): Promise<OfficeXlsxWorkerResponse> {
    this.seq += 1
    return this.post({ seq: this.seq, type: 'init', buffer }, [buffer])
  }

  parseSheet(sheetIndex: number): Promise<OfficeXlsxWorkerResponse> {
    this.seq += 1
    return this.post({ seq: this.seq, type: 'parseSheet', sheetIndex })
  }

  terminate(): void {
    this.worker.terminate()
    this.rejectAll(new Error('表格解析线程已关闭'))
  }
}

export default function WorkbenchXlsxPreview(): JSX.Element {
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const activeFileSize = useWorkbenchStore((s) => s.activeFileSize)
  const activeFileOversized = useWorkbenchStore((s) => s.activeFileOversized)
  const openInSystem = useWorkbenchStore((s) => s.openInSystem)
  const revealFile = useWorkbenchStore((s) => s.revealFile)

  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [sheetNames, setSheetNames] = useState<string[]>([])
  const [activeSheet, setActiveSheet] = useState(0)
  const [sheetData, setSheetData] = useState<SheetData | null>(null)
  const [sheetError, setSheetError] = useState('')

  const clientRef = useRef<XlsxWorkerClient | null>(null)
  // workbook 代际：切文件/刷新后 parseSheet 响应按代际丢弃，防止旧 workbook 的数据落到新文件上
  const generationRef = useRef(0)

  const oversized =
    activeFileOversized || (typeof activeFileSize === 'number' && activeFileSize > OFFICE_PREVIEW_MAX_BYTES)

  const formattedSize = useMemo(() => formatFileSize(activeFileSize), [activeFileSize])

  const fileExt = useMemo(() => {
    if (!activeFilePath) return ''
    const idx = activeFilePath.lastIndexOf('.')
    return idx !== -1 ? activeFilePath.slice(idx).toLowerCase() : ''
  }, [activeFilePath])

  const fileNode = useMemo(
    () => ({
      id: activeFilePath || 'preview.xlsx',
      name: activeFilePath?.split(/[/\\]/).pop() || 'preview.xlsx',
      path: activeFilePath || 'preview.xlsx',
      fullPath: activeFilePath || 'preview.xlsx',
      isDirectory: false,
      extension: fileExt
    }),
    [activeFilePath, fileExt]
  )

  // 加载主链路：字节只在 effect 内流转不进全局 store；worker 随组件卸载/换文件 terminate。
  useEffect(() => {
    if (!workspacePath || !activeFilePath || oversized) return

    let cancelled = false
    const generation = generationRef.current + 1
    generationRef.current = generation
    setLoadState('loading')
    setLoadError('')
    setSheetNames([])
    setActiveSheet(0)
    setSheetData(null)
    setSheetError('')

    const client = new XlsxWorkerClient()
    clientRef.current = client

    const run = async (): Promise<void> => {
      try {
        const result = await window.api.workbench.readOfficeBytes(workspacePath, activeFilePath)
        if (cancelled) return
        if (!result.success || !result.data) {
          throw new Error(result.error || '读取表格文件失败')
        }
        // transferable 转移字节零拷贝进 worker；转移后本侧 buffer 已失效，不再引用。
        // 注意 IPC 过来的 Uint8Array 可能是共享池上的视图（byteOffset 非 0），
        // 直接传 .buffer 会把视图外的字节一起带进 worker，必须切出精确副本。
        const bytes = result.data.bytes
        const buffer =
          bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
            ? (bytes.buffer as ArrayBuffer)
            : (bytes.slice().buffer as ArrayBuffer)
        const initResponse = await client.init(buffer)
        if (cancelled) return
        if (initResponse.type !== 'init' || !initResponse.ok) {
          throw new Error(initResponse.type === 'init' && !initResponse.ok ? initResponse.error : '表格文件解析失败')
        }
        if (initResponse.sheetNames.length === 0) {
          throw new Error('表格内没有工作表')
        }
        setSheetNames(initResponse.sheetNames)
        setLoadState('ready')
      } catch (err) {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : String(err))
        setLoadState('error')
      }
    }
    void run()

    return () => {
      cancelled = true
      client.terminate()
      if (clientRef.current === client) clientRef.current = null
    }
  }, [workspacePath, activeFilePath, reloadKey, oversized])

  // sheet 惰性解析：只在切到某张表时跑 sheet_to_json；
  // 切走时丢弃 JSON（重新切回重新生成，workbook 常驻 worker 代价低）。
  useEffect(() => {
    if (loadState !== 'ready') return
    const client = clientRef.current
    if (!client) return

    let cancelled = false
    const generation = generationRef.current
    setSheetData(null)
    setSheetError('')

    const run = async (): Promise<void> => {
      const response = await client.parseSheet(activeSheet)
      if (cancelled || generation !== generationRef.current) return
      if (response.type === 'parseSheet' && response.ok) {
        setSheetData({ rows: response.rows, merges: response.merges, colCount: response.colCount })
      } else {
        setSheetError(response.type === 'parseSheet' && !response.ok ? response.error : '工作表解析失败')
      }
    }
    void run()

    return () => {
      cancelled = true
    }
  }, [loadState, activeSheet])

  const handleSwitchSheet = useCallback((index: number) => {
    setActiveSheet(index)
    // 选区属于上一张表的 DOM，WorkbenchDataTable 经 resetKey 联动清残留气泡
  }, [])

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden bg-slate-100 dark:bg-gray-900">
      <PreviewHeader
        left={
          <>
            <FileTypeIcon node={fileNode} className="w-[19px] h-[19px]" />
            <span className="font-medium text-text-primary truncate" title={activeFilePath || ''}>
              {activeFilePath}
            </span>
          </>
        }
        right={
          <>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors"
              title="刷新表格渲染"
            >
              <AppIcon name="refresh" size={19} />
            </button>
            <button
              type="button"
              onClick={() => {
                if (activeFilePath) void openInSystem(activeFilePath)
              }}
              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors"
              title="使用系统默认程序打开"
            >
              <AppIcon name="open_in_new" size={19} />
            </button>
            <button
              type="button"
              onClick={() => {
                if (activeFilePath) void revealFile(activeFilePath)
              }}
              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors"
              title="在系统资源管理器中定位"
            >
              <AppIcon name="folder_open" size={19} />
            </button>
          </>
        }
      />

      {sheetNames.length > 1 && (
        <div className="h-9 px-3 flex items-center gap-1 shrink-0 overflow-x-auto bg-white/60 dark:bg-gray-800/60 border-b border-black/5 dark:border-white/5 select-none">
          {sheetNames.map((name, index) => (
            <button
              key={`${index}:${name}`}
              type="button"
              onClick={() => handleSwitchSheet(index)}
              className={`px-2.5 py-1 rounded-md text-label whitespace-nowrap transition-colors ${
                index === activeSheet
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 w-full h-full relative overflow-hidden">
        {oversized ? (
          <PreviewFallbackState
            icon={
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-500 mb-4">
                <FileTypeIcon node={fileNode} className="w-[30px] h-[30px]" />
              </div>
            }
            title="表格超出内嵌预览上限"
            description={
              <>
                该文件大小为 <span className="font-semibold text-text-primary">{formattedSize}</span>，超过工作台
                10MB 的内嵌预览上限。可用系统默认应用打开查看与编辑。
              </>
            }
            actionLabel="在本地打开"
            onAction={() => {
              if (activeFilePath) void openInSystem(activeFilePath)
            }}
          />
        ) : loadState === 'error' ? (
          <PreviewFallbackState
            icon={<AppIcon name="error" size={24} className="text-rose-400 mb-2" />}
            title="未能渲染这份表格"
            description={loadError || '文件已损坏或格式不受支持，可用系统默认应用打开'}
            actionLabel="在本地打开"
            onAction={() => {
              if (activeFilePath) void openInSystem(activeFilePath)
            }}
          />
        ) : sheetError ? (
          <PreviewFallbackState
            icon={<AppIcon name="error" size={24} className="text-rose-400 mb-2" />}
            title="未能解析这张工作表"
            description={sheetError}
            actionLabel="在本地打开"
            onAction={() => {
              if (activeFilePath) void openInSystem(activeFilePath)
            }}
          />
        ) : sheetData ? (
          <WorkbenchDataTable
            rows={sheetData.rows}
            colCount={sheetData.colCount}
            merges={sheetData.merges}
            resetKey={activeSheet}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-text-secondary text-body">
            <AppIcon name="refresh" size={19} className="animate-spin mr-2" />
            正在解析工作表
          </div>
        )}

        {loadState === 'loading' && !oversized && (
          <div className="absolute inset-0 flex items-center justify-center text-text-secondary text-body bg-slate-100/80 dark:bg-gray-900/80">
            <AppIcon name="refresh" size={19} className="animate-spin mr-2" />
            正在解析表格
          </div>
        )}

        <div className="absolute bottom-3 right-3 z-dropdown flex items-center gap-2">
          <WorkbenchSendToAiButton />
          {formattedSize && (
            <PreviewMetaPill title={`大小 ${formattedSize}`}>
              <span className="whitespace-nowrap">{formattedSize}</span>
            </PreviewMetaPill>
          )}
        </div>
      </div>
    </div>
  )
}
