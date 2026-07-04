import { useState, useCallback, useEffect } from 'react'
import { useAppStore, type AgentPrompt, type SummaryModel, type ApiProvider } from '../store/appStore'
import logo from '../assets/logo.png'
import CustomDropdown, { type DropdownOption } from './CustomDropdown'
import ConfirmModal from './ConfirmModal'
import ShortcutRecorder from './ShortcutRecorder'

interface SettingsDrawerProps {
  isOpen: boolean
  onClose: () => void
}

// 提示词编辑弹窗组件
interface PromptEditorModalProps {
  isOpen: boolean
  onClose: () => void
  prompt: AgentPrompt | null
  onSave: (prompt: AgentPrompt) => Promise<void>
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
      <div className="relative w-[600px] max-h-[80vh] bg-app border border-gray-200 rounded-lg shadow-2xl flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-text-primary">
            {isNew ? '新增 Agent 提示词' : '编辑提示词'}
          </h3>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary transition-colors"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* 表单内容 */}
        <div className="flex-1 p-4 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-sm text-text-secondary mb-2">名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="输入提示词名称"
              className="w-full px-3 py-2 bg-sidebar border border-gray-200 rounded-md text-text-secondary placeholder-gray-500 focus:outline-none focus:border-primary/50"
            />
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-2">描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="一句话描述这个提示词的用途（可选）"
              rows={3}
              className="w-full px-3 py-2 bg-sidebar border border-gray-200 rounded-md text-text-secondary placeholder-gray-500 focus:outline-none focus:border-primary/50 resize-none text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-2">提示词内容</label>
            <textarea
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              placeholder="输入提示词内容..."
              rows={12}
              className="w-full px-3 py-2 bg-sidebar border border-gray-200 rounded-md text-text-secondary placeholder-gray-500 focus:outline-none focus:border-primary/50 resize-none font-mono text-sm"
            />
          </div>
        </div>

        {/* 底部操作按钮 */}
        <div className="flex justify-end gap-3 p-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-text-secondary hover:text-text-primary transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || isSaving}
            className="px-4 py-2 bg-primary text-white font-medium rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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

  useEffect(() => {
    if (isOpen) {
      setName(provider?.name || '')
      setBaseUrl(provider?.baseUrl || '')
      setApiKey(provider?.apiKey || '')
    }
  }, [isOpen, provider])

  if (!isOpen) return null

