import { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import { useAppStore } from '../../store/appStore'
import { useWorkbenchStore } from '../../store/workbenchStore'
import WebviewCard, { type WebviewCardRef } from '../WebviewCard'
import { assistantReplyConfigs } from '../../../../shared/config/selectors'
import {
  generateInsertReplyButtonScript,
  type FileUploadData
} from '../../../../shared/utils/webviewScripts'
import { defaultSelectors } from '../../../../shared/config/selectors'
import { AppIcon } from '../icons/AppIcon'
import { extractLocalPath, collectLocalPaths } from './WorkbenchFileTree'
import {
  WORKBENCH_SEND_FILE_EVENT,
  WORKBENCH_UPLOAD_NODES_EVENT,
  type WorkbenchSendFileDetail,
  type WorkbenchUploadNodesDetail
} from './workbenchAiEvents'
import { getFileCategory, type WorkbenchFileNode } from '../../../../shared/types/workbench'

const INSERT_PREFIX = '__MC_INSERT_CURRENT__'
const SAVE_PREFIX = '__MC_SAVE_NEW__'

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson',
  '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.7z': 'application/x-7z-compressed',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.py': 'text/x-python',
  '.java': 'text/x-java-source',
  '.c': 'text/x-c',
  '.cpp': 'text/x-c++',
  '.html': 'text/html',
  '.css': 'text/css',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.xml': 'application/xml',
  '.sh': 'application/x-sh',
  '.bash': 'application/x-sh',
  '.sql': 'application/sql',
  '.rs': 'text/x-rust',
  '.go': 'text/x-go',
  '.toml': 'application/toml',
  '.ini': 'text/plain',
  '.env': 'text/plain',
  '.log': 'text/plain',
  '.ps1': 'text/plain'
}

function getMimeType(fileNameOrExt: string): string {
  const lastDot = fileNameOrExt.lastIndexOf('.')
  const ext = (lastDot !== -1 ? fileNameOrExt.slice(lastDot) : fileNameOrExt).toLowerCase()
  const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`
  if (MIME_BY_EXT[normalizedExt]) {
    return MIME_BY_EXT[normalizedExt]
  }
  const category = getFileCategory(fileNameOrExt)
  if (category === 'code' || category === 'text' || category === 'markdown') {
    return 'text/plain'
  }
  return 'application/octet-stream'
}

function resolveAbsoluteFilePath(filePath: string, workspacePath?: string | null): string {
  if (!filePath) return ''
  const isAbs = /^[a-zA-Z]:[/\\]/.test(filePath) || filePath.startsWith('/') || filePath.startsWith('\\\\')
  if (isAbs) return filePath
  if (workspacePath) {
    const cleanRoot = workspacePath.replace(/[/\\]+$/, '')
    const cleanRel = filePath.replace(/^[/\\]+/, '')
    const sep = cleanRoot.includes('\\') ? '\\' : '/'
    return `${cleanRoot}${sep}${cleanRel.replace(/\//g, sep)}`
  }
  return filePath
}

/** 等侧边栏完成一帧布局后再操作 Webview，避免折叠态下 guest 仍为 0 尺寸。 */
function runAfterPanePaint(fn: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(fn))
}

type UploadNode = Pick<WorkbenchFileNode, 'path' | 'name' | 'isDirectory' | 'size' | 'extension'> & {
  fullPath?: string
}

function mapNodesToUploads(nodes: UploadNode[]): {
  files: FileUploadData[]
  skippedFolders: string[]
} {
  const workspacePath = useWorkbenchStore.getState().workspacePath
  const skippedFolders = nodes.filter((node) => node.isDirectory).map((node) => node.name)
  const files = nodes
    .filter((node) => !node.isDirectory && Boolean(node.fullPath || node.path))
    .map((node) => ({
      filePath: resolveAbsoluteFilePath(node.fullPath || node.path, workspacePath),
      fileName: node.name,
      mimeType: getMimeType(node.extension || node.name),
      size: node.size || 0
    }))
  return { files, skippedFolders }
}

