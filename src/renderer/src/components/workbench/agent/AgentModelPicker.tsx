import { useEffect, useMemo, useRef, useState } from 'react'
import { AppIcon } from '../../icons/AppIcon'
import { useAgentSessionStore } from '../../../store/agentSessionStore'
import {
  THINKING_LABELS,
  type AgentProvider,
  type AgentProviderModel,
  type AgentThinkingLevel
} from '../../../types/agent'

interface AgentModelPickerProps {
  onClose: () => void
}

interface PickerItem {
  provider: AgentProvider
  model: AgentProviderModel
}

export function AgentModelPicker({ onClose }: AgentModelPickerProps): JSX.Element {
  const snapshot = useAgentSessionStore((s) => s.snapshot)
  const sessionStatus = useAgentSessionStore((s) => s.sessionStatus)
  const setModel = useAgentSessionStore((s) => s.setModel)
  const setThinkingLevel = useAgentSessionStore((s) => s.setThinkingLevel)
  const fetchSnapshot = useAgentSessionStore((s) => s.fetchSnapshot)
  const openAgentSettings = useAgentSessionStore((s) => s.openAgentSettings)

  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void fetchSnapshot()
    inputRef.current?.focus()
  }, [fetchSnapshot])

  const active = sessionStatus?.active ?? snapshot?.active
  const thinkingLevel: AgentThinkingLevel = active?.thinkingLevel ?? 'off'
  const thinkingLevels = active?.availableThinkingLevels ?? []
  const supportsThinking = Boolean(active?.supportsThinking && thinkingLevels.length > 1)
  const currentThinkingIndex = Math.max(0, thinkingLevels.indexOf(thinkingLevel))

  const groups = useMemo(() => {
    const providers = snapshot?.providers ?? []
    const q = query.trim().toLowerCase()
    const result: Array<{ provider: AgentProvider; items: PickerItem[] }> = []
    for (const provider of providers) {
      if (provider.disabled) continue
      const items = provider.models
        .filter((model) => model.available)
        .filter(
          (model) =>
            !q ||
            model.name.toLowerCase().includes(q) ||
            model.id.toLowerCase().includes(q) ||
            provider.name.toLowerCase().includes(q) ||
            provider.id.toLowerCase().includes(q)
        )
        .map((model) => ({ provider, model }))
      if (items.length > 0) result.push({ provider, items })
    }
    return result
  }, [snapshot, query])

  const total = groups.reduce((sum, group) => sum + group.items.length, 0)

  const favoriteItems = useMemo(() => {
    const providers = snapshot?.providers ?? []
    const favorites = snapshot?.favorites ?? []
    const q = query.trim().toLowerCase()
    const items: PickerItem[] = []
    for (const fav of favorites) {
      const provider = providers.find((p) => p.id === fav.providerId)
      if (!provider || provider.disabled) continue
      const model = provider.models.find((m) => m.id === fav.modelId)
      if (!model || !model.available) continue
      if (
        q &&
        !model.name.toLowerCase().includes(q) &&
        !model.id.toLowerCase().includes(q) &&
        !provider.name.toLowerCase().includes(q) &&
        !provider.id.toLowerCase().includes(q)
      ) {
        continue
      }
      items.push({ provider, model })
    }
    return items
  }, [snapshot, query])

  const handleSelect = async (provider: AgentProvider, model: AgentProviderModel): Promise<void> => {
    if (saving) return
    if (active?.providerId === provider.id && active.modelId === model.id) {
      onClose()
      return
    }
    setSaving(true)
    setError('')
    const ok = await setModel(model.id, provider.id)
    setSaving(false)
    if (ok) onClose()
    else setError('切换模型失败，请检查该供应商的认证状态')
  }

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const index = Number(e.target.value)
    const nextLevel = thinkingLevels[index]
    if (nextLevel && nextLevel !== thinkingLevel) {
      void setThinkingLevel(nextLevel)
    }
  }

  const renderModelRow = (
    key: string,
    provider: AgentProvider,
    model: AgentProviderModel
  ): JSX.Element => {
    const isActive = active?.providerId === provider.id && active.modelId === model.id
    return (
      <button
        key={key}
        type="button"
        onClick={() => void handleSelect(provider, model)}
        disabled={saving}
        className={`w-full text-left p-2 rounded-lg flex items-center justify-between transition-colors ${
          isActive
            ? 'bg-blue-50/60 dark:bg-primary/15 font-medium'
            : 'hover:bg-gray-50 dark:hover:bg-white/5'
        } disabled:opacity-60`}
      >
        <div className="min-w-0 flex-1">
          <div
            className={`text-body leading-tight truncate ${
              isActive
                ? 'text-slate-900 dark:text-white font-semibold'
                : 'text-slate-800 dark:text-gray-200 font-medium'
            }`}
          >
            {model.name}
          </div>
          <div className="text-caption text-text-secondary truncate mt-0.5 font-mono">
            {provider.id}
            {model.contextWindow ? ` · ${Math.round(model.contextWindow / 1000)}k 上下文` : ''}
          </div>
        </div>
        {isActive && <AppIcon name="check" size={16} className="text-primary shrink-0 ml-2" />}
      </button>
    )
  }

  return (
    <div className="flex flex-col text-label w-full select-none bg-white dark:bg-gray-800">
      {/* 搜索 Header：与模式选择器与上下文弹窗的 Header 规格一致 */}
      <div className="px-3 py-2.5 border-b border-gray-100 bg-white dark:border-white/10 dark:bg-gray-800">
        <div className="relative">
          <AppIcon
            name="search"
            size={14}
            className="text-text-secondary absolute left-2.5 top-1/2 -translate-y-1/2"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                if (query) setQuery('')
                else onClose()
              }
            }}
            placeholder="搜索模型..."
            className="w-full pl-8 pr-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200/70 text-text-primary text-label placeholder-gray-400 focus:outline-none focus:bg-white focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all dark:bg-white/5 dark:border-white/10 dark:focus:bg-gray-900"
          />
        </div>
      </div>

      {/* 模型列表：与模式选择器一致的 p-1.5 内衬与 rounded-lg Item */}
      <div className="max-h-[260px] overflow-y-auto p-1.5 bg-white dark:bg-gray-800 space-y-1.5">
        {total === 0 && favoriteItems.length === 0 && (
          <div className="px-3 py-6 text-center space-y-2">
            <div className="text-text-secondary text-label">没有可用模型</div>
            <button
              type="button"
              onClick={() => {
                onClose()
                openAgentSettings()
              }}
              className="text-primary hover:opacity-80 transition-opacity font-medium text-label"
            >
              打开供应商设置
            </button>
          </div>
        )}
        {favoriteItems.length > 0 && (
          <div className="space-y-0.5">
            <div className="px-2 pt-1 pb-0.5 flex items-center gap-1 text-caption text-text-secondary font-medium">
              <AppIcon name="star" size={12} className="text-amber-500" fill="currentColor" />
              <span className="truncate">常用模型</span>
              <span className="shrink-0 ml-auto">{favoriteItems.length}</span>
            </div>
            {favoriteItems.map(({ provider, model }) =>
              renderModelRow(`fav:${provider.id}:${model.id}`, provider, model)
            )}
          </div>
        )}
        {groups.map(({ provider, items }) => (
          <div key={provider.id} className="space-y-0.5">
            <div className="px-2 pt-1 pb-0.5 flex items-center justify-between text-caption text-text-secondary font-medium">
              <span className="truncate">{provider.name}</span>
              <span className="shrink-0">{items.length}</span>
            </div>
            {items.map(({ model }) =>
              renderModelRow(`${provider.id}:${model.id}`, provider, model)
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="px-3 py-2 border-t border-gray-100 text-label text-rose-600 bg-white dark:border-white/10 dark:bg-gray-800 dark:text-rose-400">
          {error}
        </div>
      )}

      {/* 底部 Footer: 思考强度设置 */}
      <div className="border-t border-slate-100 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-white/[0.03]">
        {supportsThinking ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-label">
              <div className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-gray-200">
                <AppIcon name="psychology" size={14} className="text-primary" />
                <span>思考强度</span>
              </div>
              <span className="font-semibold text-primary px-2 py-0.5 rounded-full bg-primary/10 text-caption">
                {THINKING_LABELS[thinkingLevel] ?? thinkingLevel}
              </span>
            </div>

            <div className="pt-1 pb-0.5">
              <input
                type="range"
                min={0}
                max={thinkingLevels.length - 1}
                step={1}
                value={currentThinkingIndex}
                onChange={handleSliderChange}
                className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-primary focus:outline-none dark:bg-white/15"
              />
              <div className="flex justify-between items-center text-caption text-slate-400 mt-1.5 font-medium px-0.5">
                {thinkingLevels.map((lvl, idx) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => void setThinkingLevel(lvl)}
                    className={`transition-colors cursor-pointer hover:text-slate-700 dark:hover:text-gray-200 ${
                      idx === currentThinkingIndex ? 'text-primary font-bold' : ''
                    }`}
                  >
                    {THINKING_LABELS[lvl] ?? lvl}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-slate-400 text-label py-0.5">
            <AppIcon name="psychology" size={14} className="opacity-40 shrink-0" />
            <span className="text-caption">当前模型不支持思考强度调节</span>
          </div>
        )}
      </div>
    </div>
  )
}
