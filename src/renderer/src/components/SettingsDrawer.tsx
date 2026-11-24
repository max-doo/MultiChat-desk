import { useState, useCallback, useEffect } from 'react'
import { useAppStore, type SummaryPrompt, type ApiConfig } from '../store/appStore'
import logo from '../assets/logo.png'
import ConfirmModal from './ConfirmModal'
import ShortcutRecorder from './ShortcutRecorder'
import ImportCacheConfirmModal from './ImportCacheConfirmModal'
import AboutSection from './AboutSection'
import CliIntegrationSection from './CliIntegrationSection'
import ModelOrderModal from './ModelOrderModal'
import ProductModeOrderModal from './ProductModeOrderModal'
import { openUpdateRelease, useUpdateReminder } from '../hooks/useUpdateState'
import { AppIcon } from './icons/AppIcon'

interface SettingsDrawerProps {
  isOpen: boolean
  onClose: () => void
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
            <AppIcon name="close" />
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

/**
 * 设置抽屉组件
 * 从左侧滑出，包含显示模式、API 配置、文件目录等设置
 */
function SettingsDrawer({ isOpen, onClose }: SettingsDrawerProps): JSX.Element {
  const { apiConfig, setApiConfig } = useAppStore()
  const { hasUpdate, releaseUrl } = useUpdateReminder()

  // 弹窗状态
  const [promptEditorOpen, setPromptEditorOpen] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<SummaryPrompt | null>(null)
  const [isNewPrompt, setIsNewPrompt] = useState(false)

  const [modelOrderOpen, setModelOrderOpen] = useState(false)
  const [modeOrderOpen, setModeOrderOpen] = useState(false)

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
    type: 'prompt'
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

  // 处理备份配置与业务数据
  const handleExportCache = async (): Promise<void> => {
    if (!window.api?.exportCache) {
      console.error('exportCache API 不可用')
      return
    }
    await useAppStore.getState().retryHistorySave()
    const saveError = useAppStore.getState().historySaveError
    if (saveError) { alert(`历史尚未保存，备份未开始：${saveError}`); return }
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
    businessCounts?: Record<string, { added: number; unchanged: number; conflicts: number }>
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

    setImportPreview({
      isOpen: true,
      file: data.file,
      keys: data.keys,
      conflicts: data.conflicts,
      values: data.values,
      businessCounts: data.businessCounts
    })
  }

  // 确认导入：逐键写入，再刷新内存态（providers/summaryModels 已废弃，导入的旧键不再回填）
  const handleConfirmImportCache = async (overwriteBusiness = false): Promise<void> => {
    if (!importPreview || !window.api?.storeSet) return
    const { keys, values } = importPreview

    try {
    for (const k of keys) {
      if (k === 'history' || k === 'summaryHistory' || k === 'notes') {
        const result = k === 'notes' ? await window.api.notesImport(values[k], overwriteBusiness) : await window.api.historyImport(k === 'history' ? 'conversation' : 'summary', values[k], overwriteBusiness)
        if (!result.success) throw new Error(result.error || '恢复业务数据失败')
        continue
      }
      const value = values[k]
      if (k === 'apiConfig' && value && typeof value === 'object') {
        // 旧备份可能带 providers/apiKey 等废弃字段，剥掉后只保留模板字段。
        const { providers: _p, activeProviderId: _a, lastSelectedAgentId: _l, apiKey: _k, baseUrl: _b, ...rest } = value as Record<string, unknown>
        await window.api.storeSet(k, { ...rest, summaryPrompts: rest.summaryPrompts })
        continue
      }
      if (k === 'summaryModels') continue // 已废弃键，导入忽略
      await window.api.storeSet(k, value)
    }
    } catch (error) { alert(error instanceof Error ? error.message : '恢复失败，已完成的数据保留，可安全重试'); return }
    await useAppStore.getState().refreshHistoryLists()

    // 刷新内存态：重新从 store 读取并写回 zustand
    try {
      const apiConfigVal = await window.api.storeGet('apiConfig') as ApiConfig | undefined
      const patch: Record<string, unknown> = {}
      if (apiConfigVal) patch.apiConfig = apiConfigVal
      if (Object.keys(patch).length > 0) useAppStore.setState(patch)
    } catch (e) {
      console.warn('导入后刷新内存态失败，建议重启应用:', e)
    }

    setImportPreview(null)
    alert('数据恢复完成。历史、笔记和导图已刷新；其他配置建议重启后使用。')
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
              <span className="text-tiny leading-none font-bold text-red-500 bg-red-50 border border-red-200 px-1.5 py-1 rounded-full">NEW</span>
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
            <AppIcon name="close" size={24} />
          </button>
        </div>

        {/* 设置内容：可滚动区域 */}
        <div className="flex-1 p-6 space-y-8 overflow-y-auto">

          {/* 主页模式设置 */}
          <div>
            <h3 className="flex items-center gap-2 font-semibold text-text-primary mb-4">
              <AppIcon name="view_column_2" size={20} className="text-primary" />
              主页模式设置
            </h3>
            <div className="p-4 rounded-xl glass-panel flex items-center justify-between">
              <div>
                <div className="text-sm text-text-primary font-medium">自定义模式入口</div>
                <div className="text-xs text-text-secondary mt-1">调整标题栏模式切换的顺序与显示，至少保留两个</div>
              </div>
              <button
                type="button"
                onClick={() => setModeOrderOpen(true)}
                className="flex items-center gap-1 text-sm text-primary hover:opacity-80 transition-colors font-medium shrink-0 ml-4"
              >
                <AppIcon name="tune" size={16} />
                调整
              </button>
            </div>
          </div>
          <div>
            <h3 className="flex items-center gap-2 font-semibold text-text-primary mb-4">
              <AppIcon name="account_tree" size={20} className="text-primary" />
              任务分配与总结设置
            </h3>
            <div className="space-y-4">
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
                      <AppIcon name="folder_open" size={20} />
                    </button>
                    <button
                      onClick={() => refreshSummaryPrompts().catch(() => { })}
                      className="p-1 text-text-secondary hover:text-text-primary transition-colors"
                      title="刷新"
                      aria-label="刷新"
                    >
                      <AppIcon name="refresh" size={20} />
                    </button>
                    <button
                      onClick={handleAddPrompt}
                      className="flex items-center gap-1 text-xs text-primary hover:opacity-80 transition-colors font-medium"
                    >
                      <AppIcon name="add" size={14} />
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
                            <span className="px-1.5 py-0.5 bg-primary/10 text-primary text-tiny rounded shrink-0 font-medium">预设</span>
                          )}
                        </div>
                        <div className="text-caption text-text-secondary truncate h-[14px] leading-[14px]">
                          {prompt.description || ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleEditPrompt(prompt)}
                          className="p-1 text-text-secondary hover:text-primary transition-colors"
                          title="编辑"
                        >
                          <AppIcon name="edit" size={20} />
                        </button>
                        <button
                          onClick={() => handleDeletePrompt(prompt.id)}
                          className="p-1 text-text-secondary hover:text-red-400 transition-colors"
                          title="删除"
                        >
                          <AppIcon name="delete" size={20} />
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
              <AppIcon name="text_select_start" size={20} className="text-primary" />
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
              <AppIcon name="keyboard" size={20} className="text-primary" />
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

