import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  useAppStore,
  DEFAULT_PRODUCT_MODE_CONFIG,
  DEEP_RESEARCH_SUPPORTED_MODEL_IDS,
  IMAGE_GENERATION_SUPPORTED_MODEL_IDS,
  type SummaryPrompt,
  type ApiConfig,
  type ModelConfig,
  type ProductMode,
  type ProductModeConfig
} from '../store/appStore'
import { useUpdateReminder, openUpdateRelease } from '../hooks/useUpdateState'
import logo from '../assets/logo.png'
import ShortcutRecorder from '../components/ShortcutRecorder'
import AboutSection from '../components/AboutSection'
import CliIntegrationSection from '../components/CliIntegrationSection'
import { AgentProviderSettings } from '../components/workbench/agent/AgentProviderSettings'
import { AgentSkillsSettings } from '../components/workbench/agent/AgentSkillsSettings'
import { AppIcon, type AppIconName } from '../components/icons/AppIcon'

type SettingsSectionId =
  | 'interface'
  | 'agent'
  | 'summary'
  | 'selection'
  | 'shortcuts'
  | 'storage'
  | 'cli'
  | 'about'
  | 'dev'

interface NavSectionItem {
  id: SettingsSectionId
  label: string
  icon: AppIconName
  group: 'general' | 'system'
}

const BASE_NAV_SECTIONS: NavSectionItem[] = [
  { id: 'interface', label: '界面与模式', icon: 'view_column_2', group: 'general' },
  { id: 'agent', label: 'Agent 配置', icon: 'smart_toy', group: 'general' },
  { id: 'summary', label: '任务与总结', icon: 'account_tree', group: 'general' },
  { id: 'selection', label: '划词工具条', icon: 'text_select_start', group: 'general' },
  { id: 'shortcuts', label: '全局快捷键', icon: 'keyboard', group: 'general' },
  { id: 'storage', label: '数据与备份', icon: 'folder_special', group: 'system' },
  { id: 'cli', label: '命令行集成', icon: 'terminal', group: 'system' },
  { id: 'about', label: '关于与更新', icon: 'info', group: 'system' }
]

const MODE_META: Record<ProductMode, { label: string; description: string; icon: AppIconName }> = {
  multi_ai: { label: '多AI', description: '多平台并排对话', icon: 'grid_view' },
  task_assignment: { label: '任务分配', description: '单 AI 多窗拆解', icon: 'account_tree' },
  debate: { label: '辩论', description: '双 AI 对抗辩论', icon: 'gavel' },
  workbench: { label: '工作台', description: '知识库与 AI 协同', icon: 'work' }
}

const SHORTCUT_LABELS: Record<string, string> = {
  summon: '唤醒快捷助手',
  summarize: '划词召唤 - 总结',
  polish: '划词召唤 - 润色',
  translate: '划词召唤 - 翻译',
  raw: '划词召唤 - 纯文本入框',
  search: '划词召唤 - 搜索'
}

const SHORTCUT_ITEMS = [
  { key: 'summon', label: '唤醒快捷助手', placeholder: 'CommandOrControl+Shift+Space' },
  { key: 'summarize', label: '划词召唤 - 总结', placeholder: 'CommandOrControl+Shift+S' },
  { key: 'polish', label: '划词召唤 - 润色', placeholder: 'CommandOrControl+Shift+E' },
  { key: 'translate', label: '划词召唤 - 翻译', placeholder: 'CommandOrControl+Shift+T' },
  { key: 'raw', label: '划词召唤 - 纯文本入框', placeholder: 'CommandOrControl+Shift+Q' },
  { key: 'search', label: '划词召唤 - 搜索', placeholder: 'CommandOrControl+Shift+F' }
] as const

const CACHE_KEY_LABELS: Record<string, string> = {
  displayMode: '显示模式',
  models: '主界面模型列表',
  apiConfig: '总结与任务分配配置',
  summaryModels: '任务分配可用模型（已废弃，导入忽略）',
  history: '主界面对话历史',
  summaryHistory: '总结历史记录',
  notes: '笔记、共享快照与思维导图',
  geminiAccountUrl: 'Gemini 账户 URL'
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

interface SectionHeaderProps {
  icon: AppIconName
  title: string
  description?: string
}

function SectionHeader({ icon, title, description }: SectionHeaderProps): JSX.Element {
  return (
    <div className="mb-3 flex items-start gap-2.5">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <AppIcon name={icon} size={16} />
      </div>
      <div className="min-w-0">
        <h2 className="text-title font-semibold text-text-primary">{title}</h2>
        {description && <p className="mt-0.5 text-caption text-text-secondary">{description}</p>}
      </div>
    </div>
  )
}

interface InlineFeedbackProps {
  tone: 'error' | 'success' | 'info'
  message: string
  onDismiss?: () => void
}

function InlineFeedback({ tone, message, onDismiss }: InlineFeedbackProps): JSX.Element {
  const toneClass =
    tone === 'error'
      ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
      : tone === 'success'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
        : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300'
  return (
    <div className={`flex items-start justify-between gap-2 rounded-lg border px-3 py-2 text-label ${toneClass}`}>
      <span className="break-words">{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 opacity-70 transition-opacity hover:opacity-100"
          aria-label="关闭提示"
        >
          <AppIcon name="close" size={14} />
        </button>
      )}
    </div>
  )
}

interface InlinePromptEditorProps {
  prompt: SummaryPrompt | null
  isNew?: boolean
  onSave: (prompt: SummaryPrompt) => Promise<void>
  onCancel: () => void
}

