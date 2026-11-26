import { useEffect, useState } from 'react'
import {
  PROVIDER_PRESETS,
  PROVIDER_PRESET_CATEGORIES,
  type ProviderPreset,
  type ProviderPresetCategory
} from '../../../../../shared/config/providerPresets'
import type {
  AgentCustomGatewaySpec,
  AgentGatewayApiType,
  AgentGatewayTestResult,
  AgentIpcApi,
  AgentProvider
} from '../../../types/agent'
import { parsePastedGatewayConfig } from '../../../utils/providerPasteParser'
import { AppIcon } from '../../icons/AppIcon'
import { Button, WORKBENCH_INPUT_CLASS } from '../../ui/FormControls'
import Modal, { ModalHeader } from '../../ui/Modal'
import { AgentProviderQuotaBar } from './AgentProviderQuotaBar'

const INPUT_CLASS = `${WORKBENCH_INPUT_CLASS} text-label`

function getAgentApi(): AgentIpcApi {
  return window.api as unknown as AgentIpcApi
}

const API_OPTIONS: Array<{ value: AgentGatewayApiType; label: string; hint: string }> = [
  { value: 'openai-completions', label: 'OpenAI Chat', hint: '/v1/chat/completions（最通用）' },
  { value: 'openai-responses', label: 'OpenAI Responses', hint: '/v1/responses（GPT-5 / Codex）' },
  { value: 'anthropic-messages', label: 'Anthropic Messages', hint: '/v1/messages（Claude 原生）' }
]

