import { useState, useEffect } from 'react'
import { X, Check, Key, Server, Cpu } from 'lucide-react'
import { useAgentSessionStore } from '../../../store/agentSessionStore'

interface AgentSettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export function AgentSettingsModal({ isOpen, onClose }: AgentSettingsModalProps): JSX.Element | null {
  const activeModel = useAgentSessionStore((s) => s.activeModel)
  const activeProvider = useAgentSessionStore((s) => s.activeProvider)
  const providers = useAgentSessionStore((s) => s.providers)
  const setCredential = useAgentSessionStore((s) => s.setCredential)
  const setModel = useAgentSessionStore((s) => s.setModel)
  const fetchProviders = useAgentSessionStore((s) => s.fetchProviders)

  const [providerId, setProviderId] = useState(activeProvider || 'openai')
  const [modelName, setModelName] = useState(activeModel || 'devin/swe-2')
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:3425/v1')
  const [apiKey, setApiKey] = useState('magpie')
  const [saving, setSaving] = useState(false)
  const [savedSuccess, setSavedSuccess] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (isOpen) {
      setProviderId(activeProvider || 'openai')
      setModelName(activeModel || 'devin/swe-2')
      void fetchProviders()
    }
  }, [isOpen, activeProvider, activeModel, fetchProviders])

  if (!isOpen) return null

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    setErrorMsg('')
    setSavedSuccess(false)

    try {
      const okCred = await setCredential(providerId, {
        type: 'api_key',
        key: apiKey,
        baseUrl: baseUrl.trim() || undefined
      })

      const okModel = await setModel(modelName.trim(), providerId)

      if (okCred && okModel) {
        setSavedSuccess(true)
        setTimeout(() => {
          setSavedSuccess(false)
          onClose()
        }, 800)
      } else {
        setErrorMsg('配置保存失败，请检查参数')
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const selectedProviderInfo = providers.find((p) => p.providerId === providerId)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 select-none">
      <div className="w-full max-w-md rounded-2xl bg-white border border-gray-200 shadow-2xl overflow-hidden flex flex-col text-gray-800 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
              <Cpu className="w-3.5 h-3.5" />
            </div>
            <h3 className="font-semibold text-sm text-gray-900">本地 Agent 模型与凭证配置</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 text-xs">
          {/* Provider Select */}
          <div>
            <label className="block text-gray-700 font-medium mb-1 flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-gray-500" />
              <span>Provider (推理服务商)</span>
            </label>
            <select
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-800 text-xs focus:outline-none focus:border-blue-500"
            >
              <option value="magpie">Magpie (本地 Devin 网关 / 推荐)</option>
              <option value="openai">OpenAI / 本地兼容接口</option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="deepseek">DeepSeek</option>
              <option value="google">Google Gemini</option>
              <option value="openrouter">OpenRouter</option>
              <option value="groq">Groq</option>
            </select>
            {selectedProviderInfo && (
              <div className="mt-1 text-[11px] text-gray-400">
                状态:{' '}
                {selectedProviderInfo.configured ? (
                  <span className="text-green-600 font-medium">已配置</span>
                ) : (
                  <span className="text-gray-500">未配置</span>
                )}
              </div>
            )}
          </div>

          {/* Base URL */}
          <div>
            <label className="block text-gray-700 font-medium mb-1">
              Base URL (API 接口根地址)
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://127.0.0.1:3425/v1"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white font-mono text-xs text-gray-800 focus:outline-none focus:border-blue-500"
            />
            <span className="text-[10.5px] text-gray-400 mt-0.5 block">
              本地模型默认: http://127.0.0.1:3425/v1
            </span>
          </div>

          {/* API Key */}
          <div>
            <label className="block text-gray-700 font-medium mb-1 flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-gray-500" />
              <span>API Key</span>
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="magpie"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white font-mono text-xs text-gray-800 focus:outline-none focus:border-blue-500"
            />
            <span className="text-[10.5px] text-gray-400 mt-0.5 block">
              本地验证服务默认: magpie
            </span>
          </div>

          {/* Model Name */}
          <div>
            <label className="block text-gray-700 font-medium mb-1">
              Model (模型标识)
            </label>
            <input
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="devin/swe-2"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white font-mono text-xs text-gray-800 focus:outline-none focus:border-blue-500"
            />
            <span className="text-[10.5px] text-gray-400 mt-0.5 block">
              推荐本地 Agent 模型: devin/swe-2
            </span>
          </div>

          {errorMsg && (
            <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs">
              {errorMsg}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-100 text-gray-700 text-xs font-medium transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="px-4 py-1.5 rounded-lg bg-primary hover:opacity-90 disabled:opacity-50 text-white text-xs font-medium flex items-center gap-1.5 shadow-sm transition-colors"
          >
            {savedSuccess ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>已保存</span>
              </>
            ) : saving ? (
              <span>保存中...</span>
            ) : (
              <span>保存配置</span>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