function InlinePromptEditor({
  prompt,
  isNew,
  onSave,
  onCancel
}: InlinePromptEditorProps): JSX.Element {
  const [name, setName] = useState(prompt?.name ?? '')
  const [description, setDescription] = useState(prompt?.description ?? '')
  const [promptText, setPromptText] = useState(prompt?.prompt ?? '')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    setName(prompt?.name ?? '')
    setDescription(prompt?.description ?? '')
    setPromptText(prompt?.prompt ?? '')
  }, [prompt])

  const handleSubmit = async (): Promise<void> => {
    if (!name.trim() || isSaving) return
    setIsSaving(true)
    try {
      await onSave({
        id: prompt?.id || String(Date.now()),
        name: name.trim(),
        description: description.trim() ? description.trim() : undefined,
        prompt: promptText.trim(),
        isDefault: prompt?.isDefault || false
      })
      onCancel()
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-primary/25 bg-white/80 p-3.5 dark:border-white/15 dark:bg-white/5">
      <div className="flex items-center justify-between">
        <span className="text-body font-medium text-text-primary">
          {isNew ? '新增总结提示词' : `编辑提示词：${prompt?.name || ''}`}
        </span>
      </div>
      <div>
        <label className="mb-1 block text-label font-medium text-text-primary">名称</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="输入提示词名称"
          className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50/80 px-3 text-body text-text-primary placeholder:text-gray-400 focus:border-primary focus:bg-white focus:outline-none dark:border-slate-700/80 dark:bg-slate-800/50 dark:focus:bg-slate-800"
        />
      </div>
      <div>
        <label className="mb-1 block text-label font-medium text-text-primary">描述</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="一句话描述这个提示词的用途（可选）"
          className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50/80 px-3 text-body text-text-primary placeholder:text-gray-400 focus:border-primary focus:bg-white focus:outline-none dark:border-slate-700/80 dark:bg-slate-800/50 dark:focus:bg-slate-800"
        />
      </div>
      <div>
        <label className="mb-1 block text-label font-medium text-text-primary">提示词内容</label>
        <textarea
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          placeholder="输入提示词内容..."
          rows={7}
          className="w-full resize-y rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 font-mono text-body text-text-primary placeholder:text-gray-400 focus:border-primary focus:bg-white focus:outline-none dark:border-slate-700/80 dark:bg-slate-800/50 dark:focus:bg-slate-800"
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="h-9 rounded-lg border border-gray-200 bg-sidebar px-3.5 text-body text-text-secondary transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => {
            void handleSubmit()
          }}
          disabled={!name.trim() || isSaving}
          className="h-9 rounded-lg bg-primary px-4 text-body font-medium text-white shadow-soft transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  )
}