          {/* 模型下拉列表排序设置 */}
          <div>
            <h3 className="flex items-center gap-2 font-semibold text-text-primary mb-4">
              <AppIcon name="swap_vert" size={20} className="text-primary" />
              模型下拉列表排序
            </h3>
            <div className="p-4 rounded-xl glass-panel flex items-center justify-between">
              <div>
                <div className="text-sm text-text-primary font-medium">自定义模型显示顺序</div>
                <div className="text-xs text-text-secondary mt-1">将常用模型排在前面</div>
              </div>
              <button
                type="button"
                onClick={() => setModelOrderOpen(true)}
                className="flex items-center gap-1 text-sm text-primary hover:opacity-80 transition-colors font-medium shrink-0 ml-4"
              >
                <AppIcon name="tune" size={16} />
                调整排序
              </button>
            </div>
          </div>

          {/* 文件目录设置 */}
          <div>
            <h3 className="flex items-center gap-2 font-semibold text-text-primary mb-4">
              <AppIcon name="folder_special" size={20} className="text-primary" />
              文件与缓存
            </h3>
            <div className="p-4 rounded-xl glass-panel space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">应用缓存数据</label>
                <div className="flex gap-2">
                  <button
                    onClick={handleExportCache}
                    className="flex items-center gap-2 px-4 py-2 rounded-full glass-panel text-text-primary hover:text-primary hover:bg-blue-50/50 transition-all text-sm font-medium"
                  >
                    <AppIcon name="download" size={14} />
                    备份配置与业务数据
                  </button>
                  <button
                    onClick={handleImportCache}
                    className="flex items-center gap-2 px-4 py-2 rounded-full glass-panel text-text-primary hover:text-primary hover:bg-blue-50/50 transition-all text-sm font-medium"
                  >
                    <AppIcon name="upload" size={14} />
                    恢复配置与业务数据
                  </button>
                </div>
                <p className="text-xs text-text-secondary mt-1.5">导出为 JSON 文件，包含配置、历史、笔记与导图数据</p>
              </div>
            </div>
          </div>

