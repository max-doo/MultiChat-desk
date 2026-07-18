import { useState, useCallback, useEffect } from 'react'
import { useAppStore, type SummaryPrompt, type SummaryModel, type ApiProvider, type ApiConfig } from '../store/appStore'
import logo from '../assets/logo.png'
import CustomDropdown, { type DropdownOption } from './CustomDropdown'
import ConfirmModal from './ConfirmModal'
import ShortcutRecorder from './ShortcutRecorder'
import ImportCacheConfirmModal from './ImportCacheConfirmModal'
import AboutSection from './AboutSection'
import { openUpdateRelease, useUpdateReminder } from '../hooks/useUpdateState'

interface SettingsDrawerProps {
  isOpen: boolean
  onClose: () => void
}

/**
 * 校验 baseUrl 格式：必须以 http:// 或 https:// 开头。
 * 返回 null 表示通过，返回字符串表示错误信息。
 * 不强制要求 /v1 结尾（不同供应商路径不同，如 OpenRouter /api/v1、Gemini /v1beta）。
 */
function validateBaseUrl(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return 'Base URL 不能为空'
  if (!/^https?:\/\//i.test(trimmed)) return 'Base URL 需以 http:// 或 https:// 开头'
  return null
}

// 快捷键 key → 中文标签，用于冲突提示
const SHORTCUT_LABELS: Record<string, string> = {
  summon: '唤醒快捷助手',
  summarize: '划词召唤 - 总结',
  polish: '划词召唤 - 润色',
  translate: '划词召唤 - 翻译',
  raw: '划词召唤 - 纯文本入框',
  search: '划词召唤 - 搜索'
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function getSummaryModelKey(model: SummaryModel): string {
  return `${model.providerId}\u0000${model.id}`
}

function uniqueSummaryModels(models: SummaryModel[]): SummaryModel[] {
  const seen = new Set<string>()
  return models.filter((model) => {
    const key = getSummaryModelKey(model)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// 提示词编辑弹窗组件
interface PromptEditorModalProps {
  isOpen: boolean
  onClose: () => void
  prompt: SummaryPrompt | null
  onSave: (prompt: SummaryPrompt) => Promise<void>
  isNew?: boolean
}

function PromptEditorModal({ isOpen, onClose, prompt, onSave, isNew }: PromptEditorModalProps): JSX.Element | null {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [promptText, setPromptText] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // 当弹窗打开时初始化表单数据
  useEffect(() => {
    if (isOpen) {
      if (prompt) {
        setName(prompt.name)
        setDescription(prompt.description || '')
        setPromptText(prompt.prompt)
      } else {
        setName('')
        setDescription('')
        setPromptText('')
      }
    }
  }, [isOpen, prompt])

  if (!isOpen) return null

  const handleSave = async (): Promise<void> => {
    if (!name.trim()) return
    setIsSaving(true)
    try {
      await onSave({
        id: prompt?.id || String(Date.now()),
        name: name.trim(),
        description: description.trim() ? description.trim() : undefined,
        prompt: promptText.trim(),
        isDefault: prompt?.isDefault || false
      })
      onClose()
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* 遮罩层 */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* 弹窗内容 */}
      <div className="relative w-[600px] max-h-[80vh] glass-panel-heavy rounded-2xl shadow-float flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-white/60">
          <h3 className="text-lg font-semibold text-text-primary">
            {isNew ? '新增总结提示词' : '编辑总结提示词'}
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-text-secondary hover:text-text-primary hover:bg-black/5 transition-colors"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* 表单内容 */}
        <div className="flex-1 p-4 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="输入提示词名称"
              className="w-full px-3 py-2 glass-panel rounded-lg text-text-primary placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="一句话描述这个提示词的用途（可选）"
              rows={3}
              className="w-full px-3 py-2 glass-panel rounded-lg text-text-primary placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none text-sm transition-all"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">提示词内容</label>
            <textarea
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              placeholder="输入提示词内容..."
              rows={12}
              className="w-full px-3 py-2 glass-panel rounded-lg text-text-primary placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none font-mono text-sm transition-all"
            />
          </div>
        </div>

        {/* 底部操作按钮 */}
        <div className="flex justify-end gap-3 p-4 border-t border-white/60">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-full glass-panel text-text-primary hover:bg-black/5 transition-colors text-sm"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || isSaving}
            className="px-5 py-2 rounded-full bg-primary text-white font-medium shadow-soft hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

// 供应商编辑弹窗组件
interface ProviderEditorModalProps {
  isOpen: boolean
  onClose: () => void
  provider: ApiProvider | null
  onSave: (provider: ApiProvider) => void
  isNew?: boolean
}

function ProviderEditorModal({ isOpen, onClose, provider, onSave, isNew }: ProviderEditorModalProps): JSX.Element | null {
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrlError, setBaseUrlError] = useState('')

  useEffect(() => {
    if (isOpen) {
      setName(provider?.name || '')
      setBaseUrl(provider?.baseUrl || '')
      setApiKey(provider?.apiKey || '')
      setBaseUrlError('')
    }
  }, [isOpen, provider])

  if (!isOpen) return null

  const handleSave = (): void => {
    if (!name.trim() || !apiKey.trim()) return
    // baseUrl 格式校验：失败不关闭弹窗，显示红字错误
    const urlError = validateBaseUrl(baseUrl)
    if (urlError) {
      setBaseUrlError(urlError)
      return
    }
    onSave({
      id: provider?.id || `provider-${Date.now()}`,
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      enabled: provider ? provider.enabled : true
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-[450px] glass-panel-heavy rounded-2xl shadow-float flex flex-col p-5 space-y-4">
        <h3 className="text-lg font-semibold text-text-primary">{isNew ? '新增供应商' : '编辑供应商'}</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：OpenRouter"
              className="w-full px-3 py-2 glass-panel rounded-lg text-text-primary placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/30 text-sm transition-all"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">Base URL</label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => { setBaseUrl(e.target.value); setBaseUrlError('') }}
              placeholder="https://api.openai.com/v1"
              className={`w-full px-3 py-2 glass-panel rounded-lg text-text-primary placeholder-gray-400 focus:outline-none focus:ring-2 text-sm transition-all ${baseUrlError ? 'ring-2 ring-red-400' : 'focus:ring-primary/30'}`}
            />
            {baseUrlError && (
              <p className="mt-1.5 text-xs text-red-500">{baseUrlError}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full px-3 py-2 glass-panel rounded-lg text-text-primary placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/30 text-sm transition-all"
            />
            <p className="mt-1.5 text-[11px] text-text-secondary">Key 仅保存在本地配置文件，不会上传。导出缓存时将自动脱敏。</p>
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-full glass-panel text-text-primary hover:bg-black/5 transition-colors text-sm">取消</button>
          <button onClick={handleSave} className="px-5 py-2 rounded-full bg-primary text-white font-medium shadow-soft hover:opacity-90 transition-all text-sm">保存</button>
        </div>
      </div>
    </div>
  )
}

// 模型配置弹窗组件
interface ModelEditorModalProps {
  isOpen: boolean
  onClose: () => void
  models: SummaryModel[]
  onSave: (models: SummaryModel[]) => void
  providers: ApiProvider[]
}

function ModelEditorModal({ isOpen, onClose, models, onSave, providers }: ModelEditorModalProps): JSX.Element | null {
  const [modelList, setModelList] = useState<SummaryModel[]>(() => uniqueSummaryModels(models))
  const [newModelId, setNewModelId] = useState('')
  const [newModelName, setNewModelName] = useState('')
  const [selectedProviderId, setSelectedProviderId] = useState(providers[0]?.id || '')
  const [isSyncing, setIsSyncing] = useState(false)
  // 行内改名编辑态：editingId 用 `${providerId}-${id}` 作 key 避免不同供应商同名模型冲突
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  // 将供应商列表转换为下拉菜单选项格式
  const providerOptions: DropdownOption<string>[] = providers.map(p => ({
    value: p.id,
    label: p.name
  }))

  // 切换供应商下拉时清空行内编辑态，避免切回来时 input 残留
  useEffect(() => {
    setEditingKey(null)
    setEditName('')
  }, [selectedProviderId])

  // 进入行内编辑态时，聚焦并全选 input（仅在 editingKey 变化时触发一次，
  // 避免每次按键都重聚焦/全选打断输入）
  useEffect(() => {
    if (!editingKey) return
    const el = document.querySelector<HTMLInputElement>(
      `input[data-edit-key="${CSS.escape(editingKey)}"]`
    )
    if (el) {
      el.focus()
      el.select()
    }
  }, [editingKey])

  useEffect(() => {
    if (isOpen) {
      setModelList(uniqueSummaryModels(models))
      if (providers.length > 0 && !selectedProviderId) {
        setSelectedProviderId(providers[0].id)
      }
    }
  }, [isOpen, models, providers])

  if (!isOpen) return null

  const handleSyncModels = async (): Promise<void> => {
    const provider = providers.find(p => p.id === selectedProviderId)
    if (!provider) {
      alert('请先选择供应商')
      return
    }
    // 同步前校验链：enabled → baseUrl 格式 → apiKey 非空
    if (provider.enabled === false) {
      alert('该供应商未启用，无法同步')
      return
    }
    const urlError = validateBaseUrl(provider.baseUrl)
    if (urlError) {
      alert(urlError)
      return
    }
    if (!provider.apiKey) {
      alert('请先为此供应商配置 API Key')
      return
    }

    setIsSyncing(true)
    try {
      const result = await (window.api as any).fetchModels({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl
      })

      if (result.success && result.data) {
        // 转换获取到的模型（OpenAI 标准格式）
        const fetchedModels: SummaryModel[] = result.data.map((m: any) => ({
          id: m.id,
          name: m.id,
          providerId: provider.id
        }))

        // 合并并去重（基于提供商 ID 和模型 ID）
        const newModels = uniqueSummaryModels(modelList)
        let addedCount = 0

        fetchedModels.forEach(fm => {
          if (!newModels.find(m => m.id === fm.id && m.providerId === fm.providerId)) {
            newModels.push(fm)
            addedCount++
          }
        })

        if (addedCount === 0) {
          alert('未发现新模型')
        } else {
          setModelList(newModels)
          alert(`成功同步 ${addedCount} 个新模型`)
        }
      } else {
        alert(`同步失败: ${result.error}`)
      }
    } catch (error) {
      alert(`同步出错: ${error}`)
    } finally {
      setIsSyncing(false)
    }
  }

  const handleAddModel = (): void => {
    if (!newModelId.trim() || !newModelName.trim() || !selectedProviderId) return
    const newModel = {
      id: newModelId.trim(),
      name: newModelName.trim(),
      providerId: selectedProviderId
    }
    if (modelList.some((model) => getSummaryModelKey(model) === getSummaryModelKey(newModel))) return
    setModelList([...modelList, newModel])
    setNewModelId('')
    setNewModelName('')
  }

  const handleRemoveModel = (providerId: string, id: string): void => {
    setModelList(modelList.filter(m => !(m.id === id && m.providerId === providerId)))
  }

  // 进入行内改名编辑：只动 name，绝不动 id
  const handleStartEditModel = (providerId: string, id: string, currentName: string): void => {
    setEditingKey(`${providerId}-${id}`)
    setEditName(currentName)
  }

  // 保存改名：trim 后非空才替换 name；空名拦截（input 边框变红由 editName 为空时驱动）
  const handleCommitEditModel = (providerId: string, id: string): void => {
    const trimmed = editName.trim()
    if (!trimmed) return // 空名不保存，保留原值（input 仍处编辑态，边框变红提示）
    setModelList(modelList.map(m =>
      (m.id === id && m.providerId === providerId) ? { ...m, name: trimmed } : m
    ))
    setEditingKey(null)
    setEditName('')
  }

  const handleCancelEditModel = (): void => {
    setEditingKey(null)
    setEditName('')
  }

  const handleSave = (): void => {
    onSave(uniqueSummaryModels(modelList))
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative w-[550px] max-h-[85vh] glass-panel-heavy rounded-2xl shadow-float flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-white/60">
          <h3 className="text-lg font-semibold text-text-primary">配置可用模型</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-text-secondary hover:text-text-primary hover:bg-black/5 transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex-1 p-4 space-y-4 overflow-y-auto">
          {/* 自动同步 */}
          <div className="p-3 glass-panel rounded-xl flex items-end gap-3">
            <div className="flex-1">
              <CustomDropdown
                options={providerOptions}
                value={selectedProviderId || null}
                onChange={setSelectedProviderId}
                placeholder="请选择供应商"
                label="选择供应商以同步模型列表"
              />
            </div>
            <button
              onClick={handleSyncModels}
              disabled={isSyncing || !selectedProviderId}
              className="px-4 py-2 bg-primary text-white font-medium rounded-full shadow-soft hover:opacity-90 disabled:opacity-50 flex items-center gap-2 transition-all text-sm"
            >
              <span className={`material-symbols-outlined text-sm ${isSyncing ? 'animate-spin' : ''}`}>sync</span>
              {isSyncing ? '同步中' : '自动同步'}
            </button>
          </div>

          {/* 模型列表 */}
          <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
            {uniqueSummaryModels(modelList)
              .filter(model => model.providerId === selectedProviderId)
              .map((model) => {
                const provider = providers.find(p => p.id === model.providerId)
                const itemKey = `${model.providerId}-${model.id}`
                const isEditing = editingKey === itemKey
                return (
                  <div key={itemKey} className="flex items-center justify-between p-2.5 glass-panel rounded-lg group">
                    <div className="flex flex-col flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {isEditing ? (
                          <input
                            data-edit-key={itemKey}
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleCommitEditModel(model.providerId, model.id)
                              else if (e.key === 'Escape') handleCancelEditModel()
                            }}
                            onBlur={() => handleCommitEditModel(model.providerId, model.id)}
                            className={`px-2 py-0.5 bg-white/70 border rounded text-text-primary text-sm focus:outline-none ${editName.trim() ? 'border-primary/50' : 'border-red-400'}`}
                          />
                        ) : (
                          <span className="text-text-primary text-sm font-medium">{model.name}</span>
                        )}
                        <span className="px-1.5 py-0.5 bg-primary/10 text-primary text-[10px] rounded shrink-0 font-medium">
                          {provider?.name || '未知供应商'}
                        </span>
                      </div>
                      <span className="text-text-secondary text-xs mt-0.5">{model.id}</span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      {isEditing ? (
                        <>
                          <button
                            onClick={() => handleCommitEditModel(model.providerId, model.id)}
                            className="p-1 text-text-secondary hover:text-primary transition-colors"
                            title="确认"
                          >
                            <span className="material-symbols-outlined text-sm">check</span>
                          </button>
                          <button
                            onMouseDown={(e) => { e.preventDefault(); handleCancelEditModel() }}
                            className="p-1 text-text-secondary hover:text-red-400 transition-colors"
                            title="取消"
                          >
                            <span className="material-symbols-outlined text-sm">close</span>
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => handleStartEditModel(model.providerId, model.id, model.name)}
                            className="p-1 text-text-secondary hover:text-primary transition-colors"
                            title="改名"
                          >
                            <span className="material-symbols-outlined text-sm">edit</span>
                          </button>
                          <button
                            onClick={() => handleRemoveModel(model.providerId, model.id)}
                            className="p-1 text-text-secondary hover:text-red-400 transition-colors"
                            title="删除"
                          >
                            <span className="material-symbols-outlined text-sm">delete</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            {uniqueSummaryModels(modelList).filter(model => model.providerId === selectedProviderId).length === 0 && (
              <div className="text-center py-8 text-text-secondary text-sm">
                该供应商下暂无已配置模型
              </div>
            )}
          </div>

          {/* 手动添加 */}
          <div className="p-3 glass-panel rounded-xl space-y-3">
            <div className="text-xs font-medium text-text-primary">手动添加模型</div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={newModelId}
                onChange={(e) => setNewModelId(e.target.value)}
                placeholder="模型 ID (如 gpt-4)"
                className="px-3 py-2 bg-white/70 border border-white/80 rounded-lg text-text-primary placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              />
              <input
                type="text"
                value={newModelName}
                onChange={(e) => setNewModelName(e.target.value)}
                placeholder="显示名称 (如 GPT-4)"
                className="px-3 py-2 bg-white/70 border border-white/80 rounded-lg text-text-primary placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              />
            </div>
            <button
              onClick={handleAddModel}
              disabled={!newModelId.trim() || !newModelName.trim()}
              className="w-full px-3 py-2 rounded-full glass-panel text-text-primary hover:text-primary hover:bg-blue-50/50 disabled:opacity-50 transition-all text-sm font-medium"
            >
              添加
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-3 p-4 border-t border-white/60">
          <button onClick={onClose} className="px-4 py-2 rounded-full glass-panel text-text-primary hover:bg-black/5 transition-colors text-sm">取消</button>
          <button onClick={handleSave} className="px-5 py-2 rounded-full bg-primary text-white font-medium shadow-soft hover:opacity-90 transition-all text-sm">保存配置</button>
        </div>
      </div>
    </div>
  )
}

/**
 * 设置抽屉组件
 * 从左侧滑出，包含显示模式、API 配置、文件目录等设置
 */
function SettingsDrawer({ isOpen, onClose }: SettingsDrawerProps): JSX.Element {
  const { apiConfig, setApiConfig, summaryModels, setSummaryModels } = useAppStore()
  const { hasUpdate, releaseUrl } = useUpdateReminder()

  // 弹窗状态
  const [promptEditorOpen, setPromptEditorOpen] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<SummaryPrompt | null>(null)
  const [isNewPrompt, setIsNewPrompt] = useState(false)

  const [providerEditorOpen, setProviderEditorOpen] = useState(false)
  const [editingProvider, setEditingProvider] = useState<ApiProvider | null>(null)
  const [isNewProvider, setIsNewProvider] = useState(false)
  const [validatingProviders, setValidatingProviders] = useState<Record<string, boolean>>({})

  const [modelEditorOpen, setModelEditorOpen] = useState(false)

  // 快捷键设置状态
  const [shortcuts, setShortcuts] = useState<Record<string, string>>({
    summon: 'CommandOrControl+Shift+Space',
    summarize: '',
    polish: '',
    translate: '',
    raw: '',
    search: ''
  })

  useEffect(() => {
    if (isOpen && window.api?.shortcutGet) {
      window.api.shortcutGet().then(res => {
        if (res.success && res.data) {
          setShortcuts(res.data)
        }
      })
    }
  }, [isOpen])

  const handleShortcutChange = async (key: string, val: string): Promise<void> => {
    // 冲突检测：val 非空时，若与其它 key 的非空值相同则拦截，不写入、不持久化
    if (val) {
      const conflictKey = Object.entries(shortcuts).find(
        ([k, v]) => k !== key && v && v === val
      )?.[0]
      if (conflictKey) {
        const conflictLabel = SHORTCUT_LABELS[conflictKey] || conflictKey
        alert(`该快捷键已被「${conflictLabel}」占用，请重新录制`)
        return
      }
    }
    const updated = { ...shortcuts, [key]: val }
    setShortcuts(updated)
    if (window.api?.shortcutSet) {
      await window.api.shortcutSet({ [key]: val })
    }
  }

  // 划词悬浮工具条状态
  const [selectionToolbarEnabled, setSelectionToolbarEnabled] = useState<boolean>(false)
  const [selectionPermission, setSelectionPermission] = useState<string>('unknown')

  useEffect(() => {
    if (isOpen && window.api?.selectionToolbarGet) {
      window.api.selectionToolbarGet().then(res => {
        if (res.success && res.data !== undefined) {
          setSelectionToolbarEnabled(res.data)
        }
      })
      if (window.api.platform === 'darwin' && window.api.selectionPermissionGet) {
        window.api.selectionPermissionGet().then(res => {
          if (res.success && res.data) setSelectionPermission(res.data)
        })
      }
    }
  }, [isOpen])

  const handleSelectionToolbarChange = async (enabled: boolean): Promise<void> => {
    if (window.api?.selectionToolbarSet) {
      const result = await window.api.selectionToolbarSet(enabled)
      if (!result.success) {
        alert(result.error || '无法启用划词悬浮工具条')
        return
      }
    }
    setSelectionToolbarEnabled(enabled)
  }

  // 确认弹窗状态
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean
    type: 'prompt' | 'provider' | 'set-default'
    id: string
    name: string
  }>({
    isOpen: false,
    type: 'prompt',
    id: '',
    name: ''
  })

  // 获取当前的总结提示词列表
  const summaryPrompts = apiConfig.summaryPrompts || []
  const sortedSummaryPrompts = [...uniqueById(summaryPrompts)].sort((a, b) => {
    const aNum = /^\d+$/.test(a.id)
    const bNum = /^\d+$/.test(b.id)
    if (aNum && bNum) return Number(a.id) - Number(b.id)
    if (aNum !== bNum) return aNum ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-Hans-CN')
  })

  // 获取供应商列表
  const providers = apiConfig.providers || []

  // 预览只显示已启用供应商的模型（disabled 供应商的模型保留配置但不显示）
  const enabledSummaryModels = summaryModels.filter(m =>
    providers.find(p => p.id === m.providerId)?.enabled
  )



  // 处理选择导出目录
  const handleSelectDirectory = async (): Promise<void> => {
    if (!window.api?.selectDirectory) {
      console.error('API 不可用')
      return
    }
    const dirPath = await window.api.selectDirectory()
    if (dirPath) {
      setApiConfig({ ...apiConfig, exportDirectory: dirPath })
    }
  }

  // 用系统资源管理器打开导出目录
  const handleOpenExportDirectory = async (): Promise<void> => {
    if (!apiConfig.exportDirectory || !window.api?.openPath) return
    const result = await window.api.openPath(apiConfig.exportDirectory)
    if (!result.success) {
      alert(`打开文件夹失败: ${result.error || '路径不存在或无法访问'}`)
    }
  }

  // 处理导出缓存数据
  const handleExportCache = async (): Promise<void> => {
    if (!window.api?.exportCache) {
      console.error('exportCache API 不可用')
      return
    }
    const result = await window.api.exportCache()
    if (result.success) {
      console.log('缓存数据已导出:', result.filePath)
    } else if (result.error !== '用户取消') {
      console.error('导出缓存数据失败:', result.error)
      alert(`导出失败: ${result.error}`)
    }
  }

  // 导入缓存数据预览状态
  const [importPreview, setImportPreview] = useState<{
    isOpen: boolean
    file: string
    keys: string[]
    conflicts: string[]
    values: Record<string, unknown>
    redactedProviderCount: number
  } | null>(null)

  // 触发导入：先弹文件选择 → 返回预览数据 → 再弹确认弹窗
  const handleImportCache = async (): Promise<void> => {
    if (!window.api?.importCache) {
      console.error('importCache API 不可用')
      return
    }
    // 导入前自动备份一次（失败不阻断）
    if (window.api.exportCache) {
      try {
        await window.api.exportCache()
      } catch (e) {
        console.warn('导入前自动备份失败:', e)
      }
    }

    const result = await window.api.importCache()
    if (!result.success) {
      if (result.error !== '用户取消') {
        alert(`导入失败: ${result.error}`)
      }
      return
    }
    const data = result.data
    if (!data) return

    // 检测导入 apiConfig 中含 REDACTED apiKey 的供应商数量
    let redactedCount = 0
    const importedApiConfig = data.values.apiConfig as { providers?: ApiProvider[] } | undefined
    if (importedApiConfig?.providers) {
      redactedCount = importedApiConfig.providers.filter(p => p.apiKey === '<REDACTED>').length
    }

    setImportPreview({
      isOpen: true,
      file: data.file,
      keys: data.keys,
      conflicts: data.conflicts,
      values: data.values,
      redactedProviderCount: redactedCount
    })
  }

  // 确认导入：逐键写入，处理 REDACTED apiKey（保留本地 Key），再刷新内存态
  const handleConfirmImportCache = async (): Promise<void> => {
    if (!importPreview || !window.api?.storeSet) return
    const { keys, values } = importPreview
    const localApiConfig = useAppStore.getState().apiConfig
    const localProviders = localApiConfig.providers || []

    for (const k of keys) {
      let value = values[k]
      // REDACTED 处理：导入 apiConfig 时，对 apiKey === '<REDACTED>' 的供应商保留本地现有 Key
      if (k === 'apiConfig' && value && typeof value === 'object') {
        const imported = value as ApiConfig
        if (Array.isArray(imported.providers)) {
          // 用新对象避免 mutate 预览态 values
          value = {
            ...imported,
            providers: imported.providers.map(p => {
              if (p.apiKey === '<REDACTED>') {
                const local = localProviders.find(lp => lp.id === p.id)
                return { ...p, apiKey: local?.apiKey || '' }
              }
              return p
            })
          }
        }
      }
      await window.api.storeSet(k, value)
    }

    // 刷新内存态：重新从 store 读取并写回 zustand
    try {
      const [apiConfigVal, summaryModelsVal] = await Promise.all([
        window.api.storeGet('apiConfig') as Promise<ApiConfig | undefined>,
        window.api.storeGet('summaryModels') as Promise<SummaryModel[] | undefined>
      ])
      const patch: Record<string, unknown> = {}
      if (apiConfigVal) patch.apiConfig = apiConfigVal
      if (summaryModelsVal) patch.summaryModels = summaryModelsVal
      if (Object.keys(patch).length > 0) useAppStore.setState(patch)
    } catch (e) {
      console.warn('导入后刷新内存态失败，建议重启应用:', e)
    }

    setImportPreview(null)
    alert('缓存导入完成，建议重启应用以使全部变更（如历史记录）生效。')
  }

  // 提示词管理
  const handleEditPrompt = (prompt: SummaryPrompt): void => {
    setEditingPrompt(prompt)
    setIsNewPrompt(false)
    setPromptEditorOpen(true)
  }

  const handleAddPrompt = (): void => {
    setEditingPrompt(null)
    setIsNewPrompt(true)
    setPromptEditorOpen(true)
  }

  const refreshSummaryPrompts = useCallback(async (): Promise<void> => {
    if (!window.api?.summaryPromptsList) return
    const prompts = await window.api.summaryPromptsList() as SummaryPrompt[]
    const currentApiConfig = useAppStore.getState().apiConfig
    setApiConfig({ ...currentApiConfig, summaryPrompts: prompts })
  }, [setApiConfig])

  useEffect(() => {
    if (!isOpen) return
    refreshSummaryPrompts().catch(() => { })
  }, [isOpen, refreshSummaryPrompts])

  const handleSavePrompt = async (prompt: SummaryPrompt): Promise<void> => {
    if (!window.api?.summaryPromptsWrite) return
    await window.api.summaryPromptsWrite(prompt)
    await refreshSummaryPrompts()
  }

  const handleDeletePrompt = (id: string): void => {
    const prompt = summaryPrompts.find(p => p.id === id)
    if (prompt) {
      setConfirmModal({
        isOpen: true,
        type: 'prompt',
        id,
        name: prompt.name
      })
    }
  }

  // 确认删除总结提示词
  const handleConfirmDeletePrompt = async (): Promise<void> => {
    if (window.api?.summaryPromptsDelete) {
      await window.api.summaryPromptsDelete(confirmModal.id)
      await refreshSummaryPrompts()
    }
    setConfirmModal({ ...confirmModal, isOpen: false })
  }

  // 供应商管理
  const handleEditProvider = (provider: ApiProvider): void => {
    setEditingProvider(provider)
    setIsNewProvider(false)
    setProviderEditorOpen(true)
  }

  const handleAddProvider = (): void => {
    setEditingProvider(null)
    setIsNewProvider(true)
    setProviderEditorOpen(true)
  }

  const handleValidateProvider = async (provider: ApiProvider): Promise<void> => {
    if (!provider.apiKey || !provider.baseUrl) {
      alert('请先配置 API Key 和 Base URL')
      return
    }

    setValidatingProviders(prev => ({ ...prev, [provider.id]: true }))
    try {
      const result = await (window.api as any).validateApi({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl
      })

      // 三态：valid（清空错误）/ invalid（记录错误摘要）
      const newProviders = providers.map(p =>
        p.id === provider.id
          ? {
            ...p,
            validated: result.success,
            validatedStatus: result.success ? 'valid' as const : 'invalid' as const,
            validatedError: result.success ? '' : (result.error || '无法连接到服务器')
          }
          : p
      )
      setApiConfig({ ...apiConfig, providers: newProviders })

      if (result.success) {
        // 校验成功不弹窗，直接显示绿点
      } else {
        alert(`校验失败: ${result.error || '无法连接到服务器'}`)
      }
    } catch (error) {
      // 异常也视为 invalid
      const errMsg = String(error)
      const newProviders = providers.map(p =>
        p.id === provider.id
          ? { ...p, validated: false, validatedStatus: 'invalid' as const, validatedError: errMsg }
          : p
      )
      setApiConfig({ ...apiConfig, providers: newProviders })
      alert(`校验出错: ${error}`)
    } finally {
      setValidatingProviders(prev => ({ ...prev, [provider.id]: false }))
    }
  }

  const handleSaveProvider = (provider: ApiProvider): void => {
    const currentProviders = [...providers]
    const existingIndex = currentProviders.findIndex(p => p.id === provider.id)

    // 如果是编辑现有供应商且 Key 或 URL 发生了变化，重置校验状态为 unknown
    const updatedProvider = { ...provider }
    if (existingIndex >= 0) {
      const old = currentProviders[existingIndex]
      if (old.apiKey !== provider.apiKey || old.baseUrl !== provider.baseUrl) {
        updatedProvider.validated = false
        updatedProvider.validatedStatus = 'unknown'
        updatedProvider.validatedError = ''
      }
    }

    if (existingIndex >= 0) currentProviders[existingIndex] = updatedProvider
    else currentProviders.push(updatedProvider)
    setApiConfig({ ...apiConfig, providers: currentProviders })
  }

  // 设为默认供应商：disabled 时先弹确认自动 enable，再设 activeProviderId
  const handleSetDefaultProvider = (provider: ApiProvider): void => {
    if (provider.enabled === false) {
      setConfirmModal({
        isOpen: true,
        type: 'set-default',
        id: provider.id,
        name: provider.name
      })
      return
    }
    setApiConfig({ ...apiConfig, activeProviderId: provider.id })
  }

  const handleDeleteProvider = (id: string): void => {
    const provider = providers.find(p => p.id === id)
    if (provider) {
      setConfirmModal({
        isOpen: true,
        type: 'provider',
        id,
        name: provider.name
      })
    }
  }

  // 确认删除供应商
  const handleConfirmDeleteProvider = (): void => {
    const deletedProviderId = confirmModal.id
    setApiConfig({ ...apiConfig, providers: providers.filter(p => p.id !== deletedProviderId) })
    // 同时删除该供应商下的所有总结模型，避免配置与模型列表不一致
    setSummaryModels(summaryModels.filter(m => m.providerId !== deletedProviderId))
    setConfirmModal({ ...confirmModal, isOpen: false })
  }

  const handleToggleProvider = (id: string): void => {
    const newProviders = providers.map(p =>
      p.id === id ? { ...p, enabled: !p.enabled } : p
    )
    setApiConfig({ ...apiConfig, providers: newProviders })
  }

  // 模型管理
  const handleSaveModels = (models: SummaryModel[]): void => {
    setSummaryModels(models)
  }

  return (
    <>
      {/* 遮罩层 */}
      <div
        className={`fixed inset-0 overlay z-40 transition-opacity duration-200 ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        style={{ WebkitAppRegion: 'no-drag' } as any}
        onClick={isOpen ? onClose : undefined}
      />

      {/* 抽屉面板 */}
      <div
        className={`fixed left-0 top-0 bottom-0 w-[500px] glass-panel-heavy border-r border-white/40 z-50 flex flex-col rounded-r-3xl overflow-hidden transform transition-all duration-300 ease-in-out ${isOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full shadow-none'
          }`}
        style={{ WebkitAppRegion: 'no-drag' } as any}
      >
        {/* 头部 */}
        <div className="relative flex items-center justify-between p-4 border-b border-white/40">
          {/* 左侧 Logo 和产品名称 */}
          {hasUpdate ? (
            <button
              type="button"
              onClick={() => openUpdateRelease(releaseUrl)}
              className="flex items-center gap-2 text-text-primary rounded-lg hover:bg-white/60 transition-colors"
              title="发现新版本，打开发布页"
            >
              <img src={logo} alt="MultiChat Logo" className="w-7 h-7 object-contain" />
              <span className="font-semibold text-primary text-sm tracking-wide">MultiChat</span>
              <span className="text-[9px] leading-none font-bold text-red-500 bg-red-50 border border-red-200 px-1.5 py-1 rounded-full">NEW</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 text-text-primary">
              <img src={logo} alt="MultiChat Logo" className="w-7 h-7 object-contain" />
              <span className="font-semibold text-primary text-sm tracking-wide">MultiChat</span>
            </div>
          )}

          {/* 中间标题 */}
          <div className="absolute left-1/2 transform -translate-x-1/2">
            <h2 className="text-lg font-semibold text-text-primary">设置面板</h2>
          </div>

          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary transition-colors z-10"
          >
            <span className="material-symbols-outlined text-2xl">close</span>
          </button>
        </div>

        {/* 设置内容：可滚动区域 */}
        <div className="flex-1 p-6 space-y-8 overflow-y-auto">


          {/* 总结方式配置 */}
          <div>
            <h3 className="flex items-center gap-2 font-semibold text-text-primary mb-4">
              <span className="material-symbols-outlined text-primary text-xl">auto_awesome</span>
              总结方式配置
            </h3>

            <div className="space-y-4">
              {/* 总结方式选择 */}
              <div className="p-4 rounded-xl glass-panel">
                <label className="block text-sm font-medium text-text-primary mb-2">总结方式</label>
                <div className="space-y-2">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="summarySource"
                      checked={(apiConfig.summarySource ?? 'webview') === 'webview'}
                      onChange={() => setApiConfig({ ...apiConfig, summarySource: 'webview' })}
                      className="mt-0.5 w-4 h-4 text-primary accent-primary border-gray-300 focus:ring-primary/20"
                    />
                    <div>
                      <div className="text-sm text-text-primary font-medium">嵌入式页面（默认）</div>
                      <div className="text-[11px] text-text-secondary">通过厂商网页直接总结，无需 API Key</div>
                    </div>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="summarySource"
                      checked={apiConfig.summarySource === 'api'}
                      onChange={() => setApiConfig({ ...apiConfig, summarySource: 'api' })}
                      className="mt-0.5 w-4 h-4 text-primary accent-primary border-gray-300 focus:ring-primary/20"
                    />
                    <div>
                      <div className="text-sm text-text-primary font-medium">API 调用</div>
                      <div className="text-[11px] text-text-secondary">通过 OpenAI 兼容接口总结，需配置下方供应商</div>
                    </div>
                  </label>
                </div>
                {apiConfig.summarySource === 'api' && providers.length === 0 && (
                  <p className="mt-2 text-[11px] text-yellow-600">未配置供应商，请先新增 API 供应商</p>
                )}
              </div>

              {/* API 供应商管理 */}
              <div className="p-4 rounded-xl glass-panel">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-text-primary">API 供应商（多 Key 管理）</label>
                  <button
                    onClick={handleAddProvider}
                    className="flex items-center gap-1 text-xs text-primary hover:opacity-80 transition-colors font-medium"
                  >
                    <span className="material-symbols-outlined text-sm">add</span>
                    新增
                  </button>
                </div>
                <div className="space-y-2">
                  {providers.map(provider => {
                    // 校验三态：优先 validatedStatus，回退兼容旧 validated 字段
                    const vStatus: 'unknown' | 'valid' | 'invalid' =
                      provider.validatedStatus
                        ? provider.validatedStatus
                        : (provider.validated === true ? 'valid' : 'unknown')
                    const isDefault = apiConfig.activeProviderId === provider.id
                    return (
                    <div
                      key={provider.id}
                      className="flex items-center justify-between p-2.5 glass-panel rounded-lg group"
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="radio"
                          name="activeProvider"
                          checked={isDefault}
                          onChange={() => handleSetDefaultProvider(provider)}
                          className="w-4 h-4 text-primary accent-primary border-gray-300 focus:ring-primary/20 cursor-pointer"
                        />
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-medium ${provider.enabled ? 'text-text-primary' : 'text-text-secondary line-through opacity-70'}`}>
                              {provider.name}
                            </span>
                            {isDefault && (
                              <span className="px-1.5 py-0.5 bg-primary/10 text-primary text-[10px] rounded shrink-0 font-medium" title="当前默认">默认</span>
                            )}
                            {vStatus === 'valid' && (
                              <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" title="校验通过" />
                            )}
                            {vStatus === 'invalid' && (
                              <span className="w-2 h-2 rounded-full bg-red-500" title={`校验失败：${provider.validatedError || '未知原因'}`} />
                            )}
                            {vStatus === 'unknown' && (
                              <span className="w-2 h-2 rounded-full bg-gray-400" title="未校验" />
                            )}
                          </div>
                          <span className={`text-[10px] truncate max-w-[150px] ${provider.enabled ? 'text-text-secondary' : 'text-text-secondary opacity-50'}`}>
                            {provider.baseUrl}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleValidateProvider(provider)}
                            disabled={validatingProviders[provider.id]}
                            className="p-1 text-text-secondary hover:text-primary transition-colors disabled:opacity-50"
                            title="校验 API"
                          >
                            <span className={`material-symbols-outlined text-xl ${validatingProviders[provider.id] ? 'animate-spin' : ''}`}>
                              {validatingProviders[provider.id] ? 'sync' : 'verified'}
                            </span>
                          </button>
                          <button
                            onClick={() => handleEditProvider(provider)}
                            className="p-1 text-text-secondary hover:text-primary transition-colors"
                            title="编辑"
                          >
                            <span className="material-symbols-outlined text-xl">edit</span>
                          </button>
                          <button
                            onClick={() => handleDeleteProvider(provider.id)}
                            className="p-1 text-text-secondary hover:text-red-400 transition-colors"
                            title="删除"
                          >
                            <span className="material-symbols-outlined text-xl">delete</span>
                          </button>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer" title={provider.enabled ? "点击停用" : "点击启用"}>
                          <input
                            type="checkbox"
                            checked={provider.enabled}
                            onChange={() => handleToggleProvider(provider.id)}
                            className="sr-only peer"
                          />
                          <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                        </label>
                      </div>
                    </div>
                    )
                  })}
                </div>
              </div>

              {/* 可用模型配置 */}
              <div className="p-4 rounded-xl glass-panel">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-text-primary">
                    可用总结模型（已启用 <span className="text-primary">{enabledSummaryModels.length}</span> / 共 {summaryModels.length}）
                  </label>
                  <button
                    onClick={() => setModelEditorOpen(true)}
                    className="text-xs text-primary hover:opacity-80 transition-colors font-medium"
                  >
                    同步/配置
                  </button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {enabledSummaryModels.slice(0, 5).map((model: SummaryModel) => (
                    <span key={`${model.providerId}-${model.id}`} className="px-2 py-0.5 glass-panel text-text-primary text-[10px] rounded font-medium">
                      {model.name}
                    </span>
                  ))}
                  {enabledSummaryModels.length > 5 && (
                    <span className="px-2 py-0.5 text-text-secondary text-[10px]">+{enabledSummaryModels.length - 5} 更多</span>
                  )}
                  {enabledSummaryModels.length === 0 && summaryModels.length > 0 && (
                    <span className="text-text-secondary text-[10px]">未启用供应商的模型已隐藏</span>
                  )}
                </div>
                <p className="text-[11px] text-text-secondary mt-2">默认总结模型在总结面板内选择并自动记忆</p>
              </div>

              {/* 提示词模板列表 */}
              <div className="p-4 rounded-xl glass-panel">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-text-primary">总结提示词模板</label>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => window.api?.summaryPromptsOpenFolder?.()}
                      className="p-1 text-text-secondary hover:text-text-primary transition-colors"
                      title="打开文件夹"
                      aria-label="打开文件夹"
                    >
                      <span className="material-symbols-outlined text-xl">folder_open</span>
                    </button>
                    <button
                      onClick={() => refreshSummaryPrompts().catch(() => { })}
                      className="p-1 text-text-secondary hover:text-text-primary transition-colors"
                      title="刷新"
                      aria-label="刷新"
                    >
                      <span className="material-symbols-outlined text-xl">refresh</span>
                    </button>
                    <button
                      onClick={handleAddPrompt}
                      className="flex items-center gap-1 text-xs text-primary hover:opacity-80 transition-colors font-medium"
                    >
                      <span className="material-symbols-outlined text-sm">add</span>
                      新增
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  {sortedSummaryPrompts.map(prompt => (
                    <div
                      key={prompt.id}
                      className="flex items-center justify-between py-2 px-3 glass-panel rounded-lg hover:bg-blue-50/40 transition-colors group"
                    >
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-text-primary text-sm truncate font-medium">{prompt.name}</span>
                          {prompt.isDefault && (
                            <span className="px-1.5 py-0.5 bg-primary/10 text-primary text-[10px] rounded shrink-0 font-medium">预设</span>
                          )}
                        </div>
                        <div className="text-[11px] text-text-secondary truncate h-[14px] leading-[14px]">
                          {prompt.description || ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleEditPrompt(prompt)}
                          className="p-1 text-text-secondary hover:text-primary transition-colors"
                          title="编辑"
                        >
                          <span className="material-symbols-outlined text-xl">edit</span>
                        </button>
                        <button
                          onClick={() => handleDeletePrompt(prompt.id)}
                          className="p-1 text-text-secondary hover:text-red-400 transition-colors"
                          title="删除"
                        >
                          <span className="material-symbols-outlined text-xl">delete</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 划词悬浮工具条设置 */}
          <div>
            <h3 className="flex items-center gap-2 font-semibold text-text-primary mb-4">
              <span className="material-symbols-outlined text-primary text-xl">text_select_start</span>
              划词悬浮工具条
            </h3>
            <div className="p-4 rounded-xl glass-panel flex items-center justify-between">
              <div>
                <div className="text-sm text-text-primary font-medium">启用划词悬浮工具条</div>
                <div className="text-xs text-text-secondary mt-1">开启后，选中文本松开鼠标将自动出现快捷操作栏</div>
                {window.api.platform === 'darwin' && (
                  <button
                    type="button"
                    className="mt-2 text-xs text-primary hover:underline"
                    onClick={async () => {
                      const res = await window.api.selectionPermissionRequest()
                      if (res.success && res.data) setSelectionPermission(res.data)
                    }}
                  >
                    macOS 辅助功能权限：{selectionPermission}（点击请求；首次读取时可能还会请求“自动化”权限）
                  </button>
                )}
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectionToolbarEnabled}
                  onChange={(e) => handleSelectionToolbarChange(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>
          </div>

          {/* 全局快捷键设置 */}
          <div>
            <h3 className="flex items-center gap-2 font-semibold text-text-primary mb-4">
              <span className="material-symbols-outlined text-primary text-xl">keyboard</span>
              全局快捷键
            </h3>
            <div className="p-4 rounded-xl glass-panel space-y-3">
              {[
                { key: 'summon', label: '唤醒快捷助手', placeholder: 'CommandOrControl+Shift+Space' },
                { key: 'summarize', label: '划词召唤 - 总结', placeholder: 'CommandOrControl+Shift+S' },
                { key: 'polish', label: '划词召唤 - 润色', placeholder: 'CommandOrControl+Shift+E' },
                { key: 'translate', label: '划词召唤 - 翻译', placeholder: 'CommandOrControl+Shift+T' },
                { key: 'raw', label: '划词召唤 - 纯文本入框', placeholder: 'CommandOrControl+Shift+Q' },
                { key: 'search', label: '划词召唤 - 搜索', placeholder: 'CommandOrControl+Shift+F' }
              ].map(({ key, label, placeholder }) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <label className="text-sm text-text-primary">{label}</label>
                  <ShortcutRecorder
                    value={shortcuts[key] || ''}
                    onChange={(val) => handleShortcutChange(key, val)}
                    placeholder={placeholder}
                    defaultShortcut={key === 'summon' ? 'CommandOrControl+Shift+Space' : ''}
                  />
                </div>
              ))}
              <p className="text-xs text-text-secondary mt-2">点击设置框后，直接在键盘上按下组合快捷键即可自动录制（按 Esc 取消）</p>
            </div>
          </div>

          {/* 文件目录设置 */}
          <div>
            <h3 className="flex items-center gap-2 font-semibold text-text-primary mb-4">
              <span className="material-symbols-outlined text-primary text-xl">folder_special</span>
              文件与缓存
            </h3>
            <div className="p-4 rounded-xl glass-panel space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">总结导出文件夹</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="选择导出目录..."
                    value={apiConfig.exportDirectory || ''}
                    readOnly
                    className="flex-1 px-3 py-2 glass-panel rounded-lg text-text-primary placeholder-gray-400 text-sm focus:outline-none"
                  />
                  <button
                    onClick={handleSelectDirectory}
                    className="px-4 py-2 rounded-full glass-panel text-text-primary hover:text-primary hover:bg-blue-50/50 transition-all text-sm font-medium"
                  >
                    浏览
                  </button>
                  <button
                    onClick={handleOpenExportDirectory}
                    disabled={!apiConfig.exportDirectory}
                    className="px-4 py-2 rounded-full glass-panel text-text-primary hover:text-primary hover:bg-blue-50/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm font-medium"
                  >
                    打开
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">应用缓存数据</label>
                <div className="flex gap-2">
                  <button
                    onClick={handleExportCache}
                    className="flex items-center gap-2 px-4 py-2 rounded-full glass-panel text-text-primary hover:text-primary hover:bg-blue-50/50 transition-all text-sm font-medium"
                  >
                    <span className="material-symbols-outlined text-sm">download</span>
                    导出缓存数据
                  </button>
                  <button
                    onClick={handleImportCache}
                    className="flex items-center gap-2 px-4 py-2 rounded-full glass-panel text-text-primary hover:text-primary hover:bg-blue-50/50 transition-all text-sm font-medium"
                  >
                    <span className="material-symbols-outlined text-sm">upload</span>
                    导入缓存数据
                  </button>
                </div>
                <p className="text-xs text-text-secondary mt-1.5">导出为 JSON 文件，API Key 等敏感信息将被自动脱敏</p>
              </div>
            </div>
          </div>

          {/* 关于 */}
          <div>
            <h3 className="flex items-center gap-2 font-semibold text-text-primary mb-4">
              <span className="material-symbols-outlined text-primary text-xl">info</span>
              关于
            </h3>
            <div className="p-4 rounded-xl glass-panel">
              <a
                href="https://github.com/max-doo/MultiChat-desk"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-3 glass-panel rounded-xl hover:bg-blue-50/40 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-primary text-xl">help</span>
                  <div className="flex flex-col">
                    <span className="text-text-primary text-sm font-medium">查看使用说明</span>
                    <span className="text-text-secondary text-[10px]">了解如何配置、使用和管理 API Key</span>
                  </div>
                </div>
                <span className="material-symbols-outlined text-text-secondary group-hover:text-primary transition-colors">
                  open_in_new
                </span>
              </a>
              <AboutSection />
            </div>
          </div>

          {/* Dev-only 诊断入口 */}
          {import.meta.env.DEV && (
            <div>
              <h3 className="flex items-center gap-2 font-semibold text-text-primary mb-4">
                <span className="material-symbols-outlined text-primary text-xl">build</span>
                开发工具
              </h3>
              <button
                type="button"
                onClick={() => { void window.api.diagnosticsOpenWindow() }}
                className="px-4 py-2 text-sm rounded-full glass-panel text-text-primary hover:text-primary hover:bg-blue-50/50 transition-all font-medium w-full"
              >
                🔬 选择器诊断 (dev)
              </button>
            </div>
          )}

        </div>
      </div>

      {/* 弹窗组件 */}
      <PromptEditorModal
        isOpen={promptEditorOpen}
        onClose={() => setPromptEditorOpen(false)}
        prompt={editingPrompt}
        onSave={handleSavePrompt}
        isNew={isNewPrompt}
      />

      <ProviderEditorModal
        isOpen={providerEditorOpen}
        onClose={() => setProviderEditorOpen(false)}
        provider={editingProvider}
        onSave={handleSaveProvider}
        isNew={isNewProvider}
      />

      <ModelEditorModal
        isOpen={modelEditorOpen}
        onClose={() => setModelEditorOpen(false)}
        models={summaryModels}
        onSave={handleSaveModels}
        providers={providers}
      />

      {/* 确认弹窗（删除 / 设为默认） */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={
          confirmModal.type === 'set-default'
            ? '启用并设为默认'
            : `删除${confirmModal.type === 'prompt' ? '总结提示词' : '供应商'}`
        }
        message={
          confirmModal.type === 'set-default'
            ? `"${confirmModal.name}" 当前未启用。设为默认将自动启用该供应商，是否继续？`
            : `确定要删除 "${confirmModal.name}" 吗？此操作不可恢复。`
        }
        confirmText={confirmModal.type === 'set-default' ? '启用并设为默认' : '删除'}
        cancelText="取消"
        type={confirmModal.type === 'set-default' ? 'warning' : 'danger'}
        onConfirm={() => {
          if (confirmModal.type === 'prompt') {
            void handleConfirmDeletePrompt()
          } else if (confirmModal.type === 'provider') {
            handleConfirmDeleteProvider()
          } else if (confirmModal.type === 'set-default') {
            // 先 enable 再设 activeProviderId
            const targetId = confirmModal.id
            const newProviders = providers.map(p =>
              p.id === targetId ? { ...p, enabled: true } : p
            )
            setApiConfig({ ...apiConfig, providers: newProviders, activeProviderId: targetId })
            setConfirmModal({ ...confirmModal, isOpen: false })
          }
        }}
        onCancel={() => setConfirmModal({ ...confirmModal, isOpen: false })}
      />

      {/* 导入缓存预览弹窗 */}
      <ImportCacheConfirmModal
        isOpen={importPreview?.isOpen ?? false}
        file={importPreview?.file ?? ''}
        keys={importPreview?.keys ?? []}
        conflicts={importPreview?.conflicts ?? []}
        redactedProviderCount={importPreview?.redactedProviderCount ?? 0}
        onConfirm={() => { void handleConfirmImportCache() }}
        onCancel={() => setImportPreview(null)}
      />
    </>
  )
}

export default SettingsDrawer