const TOAST_MESSAGE_MAX_CHARS = 64
/** 上传锁超过该时长仍未释放，视为已僵死，允许新一批上传接管。 */
const UPLOAD_LOCK_STALE_MS = 3 * 60_000

/** 提示条只展示结论，超长错误详情放进控制台，避免撑满侧边栏。 */
function truncateToastMessage(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim()
  return normalized.length > TOAST_MESSAGE_MAX_CHARS
    ? `${normalized.slice(0, TOAST_MESSAGE_MAX_CHARS - 1)}…`
    : normalized
}

interface ReplyPayload {
  platformId: string
  replyMd: string
  replyHash: string
  conversationUrl: string
  title: string
}

/** 给一个 workbench 侧边栏 webview 注入按钮脚本 + 挂载 console-message 监听。 */
function attachWorkbenchReplyButtons(
  webview: Electron.WebviewTag,
  modelId: string,
  onInsert: (p: ReplyPayload) => void,
  onSave: (p: ReplyPayload) => void
): () => void {
  const cfg = assistantReplyConfigs[modelId] || {}
  const inject = (): void => {
    try {
      const modelSel = defaultSelectors.models[modelId]
      void webview.executeJavaScript(
        generateInsertReplyButtonScript(
          modelId,
          cfg,
          modelSel || ({ messageContainer: [] } as never)
        )
      ).catch(() => undefined)
    } catch { /* webview 可能已导航 */ }
  }
  const onConsole = (e: Electron.ConsoleMessageEvent): void => {
    const msg = e.message || ''
    const isInsert = msg.startsWith(INSERT_PREFIX)
    const isSave = msg.startsWith(SAVE_PREFIX)
    if (!isInsert && !isSave) return
    try {
      const payload = JSON.parse(msg.slice(isInsert ? INSERT_PREFIX.length : SAVE_PREFIX.length)) as ReplyPayload
      if (isInsert) onInsert(payload)
      else onSave(payload)
    } catch { /* 解析失败忽略 */ }
  }
  webview.addEventListener('dom-ready', inject)
  webview.addEventListener('did-navigate-in-page', inject)
  webview.addEventListener('console-message', onConsole)
  inject()
  return () => {
    webview.removeEventListener('dom-ready', inject)
    webview.removeEventListener('did-navigate-in-page', inject)
    webview.removeEventListener('console-message', onConsole)
  }
}