function slugifyId(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

interface AgentGatewayEditorModalProps {
  open: boolean
  editingProvider: AgentProvider | null
  existingIds: Set<string>
  onClose: () => void
  onSaved: () => void
}

export function AgentGatewayEditorModal({
  open,
  editingProvider,
  existingIds,
  onClose,
  onSaved
}: AgentGatewayEditorModalProps): JSX.Element | null {
  const isEditing = Boolean(editingProvider)

  const [category, setCategory] = useState<ProviderPresetCategory>('relay')
  const [selectedPreset, setSelectedPreset] = useState<ProviderPreset | null>(null)
  const [name, setName] = useState('')
  const [providerId, setProviderId] = useState('')
  const [idTouched, setIdTouched] = useState(false)
  const [api, setApi] = useState<AgentGatewayApiType>('openai-completions')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [clearExistingKey, setClearExistingKey] = useState(false)
  const [balanceUrl, setBalanceUrl] = useState('')
  const [balancePath, setBalancePath] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [pasteNotice, setPasteNotice] = useState<string | null>(null)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<AgentGatewayTestResult | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setTestResult(null)
    setPasteNotice(null)
    setShowKey(false)
    setClearExistingKey(false)

    if (editingProvider) {
      const preset = PROVIDER_PRESETS.find((p) => p.id === editingProvider.presetId) ?? null
      setSelectedPreset(preset)
      setName(editingProvider.name)
      setProviderId(editingProvider.id)
      setIdTouched(true)
      setApi(editingProvider.api ?? 'openai-completions')
      setBaseUrl(editingProvider.baseUrl ?? '')
      setApiKey('')
      setBalanceUrl(editingProvider.balanceUrl ?? '')
      setBalancePath(editingProvider.balancePath ?? '')
      setAdvancedOpen(Boolean(editingProvider.balanceUrl || editingProvider.balancePath))
    } else {
      setSelectedPreset(null)
      setName('')
      setProviderId('')
      setIdTouched(false)
      setApi('openai-completions')
      setBaseUrl('')
      setApiKey('')
      setBalanceUrl('')
      setBalancePath('')
      setAdvancedOpen(false)
    }
  }, [open, editingProvider])

  if (!open) return null

  const applyUniqueId = (baseId: string): string => {
    const clean = slugifyId(baseId) || 'custom-gateway'
    if (!existingIds.has(clean)) return clean
    let i = 2
    while (existingIds.has(`${clean}-${i}`)) i++
    return `${clean}-${i}`
  }

  const handleSelectPreset = (preset: ProviderPreset): void => {
    setSelectedPreset(preset)
    setName(preset.name)
    if (!idTouched) {
      setProviderId(applyUniqueId(preset.id))
    }
    setApi(preset.defaultApi)
    setBaseUrl(preset.defaultBaseUrl)
    setTestResult(null)
    setError(null)
  }

  const handlePasteText = (text: string): boolean => {
    const parsed = parsePastedGatewayConfig(text)
    if (!parsed) return false
    if (parsed.baseUrl) setBaseUrl(parsed.baseUrl)
    if (parsed.api) setApi(parsed.api)
    if (parsed.apiKey) {
      setApiKey(parsed.apiKey)
      setClearExistingKey(false)
    }
    if (!isEditing) {
      if (parsed.suggestedName && !name.trim()) setName(parsed.suggestedName)
      if (parsed.suggestedId && !idTouched) setProviderId(applyUniqueId(parsed.suggestedId))
    }
    setTestResult(null)
    setError(null)
    setPasteNotice(
      parsed.sourceType === 'curl'
        ? `已从 curl 命令自动提取端点${parsed.apiKey ? '与 Key' : ''}`
        : parsed.sourceType === 'env'
          ? `已从环境变量自动提取端点${parsed.apiKey ? '与 Key' : ''}`
          : '已自动规范化接口地址'
    )
    return true
  }

  const handlePasteClipboard = async (): Promise<void> => {
    try {
      const text = await navigator.clipboard.readText()
      if (!handlePasteText(text)) {
        setError('剪贴板中未识别到 curl 命令、环境变量或有效 URL')
      }
    } catch {
      setError('无法读取剪贴板，请直接粘贴到下方输入框')
    }
  }

  const resolvedApiKeyForPayload = (): string | undefined => {
    const trimmed = apiKey.trim()
    if (trimmed) return trimmed
    if (isEditing && !clearExistingKey) return undefined
    return ''
  }

  const handleTest = async (): Promise<void> => {
    const cleanUrl = baseUrl.trim()
    if (!cleanUrl || !/^https?:\/\//i.test(cleanUrl)) {
      setError('请先填写以 http:// 或 https:// 开头的 Base URL')
      return
    }
    setTesting(true)
    setError(null)
    setTestResult(null)
    try {
      const res = await getAgentApi().agentTestGatewayConnection?.({
        providerId: providerId.trim() || undefined,
        name: name.trim() || undefined,
        baseUrl: cleanUrl,
        apiKey: resolvedApiKeyForPayload(),
        api,
        balanceUrl: balanceUrl.trim() || undefined,
        balancePath: balancePath.trim() || undefined
      })
      if (!res?.success || !res.data) {
        setError(res?.error || '连接测试失败')
        return
      }
      setTestResult(res.data)
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    const cleanId = providerId.trim()
    const cleanUrl = baseUrl.trim()
    if (!cleanId || !cleanUrl) {
      setError('供应商标识与 Base URL 不能为空')
      return
    }
    if (!/^https?:\/\//i.test(cleanUrl)) {
      setError('Base URL 需要以 http:// 或 https:// 开头')
      return
    }
    if (!isEditing && !/^[a-zA-Z0-9_-]+$/.test(cleanId)) {
      setError('供应商标识仅支持字母、数字、- 和 _')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const spec: AgentCustomGatewaySpec = {
        providerId: cleanId,
        name: name.trim() || cleanId,
        baseUrl: cleanUrl,
        apiKey: resolvedApiKeyForPayload(),
        api,
        presetId: selectedPreset?.id,
        balanceUrl: balanceUrl.trim() || undefined,
        balancePath: balancePath.trim() || undefined
      }
      const res = await getAgentApi().agentAddCustomGateway?.(spec)
      if (!res?.success) {
        setError(res?.error || '保存失败')
        return
      }
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const categoryPresets = PROVIDER_PRESETS.filter((p) => p.category === category)

  return (
    <Modal open={open} onClose={onClose} size="lg" variant="glass" zIndexClass="z-[110]" className="max-w-2xl">
      <ModalHeader
        title={isEditing ? `编辑供应商 · ${editingProvider?.name}` : '添加第三方供应商 / 网关'}
        icon="hub"
        onClose={onClose}
      />

      <div className="max-h-[72vh] space-y-4 overflow-y-auto px-5 py-4">
        {!isEditing && (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1">
                {PROVIDER_PRESET_CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategory(cat.id)}
                    className={`rounded-lg px-2.5 py-1 text-label transition-colors ${
                      category === cat.id
                        ? 'bg-primary/10 font-medium text-primary'
                        : 'text-text-secondary hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/10'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void handlePasteClipboard()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/5 px-2.5 py-1 text-label font-medium text-primary transition-colors hover:bg-primary/10"
                title="粘贴商家文档中的 curl 命令或 export OPENAI_BASE_URL / API_KEY 环境变量"
              >
                <AppIcon name="content_paste" size={14} />
                <span>粘贴 curl / 环境变量导入</span>
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {categoryPresets.map((preset) => {
                const active = selectedPreset?.id === preset.id
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset)}
                    className={`rounded-lg border px-3 py-2 text-left transition-all ${
                      active
                        ? 'border-primary bg-primary/5 shadow-sm'
                        : 'border-black/[0.06] bg-white/60 hover:border-primary/40 hover:bg-white/85 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-label font-medium text-text-primary">
                        {preset.name}
                      </span>
                      <span className="shrink-0 rounded bg-black/5 px-1.5 py-0.5 font-mono text-tiny text-text-secondary dark:bg-white/10">
                        {preset.defaultApi === 'anthropic-messages'
                          ? 'Claude'
                          : preset.defaultApi === 'openai-responses'
                            ? 'Responses'
                            : 'OpenAI'}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-caption text-text-secondary">
                      {preset.description}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {pasteNotice && (
          <div className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-label text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
            <AppIcon name="check_circle" size={15} />
            <span>{pasteNotice}</span>
          </div>
        )}

        <div
          className="space-y-3 rounded-xl border border-black/[0.06] bg-white/60 p-3.5 dark:border-white/10 dark:bg-white/[0.04]"
          onPaste={(e) => {
            const text = e.clipboardData?.getData('text')
            if (text && (/^curl(?:\.exe)?\s/i.test(text.trim()) || /(?:BASE_URL|API_KEY|AUTH_TOKEN)=/i.test(text))) {
              if (handlePasteText(text)) {
                e.preventDefault()
              }
            }
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-label font-medium text-text-primary">显示名称</label>
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  const val = e.target.value
                  setName(val)
                  if (!isEditing && !idTouched) {
                    setProviderId(slugifyId(val))
                  }
                }}
                placeholder="例如：我的中转站 / OpenRouter"
                className={`w-full ${INPUT_CLASS}`}
              />
            </div>

            <div>
              <label className="mb-1 block text-label font-medium text-text-primary">
                供应商 ID
                {isEditing && <span className="ml-1.5 text-caption font-normal text-text-secondary">不可修改</span>}
              </label>
              <input
                type="text"
                value={providerId}
                disabled={isEditing}
                onChange={(e) => {
                  setIdTouched(true)
                  setProviderId(e.target.value)
                }}
                placeholder="例如：my-relay"
                className={`w-full font-mono disabled:opacity-60 ${INPUT_CLASS}`}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-label font-medium text-text-primary">API 协议类型</label>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
              {API_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setApi(opt.value)}
                  className={`rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                    api === opt.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-black/[0.06] bg-white/70 text-text-primary hover:border-primary/40 dark:border-white/10 dark:bg-white/5'
                  }`}
                >
                  <div className="text-label font-medium">{opt.label}</div>
                  <div className="truncate text-caption text-text-secondary">{opt.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="text-label font-medium text-text-primary">接口地址（Base URL）</label>
              {selectedPreset?.keysUrl && (
                <a
                  href={selectedPreset.keysUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-caption text-primary hover:underline"
                >
                  <span>获取 Key</span>
                  <AppIcon name="open_in_new" size={12} />
                </a>
              )}
            </div>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={
                selectedPreset?.baseUrlPlaceholder ??
                (api === 'anthropic-messages' ? 'https://your-relay.com' : 'https://your-relay.com/v1')
              }
              className={`w-full font-mono ${INPUT_CLASS}`}
            />
            <div className="mt-1 text-caption text-text-secondary">
              {api === 'anthropic-messages'
                ? 'Anthropic 协议会自动拼接 /v1/messages，通常填写域名根路径即可'
                : 'OpenAI 兼容接口通常以 /v1 结尾（也支持直接粘贴完整 /chat/completions 地址自动转换）'}
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="text-label font-medium text-text-primary">API Key</label>
              {isEditing && editingProvider?.hasStoredApiKey && !apiKey && (
                <button
                  type="button"
                  onClick={() => setClearExistingKey((prev) => !prev)}
                  className="text-caption text-text-secondary hover:text-rose-500"
                >
                  {clearExistingKey ? '已标记清除旧 Key（点此撤销）' : '清除已保存 Key'}
                </button>
              )}
            </div>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value)
                  setClearExistingKey(false)
                }}
                placeholder={
                  isEditing && editingProvider?.hasStoredApiKey
                    ? clearExistingKey
                      ? '保存后将清空旧 API Key'
                      : '已保存 API Key（留空保持不变，输入则覆盖）'
                    : selectedPreset?.keyPlaceholder ?? 'sk-...'
                }
                autoComplete="off"
                className={`w-full pr-9 font-mono ${INPUT_CLASS}`}
              />
              <button
                type="button"
                onClick={() => setShowKey((prev) => !prev)}
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-text-secondary hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/10"
                title={showKey ? '隐藏 Key' : '显示 Key'}
              >
                <AppIcon name={showKey ? 'visibility_off' : 'visibility'} size={15} />
              </button>
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setAdvancedOpen((prev) => !prev)}
              className="inline-flex items-center gap-1 text-caption font-medium text-text-secondary hover:text-primary"
            >
              <AppIcon
                name="expand_more"
                size={14}
                className={`transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
              />
              <span>自定义额度查询（可选，默认自动探测 Sub2API / New-API）</span>
            </button>
            {advancedOpen && (
              <div className="mt-2 grid grid-cols-1 gap-2 rounded-lg border border-black/[0.05] bg-white/50 p-2.5 dark:border-white/10 dark:bg-white/[0.03] sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-caption font-medium text-text-primary">
                    额度接口 URL
                  </label>
                  <input
                    type="text"
                    value={balanceUrl}
                    onChange={(e) => setBalanceUrl(e.target.value)}
                    placeholder="https://relay.com/api/usage/token"
                    className={`w-full font-mono ${INPUT_CLASS}`}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-caption font-medium text-text-primary">
                    JSON 路径表达式
                  </label>
                  <input
                    type="text"
                    value={balancePath}
                    onChange={(e) => setBalancePath(e.target.value)}
                    placeholder="$data.total_available / 500000"
                    className={`w-full font-mono ${INPUT_CLASS}`}
                  />
                </div>
                {selectedPreset?.balanceHint && (
                  <div className="sm:col-span-2 text-caption text-text-secondary">
                    提示：{selectedPreset.balanceHint}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {testResult && (
          <div
            className={`space-y-2 rounded-xl border p-3 ${
              testResult.ok
                ? 'border-emerald-200 bg-emerald-50/75 dark:border-emerald-500/30 dark:bg-emerald-500/10'
                : 'border-rose-200 bg-rose-50/75 dark:border-rose-500/30 dark:bg-rose-500/10'
            }`}
          >
            {testResult.ok ? (
              <>
                <div className="flex items-center gap-1.5 text-label font-medium text-emerald-700 dark:text-emerald-300">
                  <AppIcon name="check_circle" size={15} />
                  <span>
                    连接成功：拉取到 {testResult.modelCount} 个模型（已自动补全 {testResult.enrichedCount} 个模型的上下文/推理规格）
                  </span>
                </div>
                {testResult.sampleModels.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {testResult.sampleModels.map((m) => (
                      <code
                        key={m}
                        className="rounded bg-white/80 px-1.5 py-0.5 font-mono text-caption text-text-primary dark:bg-white/10"
                      >
                        {m}
                      </code>
                    ))}
                  </div>
                )}
                {testResult.quota && <AgentProviderQuotaBar quota={testResult.quota} />}
              </>
            ) : (
              <div className="space-y-1 text-label text-rose-700 dark:text-rose-300">
                <div className="flex items-start gap-1.5 font-medium">
                  <AppIcon name="error" size={15} className="mt-0.5 shrink-0" />
                  <span className="break-words">{testResult.error}</span>
                </div>
                {testResult.hint && (
                  <div className="pl-5 text-caption text-rose-600/90 dark:text-rose-200/80">
                    排查建议：{testResult.hint}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-label text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
            <AppIcon name="error" size={15} className="mt-0.5 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-black/[0.06] px-5 py-3 dark:border-white/10">
        <Button
          variant="secondary"
          onClick={() => void handleTest()}
          disabled={testing || saving}
          className="inline-flex items-center gap-1.5 text-label"
        >
          <AppIcon name={testing ? 'progress_activity' : 'play_arrow'} size={14} className={testing ? 'animate-spin' : ''} />
          <span>{testing ? '测试中…' : '测试连接与额度'}</span>
        </Button>

        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving} className="text-label">
            取消
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} disabled={saving} className="text-label">
            {saving ? '保存中…' : isEditing ? '保存更改' : '添加并拉取模型'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
