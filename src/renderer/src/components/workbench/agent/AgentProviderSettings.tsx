import { useEffect, useMemo, useState } from 'react'
import { useAgentSessionStore } from '../../../store/agentSessionStore'
import type { AgentAuthOperation, AgentProvider, AgentProviderModel, AgentIpcApi } from '../../../types/agent'
import { AppIcon } from '../../icons/AppIcon'
import { AgentAuthDialog } from './AgentAuthDialog'

const INPUT_CLASS =
  'h-9 rounded-lg border border-slate-200 bg-slate-50/80 px-3 text-label text-text-primary placeholder:text-gray-400 focus:border-primary focus:bg-white focus:outline-none dark:border-slate-700/80 dark:bg-slate-800/50 dark:focus:bg-slate-800'

function getAgentApi(): AgentIpcApi {
  return window.api as unknown as AgentIpcApi
}

const SOURCE_LABELS: Record<string, string> = {
  stored: '已登录',
  runtime: '本次运行',
  environment: '环境变量',
  fallback: '备用凭据',
  models_json_key: 'models.json',
  models_json_command: '命令提供'
}

function authLabel(provider: AgentProvider): string {
  if (!provider.configured) return '未配置'
  if (provider.authSource) return SOURCE_LABELS[provider.authSource] || provider.authSource
  return provider.authType === 'oauth' ? 'OAuth' : '已配置'
}

function groupOf(provider: AgentProvider): 'connected' | 'attention' | 'available' {
  if (!provider.configured) return 'available'
  if (provider.availableModelCount === 0 || provider.error) return 'attention'
  return 'connected'
}