export default function WorkbenchAiSidebar(): JSX.Element | null {
  const models = useAppStore((s) => s.models)
  const sidebarModelId = useWorkbenchStore((s) => s.sidebarModelId)
  const setSidebarModelId = useWorkbenchStore((s) => s.setSidebarModelId)
  const rightPane = useWorkbenchStore((s) => s.rightPane)
  const openRightPane = useWorkbenchStore((s) => s.openRightPane)
  const closeRightPane = useWorkbenchStore((s) => s.closeRightPane)
  const draggingNodes = useWorkbenchStore((s) => s.draggingNodes)
  const setDraggingNodes = useWorkbenchStore((s) => s.setDraggingNodes)
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const isDirty = useWorkbenchStore((s) => s.isDirty)
  const saveActiveFile = useWorkbenchStore((s) => s.saveActiveFile)

  // 侧边栏为隔离场景（isolated），切换目标与下拉选项一致使用全量模型；
  // 若按主界面阵容的 enabled 过滤，选中未启用模型时无法挂载对应 webview，导致"切换不了"
  const availableModels = models
  const currentModel = useMemo(() => {
    return (
      availableModels.find((m) => m.id === sidebarModelId) ||
      availableModels[0] ||
      models[0]
    )
  }, [models, sidebarModelId])

  // 已挂载的模型集合，保证切换平台不丢失已有页面状态
  const [mountedSidebarModels, setMountedSidebarModels] = useState<Set<string>>(() => {
    return new Set(currentModel ? [currentModel.id] : [])
  })

  // 保证 currentModel 始终加入 mountedSidebarModels，避免 store 异步更新导致遗漏
  useEffect(() => {
    if (currentModel?.id) {
      setMountedSidebarModels((prev) => {
        if (prev.has(currentModel.id)) return prev
        const next = new Set(prev)
        next.add(currentModel.id)
        return next
      })
    }
  }, [currentModel?.id])

  const sidebarRefs = useRef<Map<string, WebviewCardRef>>(new Map())
  // 待定位的会话；卡片可能尚未挂载/仍在加载，交给下方轮询落实导航。
  const [conversationTarget, setConversationTarget] = useState<{
    platformId: string
    url: string
  } | null>(null)
  const insertReplyIntoActiveMarkdown = useWorkbenchStore((s) => s.insertReplyIntoActiveMarkdown)
  const saveReplyAsNewMarkdown = useWorkbenchStore((s) => s.saveReplyAsNewMarkdown)
  const pendingConversationOpen = useWorkbenchStore((s) => s.pendingConversationOpen)
  const consumeConversationOpen = useWorkbenchStore((s) => s.consumeConversationOpen)

  // 防双击：同一条回复在短时间窗内只插入一次（撤回/采纳后重试已超过窗口，允许）
  const lastInsertRef = useRef<Map<string, { hash: string; at: number }>>(new Map())

  // 拖拽与上传状态
  const [isExternalFileDragging, setIsExternalFileDragging] = useState(false)
  const [toast, setToast] = useState<{
    type: 'info' | 'success' | 'error'
    message: string
  } | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const uploadingRef = useRef<{ id: number; startedAt: number } | null>(null)
  const uploadGenerationRef = useRef(0)
  const [isUploading, setIsUploading] = useState(false)

  const showToast = useCallback(
    (type: 'info' | 'success' | 'error', message: string, autoHideMs = 4000) => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current)
        toastTimerRef.current = null
      }
      setToast({ type, message: truncateToastMessage(message) })
      if (autoHideMs > 0) {
        toastTimerRef.current = setTimeout(() => {
          setToast(null)
          toastTimerRef.current = null
        }, autoHideMs)
      }
    },
    []
  )

  // 全局 dragend/drop/dragleave/keydown 监听：防止拖拽取消或在外部释放时拖拽状态残留
  useEffect(() => {
    const handleDragEndOrDrop = (event?: DragEvent) => {
      if (event?.dataTransfer?.types.includes('Files')) {
        event.preventDefault()
      }
      setIsExternalFileDragging(false)
      if (useWorkbenchStore.getState().draggingNodes) {
        useWorkbenchStore.getState().setDraggingNodes(null)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleDragEndOrDrop()
      }
    }
    const handleWindowDragLeave = (e: DragEvent) => {
      if (
        e.clientX <= 0 ||
        e.clientY <= 0 ||
        e.clientX >= window.innerWidth ||
        e.clientY >= window.innerHeight
      ) {
        handleDragEndOrDrop()
      }
    }
    // 捕获阶段只清外部文件状态：树节点/编辑器的 drop 会 stopPropagation，
    // 冒泡监听收不到事件时会留下透明遮罩挡住 AI Webview。
    const handleExternalDrop = () => {
      // 等本轮 drop 的 React 处理完成后再卸载感应层，避免在事件派发中途改 DOM。
      window.setTimeout(() => setIsExternalFileDragging(false), 0)
    }
    const handleWindowDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) {
        event.preventDefault()
      }
    }
    const handlePointerDown = () => {
      setIsExternalFileDragging(false)
      if (useWorkbenchStore.getState().draggingNodes) {
        useWorkbenchStore.getState().setDraggingNodes(null)
      }
    }

    window.addEventListener('dragend', handleDragEndOrDrop)
    window.addEventListener('drop', handleDragEndOrDrop)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('dragleave', handleWindowDragLeave)
    window.addEventListener('dragover', handleWindowDragOver)
    document.addEventListener('drop', handleExternalDrop, true)
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      window.removeEventListener('dragend', handleDragEndOrDrop)
      window.removeEventListener('drop', handleDragEndOrDrop)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('dragleave', handleWindowDragLeave)
      window.removeEventListener('dragover', handleWindowDragOver)
      document.removeEventListener('drop', handleExternalDrop, true)
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [])

  const handleInsertReply = useCallback(
    async (p: ReplyPayload): Promise<void> => {
      if (!p?.replyMd) return
      const last = lastInsertRef.current.get(p.platformId)
      if (last && last.hash === p.replyHash && Date.now() - last.at < 1500) return // 双击防抖
      lastInsertRef.current.set(p.platformId, { hash: p.replyHash, at: Date.now() })
      if (rightPane !== 'ai') openRightPane('ai')
      await insertReplyIntoActiveMarkdown(p.replyMd, {
        conversationUrl: p.conversationUrl
      })
    },
    [insertReplyIntoActiveMarkdown, rightPane, openRightPane]
  )

  const handleSaveReply = useCallback(
    async (p: ReplyPayload): Promise<void> => {
      if (!p?.replyMd) return
      if (rightPane !== 'ai') openRightPane('ai')
      await saveReplyAsNewMarkdown(p.replyMd, {
        platformId: p.platformId,
        title: p.title,
        conversationUrl: p.conversationUrl
      })
    },
    [saveReplyAsNewMarkdown, rightPane, openRightPane]
  )

  // 为每个已挂载的侧边栏 webview 注入按钮脚本 + 挂 console-message 监听
  useEffect(() => {
    const cleanups: Array<() => void> = []
    mountedSidebarModels.forEach((modelId) => {
      const ref = sidebarRefs.current.get(modelId)
      const webview = ref?.getWebview?.()
      if (webview) {
        cleanups.push(
          attachWorkbenchReplyButtons(
            webview,
            modelId,
            (p) => void handleInsertReply(p),
            (p) => void handleSaveReply(p)
          )
        )
      }
    })
    return () => cleanups.forEach((fn) => fn())
  }, [mountedSidebarModels, handleInsertReply, handleSaveReply])

  // 切换平台
  const handleModelChange = useCallback(
    (modelId: string) => {
      setSidebarModelId(modelId)
      setMountedSidebarModels((prev) => new Set(prev).add(modelId))
    },
    [setSidebarModelId]
  )

  // 笔记属性里的来源会话：切到对应平台并直接加载该会话地址
  useEffect(() => {
    if (!pendingConversationOpen) return
    const { platformId, url, token } = pendingConversationOpen
    consumeConversationOpen(token)
    if (!availableModels.some((model) => model.id === platformId)) return
    setSidebarModelId(platformId)
    setMountedSidebarModels((prev) => new Set(prev).add(platformId))
    setConversationTarget({ platformId, url })
  }, [pendingConversationOpen, availableModels, consumeConversationOpen, setSidebarModelId])

  // 等卡片挂载完成后加载目标会话：侧边栏可能已停在该平台但开着别的会话，
  // 仅改 url prop 不会触发导航，这里显式比对并 loadURL。
  useEffect(() => {
    if (!conversationTarget) return
    let cancelled = false
    const { platformId, url } = conversationTarget
    const normalize = (raw: string): string => {
      try {
        const parsed = new URL(raw)
        return parsed.origin + parsed.pathname
      } catch {
        return raw
      }
    }
    void (async () => {
      for (let attempt = 0; attempt < 40; attempt++) {
        if (cancelled) return
        const ref = sidebarRefs.current.get(platformId)
        if (ref) {
          // 休眠态下页面停在 about:blank，直接 loadURL 会被休眠遮罩挡住，先唤醒再导航。
          if (ref.isHibernated()) await ref.resume()
          if (cancelled) return
          let current = ''
          try {
            current = ref.getCurrentUrl()
          } catch {
            current = ''
          }
          if (current) {
            if (normalize(current) !== normalize(url)) ref.loadURL(url)
            setConversationTarget(null)
            return
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      if (!cancelled) setConversationTarget(null)
    })()
    return () => {
      cancelled = true
    }
  }, [conversationTarget])

  // 监听来自划词动作的文本注入事件
  useEffect(() => {
    const handleInsertPrompt = (e: Event) => {
      const customEvent = e as CustomEvent<{ prompt: string }>
      const prompt = customEvent.detail?.prompt
      if (!prompt) return

      // 若侧边栏当前处于折叠状态，则自动展开
      if (rightPane !== 'ai') openRightPane('ai')

      if (currentModel) {
        const ref = sidebarRefs.current.get(currentModel.id)
        if (ref) {
          void ref.insertText(prompt)
        }
      }
    }

    window.addEventListener('workbench:insert-prompt', handleInsertPrompt)
    return () => {
      window.removeEventListener('workbench:insert-prompt', handleInsertPrompt)
    }
  }, [currentModel, rightPane, openRightPane])

  // 处理文件拖入释放并上传到当前 AI 对话框
  const uploadFilesToCurrentModel = useCallback(
    async (filesToUpload: FileUploadData[], skippedFolders: string[] = []): Promise<void> => {
      if (filesToUpload.length === 0) return
      const activeLock = uploadingRef.current
      if (activeLock && Date.now() - activeLock.startedAt < UPLOAD_LOCK_STALE_MS) {
        showToast('info', '正在上传上一批文件，请稍候')
        return
      }
      if (activeLock) {
        console.warn('[workbench-upload] 上传锁超时未释放，已自动接管', {
          ageMs: Date.now() - activeLock.startedAt
        })
      }
      const uploadId = uploadGenerationRef.current + 1
      uploadGenerationRef.current = uploadId
      uploadingRef.current = { id: uploadId, startedAt: Date.now() }
      setIsUploading(true)
      const isCurrentUpload = (): boolean => uploadGenerationRef.current === uploadId

      try {
        // 当前文档有未保存修改时，先确认落盘成功，确保 AI 收到完整的最新文件
        const normActive = activeFilePath ? activeFilePath.replace(/\\/g, '/').toLowerCase() : ''
        const activeName = normActive.split('/').pop()
        const includesActiveFile =
          isDirty &&
          Boolean(normActive) &&
          filesToUpload.some((f) => {
            const normFile = f.filePath.replace(/\\/g, '/').toLowerCase()
            return normFile.endsWith(normActive) || (activeName !== undefined && f.fileName.toLowerCase() === activeName)
          })
        if (includesActiveFile) {
          const saved = await saveActiveFile()
          if (!isCurrentUpload()) return
          if (!saved.saved) {
            showToast('error', '当前文件保存失败，未发送到 AI')
            return
          }
        }

        if (!currentModel) {
          showToast('error', '未选择 AI 模型')
          return
        }

        const activeRef = sidebarRefs.current.get(currentModel.id)
        if (!activeRef) {
          showToast('error', `未找到 ${currentModel.name} 的 Webview 实例，请等待页面加载完成`)
          return
        }

        let successCount = 0
        let failCount = 0
        const errors: string[] = []
        const skippedNote = skippedFolders.length > 0 ? `；已跳过 ${skippedFolders.length} 个文件夹` : ''

        for (let i = 0; i < filesToUpload.length; i++) {
          if (!isCurrentUpload()) return
          const file = filesToUpload[i]
          showToast(
            'info',
            `正在上传 (${i + 1}/${filesToUpload.length})`,
            0
          )

          let res = await activeRef.uploadFile(file)
          if (!isCurrentUpload()) return

          // 若遇到 Webview 刚挂载尚未就绪，短暂重试等待 dom-ready（最多重试 3 次，间隔 600ms）
          if (!res.success && res.error?.includes('未就绪')) {
            for (let retry = 0; retry < 3; retry++) {
              await new Promise((r) => setTimeout(r, 600))
              if (!isCurrentUpload()) return
              res = await activeRef.uploadFile(file)
              if (!isCurrentUpload()) return
              if (res.success) break
            }
          }

          if (res.success) {
            successCount++
          } else {
            failCount++
            errors.push(`${file.fileName}: ${res.error || '上传失败'}`)
          }

          if (i < filesToUpload.length - 1) {
            await new Promise((r) => setTimeout(r, 150))
          }
        }

        if (!isCurrentUpload()) return
        if (failCount === 0) {
          showToast(
            'success',
            filesToUpload.length === 1
              ? `上传完成${skippedNote}`
              : `上传完成 (${successCount}/${filesToUpload.length})${skippedNote}`
          )
        } else if (successCount === 0) {
          console.warn('[workbench-upload] 全部上传失败', errors)
          showToast(
            'error',
            (filesToUpload.length === 1
              ? `上传失败：${filesToUpload[0].fileName}`
              : `上传失败 (${failCount} 个文件)`) + skippedNote
          )
        } else {
          console.warn('[workbench-upload] 部分上传失败', errors)
          showToast(
            'info',
            `已上传 ${successCount}/${filesToUpload.length}，${failCount} 个失败${skippedNote}`
          )
        }
      } catch (err) {
        console.error('[workbench-upload] 上传发生异常', err)
        if (isCurrentUpload()) showToast('error', '上传发生异常，请重试')
      } finally {
        if (uploadingRef.current?.id === uploadId) {
          uploadingRef.current = null
          setIsUploading(false)
        }
      }
    },
    [activeFilePath, currentModel, isDirty, saveActiveFile, showToast]
  )

  /** 只停止当前批次的等待，不强行中断已派发的拖拽。 */
  const stopWaitingForUpload = useCallback(() => {
    uploadGenerationRef.current += 1
    uploadingRef.current = null
    setIsUploading(false)
    setToast(null)
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current)
      toastTimerRef.current = null
    }
    showToast('info', '已停止等待上传，可以重新拖入文件')
  }, [showToast])

  // 工具栏「发送到 AI」：直接上传当前完整文件，不再展开操作菜单
  useEffect(() => {
    const handleSendFile = (event: Event) => {
      const detail = (event as CustomEvent<WorkbenchSendFileDetail>).detail
      if (!detail?.filePath || !detail.fileName) return
      if (useWorkbenchStore.getState().rightPane !== 'ai') openRightPane('ai')
      runAfterPanePaint(() => {
        void uploadFilesToCurrentModel([
          {
            filePath: resolveAbsoluteFilePath(
              detail.filePath,
              useWorkbenchStore.getState().workspacePath
            ),
            fileName: detail.fileName,
            mimeType: getMimeType(detail.fileName),
            size: detail.size ?? 0
          }
        ])
      })
    }

    window.addEventListener(WORKBENCH_SEND_FILE_EVENT, handleSendFile)
    return () => window.removeEventListener(WORKBENCH_SEND_FILE_EVENT, handleSendFile)
  }, [openRightPane, uploadFilesToCurrentModel])

  // 处理文件拖入释放并上传到当前 AI 对话框
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsExternalFileDragging(false)
      const activeLock = uploadingRef.current
      if (activeLock && Date.now() - activeLock.startedAt < UPLOAD_LOCK_STALE_MS) {
        showToast('info', '正在上传上一批文件，请稍候')
        return
      }

      let filesToUpload: FileUploadData[] = []
      let skippedFolders: string[] = []
      const workspacePath = useWorkbenchStore.getState().workspacePath
      const dragTypes = e.dataTransfer ? Array.from(e.dataTransfer.types) : []
      const hasExternalFiles = dragTypes.includes('Files')
      const hasWorkspacePayload = dragTypes.includes('application/x-multichat-workspace-files')

      // 外部文件拖拽优先，避免上一次拖拽残留的 draggingNodes 劫持本次上传。
      const currentDragging = hasExternalFiles && !hasWorkspacePayload
        ? null
        : useWorkbenchStore.getState().draggingNodes
      if (currentDragging && currentDragging.length > 0) {
        const mapped = mapNodesToUploads(currentDragging)
        if (mapped.files.length === 0) {
          showToast('info', '暂不支持上传文件夹，请拖拽文件')
          setDraggingNodes(null)
          return
        }
        filesToUpload = mapped.files
        skippedFolders = mapped.skippedFolders
      } else if (e.dataTransfer) {
        const customData = e.dataTransfer.getData('application/x-multichat-workspace-files')
        if (customData) {
          try {
            const parsed = JSON.parse(customData) as Array<{
              path: string
              fullPath: string
              name: string
              isDirectory: boolean
              size?: number
              extension?: string
            }>
            const mapped = mapNodesToUploads(parsed)
            if (mapped.files.length === 0) {
              showToast('info', '暂不支持上传文件夹，请拖拽文件')
              return
            }
            filesToUpload = mapped.files
            skippedFolders = mapped.skippedFolders
          } catch {
            // ignore
          }
        }

        if (filesToUpload.length === 0 && e.dataTransfer.files?.length > 0) {
          const localPaths = collectLocalPaths(e.dataTransfer.files)
          if (localPaths.length > 0) {
            filesToUpload = Array.from(e.dataTransfer.files)
              .map((f) => ({
                filePath: extractLocalPath(f),
                fileName: f.name,
                mimeType: f.type || getMimeType(f.name),
                size: f.size || 0
              }))
              .filter((f) => Boolean(f.filePath))
          }
        }

        // text/plain 回退支持（单路径或多行路径拖拽）
        if (filesToUpload.length === 0) {
          const textPlain = e.dataTransfer.getData('text/plain')
          if (textPlain) {
            const lines = textPlain.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
            const resolvedList: FileUploadData[] = []
            for (const line of lines) {
              const absPath = resolveAbsoluteFilePath(line, workspacePath)
              const baseName = absPath.split(/[/\\]/).pop() || ''
              if (baseName && (absPath.includes('/') || absPath.includes('\\'))) {
                resolvedList.push({
                  filePath: absPath,
                  fileName: baseName,
                  mimeType: getMimeType(baseName),
                  size: 0
                })
              }
            }
            if (resolvedList.length > 0) {
              filesToUpload = resolvedList
            }
          }
        }
      }

      setDraggingNodes(null)
      if (filesToUpload.length === 0) {
        showToast('info', '未识别到可上传的文件')
        return
      }
      await uploadFilesToCurrentModel(filesToUpload, skippedFolders)
    },
    [setDraggingNodes, showToast, uploadFilesToCurrentModel]
  )

  // AI 侧边栏折叠或切到导图时，右侧条带把拖拽节点转交给这里；
  // 侧边栏始终挂载，所以展开与上传可以在一次拖拽内完成。
  useEffect(() => {
    const handleUploadNodes = (event: Event) => {
      const detail = (event as CustomEvent<WorkbenchUploadNodesDetail>).detail
      if (!detail?.nodes?.length) return
      if (useWorkbenchStore.getState().rightPane !== 'ai') openRightPane('ai')
      const mapped = mapNodesToUploads(detail.nodes)
      setDraggingNodes(null)
      if (mapped.files.length === 0) {
        showToast('info', '暂不支持上传文件夹，请拖拽文件')
        return
      }
      runAfterPanePaint(() => {
        void uploadFilesToCurrentModel(mapped.files, mapped.skippedFolders)
      })
    }

    window.addEventListener(WORKBENCH_UPLOAD_NODES_EVENT, handleUploadNodes)
    return () => {
      window.removeEventListener(WORKBENCH_UPLOAD_NODES_EVENT, handleUploadNodes)
    }
  }, [openRightPane, setDraggingNodes, showToast, uploadFilesToCurrentModel])

  const isDraggingActive = Boolean(draggingNodes && draggingNodes.length > 0) || isExternalFileDragging

  return (
    <div
      onDragEnter={(e) => {
        if (!draggingNodes && e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
          e.preventDefault()
          setIsExternalFileDragging(true)
        }
      }}
      className="flex flex-col h-full bg-white dark:bg-gray-900 border-l border-black/5 dark:border-white/5 overflow-hidden relative"
    >
      {/* 浮动上传状态提示 */}
      {toast && (
        <div
          data-upload-toast
          className={`absolute top-28 left-1/2 -translate-x-1/2 max-w-[calc(100%-1.5rem)] px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 shadow-float z-50 notification-popup backdrop-blur-md transition-all ${
            toast.type === 'success'
              ? 'bg-white/90 border border-green-200 text-green-700'
              : toast.type === 'error'
              ? 'bg-white/90 border border-red-200 text-red-700'
              : 'bg-white/90 border border-blue-200 text-blue-700'
          }`}
        >
          <AppIcon
            name={toast.type === 'success' ? 'check_circle' : toast.type === 'error' ? 'error' : 'info'}
            size={16}
            className={`text-base flex-shrink-0 ${
              toast.type === 'success'
                ? 'text-green-500'
                : toast.type === 'error'
                ? 'text-red-500'
                : 'text-blue-500'
            }`}
          />
          <span className="min-w-0 break-words text-center leading-relaxed line-clamp-2">{toast.message}</span>
          {isUploading && (
            <button
              type="button"
              onClick={stopWaitingForUpload}
              className="shrink-0 px-2 py-1 rounded-md text-xs font-medium text-blue-700 bg-blue-500/10 hover:bg-blue-500/20 transition-colors"
            >
              停止等待
            </button>
          )}
        </div>
      )}

      <div className="flex-1 relative overflow-hidden bg-white dark:bg-gray-900">
        {/* 拖拽感应层：覆盖于 webview 上层，防止 guest webview 吞噬 host 拖拽事件（完全透明，无遮罩与提示，自然无感交互） */}
        {isDraggingActive && (
          <div
            onDragEnter={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onDragOver={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (e.dataTransfer) {
                try {
                  e.dataTransfer.dropEffect = 'copy'
                } catch {
                  // ignore
                }
              }
            }}
            onDragLeave={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setIsExternalFileDragging(false)
            }}
            onDrop={handleDrop}
            className="absolute inset-0 z-40 bg-transparent cursor-copy"
          />
        )}

        {availableModels.map((model) => {
          if (!mountedSidebarModels.has(model.id)) return null
          const isCurrent = model.id === currentModel?.id
          return (
            <div
              key={model.id}
              className="h-full w-full"
              style={{ display: isCurrent ? 'block' : 'none' }}
            >
              <WebviewCard
                id={model.id}
                name={model.name}
                url={model.url}
                logo={model.logo}
                enabled={true}
                slotIndex={99}
                compact={true}
                isolated={true}
                flat={true}
                captureContext="workbench"
                webviewInstanceId={`workbench-sidebar-${model.id}`}
                onModelChange={handleModelChange}
                headerActions={
                  <button
                    type="button"
                    onClick={closeRightPane}
                    className="w-7 h-7 rounded-full text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center transition-all duration-200"
                    title="折叠 AI 侧边栏"
                    aria-label="折叠 AI 侧边栏"
                  >
                    <AppIcon name="right_panel_close" size={20} />
                  </button>
                }
                ref={(ref) => {
                  if (ref) sidebarRefs.current.set(model.id, ref)
                  else sidebarRefs.current.delete(model.id)
                }}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
