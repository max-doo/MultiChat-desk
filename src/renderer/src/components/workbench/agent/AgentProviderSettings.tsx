import { useEffect, useMemo, useState } from 'react'
import { useAgentSessionStore } from '../../../store/agentSessionStore'
import {
  THINKING_LABELS,
  type AgentAuthOperation,
  type AgentIpcApi,
  type AgentProvider,
  type AgentProviderModel
} from '../../../types/agent'
import { AppIcon } from '../../icons/AppIcon'
import { Button, WORKBENCH_INPUT_CLASS } from '../../ui/FormControls'
import { AgentAuthDialog } from './AgentAuthDialog'
import { AgentGatewayEditorModal } from './AgentGatewayEditorModal'
import { AgentProviderQuotaBar } from './AgentProviderQuotaBar'

const INPUT_CLASS = `${WORKBENCH_INPUT_CLASS} text-label`
const DEFAULT_VISIBLE_MODELS = 30

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

const API_LABELS: Record<string, string> = {
  'openai-completions': 'OpenAI Chat',
  'openai-responses': 'Responses',
  'anthropic-messages': 'Anthropic'
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

function formatThinkingHint(model: AgentProviderModel): string | null {
  if (!model.reasoning) return null
  const active = (model.thinkingLevels ?? []).filter((l) => l !== 'off')
  if (active.length === 0) return '思考'
  const labels = active.map((l) => THINKING_LABELS[l] ?? l)
  return `思考 (${labels.join('/')})`
}

function useAgentProviderSettingsState({ inlineAuth = false }: { inlineAuth?: boolean } = {}) {
  const snapshot = useAgentSessionStore((s) => s.snapshot)
  const snapshotLoading = useAgentSessionStore((s) => s.snapshotLoading)
  const authOperations = useAgentSessionStore((s) => s.authOperations)
  const providerQuotas = useAgentSessionStore((s) => s.providerQuotas)
  const quotasLoading = useAgentSessionStore((s) => s.quotasLoading)
  const loginProvider = useAgentSessionStore((s) => s.loginProvider)
  const respondProviderAuth = useAgentSessionStore((s) => s.respondProviderAuth)
  const cancelProviderAuth = useAgentSessionStore((s) => s.cancelProviderAuth)
  const logoutProvider = useAgentSessionStore((s) => s.logoutProvider)
  const refreshProviderModels = useAgentSessionStore((s) => s.refreshProviderModels)
  const setProviderBaseUrl = useAgentSessionStore((s) => s.setProviderBaseUrl)
  const setProviderDisabled = useAgentSessionStore((s) => s.setProviderDisabled)
  const setFavoriteModels = useAgentSessionStore((s) => s.setFavoriteModels)
  const fetchProviderQuotas = useAgentSessionStore((s) => s.fetchProviderQuotas)
  const refreshProviderQuota = useAgentSessionStore((s) => s.refreshProviderQuota)
  const setCredential = useAgentSessionStore((s) => s.setCredential)

  const [query, setQuery] = useState('')
  const [busyProvider, setBusyProvider] = useState<string | null>(null)
  const [quotaBusyProvider, setQuotaBusyProvider] = useState<string | null>(null)
  const [providerErrors, setProviderErrors] = useState<Record<string, string>>({})
  const [showAll, setShowAll] = useState<Record<string, boolean>>({})
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set())
  const [showAllModelsByProvider, setShowAllModelsByProvider] = useState<Record<string, boolean>>({})

  const [editingBaseUrl, setEditingBaseUrl] = useState<string | null>(null)
  const [baseUrlDraft, setBaseUrlDraft] = useState('')
  const [baseUrlSaving, setBaseUrlSaving] = useState(false)
  const [baseUrlError, setBaseUrlError] = useState<string | null>(null)

  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [keyDraft, setKeyDraft] = useState('')
  const [keySaving, setKeySaving] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)

  const [dialogId, setDialogId] = useState<string | null>(null)
  const [gatewayModalOpen, setGatewayModalOpen] = useState(false)
  const [editingGateway, setEditingGateway] = useState<AgentProvider | null>(null)
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
  const existingIds = useMemo(() => new Set(providers.map((p) => p.id)), [providers])

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

  const initListeners = useAgentSessionStore((s) => s.initListeners)
  useEffect(() => initListeners(), [initListeners])

  useEffect(() => {
    if (providers.length > 0) {
      void fetchProviderQuotas(false)
    }
  }, [providers.length, fetchProviderQuotas])

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
  const runningByProvider = useMemo(() => {
    const map: Record<string, AgentAuthOperation> = {}
    for (const op of Object.values(authOperations)) {
      if (op.status === 'running' || op.status === 'waiting') map[op.providerId] = op
    }
    return map
  }, [authOperations])

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
    setProviderErrors((prev) => {
      const next = { ...prev }
      delete next[provider.id]
      return next
    })
    try {
      const res = await getAgentApi().agentRefreshProviderModels(provider.id)
      if (!res.success) {
        setProviderErrors((prev) => ({
          ...prev,
          [provider.id]: res.error || '刷新模型失败'
        }))
      } else {
        await refreshProviderModels(provider.id)
      }
      if (provider.configured && provider.id !== 'magpie') {
        void handleRefreshQuota(provider.id)
      }
    } finally {
      setBusyProvider(null)
    }
  }

  const handleRefreshQuota = async (providerId: string): Promise<void> => {
    setQuotaBusyProvider(providerId)
    await refreshProviderQuota(providerId)
    setQuotaBusyProvider(null)
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

  const saveBaseUrl = async (provider: AgentProvider, overrideVal?: string | null): Promise<void> => {
    const targetVal = overrideVal === undefined ? baseUrlDraft.trim() : overrideVal
    if (targetVal && !/^https?:\/\//i.test(targetVal)) {
      setBaseUrlError('baseUrl 需要以 http:// 或 https:// 开头')
      return
    }
    setBaseUrlSaving(true)
    setBaseUrlError(null)
    const ok = await setProviderBaseUrl(provider.id, targetVal || null)
    setBaseUrlSaving(false)
    if (ok) {
      setEditingBaseUrl(null)
    } else {
      setBaseUrlError('保存失败')
    }
  }

  const startEditKey = (provider: AgentProvider): void => {
    setEditingKey(provider.id)
    setKeyDraft('')
    setKeyError(null)
  }

  const saveKey = async (provider: AgentProvider): Promise<void> => {
    const key = keyDraft.trim()
    if (!key) {
      setKeyError('API Key 不能为空')
      return
    }
    setKeySaving(true)
    setKeyError(null)
    const result = await setCredential(provider.id, { type: 'api_key', key })
    setKeySaving(false)
    if (result.ok) {
      setEditingKey(null)
      setKeyDraft('')
    } else {
      setKeyError(result.error || '保存失败')
    }
  }

  const handleDialogSubmit = async (operationId: string, value: string): Promise<boolean> => {
    return respondProviderAuth(operationId, value)
  }

  const handleDialogCancel = async (operationId: string): Promise<boolean> => {
    const cancelled = await cancelProviderAuth(operationId)
    if (cancelled) setDialogId(null)
    return cancelled
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
          const isCustom = Boolean(provider.isCustom || customIds.has(provider.id))
          const endpointEditable = Boolean(provider.endpointEditable ?? (provider.id === 'magpie' || isCustom))
          const isEditingThis = editingBaseUrl === provider.id
          const providerOpen = searching || expandedProviders.has(provider.id)
          const quota = providerQuotas[provider.id]
          const hasCustomBaseOverride =
            Boolean(provider.defaultBaseUrl && provider.baseUrl && provider.baseUrl !== provider.defaultBaseUrl)
          const inlineError = providerErrors[provider.id] || provider.error

          const showAllModels = Boolean(showAllModelsByProvider[provider.id]) || searching
          const visibleModels = showAllModels
            ? provider.models
            : provider.models.slice(0, DEFAULT_VISIBLE_MODELS)

          return (
            <div
              key={provider.id}
              className={`rounded-lg border border-white/70 bg-white/55 transition-colors hover:bg-white/75 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10 ${provider.disabled ? 'opacity-60' : ''}`}
            >
              <div className="px-3.5 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div
                    className="min-w-0 flex-1 cursor-pointer"
                    onClick={() => toggleProvider(provider.id)}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          provider.disabled
                            ? 'bg-gray-300 dark:bg-gray-600'
                            : provider.configured
                              ? 'bg-emerald-500'
                              : 'bg-gray-300 dark:bg-gray-600'
                        }`}
                      />
                      <span className={`truncate text-body font-medium ${provider.disabled ? 'text-text-secondary' : 'text-text-primary'}`}>
                        {provider.name}
                      </span>
                      <code className="truncate font-mono text-caption text-text-secondary">{provider.id}</code>
                      {provider.api && (
                        <span className="rounded bg-black/5 px-1.5 py-0.5 text-tiny text-text-secondary dark:bg-white/10">
                          {API_LABELS[provider.api] ?? provider.api}
                        </span>
                      )}
                      {provider.disabled && (
                        <span className="shrink-0 rounded bg-black/5 px-1.5 py-0.5 text-tiny text-text-secondary dark:bg-white/10">
                          已停用
                        </span>
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
                              if (isCustom) {
                                setEditingGateway(provider)
                                setGatewayModalOpen(true)
                              } else {
                                startEditBaseUrl(provider)
                              }
                            }}
                            className="flex min-w-0 max-w-full items-center gap-1 truncate transition-colors hover:text-primary"
                            title={isCustom ? '编辑网关配置' : `修改接口地址（当前：${provider.baseUrl}）`}
                          >
                            <span className="truncate font-mono">{provider.baseUrl}</span>
                            <AppIcon name="edit" size={12} className="shrink-0 opacity-70" />
                          </button>
                          {hasCustomBaseOverride && !isCustom && (
                            <span className="rounded bg-amber-500/10 px-1 py-0.5 text-tiny text-amber-700 dark:text-amber-300">
                              自定义端点
                            </span>
                          )}
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

                    {inlineError && (
                      <div className="mt-1 break-words text-label text-rose-600 dark:text-rose-400">
                        {inlineError}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {isCustom && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingGateway(provider)
                            setGatewayModalOpen(true)
                          }}
                          disabled={isBusy}
                          className="flex h-8 items-center gap-1 rounded-lg px-2.5 text-label font-medium text-text-secondary transition-colors hover:bg-black/5 hover:text-primary disabled:opacity-40 dark:hover:bg-white/10"
                          title="编辑供应商配置、协议、Key 与额度接口"
                        >
                          <AppIcon name="edit" size={14} />
                          <span>编辑</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRemoveCustom(provider.id)}
                          disabled={isBusy}
                          className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-40"
                          title="移除自定义供应商"
                        >
                          <AppIcon name="delete" size={15} />
                        </button>
                      </>
                    )}
                    {provider.apiKeyAvailable && !isCustom && provider.id !== 'magpie' && (
                      <button
                        type="button"
                        onClick={() => {
                          if (editingKey === provider.id) setEditingKey(null)
                          else startEditKey(provider)
                        }}
                        disabled={isBusy}
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
                        <span>{provider.isSubscription ? '订阅登录' : 'OAuth'}</span>
                      </button>
                    )}
                    {provider.configured && (provider.authSource === 'stored' || provider.authSource === 'runtime') && !isCustom && (
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
                      title="刷新模型列表与额度"
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

                {provider.configured && provider.id !== 'magpie' && !provider.disabled && (
                  <AgentProviderQuotaBar
                    quota={quota}
                    loading={quotaBusyProvider === provider.id || (quotasLoading && !quota)}
                    onRefresh={() => void handleRefreshQuota(provider.id)}
                  />
                )}
              </div>

              {isEditingThis && !isCustom && (
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
                      placeholder={provider.defaultBaseUrl || 'https://host/v1'}
                      autoFocus
                      className={`min-w-0 flex-1 font-mono ${INPUT_CLASS}`}
                    />
                    <Button
                      variant="primary"
                      onClick={() => void saveBaseUrl(provider)}
                      disabled={baseUrlSaving}
                      className="shrink-0 px-3.5 text-label"
                    >
                      {baseUrlSaving ? '…' : '保存'}
                    </Button>
                    {hasCustomBaseOverride && (
                      <Button
                        variant="secondary"
                        onClick={() => void saveBaseUrl(provider, null)}
                        disabled={baseUrlSaving}
                        className="shrink-0 px-3 text-label"
                        title={`恢复默认端点：${provider.defaultBaseUrl}`}
                      >
                        <AppIcon name="restart_alt" size={14} />
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      onClick={() => setEditingBaseUrl(null)}
                      className="shrink-0 px-3 text-label"
                    >
                      取消
                    </Button>
                  </div>
                  {baseUrlError && <div className="text-label text-rose-600 dark:text-rose-400">{baseUrlError}</div>}
                </div>
              )}

              {editingKey === provider.id && (
                <div className="space-y-2 border-t border-black/[0.05] px-3.5 py-2.5 dark:border-white/10">
                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      value={keyDraft}
                      onChange={(e) => setKeyDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void saveKey(provider)
                        if (e.key === 'Escape') setEditingKey(null)
                      }}
                      placeholder="输入 API Key"
                      autoFocus
                      autoComplete="off"
                      className={`min-w-0 flex-1 font-mono ${INPUT_CLASS}`}
                    />
                    <Button
                      variant="primary"
                      onClick={() => void saveKey(provider)}
                      disabled={keySaving}
                      className="shrink-0 px-3.5 text-label"
                    >
                      {keySaving ? '…' : '保存'}
                    </Button>
                  </div>
                  {keyError && <div className="text-label text-rose-600 dark:text-rose-400">{keyError}</div>}
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
                    <div className="text-label text-text-secondary">
                      暂无模型目录（可点击右上角刷新按钮或编辑检查端点）
                    </div>
                  )}
                  {visibleModels.map((model) => {
                    const key = `${model.providerId}:${model.id}`
                    const fav = favoriteKeys.has(key)
                    const thinkingText = formatThinkingHint(model)
                    return (
                      <div key={key}>
                        <div
                          className={`flex items-center gap-2 py-0.5 text-label ${
                            model.available || provider.disabled ? 'text-text-primary' : 'text-text-secondary/70'
                          } ${provider.disabled ? 'opacity-70' : ''}`}
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
                          <span className="min-w-0 truncate" title={model.id}>
                            {model.name}
                          </span>
                          {thinkingText && (
                            <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-tiny text-primary">
                              {thinkingText}
                            </span>
                          )}
                          {model.input.includes('image') && (
                            <span className="shrink-0 rounded bg-black/5 px-1.5 py-0.5 text-tiny text-text-secondary dark:bg-white/10">
                              图像
                            </span>
                          )}
                          <span className="ml-auto shrink-0 font-mono text-tiny text-text-secondary">
                            {model.contextWindow ? `${Math.round(model.contextWindow / 1000)}k` : ''}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                  {!showAllModels && provider.models.length > DEFAULT_VISIBLE_MODELS && (
                    <button
                      type="button"
                      onClick={() =>
                        setShowAllModelsByProvider((prev) => ({ ...prev, [provider.id]: true }))
                      }
                      className="pt-1 text-caption font-medium text-primary hover:underline"
                    >
                      展开其余 {provider.models.length - DEFAULT_VISIBLE_MODELS} 个模型
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {list.length > defaultVisible && (
          <button
            type="button"
            onClick={() => setShowAll((prev) => ({ ...prev, [title]: !isExpanded }))}
            className="text-label text-primary transition-opacity hover:opacity-80"
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

  return {
    inlineAuth,
    query,
    setQuery,
    quotasLoading,
    fetchProviderQuotas,
    favoriteModels,
    favBusy,
    handleToggleFavorite,
    snapshotLoading,
    providers,
    renderGroup,
    groups,
    showAvailableGroup,
    hasConfiguredGroups,
    setAvailableExpanded,
    gatewayModalOpen,
    editingGateway,
    existingIds,
    setGatewayModalOpen,
    setEditingGateway,
    activeOperation,
    setDialogId,
    handleDialogSubmit,
    handleDialogCancel
  }
}

export type AgentProviderSettingsState = ReturnType<typeof useAgentProviderSettingsState>

export { useAgentProviderSettingsState }

export function AgentProviderToolbar({ state }: { state: AgentProviderSettingsState }): JSX.Element {
  const {
    query,
    setQuery,
    quotasLoading,
    fetchProviderQuotas,
    setEditingGateway,
    setGatewayModalOpen
  } = state
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[200px] flex-1">
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
        onClick={() => void fetchProviderQuotas(true)}
        disabled={quotasLoading}
        className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-sidebar px-3 text-label font-medium text-text-secondary transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-45 dark:border-white/10 dark:bg-white/5"
        title="刷新所有已连接订阅与网关额度"
      >
        <AppIcon name="refresh" size={14} className={quotasLoading ? 'animate-spin' : ''} />
        <span>刷新额度</span>
      </button>
      <button
        type="button"
        onClick={() => {
          setEditingGateway(null)
          setGatewayModalOpen(true)
        }}
        className="flex h-9 shrink-0 items-center gap-1 rounded-lg bg-primary px-3 text-label font-medium text-white shadow-soft transition-opacity hover:opacity-90"
      >
        <AppIcon name="add" size={14} />
        <span>添加供应商</span>
      </button>
    </div>
  )
}

export function AgentProviderContent({ state }: { state: AgentProviderSettingsState }): JSX.Element {
  const {
    favoriteModels,
    favBusy,
    handleToggleFavorite,
    snapshotLoading,
    providers,
    renderGroup,
    groups,
    showAvailableGroup,
    hasConfiguredGroups,
    query,
    setAvailableExpanded,
    gatewayModalOpen,
    editingGateway,
    existingIds,
    setGatewayModalOpen,
    setEditingGateway,
    fetchProviderQuotas,
    inlineAuth,
    activeOperation,
    setDialogId,
    handleDialogSubmit,
    handleDialogCancel
  } = state
  return (
    <div className="space-y-4">
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
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/80 bg-white/80 px-2.5 py-1 text-label shadow-sm dark:border-white/10 dark:bg-white/10"
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

      {renderGroup('已连接', groups.connected, 12)}
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
            {renderGroup('可连接（内置官方 / 订阅）', groups.available, 10)}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAvailableExpanded(true)}
            className="flex w-full items-center justify-between rounded-lg border border-white/70 bg-white/45 px-3.5 py-2.5 text-left text-label text-text-secondary transition-colors hover:bg-white/75 hover:text-text-primary dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
          >
            <span>浏览其他内置可连接供应商（{groups.available.length}）</span>
            <AppIcon name="expand_more" size={16} />
          </button>
        )
      )}

      <AgentGatewayEditorModal
        open={gatewayModalOpen}
        editingProvider={editingGateway}
        existingIds={existingIds}
        onClose={() => {
          setGatewayModalOpen(false)
          setEditingGateway(null)
        }}
        onSaved={() => {
          void fetchProviderQuotas(true)
        }}
      />

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

export function AgentProviderSettings({ inlineAuth = false }: { inlineAuth?: boolean } = {}): JSX.Element {
  const state = useAgentProviderSettingsState({ inlineAuth })
  return (
    <div className="space-y-4">
      <AgentProviderToolbar state={state} />
      <AgentProviderContent state={state} />
    </div>
  )
}
