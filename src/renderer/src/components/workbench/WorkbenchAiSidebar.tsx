import { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import { useAppStore } from '../../store/appStore'
import { useWorkbenchStore } from '../../store/workbenchStore'
import WebviewCard, { type WebviewCardRef } from '../WebviewCard'
import { assistantReplyConfigs } from '../../../../shared/config/selectors'
import { generateInsertReplyButtonScript } from '../../../../shared/utils/webviewScripts'
import { defaultSelectors } from '../../../../shared/config/selectors'

const INSERT_PREFIX = '__MC_INSERT_CURRENT__'
const SAVE_PREFIX = '__MC_SAVE_NEW__'

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
  const isRightCollapsed = useWorkbenchStore((s) => s.isRightCollapsed)
  const toggleRightCollapse = useWorkbenchStore((s) => s.toggleRightCollapse)

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
  const insertReplyIntoActiveMarkdown = useWorkbenchStore((s) => s.insertReplyIntoActiveMarkdown)
  const saveReplyAsNewMarkdown = useWorkbenchStore((s) => s.saveReplyAsNewMarkdown)

  // 防重复插入：记录每个平台最近一次插入的 replyHash
  const lastInsertHash = useRef<Map<string, string>>(new Map())

  const handleInsertReply = useCallback(
    async (p: ReplyPayload): Promise<void> => {
      if (!p?.replyMd) return
      if (lastInsertHash.current.get(p.platformId) === p.replyHash) return // 重复点击跳过
      if (isRightCollapsed) toggleRightCollapse()
      const res = await insertReplyIntoActiveMarkdown(p.replyMd, {
        conversationUrl: p.conversationUrl
      })
      if (res.success) lastInsertHash.current.set(p.platformId, p.replyHash)
    },
    [insertReplyIntoActiveMarkdown, isRightCollapsed, toggleRightCollapse]
  )

  const handleSaveReply = useCallback(
    async (p: ReplyPayload): Promise<void> => {
      if (!p?.replyMd) return
      if (isRightCollapsed) toggleRightCollapse()
      await saveReplyAsNewMarkdown(p.replyMd, { platformId: p.platformId, title: p.title })
    },
    [saveReplyAsNewMarkdown, isRightCollapsed, toggleRightCollapse]
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

  // 监听来自划词动作的文本注入事件
  useEffect(() => {
    const handleInsertPrompt = (e: Event) => {
      const customEvent = e as CustomEvent<{ prompt: string }>
      const prompt = customEvent.detail?.prompt
      if (!prompt) return

      // 若侧边栏当前处于折叠状态，则自动展开
      if (isRightCollapsed) {
        toggleRightCollapse()
      }

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
  }, [currentModel, isRightCollapsed, toggleRightCollapse])

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 border-l border-black/5 dark:border-white/5 overflow-hidden">
      <div className="flex-1 relative overflow-hidden bg-white dark:bg-gray-900">
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
                webviewInstanceId={`workbench-sidebar-${model.id}`}
                onModelChange={handleModelChange}
                headerActions={
                  <button
                    type="button"
                    onClick={toggleRightCollapse}
                    className="w-7 h-7 rounded-full text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center transition-all duration-200"
                    title="折叠 AI 侧边栏"
                    aria-label="折叠 AI 侧边栏"
                  >
                    <span className="material-symbols-outlined text-base">right_panel_close</span>
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