/** 内联：主页模式顺序与显隐管理 */
function ProductModeOrderCard(): JSX.Element {
  const productModeConfig = useAppStore((state) => state.productModeConfig)
  const setProductModeConfig = useAppStore((state) => state.setProductModeConfig)

  const [orderedList, setOrderedList] = useState<ProductMode[]>(productModeConfig.order)
  const [hiddenList, setHiddenList] = useState<ProductMode[]>(productModeConfig.hidden)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  useEffect(() => {
    setOrderedList(productModeConfig.order)
    setHiddenList(productModeConfig.hidden)
  }, [productModeConfig])

  const commit = (order: ProductMode[], hidden: ProductMode[]): void => {
    const next: ProductModeConfig = { order, hidden }
    setOrderedList(order)
    setHiddenList(hidden)
    setProductModeConfig(next)
  }

  const handleDrop = (targetIndex: number): void => {
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null)
      setDragOverIndex(null)
      return
    }
    const nextList = [...orderedList]
    const [moved] = nextList.splice(draggedIndex, 1)
    nextList.splice(targetIndex, 0, moved)
    setDraggedIndex(null)
    setDragOverIndex(null)
    commit(nextList, hiddenList)
  }

  const handleToggleVisible = (mode: ProductMode): void => {
    if (hiddenList.includes(mode)) {
      commit(orderedList, hiddenList.filter((m) => m !== mode))
    } else {
      if (orderedList.length - hiddenList.length <= 2) return
      commit(orderedList, [...hiddenList, mode])
    }
  }

  const handleResetDefault = (): void => {
    commit([...DEFAULT_PRODUCT_MODE_CONFIG.order], [...DEFAULT_PRODUCT_MODE_CONFIG.hidden])
  }

  const visibleCount = orderedList.length - hiddenList.length

  return (
    <div className="rounded-xl glass-panel p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <div className="shrink-0 text-body font-medium text-text-primary">主页模式入口</div>
          <div className="truncate text-caption text-text-secondary">
            拖拽排序 · 至少保留 2 个
          </div>
        </div>
        <button
          type="button"
          onClick={handleResetDefault}
          className="flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-label font-medium text-text-secondary transition-colors hover:bg-black/5 hover:text-primary dark:hover:bg-white/10"
        >
          <AppIcon name="restart_alt" size={14} />
          <span>恢复默认</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 select-none">
        {orderedList.map((mode, index) => {
          const meta = MODE_META[mode]
          const isDragging = draggedIndex === index
          const isDragOver = dragOverIndex === index && draggedIndex !== index
          const isHidden = hiddenList.includes(mode)
          const hideDisabled = !isHidden && visibleCount <= 2

          return (
            <div
              key={mode}
              draggable
              onDragStart={(e) => {
                setDraggedIndex(index)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', String(index))
              }}
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (dragOverIndex !== index) setDragOverIndex(index)
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return
                if (dragOverIndex === index) setDragOverIndex(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                handleDrop(index)
              }}
              onDragEnd={() => {
                setDraggedIndex(null)
                setDragOverIndex(null)
              }}
              className={`flex cursor-grab flex-col gap-1.5 rounded-lg border px-3 py-2.5 transition-all active:cursor-grabbing ${
                isDragging
                  ? 'scale-[0.98] border-dashed border-gray-400 bg-gray-100 opacity-40'
                  : isDragOver
                    ? 'border-primary bg-primary/10 ring-2 ring-primary/25 shadow-sm'
                    : `border-white/70 bg-white/55 hover:bg-white/80 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10 ${
                        isHidden ? 'opacity-55' : ''
                      }`
              }`}
            >
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <AppIcon name="drag_indicator" size={14} className="shrink-0 text-gray-400" />
                  <AppIcon
                    name={meta.icon}
                    size={16}
                    className={`shrink-0 ${isHidden ? 'text-gray-400' : 'text-primary'}`}
                  />
                  <span
                    className={`truncate text-body font-medium ${
                      isHidden ? 'text-text-secondary' : 'text-text-primary'
                    }`}
                  >
                    {meta.label}
                  </span>
                </div>

                <button
                  type="button"
                  disabled={hideDisabled}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleToggleVisible(mode)
                  }}
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors ${
                    isHidden
                      ? 'text-gray-400 hover:bg-black/5 hover:text-primary'
                      : 'text-primary hover:bg-black/5'
                  } disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-white/10`}
                  title={isHidden ? '显示' : hideDisabled ? '至少保留两个模式' : '隐藏'}
                >
                  <AppIcon name={isHidden ? 'visibility_off' : 'visibility'} size={15} />
                </button>
              </div>

              <div className="truncate pl-5 text-caption text-text-secondary">
                {meta.description}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 内联：模型下拉列表排序与显隐管理 */
function ModelOrderCard(): JSX.Element {
  const models = useAppStore((state) => state.models)
  const reorderModels = useAppStore((state) => state.reorderModels)
  const toggleModelVisibility = useAppStore((state) => state.toggleModelVisibility)
  const resetModelsConfig = useAppStore((state) => state.resetModelsConfig)

  const [orderedList, setOrderedList] = useState<ModelConfig[]>(models)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  useEffect(() => {
    setOrderedList(models)
  }, [models])

  const handleDrop = (targetIndex: number): void => {
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null)
      setDragOverIndex(null)
      return
    }
    const nextList = [...orderedList]
    const [moved] = nextList.splice(draggedIndex, 1)
    nextList.splice(targetIndex, 0, moved)
    setOrderedList(nextList)
    setDraggedIndex(null)
    setDragOverIndex(null)
    reorderModels(nextList.map((m) => m.id))
  }

  const visibleCount = orderedList.filter((m) => !m.hidden).length

  return (
    <div className="rounded-xl glass-panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-2.5">
          <div className="shrink-0 text-body font-medium text-text-primary">模型下拉列表</div>
          <div className="text-caption text-text-secondary">
            拖拽排序 · 显隐联动选择器
          </div>
          <span className="inline-flex items-center rounded-full border border-white/70 bg-white/55 px-2 py-0.5 text-tiny text-text-secondary dark:border-white/10 dark:bg-white/5">
            {visibleCount} / {orderedList.length} 可见
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div className="hidden items-center gap-3 text-caption text-text-secondary sm:flex">
            <span className="inline-flex items-center gap-1">
              <AppIcon name="biotech" size={14} className="text-gray-400" />
              <span>深度研究</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <AppIcon name="image" size={14} className="text-gray-400" />
              <span>AI 生图</span>
            </span>
          </div>
          <button
            type="button"
            onClick={resetModelsConfig}
            className="flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-label font-medium text-text-secondary transition-colors hover:bg-black/5 hover:text-primary dark:hover:bg-white/10"
          >
            <AppIcon name="restart_alt" size={14} />
            <span>恢复默认</span>
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-white/70 bg-white/55 divide-y divide-black/[0.05] dark:border-white/10 dark:bg-white/5 dark:divide-white/10 select-none">
        {orderedList.map((model, index) => {
          const isDragging = draggedIndex === index
          const isDragOver = dragOverIndex === index && draggedIndex !== index
          const isHidden = Boolean(model.hidden)
          const hideDisabled = !isHidden && visibleCount <= 1
          const hasDeepResearch = DEEP_RESEARCH_SUPPORTED_MODEL_IDS.has(model.id)
          const hasImageGen = IMAGE_GENERATION_SUPPORTED_MODEL_IDS.has(model.id)

          return (
            <div
              key={model.id}
              draggable
              onDragStart={(e) => {
                setDraggedIndex(index)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', String(index))
              }}
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (dragOverIndex !== index) setDragOverIndex(index)
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return
                if (dragOverIndex === index) setDragOverIndex(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                handleDrop(index)
              }}
              onDragEnd={() => {
                setDraggedIndex(null)
                setDragOverIndex(null)
              }}
              className={`flex cursor-grab items-center justify-between px-3.5 py-2 transition-colors active:cursor-grabbing ${
                isDragging
                  ? 'bg-gray-100/80 opacity-40 dark:bg-white/10'
                  : isDragOver
                    ? 'bg-primary/10 ring-1 ring-inset ring-primary/50'
                    : `hover:bg-white/80 dark:hover:bg-white/10 ${isHidden ? 'opacity-55' : ''}`
              }`}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <AppIcon name="drag_indicator" size={15} className="shrink-0 text-gray-400" />
                <img
                  src={model.logo}
                  alt={model.name}
                  className="h-5 w-5 shrink-0 rounded object-contain"
                />
                <span
                  className={`truncate text-body font-medium ${
                    isHidden ? 'text-text-secondary' : 'text-text-primary'
                  }`}
                >
                  {model.name}
                </span>
              </div>

              <div className="ml-2 flex shrink-0 items-center gap-1.5">
                {hasDeepResearch && (
                  <AppIcon
                    name="biotech"
                    size={15}
                    className="text-gray-400 transition-colors hover:text-gray-600"
                    title="深度研究"
                  />
                )}
                {hasImageGen && (
                  <AppIcon
                    name="image"
                    size={15}
                    className="text-gray-400 transition-colors hover:text-gray-600"
                    title="AI 生图"
                  />
                )}
                <button
                  type="button"
                  disabled={hideDisabled}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleModelVisibility(model.id)
                  }}
                  className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                    isHidden
                      ? 'text-gray-400 hover:bg-black/5 hover:text-primary'
                      : 'text-primary hover:bg-black/5'
                  } disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-white/10`}
                  title={
                    isHidden
                      ? '在模型选择器中显示'
                      : hideDisabled
                        ? '至少保留一个可见模型'
                        : '在模型选择器中隐藏'
                  }
                >
                  <AppIcon name={isHidden ? 'visibility_off' : 'visibility'} size={15} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 二级设置页面
 * 所有配置项均在当前页内完成，无二级弹窗；左侧透明背景导航栏与右侧连续内容区双向滚动联动
 */
export default function SettingsPage(): JSX.Element {
  const { apiConfig, setApiConfig } = useAppStore()
  const { hasUpdate, releaseUrl } = useUpdateReminder()

  const navSections = useMemo<NavSectionItem[]>(() => {
    if (import.meta.env.DEV) {
      return [
        ...BASE_NAV_SECTIONS,
        { id: 'dev', label: '开发工具', icon: 'build', group: 'system' }
      ]
    }
    return BASE_NAV_SECTIONS
  }, [])

  const generalSections = useMemo(
    () => navSections.filter((s) => s.group === 'general'),
    [navSections]
  )
  const systemSections = useMemo(
    () => navSections.filter((s) => s.group === 'system'),
    [navSections]
  )

  // 导航与滚动联动状态
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('interface')
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<Partial<Record<SettingsSectionId, HTMLElement | null>>>({})
  const isProgrammaticScrollRef = useRef(false)
  const scrollUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollRafRef = useRef<number | null>(null)

  const clearProgrammaticLock = useCallback(() => {
    isProgrammaticScrollRef.current = false
    if (scrollUnlockTimerRef.current) {
      clearTimeout(scrollUnlockTimerRef.current)
      scrollUnlockTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      if (scrollUnlockTimerRef.current) clearTimeout(scrollUnlockTimerRef.current)
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current)
    }
  }, [])

  const updateActiveSectionFromScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container || isProgrammaticScrollRef.current) return

    const { scrollTop, clientHeight, scrollHeight } = container
    if (scrollTop <= 16) {
      setActiveSection(navSections[0].id)
      return
    }
    if (scrollTop + clientHeight >= scrollHeight - 24) {
      setActiveSection(navSections[navSections.length - 1].id)
      return
    }

    const containerTop = container.getBoundingClientRect().top
    const anchorY = containerTop + 120
    let matchedId: SettingsSectionId = navSections[0].id

    for (const item of navSections) {
      const el = sectionRefs.current[item.id]
      if (!el) continue
      if (el.getBoundingClientRect().top <= anchorY) {
        matchedId = item.id
      }
    }
    setActiveSection(matchedId)
  }, [navSections])

  const handleContentScroll = useCallback(() => {
    if (isProgrammaticScrollRef.current) {
      if (scrollUnlockTimerRef.current) clearTimeout(scrollUnlockTimerRef.current)
      scrollUnlockTimerRef.current = setTimeout(() => {
        isProgrammaticScrollRef.current = false
        scrollUnlockTimerRef.current = null
      }, 150)
      return
    }
    if (scrollRafRef.current !== null) return
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null
      updateActiveSectionFromScroll()
    })
  }, [updateActiveSectionFromScroll])

  const handleNavClick = useCallback((id: SettingsSectionId) => {
    const container = scrollContainerRef.current
    const targetEl = sectionRefs.current[id]
    setActiveSection(id)
    if (!container || !targetEl) return

    isProgrammaticScrollRef.current = true
    if (scrollUnlockTimerRef.current) clearTimeout(scrollUnlockTimerRef.current)
    scrollUnlockTimerRef.current = setTimeout(() => {
      isProgrammaticScrollRef.current = false
      scrollUnlockTimerRef.current = null
    }, 700)

    const containerTop = container.getBoundingClientRect().top
    const targetTop = container.scrollTop + (targetEl.getBoundingClientRect().top - containerTop) - 24
    container.scrollTo({
      top: Math.max(0, targetTop),
      behavior: 'smooth'
    })
  }, [])

  const setSectionRef = useCallback(
    (id: SettingsSectionId) => (el: HTMLElement | null) => {
      sectionRefs.current[id] = el
    },
    []
  )

  // 总结提示词内联编辑 / 删除确认状态
  const [addingPrompt, setAddingPrompt] = useState(false)
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null)
  const [deletingPromptId, setDeletingPromptId] = useState<string | null>(null)
  const [deletingPromptBusy, setDeletingPromptBusy] = useState(false)

  // 划词悬浮工具条状态与内联反馈
  const [selectionToolbarEnabled, setSelectionToolbarEnabled] = useState<boolean>(false)
  const [selectionPermission, setSelectionPermission] = useState<string>('unknown')
  const [selectionError, setSelectionError] = useState<string | null>(null)

  useEffect(() => {
    if (window.api?.selectionToolbarGet) {
      window.api.selectionToolbarGet().then((res) => {
        if (res.success && res.data !== undefined) {
          setSelectionToolbarEnabled(res.data)
        }
      })
      if (window.api.platform === 'darwin' && window.api.selectionPermissionGet) {
        window.api.selectionPermissionGet().then((res) => {
          if (res.success && res.data) setSelectionPermission(res.data)
        })
      }
    }
  }, [])

  const handleSelectionToolbarChange = async (enabled: boolean): Promise<void> => {
    setSelectionError(null)
    if (window.api?.selectionToolbarSet) {
      const result = await window.api.selectionToolbarSet(enabled)
      if (!result.success) {
        setSelectionError(result.error || '无法启用划词悬浮工具条')
        return
      }
    }
    setSelectionToolbarEnabled(enabled)
  }

  // 全局快捷键状态与内联冲突反馈
  const [shortcuts, setShortcuts] = useState<Record<string, string>>({
    summon: 'CommandOrControl+Shift+Space',
    summarize: '',
    polish: '',
    translate: '',
    raw: '',
    search: ''
  })
  const [shortcutNotice, setShortcutNotice] = useState<string | null>(null)

  useEffect(() => {
    if (window.api?.shortcutGet) {
      window.api.shortcutGet().then((res) => {
        if (res.success && res.data) {
          setShortcuts(res.data)
        }
      })
    }
  }, [])

  const handleShortcutChange = async (key: string, val: string): Promise<void> => {
    setShortcutNotice(null)
    if (val) {
      const conflictKey = Object.entries(shortcuts).find(
        ([k, v]) => k !== key && v && v === val
      )?.[0]
      if (conflictKey) {
        const conflictLabel = SHORTCUT_LABELS[conflictKey] || conflictKey
        setShortcutNotice(`该快捷键已被「${conflictLabel}」占用，请重新录制`)
        return
      }
    }
    const updated = { ...shortcuts, [key]: val }
    setShortcuts(updated)
    if (window.api?.shortcutSet) {
      await window.api.shortcutSet({ [key]: val })
    }
  }

  // 总结提示词列表与管理
  const summaryPrompts = apiConfig.summaryPrompts || []
  const sortedSummaryPrompts = useMemo(
    () =>
      [...uniqueById(summaryPrompts)].sort((a, b) => {
        const aNum = /^\d+$/.test(a.id)
        const bNum = /^\d+$/.test(b.id)
        if (aNum && bNum) return Number(a.id) - Number(b.id)
        if (aNum !== bNum) return aNum ? -1 : 1
        return a.name.localeCompare(b.name, 'zh-Hans-CN')
      }),
    [summaryPrompts]
  )

  const refreshSummaryPrompts = useCallback(async (): Promise<void> => {
    if (!window.api?.summaryPromptsList) return
    const prompts = (await window.api.summaryPromptsList()) as SummaryPrompt[]
    const currentApiConfig = useAppStore.getState().apiConfig
    setApiConfig({ ...currentApiConfig, summaryPrompts: prompts })
  }, [setApiConfig])

  useEffect(() => {
    refreshSummaryPrompts().catch(() => {})
  }, [refreshSummaryPrompts])

  const handleSavePrompt = async (prompt: SummaryPrompt): Promise<void> => {
    if (!window.api?.summaryPromptsWrite) return
    await window.api.summaryPromptsWrite(prompt)
    await refreshSummaryPrompts()
  }

  const handleConfirmDeletePrompt = async (id: string): Promise<void> => {
    if (deletingPromptBusy) return
    setDeletingPromptBusy(true)
    try {
      if (window.api?.summaryPromptsDelete) {
        await window.api.summaryPromptsDelete(id)
        await refreshSummaryPrompts()
      }
      setDeletingPromptId(null)
    } finally {
      setDeletingPromptBusy(false)
    }
  }

  // 备份与内联恢复预览状态
  const [storageFeedback, setStorageFeedback] = useState<{
    tone: 'error' | 'success' | 'info'
    message: string
  } | null>(null)
  const [importPreview, setImportPreview] = useState<{
    file: string
    keys: string[]
    conflicts: string[]
    values: Record<string, unknown>
    businessCounts?: Record<string, { added: number; unchanged: number; conflicts: number }>
  } | null>(null)
  const [overwriteBusiness, setOverwriteBusiness] = useState(false)
  const [importingCache, setImportingCache] = useState(false)

  const handleExportCache = async (): Promise<void> => {
    setStorageFeedback(null)
    if (!window.api?.exportCache) {
      setStorageFeedback({ tone: 'error', message: 'exportCache API 不可用' })
      return
    }
    await useAppStore.getState().retryHistorySave()
    const saveError = useAppStore.getState().historySaveError
    if (saveError) {
      setStorageFeedback({ tone: 'error', message: `历史尚未保存，备份未开始：${saveError}` })
      return
    }
    const result = await window.api.exportCache()
    if (result.success) {
      setStorageFeedback({
        tone: 'success',
        message: result.filePath ? `配置与业务数据已导出至 ${result.filePath}` : '备份导出成功'
      })
    } else if (result.error !== '用户取消') {
      setStorageFeedback({ tone: 'error', message: `导出失败: ${result.error}` })
    }
  }

  const handleImportCache = async (): Promise<void> => {
    setStorageFeedback(null)
    if (!window.api?.importCache) {
      setStorageFeedback({ tone: 'error', message: 'importCache API 不可用' })
      return
    }
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
        setStorageFeedback({ tone: 'error', message: `导入失败: ${result.error}` })
      }
      return
    }
    const data = result.data
    if (!data) return

    setOverwriteBusiness(false)
    setImportPreview({
      file: data.file,
      keys: data.keys,
      conflicts: data.conflicts,
      values: data.values,
      businessCounts: data.businessCounts
    })
  }

  const handleConfirmImportCache = async (): Promise<void> => {
    if (!importPreview || !window.api?.storeSet || importingCache) return
    const { keys, values } = importPreview
    setImportingCache(true)
    setStorageFeedback(null)

    try {
      for (const k of keys) {
        if (k === 'history' || k === 'summaryHistory' || k === 'notes') {
          const result =
            k === 'notes'
              ? await window.api.notesImport(values[k], overwriteBusiness)
              : await window.api.historyImport(
                  k === 'history' ? 'conversation' : 'summary',
                  values[k],
                  overwriteBusiness
                )
          if (!result.success) throw new Error(result.error || '恢复业务数据失败')
          continue
        }
        const value = values[k]
        if (k === 'apiConfig' && value && typeof value === 'object') {
          const {
            providers: _p,
            activeProviderId: _a,
            lastSelectedAgentId: _l,
            apiKey: _k,
            baseUrl: _b,
            ...rest
          } = value as Record<string, unknown>
          await window.api.storeSet(k, { ...rest, summaryPrompts: rest.summaryPrompts })
          continue
        }
        if (k === 'summaryModels') continue
        await window.api.storeSet(k, value)
      }
    } catch (error) {
      setStorageFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : '恢复失败，已完成的数据保留，可安全重试'
      })
      setImportingCache(false)
      return
    }

    await useAppStore.getState().refreshHistoryLists()

    try {
      const [apiConfigVal, modelsVal] = await Promise.all([
        window.api.storeGet('apiConfig') as Promise<ApiConfig | undefined>,
        window.api.storeGet('models') as Promise<ModelConfig[] | undefined>
      ])
      const patch: Record<string, unknown> = {}
      if (apiConfigVal) patch.apiConfig = apiConfigVal
      if (Array.isArray(modelsVal) && modelsVal.length > 0) patch.models = modelsVal
      if (Object.keys(patch).length > 0) useAppStore.setState(patch)
    } catch (e) {
      console.warn('导入后刷新内存态失败，建议重启应用:', e)
    }

    setImportPreview(null)
    setImportingCache(false)
    setStorageFeedback({
      tone: 'success',
      message: '数据恢复完成。历史、笔记和导图已刷新；其他配置建议重启后使用。'
    })
  }

  const renderNavItem = (item: NavSectionItem): JSX.Element => {
    const isActive = activeSection === item.id
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => handleNavClick(item.id)}
        aria-current={isActive ? 'location' : undefined}
        className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-body transition-all duration-150 ${
          isActive
            ? 'border-white/80 bg-white/75 font-medium text-primary shadow-xs dark:border-white/15 dark:bg-white/10'
            : 'border-transparent text-text-secondary hover:bg-white/45 hover:text-text-primary dark:hover:bg-white/5'
        }`}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <AppIcon
            name={item.icon}
            size={16}
            className={isActive ? 'text-primary' : 'text-text-secondary'}
          />
          <span className="truncate">{item.label}</span>
        </span>
        {item.id === 'about' && hasUpdate && (
          <span className="shrink-0 rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-tiny font-bold leading-none text-red-500">
            NEW
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="flex h-full w-full overflow-hidden bg-transparent">
      {/* 左侧导航栏容器：透明背景，透出整个 APP 的渐变背景 */}
      <aside className="flex h-full w-60 shrink-0 select-none flex-col border-r border-black/[0.05] bg-transparent pb-5 pl-5 pr-3 pt-3 dark:border-white/[0.08] lg:w-64 lg:pl-6 lg:pr-4">
        <div className="mb-4 px-1">
          <h1 className="text-title-lg font-bold tracking-tight text-text-primary">设置</h1>
        </div>

        <nav aria-label="设置导航" className="flex-1 space-y-5 overflow-y-auto pr-1">
          <div>
            <div className="mb-1.5 px-3 text-caption font-medium text-text-secondary/80">
              常用与交互
            </div>
            <div className="space-y-1">{generalSections.map(renderNavItem)}</div>
          </div>

          <div className="border-t border-black/[0.05] pt-4 dark:border-white/[0.08]">
            <div className="mb-1.5 px-3 text-caption font-medium text-text-secondary/80">
              数据与系统
            </div>
            <div className="space-y-1">{systemSections.map(renderNavItem)}</div>
          </div>
        </nav>

        <div className="mt-4 flex items-center gap-2 px-2 pt-2">
          <img src={logo} alt="MultiChat" className="h-5 w-5 object-contain opacity-90" />
          <span className="text-label font-medium text-text-secondary">MultiChat</span>
          {hasUpdate && (
            <button
              type="button"
              onClick={() => openUpdateRelease(releaseUrl)}
              className="ml-auto text-caption font-medium text-primary hover:underline"
            >
              发现新版
            </button>
          )}
        </div>
      </aside>

      {/* 右侧连续配置内容区 */}
      <div
        ref={scrollContainerRef}
        onScroll={handleContentScroll}
        onWheel={clearProgrammaticLock}
        onPointerDown={clearProgrammaticLock}
        onTouchStart={clearProgrammaticLock}
        className="h-full min-w-0 flex-1 overflow-y-auto px-6 pb-6 pt-3 lg:px-10"
      >
        <div className="mx-auto max-w-3xl space-y-8 pb-24">
          {/* 1. 界面与模式 */}
          <section ref={setSectionRef('interface')} data-section-id="interface">
            <SectionHeader icon="view_column_2" title="界面与模式" />
            <div className="space-y-4">
              <ProductModeOrderCard />
              <ModelOrderCard />
            </div>
          </section>

          {/* 2. Agent 配置 */}
          <section ref={setSectionRef('agent')} data-section-id="agent">
            <SectionHeader
              icon="smart_toy"
              title="Agent 配置"
              description="内置 Agent 模型、Skills 与命令权限"
            />
            <div className="space-y-4">
              <div className="rounded-xl glass-panel p-4">
                <div className="mb-3 text-body font-medium text-text-primary">供应商与模型凭证</div>
                <AgentProviderSettings inlineAuth />
              </div>

              <div className="rounded-xl glass-panel p-4">
                <div className="mb-3 text-body font-medium text-text-primary">技能目录与命令权限</div>
                <AgentSkillsSettings />
              </div>
            </div>
          </section>

          {/* 3. 任务与总结 */}
          <section ref={setSectionRef('summary')} data-section-id="summary">
            <SectionHeader icon="account_tree" title="任务与总结" />
            <div className="rounded-xl glass-panel p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-baseline gap-2.5">
                  <div className="shrink-0 text-body font-medium text-text-primary">总结提示词模板</div>
                  <div className="truncate text-caption text-text-secondary">
                    共 {sortedSummaryPrompts.length} 个模板
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => window.api?.summaryPromptsOpenFolder?.()}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/10"
                    title="打开模板文件夹"
                    aria-label="打开模板文件夹"
                  >
                    <AppIcon name="folder_open" size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void refreshSummaryPrompts().catch(() => {})
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/10"
                    title="刷新模板"
                    aria-label="刷新模板"
                  >
                    <AppIcon name="refresh" size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingPromptId(null)
                      setDeletingPromptId(null)
                      setAddingPrompt((prev) => !prev)
                    }}
                    className="flex h-8 items-center gap-1 rounded-lg bg-primary/10 px-2.5 text-label font-medium text-primary transition-colors hover:bg-primary/15"
                  >
                    <AppIcon name={addingPrompt ? 'close' : 'add'} size={14} />
                    <span>{addingPrompt ? '收起' : '新增'}</span>
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {addingPrompt && (
                  <InlinePromptEditor
                    prompt={null}
                    isNew
                    onSave={handleSavePrompt}
                    onCancel={() => setAddingPrompt(false)}
                  />
                )}

                {sortedSummaryPrompts.map((prompt) => {
                  const isEditing = editingPromptId === prompt.id
                  const isConfirmingDelete = deletingPromptId === prompt.id

                  if (isEditing) {
                    return (
                      <InlinePromptEditor
                        key={prompt.id}
                        prompt={prompt}
                        onSave={handleSavePrompt}
                        onCancel={() => setEditingPromptId(null)}
                      />
                    )
                  }

                  return (
                    <div
                      key={prompt.id}
                      className="group flex items-center justify-between gap-3 rounded-lg border border-white/70 bg-white/50 px-3 py-2.5 transition-colors hover:bg-blue-50/40 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-body font-medium text-text-primary">
                            {prompt.name}
                          </span>
                          {prompt.isDefault && (
                            <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-tiny font-medium text-primary">
                              预设
                            </span>
                          )}
                        </div>
                        {prompt.description && (
                          <div className="mt-0.5 truncate text-caption text-text-secondary">
                            {prompt.description}
                          </div>
                        )}
                      </div>

                      {isConfirmingDelete ? (
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className="text-caption text-rose-600">确认删除？</span>
                          <button
                            type="button"
                            disabled={deletingPromptBusy}
                            onClick={() => {
                              void handleConfirmDeletePrompt(prompt.id)
                            }}
                            className="rounded-lg bg-red-600 px-2.5 py-1 text-label font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                          >
                            {deletingPromptBusy ? '删除中' : '确认'}
                          </button>
                          <button
                            type="button"
                            disabled={deletingPromptBusy}
                            onClick={() => setDeletingPromptId(null)}
                            className="rounded-lg border border-gray-200 bg-sidebar px-2.5 py-1 text-label text-text-secondary transition-colors hover:bg-gray-100 dark:border-white/10 dark:bg-white/5"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                          <button
                            type="button"
                            onClick={() => {
                              setAddingPrompt(false)
                              setDeletingPromptId(null)
                              setEditingPromptId(prompt.id)
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-black/5 hover:text-primary dark:hover:bg-white/10"
                            title="编辑"
                            aria-label={`编辑 ${prompt.name}`}
                          >
                            <AppIcon name="edit" size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingPromptId(null)
                              setDeletingPromptId(prompt.id)
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                            title="删除"
                            aria-label={`删除 ${prompt.name}`}
                          >
                            <AppIcon name="delete" size={16} />
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </section>

          {/* 4. 划词工具条 */}
          <section ref={setSectionRef('selection')} data-section-id="selection">
            <SectionHeader icon="text_select_start" title="划词工具条" />
            <div className="space-y-3 rounded-xl glass-panel p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-body font-medium text-text-primary">启用划词悬浮工具条</div>
                  <div className="mt-0.5 text-caption text-text-secondary">
                    选中文本自动弹出快捷操作栏
                  </div>
                  {window.api.platform === 'darwin' && (
                    <button
                      type="button"
                      className="mt-2 text-label text-primary hover:underline"
                      onClick={async () => {
                        const res = await window.api.selectionPermissionRequest()
                        if (res.success && res.data) setSelectionPermission(res.data)
                      }}
                    >
                      macOS 辅助功能权限：{selectionPermission}（点击请求；首次读取时可能还会请求“自动化”权限）
                    </button>
                  )}
                </div>
                <label className="relative inline-flex shrink-0 cursor-pointer items-center">
                  <input
                    type="checkbox"
                    aria-label="启用划词悬浮工具条"
                    checked={selectionToolbarEnabled}
                    onChange={(e) => {
                      void handleSelectionToolbarChange(e.target.checked)
                    }}
                    className="peer sr-only"
                  />
                  <div className="h-5 w-9 rounded-full bg-gray-200 transition-all after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-primary peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none dark:bg-gray-700" />
                </label>
              </div>
              {selectionError && (
                <InlineFeedback
                  tone="error"
                  message={selectionError}
                  onDismiss={() => setSelectionError(null)}
                />
              )}
            </div>
          </section>

          {/* 5. 全局快捷键 */}
          <section ref={setSectionRef('shortcuts')} data-section-id="shortcuts">
            <SectionHeader
              icon="keyboard"
              title="全局快捷键"
              description="点击录制框按下组合键，Esc 取消"
            />
            <div className="space-y-3 rounded-xl glass-panel p-4">
              {SHORTCUT_ITEMS.map(({ key, label, placeholder }) => (
                <div key={key} className="flex items-center justify-between gap-4 py-0.5">
                  <label className="text-body text-text-primary">{label}</label>
                  <ShortcutRecorder
                    value={shortcuts[key] || ''}
                    onChange={(val) => {
                      void handleShortcutChange(key, val)
                    }}
                    placeholder={placeholder}
                    defaultShortcut={key === 'summon' ? 'CommandOrControl+Shift+Space' : ''}
                  />
                </div>
              ))}
              {shortcutNotice && (
                <InlineFeedback
                  tone="error"
                  message={shortcutNotice}
                  onDismiss={() => setShortcutNotice(null)}
                />
              )}
            </div>
          </section>

          {/* 6. 数据与备份 */}
          <section ref={setSectionRef('storage')} data-section-id="storage">
            <SectionHeader icon="folder_special" title="数据与备份" />
            <div className="space-y-3 rounded-xl glass-panel p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-body font-medium text-text-primary">应用缓存与业务数据</div>
                  <div className="mt-0.5 text-caption text-text-secondary">
                    导出或恢复 JSON 备份（恢复前自动尝试备份）
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void handleExportCache()
                    }}
                    className="flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-sidebar px-3.5 text-body font-medium text-text-primary transition-colors hover:border-primary/40 hover:text-primary dark:border-white/10 dark:bg-white/5"
                  >
                    <AppIcon name="download" size={14} />
                    <span>备份数据</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleImportCache()
                    }}
                    className="flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-sidebar px-3.5 text-body font-medium text-text-primary transition-colors hover:border-primary/40 hover:text-primary dark:border-white/10 dark:bg-white/5"
                  >
                    <AppIcon name="upload" size={14} />
                    <span>恢复数据</span>
                  </button>
                </div>
              </div>

              {storageFeedback && (
                <InlineFeedback
                  tone={storageFeedback.tone}
                  message={storageFeedback.message}
                  onDismiss={() => setStorageFeedback(null)}
                />
              )}

              {importPreview && (
                <div className="space-y-3 rounded-lg border border-primary/25 bg-white/80 p-3.5 dark:border-white/15 dark:bg-white/5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-body font-medium text-text-primary">确认恢复数据</span>
                    <button
                      type="button"
                      onClick={() => setImportPreview(null)}
                      className="text-caption text-text-secondary hover:text-text-primary"
                    >
                      取消
                    </button>
                  </div>
                  <p className="text-label text-text-secondary">
                    将从文件导入以下数据，<span className="font-medium text-amber-600">覆盖</span>
                    现有同名配置；历史、笔记和导图按 ID 合并：
                  </p>
                  <div className="truncate text-caption text-text-secondary" title={importPreview.file}>
                    来源：{importPreview.file}
                  </div>
                  <div className="space-y-1">
                    {importPreview.keys.map((k) => {
                      const isConflict = importPreview.conflicts.includes(k)
                      const label = CACHE_KEY_LABELS[k] || k
                      const counts = importPreview.businessCounts?.[k]
                      return (
                        <div
                          key={k}
                          className="flex items-center justify-between rounded-lg bg-sidebar/60 px-3 py-1.5 text-label dark:bg-white/5"
                        >
                          <span className="text-text-primary">{label}</span>
                          <span className={`text-caption ${isConflict ? 'text-amber-600' : 'text-text-secondary'}`}>
                            {counts
                              ? `新增 ${counts.added} · 相同 ${counts.unchanged} · 冲突 ${counts.conflicts}`
                              : isConflict
                                ? '将覆盖现有配置'
                                : '新增'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  {importPreview.businessCounts && (
                    <label className="flex items-center gap-2 text-label text-text-secondary">
                      <input
                        type="checkbox"
                        checked={overwriteBusiness}
                        onChange={(e) => setOverwriteBusiness(e.target.checked)}
                        className="rounded accent-primary"
                      />
                      <span>覆盖同 ID 的冲突业务记录（默认保留本地）</span>
                    </label>
                  )}
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      disabled={importingCache}
                      onClick={() => setImportPreview(null)}
                      className="h-9 rounded-lg border border-gray-200 bg-sidebar px-3.5 text-body text-text-secondary transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-white/10 dark:bg-white/5"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      disabled={importingCache}
                      onClick={() => {
                        void handleConfirmImportCache()
                      }}
                      className="h-9 rounded-lg bg-primary px-4 text-body font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {importingCache ? '导入中…' : '确认导入'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* 7. 命令行集成 */}
          <section ref={setSectionRef('cli')} data-section-id="cli">
            <SectionHeader icon="terminal" title="命令行集成" />
            <CliIntegrationSection />
          </section>

          {/* 8. 关于与更新 */}
          <section ref={setSectionRef('about')} data-section-id="about">
            <SectionHeader icon="info" title="关于与更新" />
            <div className="rounded-xl glass-panel p-4">
              <a
                href="https://github.com/max-doo/MultiChat-desk"
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center justify-between rounded-lg border border-white/70 bg-white/50 p-3 transition-all hover:bg-blue-50/40 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
              >
                <div className="flex items-center gap-3">
                  <AppIcon name="help" size={20} className="text-primary" />
                  <div className="flex flex-col">
                    <span className="text-body font-medium text-text-primary">查看使用说明</span>
                    <span className="text-caption text-text-secondary">
                      GitHub 文档与常见问题
                    </span>
                  </div>
                </div>
                <AppIcon
                  name="open_in_new"
                  size={16}
                  className="text-text-secondary transition-colors group-hover:text-primary"
                />
              </a>
              <AboutSection />
            </div>
          </section>

          {/* 9. Dev-only 诊断入口 */}
          {import.meta.env.DEV && (
            <section ref={setSectionRef('dev')} data-section-id="dev">
              <SectionHeader icon="build" title="开发工具" />
              <div className="flex items-center justify-between gap-4 rounded-xl glass-panel p-4">
                <div className="min-w-0">
                  <div className="text-body font-medium text-text-primary">选择器诊断</div>
                  <div className="mt-0.5 text-caption text-text-secondary">
                    打开平台 DOM 与选择器诊断窗口
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void window.api.diagnosticsOpenWindow()
                  }}
                  className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-sidebar px-3.5 text-body font-medium text-text-primary transition-colors hover:border-primary/40 hover:text-primary dark:border-white/10 dark:bg-white/5"
                >
                  <AppIcon name="science" size={16} />
                  <span>打开诊断窗口</span>
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
