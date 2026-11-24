import { useEffect, useMemo, useState } from 'react'
import { Key, LogOut, Plus, RefreshCw, Search, ShieldCheck, Trash2 } from 'lucide-react'
import { useAgentSessionStore } from '../../../store/agentSessionStore'
import type { AgentAuthOperation } from '../../../types/agent'
import type { AgentProvider, AgentIpcApi } from '../../../types/agent'
import { AgentAuthDialog } from './AgentAuthDialog'

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

export function AgentProviderSettings(): JSX.Element {
  const snapshot = useAgentSessionStore((s) => s.snapshot)
  const snapshotLoading = useAgentSessionStore((s) => s.snapshotLoading)
  const authOperations = useAgentSessionStore((s) => s.authOperations)
  const loginProvider = useAgentSessionStore((s) => s.loginProvider)
  const respondProviderAuth = useAgentSessionStore((s) => s.respondProviderAuth)
  const cancelProviderAuth = useAgentSessionStore((s) => s.cancelProviderAuth)
  const logoutProvider = useAgentSessionStore((s) => s.logoutProvider)
  const refreshProviderModels = useAgentSessionStore((s) => s.refreshProviderModels)

  const [query, setQuery] = useState('')
  const [busyProvider, setBusyProvider] = useState<string | null>(null)
  const [showAll, setShowAll] = useState<Record<string, boolean>>({})
  const [dialogId, setDialogId] = useState<string | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [customSaving, setCustomSaving] = useState(false)
  const [customSpec, setCustomSpec] = useState({ providerId: '', name: '', baseUrl: '', apiKey: '' })
  const [customError, setCustomError] = useState<string | null>(null)
  const [customIds, setCustomIds] = useState<Set<string>>(new Set())

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return providers
    return providers.filter(
      (provider) =>
        provider.name.toLowerCase().includes(q) ||
        provider.id.toLowerCase().includes(q) ||
        provider.models.some((model) => model.name.toLowerCase().includes(q) || model.id.toLowerCase().includes(q))
    )
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
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between px-0.5">
          <span className="text-caption font-medium text-text-secondary">{title}</span>
          <span className="text-caption text-text-secondary">{list.length}</span>
        </div>
        {visible.map((provider) => {
          const isBusy = busyProvider === provider.id
          const running = runningByProvider[provider.id]
          return (
            <div key={provider.id} className="rounded-lg border border-gray-100 bg-white/60">
              <div className="flex items-start justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        provider.configured ? 'bg-emerald-500' : 'bg-gray-300'
                      }`}
                    />
                    <span className="text-body text-text-primary truncate">{provider.name}</span>
                    <code className="text-tiny text-text-secondary truncate">{provider.id}</code>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-caption text-text-secondary">
                    <span>{authLabel(provider)}</span>
                    <span>·</span>
                    <span>
                      {provider.availableModelCount}/{provider.modelCount} 个模型
                    </span>
                    {running && (
                      <button
                        type="button"
                        onClick={() => setDialogId(running.id)}
                        className="text-primary hover:opacity-80 transition-opacity"
                      >
                        认证中
                      </button>
                    )}
                  </div>
                  {provider.error && (
                    <div className="mt-1 text-caption text-rose-600 break-words">{provider.error}</div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {customIds.has(provider.id) && (
                    <button
                      type="button"
                      onClick={() => void handleRemoveCustom(provider.id)}
                      disabled={isBusy}
                      className="w-6 h-6 rounded-md text-text-secondary hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40 flex items-center justify-center transition-colors"
                      title="移除自定义网关（重启后完全卸载）"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                  {provider.apiKeyAvailable && (
                    <button
                      type="button"
                      onClick={() => void handleLogin(provider, 'api_key')}
                      disabled={isBusy || Boolean(running)}
                      className="px-2 py-1 rounded-md text-caption text-text-secondary hover:text-primary hover:bg-blue-50/60 disabled:opacity-40 transition-colors flex items-center gap-1"
                      title="配置 API Key"
                    >
                      <Key className="w-3 h-3" />
                      Key
                    </button>
                  )}
                  {provider.oauthAvailable && (
                    <button
                      type="button"
                      onClick={() => void handleLogin(provider, 'oauth')}
                      disabled={isBusy || Boolean(running)}
                      className="px-2 py-1 rounded-md text-caption text-text-secondary hover:text-primary hover:bg-blue-50/60 disabled:opacity-40 transition-colors flex items-center gap-1"
                      title={provider.oauthName || 'OAuth 登录'}
                    >
                      <ShieldCheck className="w-3 h-3" />
                      {provider.isSubscription ? '订阅' : 'OAuth'}
                    </button>
                  )}
                  {provider.configured && (provider.authSource === 'stored' || provider.authSource === 'runtime') && (
                    <button
                      type="button"
                      onClick={() => void handleLogout(provider)}
                      disabled={isBusy}
                      className="w-6 h-6 rounded-md text-text-secondary hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40 flex items-center justify-center transition-colors"
                      title="退出登录"
                    >
                      <LogOut className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleRefresh(provider)}
                    disabled={isBusy}
                    className="w-6 h-6 rounded-md text-text-secondary hover:text-primary hover:bg-blue-50/60 disabled:opacity-40 flex items-center justify-center transition-colors"
                    title="刷新模型列表"
                  >
                    <RefreshCw className={`w-3 h-3 ${isBusy ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>
              <div className="border-t border-gray-100 px-3 py-2 space-y-1">
                {provider.models.length === 0 && (
                  <div className="text-caption text-text-secondary">暂无模型目录</div>
                )}
                {provider.models.map((model) => (
                  <div
                    key={`${model.providerId}:${model.id}`}
                    className={`flex items-center gap-2 text-caption ${model.available ? 'text-text-primary' : 'text-text-secondary/70'}`}
                  >
                    <span className="w-1 h-1 rounded-full bg-current shrink-0" />
                    <span className="truncate">{model.name}</span>
                    {model.reasoning && <span className="shrink-0 text-tiny text-primary/70">思考</span>}
                    {model.input.includes('image') && <span className="shrink-0 text-tiny text-text-secondary">图像</span>}
                    <span className="ml-auto shrink-0 font-mono text-tiny">
                      {model.contextWindow ? `${Math.round(model.contextWindow / 1000)}k` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
        {list.length > defaultVisible && (
          <button
            type="button"
            onClick={() => setShowAll((prev) => ({ ...prev, [title]: !isExpanded }))}
            className="text-caption text-primary hover:opacity-80 transition-opacity"
          >
            {isExpanded ? '收起' : `显示全部 ${list.length} 个`}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-text-secondary absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索供应商或模型"
          className="w-full pl-8 pr-3 py-1.5 rounded-lg glass-panel text-label text-text-primary placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-caption text-text-secondary">自定义 OpenAI 兼容网关</span>
        <button
          type="button"
          onClick={() => {
            setCustomError(null)
            setCustomOpen((prev) => !prev)
          }}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-caption text-text-secondary hover:text-primary hover:bg-blue-50/60 transition-colors"
        >
          <Plus className="w-3 h-3" />
          添加网关
        </button>
      </div>

      {customOpen && (
        <div className="rounded-lg border border-gray-100 bg-white/60 p-3 space-y-2">
          <input
            type="text"
            value={customSpec.providerId}
            onChange={(e) => setCustomSpec((prev) => ({ ...prev, providerId: e.target.value }))}
            placeholder="providerId（如 my-gateway）"
            className="w-full px-2 py-1.5 rounded-md glass-panel text-label text-text-primary placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 font-mono"
          />
          <input
            type="text"
            value={customSpec.name}
            onChange={(e) => setCustomSpec((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="显示名称（可选）"
            className="w-full px-2 py-1.5 rounded-md glass-panel text-label text-text-primary placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <input
            type="text"
            value={customSpec.baseUrl}
            onChange={(e) => setCustomSpec((prev) => ({ ...prev, baseUrl: e.target.value }))}
            placeholder="http://host:port/v1"
            className="w-full px-2 py-1.5 rounded-md glass-panel text-label text-text-primary placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 font-mono"
          />
          <input
            type="password"
            value={customSpec.apiKey}
            onChange={(e) => setCustomSpec((prev) => ({ ...prev, apiKey: e.target.value }))}
            placeholder="API Key（可选）"
            className="w-full px-2 py-1.5 rounded-md glass-panel text-label text-text-primary placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 font-mono"
          />
          {customError && <div className="text-caption text-rose-600">{customError}</div>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCustomOpen(false)}
              className="px-2 py-1 rounded-md text-caption text-text-secondary hover:text-text-primary transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleAddCustom()}
              disabled={customSaving}
              className="px-3 py-1 rounded-md bg-primary text-white text-caption font-medium hover:opacity-90 disabled:opacity-50 transition-colors"
            >
              {customSaving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      )}

      {snapshotLoading && providers.length === 0 && (
        <div className="text-caption text-text-secondary py-2">正在读取模型目录…</div>
      )}
      {!snapshotLoading && providers.length === 0 && (
        <div className="text-caption text-text-secondary py-2">没有可用的供应商目录</div>
      )}

      {renderGroup('已连接', groups.connected, 8)}
      {renderGroup('需要处理', groups.attention, 8)}
      {renderGroup('可连接', groups.available, 6)}

      <AgentAuthDialog
        operation={activeOperation ?? null}
        onClose={() => setDialogId(null)}
        onSubmit={handleDialogSubmit}
        onCancel={handleDialogCancel}
      />
    </div>
  )
}
