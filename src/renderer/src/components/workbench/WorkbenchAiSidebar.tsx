import { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import { useAppStore } from '../../store/appStore'
import { useWorkbenchStore } from '../../store/workbenchStore'
import WebviewCard, { type WebviewCardRef } from '../WebviewCard'

export default function WorkbenchAiSidebar(): JSX.Element | null {
  const models = useAppStore((s) => s.models)
  const sidebarModelId = useWorkbenchStore((s) => s.sidebarModelId)
  const setSidebarModelId = useWorkbenchStore((s) => s.setSidebarModelId)
  const isRightCollapsed = useWorkbenchStore((s) => s.isRightCollapsed)
  const toggleRightCollapse = useWorkbenchStore((s) => s.toggleRightCollapse)

  const sidebarRefs = useRef<Map<string, WebviewCardRef>>(new Map())

  // 可用模型
  const availableModels = useMemo(() => models.filter((m) => m.enabled), [models])
  const currentModel = useMemo(() => {
    return (
      availableModels.find((m) => m.id === sidebarModelId) ||
      availableModels[0] ||
      models[0]
    )
  }, [availableModels, models, sidebarModelId])

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
