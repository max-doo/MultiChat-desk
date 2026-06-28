import React, { useEffect, useState, useRef } from 'react'
import { useAppStore } from '../store/appStore'
import WebviewCard, { type WebviewCardRef } from '../components/WebviewCard'

export default function QuickPage(): JSX.Element {
  const { models, registerWebviewRef, unregisterWebviewRef } = useAppStore()
  const [selectedModelId, setSelectedModelId] = useState<string>('')
  const cardRef = useRef<WebviewCardRef | null>(null)
  const isDraggingRef = useRef(false)
  const [isPinned, setIsPinned] = useState(false)

  // 获取初始置顶状态
  useEffect(() => {
    if (window.api?.quickGetAlwaysOnTop) {
      window.api.quickGetAlwaysOnTop()
        .then((pinned) => {
          setIsPinned(pinned)
        })
        .catch((err) => {
          console.error('[QuickPage] Failed to get always-on-top state:', err)
        })
    }
  }, [])

  const toggleAlwaysOnTop = async () => {
    if (window.api?.quickSetAlwaysOnTop) {
      const nextState = !isPinned
      try {
        await window.api.quickSetAlwaysOnTop(nextState)
        setIsPinned(nextState)
      } catch (err) {
        console.error('[QuickPage] Failed to set always-on-top state:', err)
      }
    }
  }

  // 窗口拖拽监听
  useEffect(() => {
    const handlePointerMove = (_e: PointerEvent) => {
      if (isDraggingRef.current) {
        window.api.windowDragMove()
      }
    }
    
    const handlePointerUp = (_e: PointerEvent) => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false
        window.api.windowDragEnd()
      }
    }
    
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [])

  // 加载上次选中的快捷模型 ID
  useEffect(() => {
    window.api.storeGet('quickModelId').then((saved) => {
      if (saved && typeof saved === 'string') {
        setSelectedModelId(saved)
      }
    }).catch(() => {})
  }, [])

  const currentModel = models.find(m => m.id === selectedModelId) || models[0]

  useEffect(() => {
    if (currentModel && !selectedModelId) {
      setSelectedModelId(currentModel.id)
    }
  }, [currentModel, selectedModelId])

  const handleModelChange = (id: string) => {
    setSelectedModelId(id)
    window.api.storeSet('quickModelId', id)
  }

  // 带重试机制的文本注入（确保 Webview 异步加载完成后能成功注入）
  const injectTextWithRetry = async (prompt: string, maxAttempts = 15) => {
    for (let i = 0; i < maxAttempts; i++) {
      if (cardRef.current) {
        const res = await cardRef.current.insertText(prompt)
        if (res.success) {
          console.log('[QuickPage] 成功注入文本至网页输入框')
          return
        }
      }
      await new Promise(r => setTimeout(r, 500))
    }
    console.warn('[QuickPage] 注入文本超时或失败')
  }

  // 监听全局快捷键注入事件
  useEffect(() => {
    const unsub = window.api.onQuickInject(async ({ text, action }) => {
      if (!text) return
      if (action === 'raw') {
        injectTextWithRetry(text)
        return
      }
      const promptMap: Record<string, string> = {
        summarize: `总结以下内容:\n\n${text}`,
        polish: `润色以下文本，使其更流畅自然:\n\n${text}`,
        translate: `翻译一下内容：如果是英文则翻译成中文，如果是中文则翻译成英文，不得更改原意:\n\n${text}`
      }
      const finalPrompt = promptMap[action] || text
      injectTextWithRetry(finalPrompt)
    })
    return () => unsub()
  }, [])

  return (
    <div className="h-screen w-screen overflow-hidden p-0">
      {currentModel ? (
        <WebviewCard
          key={currentModel.id}
          id={currentModel.id}
          name={currentModel.name}
          url={currentModel.url}
          logo={currentModel.logo}
          enabled={true}
          slotIndex={0}
          compact={true}
          isolated={true}
          draggableHeader={true}
          flat={true}
          onDragStart={() => {
            isDraggingRef.current = true
          }}
          onModelChange={(modelId) => handleModelChange(modelId)}
          headerActions={
            <div className="flex items-center gap-2 pl-2 border-l border-gray-200/60 ml-1 no-drag">
              <button
                type="button"
                onClick={toggleAlwaysOnTop}
                className={`w-7 h-7 flex items-center justify-center rounded-full transition-all duration-200 ${
                  isPinned 
                    ? 'text-primary bg-blue-50 hover:bg-blue-100' 
                    : 'text-text-secondary hover:text-text-primary hover:bg-gray-100'
                }`}
                title={isPinned ? '取消固定' : '固定窗口'}
              >
                <span 
                  className="material-symbols-outlined text-base"
                  style={isPinned ? { fontVariationSettings: "'FILL' 1" } : undefined}
                >
                  push_pin
                </span>
              </button>
              <button
                type="button"
                onClick={() => void window.api.trayShowMain()}
                className="text-xs px-2.5 py-1 bg-gray-100 hover:bg-gray-200 border border-gray-200/60 rounded-md text-text-primary transition-all duration-200 flex items-center gap-1"
                title="展开至主窗口"
              >
                <span className="material-symbols-outlined text-xs">open_in_new</span> 主界面
              </button>
              <button
                type="button"
                onClick={() => void window.api.quickHide()}
                className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-red-500 hover:bg-red-50 rounded-full transition-all duration-200"
                title="关闭"
              >
                ✕
              </button>
            </div>
          }
          ref={(ref) => {
            cardRef.current = ref
            if (ref) {
              registerWebviewRef(currentModel.id, ref)
            } else {
              unregisterWebviewRef(currentModel.id)
            }
          }}
        />
      ) : (
        <div className="flex items-center justify-center h-full text-text-secondary text-sm">
          暂无可用模型配置
        </div>
      )}
    </div>
  )
}