export function AgentProviderSettings({ inlineAuth = false }: { inlineAuth?: boolean } = {}): JSX.Element {
  const snapshot = useAgentSessionStore((s) => s.snapshot)
  const snapshotLoading = useAgentSessionStore((s) => s.snapshotLoading)
  const authOperations = useAgentSessionStore((s) => s.authOperations)
  const loginProvider = useAgentSessionStore((s) => s.loginProvider)
  const respondProviderAuth = useAgentSessionStore((s) => s.respondProviderAuth)
  const cancelProviderAuth = useAgentSessionStore((s) => s.cancelProviderAuth)
  const logoutProvider = useAgentSessionStore((s) => s.logoutProvider)
  const refreshProviderModels = useAgentSessionStore((s) => s.refreshProviderModels)
  const setProviderBaseUrl = useAgentSessionStore((s) => s.setProviderBaseUrl)
  const setProviderDisabled = useAgentSessionStore((s) => s.setProviderDisabled)
  const setFavoriteModels = useAgentSessionStore((s) => s.setFavoriteModels)

  const [query, setQuery] = useState('')
  const [busyProvider, setBusyProvider] = useState<string | null>(null)
  const [showAll, setShowAll] = useState<Record<string, boolean>>({})
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set())
  const [editingBaseUrl, setEditingBaseUrl] = useState<string | null>(null)
  const [baseUrlDraft, setBaseUrlDraft] = useState('')
  const [baseUrlSaving, setBaseUrlSaving] = useState(false)
  const [baseUrlError, setBaseUrlError] = useState<string | null>(null)
  const [dialogId, setDialogId] = useState<string | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [customSaving, setCustomSaving] = useState(false)
  const [customSpec, setCustomSpec] = useState({ providerId: '', name: '', baseUrl: '', apiKey: '' })
  const [customError, setCustomError] = useState<string | null>(null)
  const [customIds, setCustomIds] = useState<Set<string>>(new Set())
  const [favBusy, setFavBusy] = useState<string | null>(null)
  const [availableExpanded, setAvailableExpanded] = useState(false)

  const favoriteKeys = useMemo(
    () => new Set((snapshot?.favorites ?? []).map((f) => `${f.providerId}:${f.modelId}`)),
    [snapshot]
  )

  const favoriteModels = useMemo(() => {
    const providers = snapshot?.providers ?? []
    return (snapshot?.favorites ?? [])
      .map((fav) => {
        const provider = providers.find((p) => p.id === fav.providerId)
        const model = provider?.models.find((m) => m.id === fav.modelId)
        return provider && model ? { provider, model } : null
      })
      .filter((entry): entry is { provider: AgentProvider; model: AgentProviderModel } =>
        Boolean(entry)
      )
  }, [snapshot])

  const providers = snapshot?.providers ?? []
  // snapshot 拉取已由 initListeners + onAgentRuntimeChanged 保证；避免打开
  // dialog 时再触发一次全量 buildProviders + IPC 序列化，减少卡顿。

  // Load persisted custom gateways once so rows can show a delete affordance.
  useEffect(() => {
    let cancelled = false
    void getAgentApi()
      .agentListCustomGateways?.()
      .then((res) => {
        if (cancelled || !res?.success || !res.data) return
        setCustomIds(new Set(res.data.map((item) => item.providerId)))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [snapshot])

  // Settings can open without any AgentCard mounted; make sure the shared
  // IPC listeners (including agent:provider-auth-changed) are actually
  // subscribed, otherwise auth state updates never reach this dialog.
  const initListeners = useAgentSessionStore((s) => s.initListeners)
  useEffect(() => initListeners(), [initListeners])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return providers
    const result: AgentProvider[] = []
    for (const provider of providers) {
      const providerHit =
        provider.name.toLowerCase().includes(q) || provider.id.toLowerCase().includes(q)
      const models = providerHit
        ? provider.models
        : provider.models.filter(
            (model) => model.name.toLowerCase().includes(q) || model.id.toLowerCase().includes(q)
          )
      if (providerHit || models.length > 0) {
        result.push({
          ...provider,
          models,
          modelCount: models.length,
          availableModelCount: models.filter((m) => m.available).length
        })
      }
    }
    return result
  }, [providers, query])

  const groups = useMemo(() => {
    const connected: AgentProvider[] = []
    const attention: AgentProvider[] = []
    const available: AgentProvider[] = []
    for (const provider of filtered) {
      const group = groupOf(provider)
      if (group === 'connected') connected.push(provider)
      else if (group === 'attention') attention.push(provider)
      else available.push(provider)
    }
    return { connected, attention, available }
  }, [filtered])

  const activeOperation = dialogId ? authOperations[dialogId] : undefined
  // 行内不再对每个 provider 做 Object.values 扫描；提到外层一次计算。
  const runningByProvider = useMemo(() => {
    const map: Record<string, AgentAuthOperation> = {}
    for (const op of Object.values(authOperations)) {
      if (op.status === 'running' || op.status === 'waiting') map[op.providerId] = op
    }
    return map
  }, [authOperations])

  const handleAddCustom = async (): Promise<void> => {
    const providerId = customSpec.providerId.trim()
    const baseUrl = customSpec.baseUrl.trim()
    const name = customSpec.name.trim()
    const apiKey = customSpec.apiKey.trim()
    if (!providerId || !baseUrl) {
      setCustomError('providerId 和 baseUrl 必填')
      return
    }
    if (!/^https?:\/\//i.test(baseUrl)) {
      setCustomError('baseUrl 需要以 http:// 或 https:// 开头')
      return
    }
    setCustomSaving(true)
    setCustomError(null)
    try {
      const res = await getAgentApi().agentAddCustomGateway?.({
        providerId,
        name: name || providerId,
        baseUrl,
        apiKey: apiKey || undefined
      })
      if (!res?.success) {
        setCustomError(res?.error || '保存失败')
        return
      }
      setCustomIds((prev) => new Set([...prev, providerId]))
      setCustomSpec({ providerId: '', name: '', baseUrl: '', apiKey: '' })
      setCustomOpen(false)
    } finally {
      setCustomSaving(false)
    }
  }

  const handleRemoveCustom = async (providerId: string): Promise<void> => {
    setBusyProvider(providerId)
    try {
      await getAgentApi().agentRemoveCustomGateway?.(providerId)
      setCustomIds((prev) => {
        const next = new Set(prev)
        next.delete(providerId)
        return next
      })
    } finally {
      setBusyProvider(null)
    }
  }

  const handleLogin = async (provider: AgentProvider, type: 'api_key' | 'oauth'): Promise<void> => {
    setBusyProvider(provider.id)
    const operation = await loginProvider(provider.id, type)
    setBusyProvider(null)
    if (operation) setDialogId(operation.id)
  }

  const handleLogout = async (provider: AgentProvider): Promise<void> => {
    setBusyProvider(provider.id)
    await logoutProvider(provider.id)
    setBusyProvider(null)
  }

  const handleRefresh = async (provider: AgentProvider): Promise<void> => {
    setBusyProvider(provider.id)
    await refreshProviderModels(provider.id)
    setBusyProvider(null)
  }

  const handleToggleDisabled = async (provider: AgentProvider): Promise<void> => {
    setBusyProvider(provider.id)
    await setProviderDisabled(provider.id, !provider.disabled)
    setBusyProvider(null)
  }

  const handleToggleFavorite = async (providerId: string, modelId: string): Promise<void> => {
    const key = `${providerId}:${modelId}`
    if (favBusy === key) return
    setFavBusy(key)
    const next = new Set(favoriteKeys)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    const favorites = [...next].map((entry) => {
      const sep = entry.indexOf(':')
      return { providerId: entry.slice(0, sep), modelId: entry.slice(sep + 1) }
    })
    await setFavoriteModels(favorites)
    setFavBusy(null)
  }

  const toggleProvider = (providerId: string): void => {
    setExpandedProviders((prev) => {
      const next = new Set(prev)
      if (next.has(providerId)) next.delete(providerId)
      else next.add(providerId)
      return next
    })
  }

  const startEditBaseUrl = (provider: AgentProvider): void => {
    setEditingBaseUrl(provider.id)
    setBaseUrlDraft(provider.baseUrl ?? '')
    setBaseUrlError(null)
  }

  const saveBaseUrl = async (provider: AgentProvider): Promise<void> => {
    const trimmed = baseUrlDraft.trim()
    if (trimmed && !/^https?:\/\//i.test(trimmed)) {
      setBaseUrlError('baseUrl 需要以 http:// 或 https:// 开头')
      return
    }
    setBaseUrlSaving(true)
    setBaseUrlError(null)
    const ok = await setProviderBaseUrl(provider.id, trimmed || null)
    setBaseUrlSaving(false)
    if (ok) {
      setEditingBaseUrl(null)
    } else {
      setBaseUrlError('保存失败')
    }
  }

  const isEndpointEditable = (provider: AgentProvider): boolean =>
    provider.id === 'magpie' || customIds.has(provider.id)

  const handleDialogSubmit = async (operationId: string, value: string): Promise<boolean> => {
    return respondProviderAuth(operationId, value)
  }

  const handleDialogCancel = async (operationId: string): Promise<boolean> => {
    return cancelProviderAuth(operationId)
  }

  const renderGroup = (title: string, list: AgentProvider[], defaultVisible: number): JSX.Element | null => {
    if (list.length === 0) return null
    const isExpanded = showAll[title] ?? false
    const visible = isExpanded ? list : list.slice(0, defaultVisible)
    const searching = query.trim().length > 0
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between px-0.5">
          <span className="text-label font-medium text-text-secondary">{title}</span>
          <span className="text-caption text-text-secondary">{list.length}</span>
        </div>
        {visible.map((provider) => {
          const isBusy = busyProvider === provider.id
          const running = runningByProvider[provider.id]
          const providerOpen = searching || expandedProviders.has(provider.id)
          const endpointEditable = isEndpointEditable(provider)
          const isEditingThis = editingBaseUrl === provider.id
          return (
            <div
              key={provider.id}
              className={`rounded-lg border border-white/70 bg-white/55 transition-colors hover:bg-white/75 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10 ${provider.disabled ? 'opacity-60' : ''}`}
            >
              <div className="flex items-start justify-between gap-3 px-3.5 py-2.5">
                <div
                  className="min-w-0 flex-1 cursor-pointer"
                  onClick={() => toggleProvider(provider.id)}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        provider.disabled ? 'bg-gray-300 dark:bg-gray-600' : provider.configured ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'
                      }`}
                    />
                    <span className={`truncate text-body font-medium ${provider.disabled ? 'text-text-secondary' : 'text-text-primary'}`}>
                      {provider.name}
                    </span>
                    <code className="truncate font-mono text-caption text-text-secondary">{provider.id}</code>
                    {provider.disabled && (
                      <span className="shrink-0 rounded bg-black/5 px-1.5 py-0.5 text-tiny text-text-secondary dark:bg-white/10">已停用</span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-text-secondary">
                    <span>{authLabel(provider)}</span>
                    <span>·</span>
                    <span>
                      {provider.availableModelCount}/{provider.modelCount} 模型
                    </span>
                    {endpointEditable && provider.baseUrl && (
                      <>
                        <span>·</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            startEditBaseUrl(provider)
                          }}
                          className="flex min-w-0 items-center gap-1 truncate transition-colors hover:text-primary"
                          title={provider.baseUrl}
                        >
                          <span className="truncate font-mono">{provider.baseUrl}</span>
                          <AppIcon name="edit" size={12} className="shrink-0 opacity-70" />
                        </button>
                      </>
                    )}
                    {running && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setDialogId(running.id)
                        }}
                        className="font-medium text-primary hover:underline"
                      >
                        认证中
                      </button>
                    )}
                  </div>
                  {provider.error && (
                    <div className="mt-1 break-words text-label text-rose-600 dark:text-rose-400">{provider.error}</div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {customIds.has(provider.id) && (
                    <button
                      type="button"
                      onClick={() => void handleRemoveCustom(provider.id)}
                      disabled={isBusy}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-40"
                      title="移除自定义供应商（重启后完全卸载）"
                    >
                      <AppIcon name="delete" size={15} />
                    </button>
                  )}
                  {provider.apiKeyAvailable && !endpointEditable && (
                    <button
                      type="button"
                      onClick={() => void handleLogin(provider, 'api_key')}
                      disabled={isBusy || Boolean(running)}
                      className="flex h-8 items-center gap-1 rounded-lg px-2.5 text-label font-medium text-text-secondary transition-colors hover:bg-black/5 hover:text-primary disabled:opacity-40 dark:hover:bg-white/10"
                      title="配置 API Key"
                    >
                      <AppIcon name="key" size={14} />
                      <span>Key</span>
                    </button>
                  )}
                  {provider.oauthAvailable && (
                    <button
                      type="button"
                      onClick={() => void handleLogin(provider, 'oauth')}
                      disabled={isBusy || Boolean(running)}
                      className="flex h-8 items-center gap-1 rounded-lg px-2.5 text-label font-medium text-text-secondary transition-colors hover:bg-black/5 hover:text-primary disabled:opacity-40 dark:hover:bg-white/10"
                      title={provider.oauthName || 'OAuth 登录'}
                    >
                      <AppIcon name="verified_user" size={14} />
                      <span>{provider.isSubscription ? '订阅' : 'OAuth'}</span>
                    </button>
                  )}
                  {provider.configured && (provider.authSource === 'stored' || provider.authSource === 'runtime') && (
                    <button
                      type="button"
                      onClick={() => void handleLogout(provider)}
                      disabled={isBusy}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-40"
                      title="退出登录"
                    >
                      <AppIcon name="logout" size={15} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleProvider(provider.id)
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-black/5 hover:text-primary dark:hover:bg-white/10"
                    title={providerOpen ? '收起模型列表' : '展开模型列表'}
                  >
                    <AppIcon
                      name="expand_more"
                      size={16}
                      className={`transition-transform ${providerOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRefresh(provider)}
                    disabled={isBusy}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-black/5 hover:text-primary disabled:opacity-40 dark:hover:bg-white/10"
                    title="刷新模型列表"
                  >
                    <AppIcon name="refresh" size={15} className={isBusy ? 'animate-spin' : ''} />
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!provider.disabled}
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleToggleDisabled(provider)
                    }}
                    disabled={isBusy || !provider.configured}
                    title={
                      !provider.configured
                        ? '接入供应商后才能启停'
                        : provider.disabled
                          ? '启用供应商'
                          : '停用供应商'
                    }
                    className={`relative ml-1 h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                      !provider.configured
                        ? 'bg-gray-200 dark:bg-gray-700'
                        : provider.disabled
                          ? 'bg-gray-300 dark:bg-gray-600'
                          : 'bg-primary'
                    }`}
                  >
                    <span
                      className={`absolute top-[2px] h-4 w-4 rounded-full bg-white shadow transition-all ${
                        provider.disabled || !provider.configured ? 'left-[2px]' : 'left-[18px]'
                      }`}
                    />
                  </button>
                </div>
              </div>
              {isEditingThis && (
                <div className="space-y-2 border-t border-black/[0.05] px-3.5 py-2.5 dark:border-white/10">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={baseUrlDraft}
                      onChange={(e) => setBaseUrlDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void saveBaseUrl(provider)
                        if (e.key === 'Escape') setEditingBaseUrl(null)
                      }}
                      placeholder="https://host/v1"
                      autoFocus
                      className={`min-w-0 flex-1 font-mono ${INPUT_CLASS}`}
                    />
                    <button
                      type="button"
                      onClick={() => void saveBaseUrl(provider)}
                      disabled={baseUrlSaving}
                      className="h-9 shrink-0 rounded-lg bg-primary px-3.5 text-label font-medium text-white shadow-soft transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {baseUrlSaving ? '…' : '保存'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingBaseUrl(null)}
                      className="h-9 shrink-0 rounded-lg border border-gray-200 bg-sidebar px-3 text-label text-text-secondary transition-colors hover:bg-gray-100 dark:border-white/10 dark:bg-white/5"
                    >
                      取消
                    </button>
                  </div>
                  {baseUrlError && <div className="text-label text-rose-600 dark:text-rose-400">{baseUrlError}</div>}
                </div>
              )}
              {inlineAuth && activeOperation && activeOperation.providerId === provider.id && (
                <div className="border-t border-black/[0.05] px-3.5 pb-3 dark:border-white/10">
                  <AgentAuthDialog
                    inline
                    operation={activeOperation}
                    onClose={() => setDialogId(null)}
                    onSubmit={handleDialogSubmit}
                    onCancel={handleDialogCancel}
                  />
                </div>
              )}
              {providerOpen && (
                <div className="space-y-1 border-t border-black/[0.05] px-3.5 py-2.5 dark:border-white/10">
                  {provider.models.length === 0 && (
                    <div className="text-label text-text-secondary">暂无模型目录</div>
                  )}
                  {provider.models.map((model) => {
                    const key = `${model.providerId}:${model.id}`
                    const fav = favoriteKeys.has(key)
                    return (
                      <div
                        key={key}
                        className={`flex items-center gap-2 py-0.5 text-label ${model.available || provider.disabled ? 'text-text-primary' : 'text-text-secondary/70'} ${provider.disabled ? 'opacity-70' : ''}`}
                      >
                        <button
                          type="button"
                          onClick={() => void handleToggleFavorite(provider.id, model.id)}
                          disabled={provider.disabled || favBusy === key}
                          title={fav ? '移出常用模型' : '加入常用模型'}
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10 ${
                            fav ? 'text-amber-500' : 'text-gray-300 hover:text-amber-400 dark:text-gray-600'
                          }`}
                        >
                          <AppIcon name="star" size={14} fill={fav ? 'currentColor' : 'none'} />
                        </button>
                        <span className="truncate">{model.name}</span>
                        {model.reasoning && <span className="shrink-0 text-tiny text-primary/80">思考</span>}
                        {model.input.includes('image') && <span className="shrink-0 text-tiny text-text-secondary">图像</span>}
                        <span className="ml-auto shrink-0 font-mono text-tiny text-text-secondary">
                          {model.contextWindow ? `${Math.round(model.contextWindow / 1000)}k` : ''}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
        {list.length > defaultVisible && (
          <button
            type="button"
            onClick={() => setShowAll((prev) => ({ ...prev, [title]: !isExpanded }))}
            className="text-label text-primary hover:opacity-80 transition-opacity"
          >
            {isExpanded ? '收起' : `显示全部 ${list.length} 个`}
          </button>
        )}
      </div>
    )
  }

  const hasConfiguredGroups = groups.connected.length > 0 || groups.attention.length > 0
  const showAvailableGroup =
    query.trim().length > 0 || !hasConfiguredGroups || availableExpanded

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <AppIcon
            name="search"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索供应商或模型"
            className={`w-full pl-9 pr-8 ${INPUT_CLASS}`}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-text-secondary hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/10"
              aria-label="清空搜索"
            >
              <AppIcon name="close" size={14} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setCustomError(null)
            setCustomOpen((prev) => !prev)
          }}
          className="flex h-9 shrink-0 items-center gap-1 rounded-lg border border-gray-200 bg-sidebar px-3 text-label font-medium text-text-primary transition-colors hover:border-primary/40 hover:text-primary dark:border-white/10 dark:bg-white/5"
        >
          <AppIcon name={customOpen ? 'close' : 'add'} size={14} />
          <span>{customOpen ? '收起' : '自定义'}</span>
        </button>
      </div>

      {customOpen && (
        <div className="space-y-2.5 rounded-lg border border-primary/25 bg-white/80 p-3.5 dark:border-white/15 dark:bg-white/5">
          <div className="text-body font-medium text-text-primary">添加自定义供应商</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              type="text"
              value={customSpec.name}
              onChange={(e) => setCustomSpec((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="名称（如 OpenRouter）"
              className={`w-full ${INPUT_CLASS}`}
            />
            <input
              type="text"
              value={customSpec.providerId}
              onChange={(e) => setCustomSpec((prev) => ({ ...prev, providerId: e.target.value }))}
              placeholder="providerId（如 openrouter）"
              className={`w-full font-mono ${INPUT_CLASS}`}
            />
            <input
              type="text"
              value={customSpec.baseUrl}
              onChange={(e) => setCustomSpec((prev) => ({ ...prev, baseUrl: e.target.value }))}
              placeholder="https://host/v1"
              className={`w-full font-mono ${INPUT_CLASS}`}
            />
            <input
              type="password"
              value={customSpec.apiKey}
              onChange={(e) => setCustomSpec((prev) => ({ ...prev, apiKey: e.target.value }))}
              placeholder="API Key（可选）"
              className={`w-full font-mono ${INPUT_CLASS}`}
            />
          </div>
          {customError && <div className="text-label text-rose-600 dark:text-rose-400">{customError}</div>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCustomOpen(false)}
              className="h-9 rounded-lg border border-gray-200 bg-sidebar px-3.5 text-label text-text-secondary transition-colors hover:bg-gray-100 dark:border-white/10 dark:bg-white/5"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleAddCustom()}
              disabled={customSaving}
              className="h-9 rounded-lg bg-primary px-4 text-label font-medium text-white shadow-soft transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {customSaving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2 rounded-lg border border-white/70 bg-white/55 px-3.5 py-2.5 dark:border-white/10 dark:bg-white/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <AppIcon name="star" size={14} className="text-amber-500" fill="currentColor" />
            <span className="text-label font-medium text-text-primary">默认模型集</span>
          </div>
          <span className="text-caption text-text-secondary">{favoriteModels.length}</span>
        </div>
        {favoriteModels.length === 0 ? (
          <div className="text-caption text-text-secondary">
            展开下方供应商并点亮星标即可置顶到模型选择器
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {favoriteModels.map(({ provider, model }) => (
              <div
                key={`${provider.id}:${model.id}`}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/80 bg-white/80 px-2.5 py-1 text-label shadow-2xs dark:border-white/10 dark:bg-white/10"
              >
                <span className="truncate font-medium text-text-primary">{model.name}</span>
                <span className="shrink-0 font-mono text-tiny text-text-secondary">{provider.id}</span>
                <button
                  type="button"
                  onClick={() => void handleToggleFavorite(provider.id, model.id)}
                  disabled={favBusy === `${provider.id}:${model.id}`}
                  title="移出默认模型集"
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-40"
                >
                  <AppIcon name="close" size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {snapshotLoading && providers.length === 0 && (
        <div className="py-2 text-label text-text-secondary">正在读取模型目录…</div>
      )}
      {!snapshotLoading && providers.length === 0 && (
        <div className="py-2 text-label text-text-secondary">没有可用的供应商目录</div>
      )}

      {renderGroup('已连接', groups.connected, 8)}
      {renderGroup('需要处理', groups.attention, 8)}

      {groups.available.length > 0 && (
        showAvailableGroup ? (
          <div className="space-y-2">
            {hasConfiguredGroups && !query.trim() && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setAvailableExpanded(false)}
                  className="text-caption text-text-secondary transition-colors hover:text-primary"
                >
                  收起可连接列表
                </button>
              </div>
            )}
            {renderGroup('可连接', groups.available, 8)}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAvailableExpanded(true)}
            className="flex w-full items-center justify-between rounded-lg border border-white/70 bg-white/45 px-3.5 py-2.5 text-left text-label text-text-secondary transition-colors hover:bg-white/75 hover:text-text-primary dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
          >
            <span>浏览其他可连接供应商（{groups.available.length}）</span>
            <AppIcon name="expand_more" size={16} />
          </button>
        )
      )}

      {!inlineAuth && (
        <AgentAuthDialog
          operation={activeOperation ?? null}
          onClose={() => setDialogId(null)}
          onSubmit={handleDialogSubmit}
          onCancel={handleDialogCancel}
        />
      )}
    </div>
  )
}