  const handleSave = (): void => {
    if (!name.trim() || !baseUrl.trim() || !apiKey.trim()) return
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
      <div className="relative w-[450px] bg-app border border-gray-200 rounded-lg shadow-2xl flex flex-col p-4 space-y-4">
        <h3 className="text-lg font-semibold text-text-primary">{isNew ? '新增供应商' : '编辑供应商'}</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-text-secondary mb-1">名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：OpenRouter"
              className="w-full px-3 py-2 bg-sidebar border border-gray-200 rounded-md text-text-secondary focus:outline-none focus:border-primary/50 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">Base URL</label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="w-full px-3 py-2 bg-sidebar border border-gray-200 rounded-md text-text-secondary focus:outline-none focus:border-primary/50 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full px-3 py-2 bg-sidebar border border-gray-200 rounded-md text-text-secondary focus:outline-none focus:border-primary/50 text-sm"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-text-secondary hover:text-text-primary transition-colors text-sm">取消</button>
          <button onClick={handleSave} className="px-4 py-2 bg-primary text-white font-medium rounded-md hover:opacity-90 transition-colors text-sm">保存</button>
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
  const [modelList, setModelList] = useState<SummaryModel[]>(models)
  const [newModelId, setNewModelId] = useState('')
  const [newModelName, setNewModelName] = useState('')
  const [selectedProviderId, setSelectedProviderId] = useState(providers[0]?.id || '')
  const [isSyncing, setIsSyncing] = useState(false)

  // 将供应商列表转换为下拉菜单选项格式
  const providerOptions: DropdownOption<string>[] = providers.map(p => ({
    value: p.id,
    label: p.name
  }))

  useEffect(() => {
    if (isOpen) {
      setModelList(models)
      if (providers.length > 0 && !selectedProviderId) {
        setSelectedProviderId(providers[0].id)
      }
    }
  }, [isOpen, models, providers])

  if (!isOpen) return null

  const handleSyncModels = async (): Promise<void> => {
    const provider = providers.find(p => p.id === selectedProviderId)
    if (!provider || !provider.apiKey) {
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
        const newModels = [...modelList]
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
    setModelList([...modelList, {
      id: newModelId.trim(),
      name: newModelName.trim(),
      providerId: selectedProviderId
    }])
    setNewModelId('')
    setNewModelName('')
  }

  const handleRemoveModel = (providerId: string, id: string): void => {
    setModelList(modelList.filter(m => !(m.id === id && m.providerId === providerId)))
  }

  const handleSave = (): void => {
    onSave(modelList)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative w-[550px] max-h-[85vh] bg-app border border-gray-200 rounded-lg shadow-2xl flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-text-primary">配置可用模型</h3>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex-1 p-4 space-y-4 overflow-y-auto">
          {/* 自动同步 */}
          <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg flex items-end gap-3">
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
              className="px-4 py-2 bg-primary text-white font-medium rounded-md hover:opacity-90 disabled:opacity-50 flex items-center gap-2 transition-colors text-sm"
            >
              <span className={`material-symbols-outlined text-sm ${isSyncing ? 'animate-spin' : ''}`}>sync</span>
              {isSyncing ? '同步中' : '自动同步'}
            </button>
          </div>

          {/* 模型列表 */}
          <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
            {modelList
              .filter(model => model.providerId === selectedProviderId)
              .map((model) => {
                const provider = providers.find(p => p.id === model.providerId)
                return (
                  <div key={`${model.providerId}-${model.id}`} className="flex items-center justify-between p-2 bg-sidebar/50 border border-gray-200 rounded-md group">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="text-text-primary text-sm font-medium">{model.name}</span>
                        <span className="px-1.5 py-0.5 bg-gray-100 text-text-secondary text-[10px] rounded">
                          {provider?.name || '未知供应商'}
                        </span>
                      </div>
                      <span className="text-gray-500 text-xs">{model.id}</span>
                    </div>
                    <button
                      onClick={() => handleRemoveModel(model.providerId, model.id)}
                      className="text-gray-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <span className="material-symbols-outlined text-sm">delete</span>
                    </button>
                  </div>
                )
              })}
            {modelList.filter(model => model.providerId === selectedProviderId).length === 0 && (
              <div className="text-center py-8 text-gray-500 text-sm">
                该供应商下暂无已配置模型
              </div>
            )}
          </div>

          {/* 手动添加 */}
          <div className="p-3 bg-sidebar/30 border border-gray-200 rounded-lg space-y-3">
            <div className="text-xs text-text-secondary">手动添加模型</div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={newModelId}
                onChange={(e) => setNewModelId(e.target.value)}
                placeholder="模型 ID (如 gpt-4)"
                className="px-3 py-2 bg-app border border-gray-200 rounded-md text-text-secondary placeholder-gray-600 text-sm focus:outline-none focus:border-primary/50"
              />
              <input
                type="text"
                value={newModelName}
                onChange={(e) => setNewModelName(e.target.value)}
                placeholder="显示名称 (如 GPT-4)"
                className="px-3 py-2 bg-app border border-gray-200 rounded-md text-text-secondary placeholder-gray-600 text-sm focus:outline-none focus:border-primary/50"
              />
            </div>
            <button
              onClick={handleAddModel}
              disabled={!newModelId.trim() || !newModelName.trim()}
              className="w-full px-3 py-2 bg-gray-100 text-text-secondary rounded-md hover:bg-gray-200 disabled:opacity-50 transition-colors text-sm"
            >
              添加
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-3 p-4 border-t border-gray-200">
          <button onClick={onClose} className="px-4 py-2 text-text-secondary hover:text-text-primary transition-colors text-sm">取消</button>
          <button onClick={handleSave} className="px-4 py-2 bg-primary text-white font-medium rounded-md hover:opacity-90 transition-colors text-sm">保存配置</button>
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

  // 弹窗状态
  const [promptEditorOpen, setPromptEditorOpen] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<AgentPrompt | null>(null)
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
    const updated = { ...shortcuts, [key]: val }
    setShortcuts(updated)
    if (window.api?.shortcutSet) {
      await window.api.shortcutSet({ [key]: val })
    }
  }

  // 划词悬浮工具条状态
  const [selectionToolbarEnabled, setSelectionToolbarEnabled] = useState<boolean>(true)

  useEffect(() => {
    if (isOpen && window.api?.selectionToolbarGet) {
      window.api.selectionToolbarGet().then(res => {
        if (res.success && res.data !== undefined) {
          setSelectionToolbarEnabled(res.data)
        }
      })
    }
  }, [isOpen])

  const handleSelectionToolbarChange = async (enabled: boolean): Promise<void> => {
    setSelectionToolbarEnabled(enabled)
    if (window.api?.selectionToolbarSet) {
      await window.api.selectionToolbarSet(enabled)
    }
  }

  // 确认弹窗状态
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean
    type: 'prompt' | 'provider'
    id: string
    name: string
  }>({
    isOpen: false,
    type: 'prompt',
    id: '',
    name: ''
  })

  // 获取当前的 Agent 提示词列表
  const agentPrompts = apiConfig.agentPrompts || []
  const sortedAgentPrompts = [...agentPrompts].sort((a, b) => {
    const aNum = /^\d+$/.test(a.id)
    const bNum = /^\d+$/.test(b.id)
    if (aNum && bNum) return Number(a.id) - Number(b.id)
    if (aNum !== bNum) return aNum ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-Hans-CN')
  })

  // 获取供应商列表
  const providers = apiConfig.providers || []



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

  // 提示词管理
  const handleEditPrompt = (prompt: AgentPrompt): void => {
    setEditingPrompt(prompt)
    setIsNewPrompt(false)
    setPromptEditorOpen(true)
  }

  const handleAddPrompt = (): void => {
    setEditingPrompt(null)
    setIsNewPrompt(true)
    setPromptEditorOpen(true)
  }

  const refreshAgentPrompts = useCallback(async (): Promise<void> => {
    if (!window.api?.agentPromptsList) return
    const prompts = await window.api.agentPromptsList() as AgentPrompt[]
    const currentApiConfig = useAppStore.getState().apiConfig
    setApiConfig({ ...currentApiConfig, agentPrompts: prompts })
  }, [setApiConfig])

  useEffect(() => {
    if (!isOpen) return
    refreshAgentPrompts().catch(() => { })
  }, [isOpen, refreshAgentPrompts])

  const handleSavePrompt = async (prompt: AgentPrompt): Promise<void> => {
    if (!window.api?.agentPromptsWrite) return
    await window.api.agentPromptsWrite(prompt)
    await refreshAgentPrompts()
  }

  const handleDeletePrompt = (id: string): void => {
    const prompt = agentPrompts.find(p => p.id === id)
    if (prompt) {
      setConfirmModal({
        isOpen: true,
        type: 'prompt',
        id,
        name: prompt.name
      })
    }
  }

  // 确认删除提示词
  const handleConfirmDeletePrompt = async (): Promise<void> => {
    if (window.api?.agentPromptsDelete) {
      await window.api.agentPromptsDelete(confirmModal.id)
      await refreshAgentPrompts()
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

      const newProviders = providers.map(p =>
        p.id === provider.id ? { ...p, validated: result.success } : p
      )
      setApiConfig({ ...apiConfig, providers: newProviders })

      if (result.success) {
        // 校验成功不弹窗，直接显示绿点
      } else {
        alert(`校验失败: ${result.error || '无法连接到服务器'}`)
      }
    } catch (error) {
      alert(`校验出错: ${error}`)
    } finally {
      setValidatingProviders(prev => ({ ...prev, [provider.id]: false }))
    }
  }

  const handleSaveProvider = (provider: ApiProvider): void => {
    const currentProviders = [...providers]
    const existingIndex = currentProviders.findIndex(p => p.id === provider.id)

    // 如果是编辑现有供应商且 Key 或 URL 发生了变化，重置校验状态
    const updatedProvider = { ...provider }
    if (existingIndex >= 0) {
      const old = currentProviders[existingIndex]
      if (old.apiKey !== provider.apiKey || old.baseUrl !== provider.baseUrl) {
        updatedProvider.validated = false
      }
    }

    if (existingIndex >= 0) currentProviders[existingIndex] = updatedProvider
    else currentProviders.push(updatedProvider)
    setApiConfig({ ...apiConfig, providers: currentProviders })
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
          <div className="flex items-center gap-2 text-text-primary">
            <img src={logo} alt="MultiChat Logo" className="w-10 h-10 object-contain" />
            <span className="font-semibold text-primary text-base">MultiChat</span>
          </div>

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


          {/* 总结 Agent 配置 */}
          <div>
            <h3 className="font-medium text-text-secondary mb-4">总结Agent配置</h3>

            <div className="space-y-4">
              {/* API 供应商管理 */}
              <div className="p-4 rounded-lg bg-sidebar/50 border border-gray-200">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm text-text-secondary">API 供应商 (多 Key 管理)</label>
                  <button
                    onClick={handleAddProvider}
                    className="flex items-center gap-1 text-xs text-primary hover:opacity-80 transition-colors"
                  >
                    <span className="material-symbols-outlined text-sm">add</span>
                    新增
                  </button>
                </div>
                <div className="space-y-2">
                  {providers.map(provider => (
                    <div
                      key={provider.id}
                      className="flex items-center justify-between p-2 bg-app/50 border border-gray-200 rounded-md group"
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={provider.enabled}
                          onChange={() => handleToggleProvider(provider.id)}
                          className="w-4 h-4 rounded border-gray-300 bg-sidebar text-primary focus:ring-primary/20"
                        />
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <span className="text-text-primary text-sm font-medium">{provider.name}</span>
                            {provider.validated && (
                              <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" title="校验通过" />
                            )}
                          </div>
                          <span className="text-gray-500 text-[10px] truncate max-w-[150px]">{provider.baseUrl}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleValidateProvider(provider)}
                          disabled={validatingProviders[provider.id]}
                          className="p-1 text-gray-500 hover:text-primary transition-colors disabled:opacity-50"
                          title="校验 API"
                        >
                          <span className={`material-symbols-outlined text-xl ${validatingProviders[provider.id] ? 'animate-spin' : ''}`}>
                            {validatingProviders[provider.id] ? 'sync' : 'verified'}
                          </span>
                        </button>
                        <button
                          onClick={() => handleEditProvider(provider)}
                          className="p-1 text-gray-500 hover:text-primary transition-colors"
                          title="编辑"
                        >
                          <span className="material-symbols-outlined text-xl">edit</span>
                        </button>
                        <button
                          onClick={() => handleDeleteProvider(provider.id)}
                          className="p-1 text-gray-500 hover:text-red-400 transition-colors"
                          title="删除"
                        >
                          <span className="material-symbols-outlined text-xl">delete</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 可用模型配置 */}
              <div className="p-4 rounded-lg bg-sidebar/50 border border-gray-200">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-text-secondary">可用总结模型 ({summaryModels.length})</label>
                  <button
                    onClick={() => setModelEditorOpen(true)}
                    className="text-xs text-primary hover:opacity-80 transition-colors"
                  >
                    同步/配置
                  </button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {summaryModels.slice(0, 5).map((model: SummaryModel) => (
                    <span key={`${model.providerId}-${model.id}`} className="px-2 py-0.5 bg-app text-text-secondary text-[10px] rounded">
                      {model.name}
                    </span>
                  ))}
                  {summaryModels.length > 5 && (
                    <span className="px-2 py-0.5 text-gray-500 text-[10px]">+{summaryModels.length - 5} 更多</span>
                  )}
                </div>
              </div>

              {/* Agent 提示词列表 */}
              <div className="p-4 rounded-lg bg-sidebar/50 border border-gray-200">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm text-text-secondary">Agent 提示词</label>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => window.api?.agentPromptsOpenFolder?.()}
                      className="p-1 text-gray-500 hover:text-text-primary transition-colors"
                      title="打开文件夹"
                      aria-label="打开文件夹"
                    >
                      <span className="material-symbols-outlined text-xl">folder_open</span>
                    </button>
                    <button
                      onClick={() => refreshAgentPrompts().catch(() => { })}
                      className="p-1 text-gray-500 hover:text-text-primary transition-colors"
                      title="刷新"
                      aria-label="刷新"
                    >
                      <span className="material-symbols-outlined text-xl">refresh</span>
                    </button>
                    <button
                      onClick={handleAddPrompt}
                      className="flex items-center gap-1 text-xs text-primary hover:opacity-80 transition-colors"
                    >
                      <span className="material-symbols-outlined text-sm">add</span>
                      新增
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  {sortedAgentPrompts.map(prompt => (
                    <div
                      key={prompt.id}
                      className="flex items-center justify-between py-2 px-3 bg-app/50 rounded-md hover:bg-app transition-colors group"
                    >
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-text-secondary text-sm truncate">{prompt.name}</span>
                          {prompt.isDefault && (
                            <span className="px-1.5 py-0.5 bg-sidebar text-gray-500 text-[10px] rounded shrink-0">预设</span>
                          )}
                        </div>
                        <div className="text-[11px] text-gray-500 truncate h-[14px] leading-[14px]">
                          {prompt.description || ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleEditPrompt(prompt)}
                          className="p-1 text-gray-500 hover:text-primary transition-colors"
                          title="编辑"
                        >
                          <span className="material-symbols-outlined text-xl">edit</span>
                        </button>
                        <button
                          onClick={() => handleDeletePrompt(prompt.id)}
                          className="p-1 text-gray-500 hover:text-red-400 transition-colors"
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
            <h3 className="font-medium text-text-secondary mb-4">划词悬浮工具条设置</h3>
            <div className="p-4 rounded-lg bg-sidebar/50 border border-gray-200 flex items-center justify-between">
              <div>
                <div className="text-sm text-text-secondary font-medium">启用划词悬浮工具条</div>
                <div className="text-xs text-gray-500 mt-1">开启后，选中文本松开鼠标将自动出现快捷操作栏</div>
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
            <h3 className="font-medium text-text-secondary mb-4">全局快捷键设置</h3>
            <div className="p-4 rounded-lg bg-sidebar/50 border border-gray-200 space-y-3">
              {[
                { key: 'summon', label: '唤醒快捷助手', placeholder: 'CommandOrControl+Shift+Space' },
                { key: 'summarize', label: '划词召唤 - 总结', placeholder: 'CommandOrControl+Shift+S' },
                { key: 'polish', label: '划词召唤 - 润色', placeholder: 'CommandOrControl+Shift+E' },
                { key: 'translate', label: '划词召唤 - 翻译', placeholder: 'CommandOrControl+Shift+T' },
                { key: 'raw', label: '划词召唤 - 纯文本入框', placeholder: 'CommandOrControl+Shift+Q' },
                { key: 'search', label: '划词召唤 - 搜索', placeholder: 'CommandOrControl+Shift+F' }
              ].map(({ key, label, placeholder }) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <label className="text-sm text-text-secondary">{label}</label>
                  <ShortcutRecorder
                    value={shortcuts[key] || ''}
                    onChange={(val) => handleShortcutChange(key, val)}
                    placeholder={placeholder}
                    defaultShortcut={key === 'summon' ? 'CommandOrControl+Shift+Space' : ''}
                  />
                </div>
              ))}
              <p className="text-xs text-gray-500 mt-2">点击设置框后，直接在键盘上按下组合快捷键即可自动录制（按 Esc 取消）</p>
            </div>
          </div>

          {/* 文件目录设置 */}
          <div>
            <h3 className="font-medium text-text-secondary mb-4">文件目录设置</h3>
            <div className="p-4 rounded-lg bg-sidebar/50 border border-gray-200 space-y-4">
              <div>
                <label className="block text-sm text-text-secondary mb-2">总结导出文件夹</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="选择导出目录..."
                    value={apiConfig.exportDirectory || ''}
                    readOnly
                    className="flex-1 px-3 py-2 bg-app border border-gray-200 rounded-md text-text-secondary placeholder-gray-500 text-sm"
                  />
                  <button
                    onClick={handleSelectDirectory}
                    className="px-4 py-2 bg-gray-100 text-text-secondary rounded-md hover:bg-gray-200 transition-colors text-sm"
                  >
                    浏览
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-2">应用缓存数据</label>
                <button
                  onClick={handleExportCache}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-text-secondary rounded-md hover:bg-gray-200 transition-colors text-sm"
                >
                  <span className="material-symbols-outlined text-sm">download</span>
                  导出缓存数据
                </button>
                <p className="text-xs text-gray-500 mt-1">导出为 JSON 文件，API Key 等敏感信息将被自动脱敏</p>
              </div>
            </div>
          </div>

          {/* 使用说明 */}
          <div>
            <h3 className="font-medium text-text-secondary mb-4">使用说明</h3>
            <div className="p-4 rounded-lg bg-sidebar/50 border border-gray-200">
              <a
                href="https://ai.feishu.cn/docx/TiLFdnaPjo7ZnQx7J5JcFMLInsd"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-3 bg-app/50 border border-gray-200 rounded-md hover:bg-app transition-all group"
              >
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-text-secondary text-xl">help</span>
                  <div className="flex flex-col">
                    <span className="text-text-primary text-sm font-medium">查看使用说明</span>
                    <span className="text-gray-500 text-[10px]">了解如何配置、使用和管理 API Key</span>
                  </div>
                </div>
                <span className="material-symbols-outlined text-gray-400 group-hover:text-primary transition-colors">
                  open_in_new
                </span>
              </a>
            </div>
          </div>

          {/* Dev-only 诊断入口 */}
          {import.meta.env.DEV && (
            <div>
              <h3 className="font-medium text-text-secondary mb-4">开发工具</h3>
              <button
                type="button"
                onClick={() => { void window.api.diagnosticsOpenWindow() }}
                className="px-3 py-2 text-sm rounded-lg border border-border text-text-primary hover:bg-white/60 w-full"
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

      {/* 确认删除弹窗 */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={`删除${confirmModal.type === 'prompt' ? '提示词' : '供应商'}`}
        message={`确定要删除 "${confirmModal.name}" 吗？此操作不可恢复。`}
        confirmText="删除"
        cancelText="取消"
        type="danger"
        onConfirm={() => {
          if (confirmModal.type === 'prompt') {
            handleConfirmDeletePrompt()
          } else {
            handleConfirmDeleteProvider()
          }
        }}
        onCancel={() => setConfirmModal({ ...confirmModal, isOpen: false })}
      />
    </>
  )
}

export default SettingsDrawer
