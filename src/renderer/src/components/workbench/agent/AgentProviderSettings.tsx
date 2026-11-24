import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Key, LogOut, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { useAgentSessionStore } from '../../../store/agentSessionStore'
import type { AgentProvider } from '../../../types/agent'
import { AgentAuthDialog } from './AgentAuthDialog'

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
  const fetchSnapshot = useAgentSessionStore((s) => s.fetchSnapshot)
  const loginProvider = useAgentSessionStore((s) => s.loginProvider)
  const respondProviderAuth = useAgentSessionStore((s) => s.respondProviderAuth)
  const cancelProviderAuth = useAgentSessionStore((s) => s.cancelProviderAuth)
  const logoutProvider = useAgentSessionStore((s) => s.logoutProvider)
  const refreshProviderModels = useAgentSessionStore((s) => s.refreshProviderModels)

  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [busyProvider, setBusyProvider] = useState<string | null>(null)
  const [showAll, setShowAll] = useState<Record<string, boolean>>({})
  const [dialogId, setDialogId] = useState<string | null>(null)

  useEffect(() => {
    void fetchSnapshot()
  }, [fetchSnapshot])

  const providers = snapshot?.providers ?? []

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
          const isOpen = expanded[provider.id] ?? false
          const isBusy = busyProvider === provider.id
          const running = Object.values(authOperations).find(
            (op) => op.providerId === provider.id && (op.status === 'running' || op.status === 'waiting')
          )
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
                  <button
                    type="button"
                    onClick={() => setExpanded((prev) => ({ ...prev, [provider.id]: !isOpen }))}
                    className="w-6 h-6 rounded-md text-text-secondary hover:text-primary hover:bg-blue-50/60 flex items-center justify-center transition-colors"
                    title="模型列表"
                  >
                    {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              {isOpen && (
                <div className="border-t border-gray-100 px-3 py-2 space-y-1 max-h-52 overflow-y-auto">
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
              )}
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