          {/* 命令行与 Agent 集成 */}
          <div>
            <h3 className="flex items-center gap-2 font-semibold text-text-primary mb-4">
              <AppIcon name="terminal" size={20} className="text-primary" />
              命令行与 Agent 集成
            </h3>
            <CliIntegrationSection />
          </div>

          {/* 关于 */}
          <div>
            <h3 className="flex items-center gap-2 font-semibold text-text-primary mb-4">
              <AppIcon name="info" size={20} className="text-primary" />
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
                  <AppIcon name="help" size={20} className="text-primary" />
                  <div className="flex flex-col">
                    <span className="text-text-primary text-sm font-medium">查看使用说明</span>
                    <span className="text-text-secondary text-tiny">查看功能说明与常见问题</span>
                  </div>
                </div>
                <AppIcon name="open_in_new" className="text-text-secondary group-hover:text-primary transition-colors" />
              </a>
              <AboutSection />
            </div>
          </div>

          {/* Dev-only 诊断入口 */}
          {import.meta.env.DEV && (
            <div>
              <h3 className="flex items-center gap-2 font-semibold text-text-primary mb-4">
                <AppIcon name="build" size={20} className="text-primary" />
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

      {/* 确认弹窗（删除提示词） */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title="删除总结提示词"
        message={`确定要删除 "${confirmModal.name}" 吗？此操作不可恢复。`}
        confirmText="删除"
        cancelText="取消"
        type="danger"
        onConfirm={() => void handleConfirmDeletePrompt()}
        onCancel={() => setConfirmModal({ ...confirmModal, isOpen: false })}
      />

      {/* 导入缓存预览弹窗 */}
      <ImportCacheConfirmModal
        isOpen={importPreview?.isOpen ?? false}
        file={importPreview?.file ?? ''}
        keys={importPreview?.keys ?? []}
        conflicts={importPreview?.conflicts ?? []}
        businessCounts={importPreview?.businessCounts}
        onConfirm={handleConfirmImportCache}
        onCancel={() => setImportPreview(null)}
      />

      {/* 模型下拉排序弹窗 */}
      <ModelOrderModal
        isOpen={modelOrderOpen}
        onClose={() => setModelOrderOpen(false)}
      />

      {/* 主页面模式切换排序/显隐弹窗 */}
      <ProductModeOrderModal
        isOpen={modeOrderOpen}
        onClose={() => setModeOrderOpen(false)}
      />
    </>
  )
}

export default SettingsDrawer
