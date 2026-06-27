import React, { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { defaultSelectors } from '../config/selectors'
import { generateSendMessageScript } from '../utils/webviewScripts'

export default function QuickPage(): JSX.Element {
  const { activeModels, currentModelId, setCurrentModelId } = useAppStore()
  const [inputText, setInputText] = useState('')

  useEffect(() => {
    if (activeModels.length > 0 && (!currentModelId || !activeModels.some(m => m.id === currentModelId))) {
      setCurrentModelId(activeModels[0].id)
    }
  }, [activeModels, currentModelId, setCurrentModelId])

  // 监听注入事件
  useEffect(() => {
    const unsub = window.api.onQuickInject(async ({ text, action }) => {
      setInputText(text)
      if (action === 'raw') return // 仅填入输入框，由用户决定后续
      const promptMap: Record<string, string> = {
        summarize: `请用精炼的语言总结以下内容:\n\n${text}`,
        polish: `请修改并润色以下文本，使其更流畅自然:\n\n${text}`,
        translate: `请将以下内容翻译成中文(若已经是中文则翻译成英文):\n\n${text}`
      }
      const finalPrompt = promptMap[action] || text
      setInputText(finalPrompt)

      // 自动发送：使用项目封装的注入脚本发送到当前 webview
      setTimeout(async () => {
        const webview = document.querySelector('webview') as Electron.WebviewTag | null
        if (!webview) return
        const targetModelId = currentModelId || (activeModels[0] ? activeModels[0].id : '')
        if (!targetModelId) return

        const selectors = defaultSelectors.models[targetModelId]
        if (selectors) {
          const code = generateSendMessageScript(finalPrompt, targetModelId, selectors)
          await webview.executeJavaScript(code)
          setInputText('')
        }
      }, 500)
    })
    return () => unsub()
  }, [activeModels, currentModelId])

  const currentModel = activeModels.find(m => m.id === currentModelId) || activeModels[0]

  return (
    <div className="flex flex-col h-screen w-screen bg-gray-900 text-white overflow-hidden border border-gray-700 rounded-lg shadow-2xl">
      {/* 自定义拖拽标题栏 */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700 select-none" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-primary">⚡ 快捷助手</span>
          <select
            value={currentModelId || ''}
            onChange={(e) => setCurrentModelId(e.target.value)}
            className="text-xs bg-gray-700 border border-gray-600 rounded px-2 py-0.5 text-gray-200 focus:outline-none"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {activeModels.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={() => void window.api.trayShowMain()}
            className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300 transition-colors"
            title="展开至主窗口"
          >
            ↗ 主界面
          </button>
          <button
            onClick={() => void window.api.quickHide()}
            className="text-gray-400 hover:text-white px-1.5 py-0.5 rounded hover:bg-gray-700 transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Webview 区域 */}
      <div className="flex-1 relative bg-white">
        {currentModel ? (
          <webview
            src={currentModel.url}
            partition="persist:shared"
            className="w-full h-full"
            allowpopups="true"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            暂无可用模型，请先在主窗口开启模型
          </div>
        )}
      </div>

      {/* 底部输入提示栏 / 快速发送 */}
      <div className="p-2 bg-gray-800 border-t border-gray-700 flex gap-2 items-center">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="输入快问内容，按 Enter 注入..."
          className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-primary"
          onKeyDown={async (e) => {
            if (e.key === 'Enter' && inputText.trim()) {
              const webview = document.querySelector('webview') as Electron.WebviewTag | null
              if (!webview || !currentModel) return
              const selectors = defaultSelectors.models[currentModel.id]
              if (selectors) {
                const code = generateSendMessageScript(inputText, currentModel.id, selectors)
                await webview.executeJavaScript(code)
                setInputText('')
              }
            }
          }}
        />
      </div>
    </div>
  )
}
