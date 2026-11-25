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
  const [collapsedProviders, setCollapsedProviders] = useState<Record<string, boolean>>({})
  const inputRef = useRef<HTMLInputElement>(null)

  const toggleProvider = (providerId: string): void => {
    setCollapsedProviders((prev) => ({ ...prev, [providerId]: !prev[providerId] }))
  }

  useEffect(() => {
    void fetchSnapshot()
    inputRef.current?.focus()
  }, [fetchSnapshot])

  const active = sessionStatus?.active ?? snapshot?.active
  const thinkingLevel: AgentThinkingLevel = active?.thinkingLevel ?? 'off'
  const thinkingLevels = active?.availableThinkingLevels ?? []
  const supportsThinking = Boolean(active?.supportsThinking && thinkingLevels.length > 1)
  const currentThinkingIndex = Math.max(0, thinkingLevels.indexOf(thinkingLevel))

  const matchesQuery = (provider: AgentProvider, model: AgentProviderModel, q: string): boolean => {
    if (!q) return true
    const ctxLabel = model.contextWindow ? `${Math.round(model.contextWindow / 1000)}k` : ''
    return (
      model.name.toLowerCase().includes(q) ||
      model.id.toLowerCase().includes(q) ||
      provider.name.toLowerCase().includes(q) ||
      provider.id.toLowerCase().includes(q) ||
      ctxLabel.toLowerCase().includes(q)
    )
  }

  const groups = useMemo(() => {
    const providers = snapshot?.providers ?? []
    const q = query.trim().toLowerCase()
    const result: Array<{ provider: AgentProvider; items: PickerItem[] }> = []
    for (const provider of providers) {
      if (provider.disabled) continue
      const items = provider.models
        .filter((model) => model.available)
        .filter((model) => matchesQuery(provider, model, q))
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
      if (!matchesQuery(provider, model, q)) continue
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

  const thinkingRatio =
    thinkingLevels.length > 1 ? currentThinkingIndex / (thinkingLevels.length - 1) : 0

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
        className={`w-full text-left px-2.5 py-2 rounded-lg flex items-center justify-between transition-colors ${
          isActive
            ? 'bg-blue-50/80 dark:bg-primary/15'
            : 'hover:bg-black/[0.045] dark:hover:bg-white/[0.07]'
        } disabled:opacity-60`}
      >
        <div className="min-w-0 flex-1">
          <div
            className={`text-body leading-tight truncate ${
              isActive
                ? 'text-slate-900 dark:text-white font-semibold'
                : 'text-text-primary dark:text-gray-200 font-medium'
            }`}
          >
            {model.name}
          </div>
          <div className="text-caption text-text-secondary truncate mt-0.5">
            {provider.id}
            {model.contextWindow ? ` · ${Math.round(model.contextWindow / 1000)}k 上下文` : ''}
          </div>
        </div>
        {isActive && <AppIcon name="check" size={16} className="text-primary shrink-0 ml-2" />}
      </button>
    )
  }

  return (
    <div className="flex flex-col text-label w-full select-none">
      {/* 搜索 Header */}
      <div className="px-3.5 py-2.5 border-b border-black/[0.06] dark:border-white/10">
        <div className="flex items-center gap-2">
          <AppIcon
            name="search"
            size={15}
            className="text-text-secondary shrink-0"
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
            placeholder="搜索模型、厂商或上下文..."
            className="w-full bg-transparent text-body text-text-primary placeholder:text-text-secondary/60 focus:outline-none dark:text-gray-100"
          />
        </div>
      </div>

      {/* 模型列表 */}
      <div className="max-h-[280px] overflow-y-auto px-2 py-2 space-y-2">
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
            <div className="px-2 pt-0.5 pb-1 flex items-center gap-1.5 text-label text-text-secondary font-medium">
              <AppIcon name="star" size={12} className="text-amber-500 shrink-0" fill="currentColor" />
              <span className="truncate">常用模型</span>
              <span className="shrink-0 ml-auto text-caption tabular-nums">{favoriteItems.length}</span>
            </div>
            {favoriteItems.map(({ provider, model }) =>
              renderModelRow(`fav:${provider.id}:${model.id}`, provider, model)
            )}
          </div>
        )}
        {favoriteItems.length > 0 && groups.length > 0 && (
          <div className="border-t border-slate-100 dark:border-white/10 mx-1" />
        )}
        {groups.map(({ provider, items }) => {
          const isSearching = query.trim().length > 0
          const isCollapsed = !isSearching && Boolean(collapsedProviders[provider.id])
          return (
            <div key={provider.id} className="space-y-0.5">
              <button
                type="button"
                onClick={() => toggleProvider(provider.id)}
                aria-expanded={!isCollapsed}
                className="w-full px-2 py-1 rounded-lg flex items-center justify-between text-label text-text-secondary font-medium hover:text-text-primary hover:bg-slate-50 transition-colors dark:hover:text-gray-200 dark:hover:bg-white/5"
              >
                <span className="flex items-center gap-1 min-w-0">
                  <AppIcon
                    name="expand_more"
                    size={12}
                    className={`shrink-0 transition-transform duration-150 ${
                      isCollapsed ? '-rotate-90' : ''
                    }`}
                  />
                  <span className="truncate">{provider.name}</span>
                </span>
                <span className="shrink-0 text-caption tabular-nums ml-2">{items.length}</span>
              </button>
              {!isCollapsed &&
                items.map(({ model }) =>
                  renderModelRow(`${provider.id}:${model.id}`, provider, model)
                )}
            </div>
          )
        })}
      </div>

      {error && (
        <div className="px-3.5 py-2 border-t border-black/[0.06] text-label text-rose-600 dark:border-white/10 dark:text-rose-400">
          {error}
        </div>
      )}

      {/* 底部 Footer: 思考强度设置 */}
      <div className="border-t border-black/[0.06] px-3.5 py-3 dark:border-white/10">
        {supportsThinking ? (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-label font-semibold text-text-primary dark:text-gray-200">
                思考强度
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-blue-50 text-primary border border-blue-100 text-caption font-semibold dark:bg-primary/15 dark:border-primary/30">
                {THINKING_LABELS[thinkingLevel] ?? thinkingLevel}
              </span>
            </div>

            <div>
              <div className="relative h-6 rounded-full bg-slate-200/80 dark:bg-white/10 overflow-hidden select-none">
                {/* 渐变激活填充条（使用项目 diffuse 四色渐变，越高越暖） */}
                <div
                  className="absolute inset-0 transition-all duration-150"
                  style={{
                    clipPath: `inset(0 calc((100% - 24px) * ${1 - thinkingRatio}) 0 0 round 9999px)`,
                    background:
                      'linear-gradient(90deg, #3b82f6 0%, #D2E8FF 35%, #FFC8DA 65%, #FFF5D6 100%)'
                  }}
                />
                {/* 档位刻度点 */}
                {thinkingLevels.map((lvl, idx) => {
                  const ratio =
                    thinkingLevels.length > 1 ? idx / (thinkingLevels.length - 1) : 0
                  const isPassed = idx <= currentThinkingIndex
                  return (
                    <span
                      key={lvl}
                      className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full pointer-events-none transition-colors ${
                        isPassed
                          ? 'bg-slate-700/35 dark:bg-white/75'
                          : 'bg-slate-400/60 dark:bg-white/25'
                      }`}
                      style={{ left: `calc(12px + (100% - 24px) * ${ratio})` }}
                    />
                  )
                })}
                {/* 滑块圆点 */}
                <div
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-white shadow-md border border-slate-200/80 pointer-events-none transition-all duration-150 dark:border-white/20"
                  style={{ left: `calc(12px + (100% - 24px) * ${thinkingRatio})` }}
                />
                <input
                  type="range"
                  min={0}
                  max={thinkingLevels.length - 1}
                  step={1}
                  value={currentThinkingIndex}
                  onChange={handleSliderChange}
                  aria-label="思考强度"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              </div>
              <div className="flex justify-between items-center mt-1.5 px-1">
                {thinkingLevels.map((lvl, idx) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => void setThinkingLevel(lvl)}
                    className={`text-caption transition-colors cursor-pointer ${
                      idx === currentThinkingIndex
                        ? 'text-primary font-semibold'
                        : 'text-text-secondary hover:text-text-primary dark:hover:text-gray-200'
                    }`}
                  >
                    {THINKING_LABELS[lvl] ?? lvl}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center text-text-secondary text-label py-0.5">
            <span className="text-caption">当前模型不支持思考强度调节</span>
          </div>
        )}
      </div>
    </div>
  )
}
