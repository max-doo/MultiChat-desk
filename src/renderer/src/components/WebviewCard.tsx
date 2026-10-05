import { useRef, useImperativeHandle, forwardRef } from 'react'
import { defaultSelectors } from '../config/selectors'
import { useAppStore, DEEP_RESEARCH_SUPPORTED_MODEL_IDS, IMAGE_GENERATION_SUPPORTED_MODEL_IDS } from '../store/appStore'
import CustomDropdown, { type DropdownOption } from './CustomDropdown'
import ModelOutputCard from './ModelOutputCard'
import type { FileUploadData } from '../utils/webviewScripts'
import type { ProbeReport, ResearchProbeReport, DomProbeReport, DomProbeOptions } from '../utils/selectorDiagnostics'
import { useWebviewLifecycle } from '../hooks/useWebviewLifecycle'
import { useWebviewActions } from '../hooks/useWebviewActions'
import { useWebviewNotes } from '../hooks/useWebviewNotes'

interface WebviewCardProps {
  id: string
  name: string
  url: string
  logo: string
  enabled: boolean
  slotIndex: number // 当前卡片所在的位置索引
  compact?: boolean // 紧凑模式：去掉 min-h 限制，适合嵌套在 flex 容器中
  hideHeader?: boolean // 隐藏头部（平台名称、刷新、状态等），适合嵌套在已有控制栏的容器中
  onModelChange?: (modelId: string) => void // 自定义平台切换回调，覆盖默认的 swapModelInSlot
  isolated?: boolean // 隔离模式：不受主界面对话状态（会话锁定、模型阵容锁定）的影响
  headerActions?: React.ReactNode // 自定义头部操作区按钮
  onNewConversation?: () => void // 自定义「新对话」点击回调（如总结页接 handleResetChat 重开总结 session）；未传则 fallback 到默认 loadURL(newConversationUrl) 行为
  draggableHeader?: boolean // 是否允许头部拖拽窗口
  /** 辩论模式下的阵营标签（正方/反方），仅 productMode='debate' 时传入 */
  sideLabel?: '正方' | '反方'
  /** 只读历史快照：URL 不匹配/网页打不开时，用本地存的该模型历史回复替代真实页面。reason 表示触发原因。 */
  readonlySnapshot?: { content: string; reason: 'url_mismatch' | 'load_error' | 'no_snapshot' } | null
  /** 历史记录里该模型的原始 URL，用于检测 webview 是否仍停在历史会话页。为空则跳过检测。 */
  expectedUrl?: string
  flat?: boolean // 扁平无边框模式：去除圆角、外边框与阴影，占满整个容器
  onDragStart?: (e: React.PointerEvent<HTMLDivElement>) => void // 开始拖拽窗口的回调
  webviewInstanceId?: string // 同一模型在快捷窗口左右两侧可同时存在
  onWebviewReady?: (webContentsId: number) => void
}

// 重新导出 FileUploadData 类型供其他组件使用
export type { FileUploadData }

// 暴露给父组件的方法
export interface WebviewCardRef {
  getWebContentsId: () => number | null
  getConversationIdentity: () => Promise<{ url: string; title: string } | null>
  sendMessage: (message: string, twoPhase?: boolean) => Promise<{ success: boolean; error?: string }>
  insertText: (message: string) => Promise<{ success: boolean; error?: string }>
  clearInput: () => Promise<{ success: boolean; error?: string }>
  getInputText: () => Promise<{ success: boolean; text?: string; error?: string }>
  uploadFile: (fileData: FileUploadData) => Promise<{ success: boolean; error?: string }>
  enableDeepResearch: () => Promise<{ success: boolean; error?: string }>
  disableDeepResearch: () => Promise<{ success: boolean; error?: string }>
  enableImageGeneration: () => Promise<{ success: boolean; error?: string }>
  disableImageGeneration: () => Promise<{ success: boolean; error?: string }>
  /** 提取当前 webview 最新回复中的生图（img/canvas/a[href]/blob→data），返回 src 列表与 wcId */
  extractGeneratedImages: () => Promise<{ images: Array<{ src: string; mime?: string }>; wcId: number | null; error?: string }>
  /** 按平台 imageDownload.steps 触发网页内置下载（hover/click），返回 {clicked, wcId}
   *  dryRun=true 时只校验配置并返回 wcId，不执行点击（用于主进程建 ctx 必须先于点击的时序） */
  clickDownloadButtons: (dryRun?: boolean) => Promise<{ clicked: number; wcId: number | null; error?: string }>
  getLatestResponse: (options?: { interactive?: boolean }) => Promise<string>
  reload: () => void
  resetToInitial: () => Promise<{ success: boolean; error?: string }>
  getCurrentUrl: () => string
  loadURL: (url: string) => void
  /** 休眠 webview：保存输入草稿与当前 URL，导航到 about:blank 以释放页面层 V8 堆/DOM（决策 D1：真卸载） */
  suspend: () => Promise<{ success: boolean; savedUrl?: string; savedDraft?: string; error?: string }>
  /** 唤醒 webview：重新加载保存的 URL 并恢复输入草稿 */
  resume: () => Promise<{ success: boolean; error?: string }>
  /** 查询是否处于休眠状态 */
  isHibernated: () => boolean
  /** dev-only：对当前页面跑 messageContainer 探针，返回每候选命中报告 */
  probeMessageContainer: () => Promise<ProbeReport>
  /** dev-only：对当前页面跑 researchMode 探针，返回每步命中报告（只读） */
  probeResearchMode: () => Promise<ResearchProbeReport>
  /** dev-only：进入检拾模式，鼠标点选平台页元素后返回其 DOM 结构（祖先链 + 子树） */
  probeDomStructure: (mode: 'pick', opts?: DomProbeOptions) => Promise<DomProbeReport>
}

/**
 * Webview 卡片组件
 * 嵌入 AI 平台的 Web 界面，支持消息发送和响应抓取
 */
const WebviewCard = forwardRef<WebviewCardRef, WebviewCardProps>(
  (
    {
      id,
      name,
      url,
      logo,
      enabled,
      slotIndex,
      compact,
      hideHeader,
      onModelChange,
      isolated,
      headerActions,
      onNewConversation,
      draggableHeader,
      flat,
      onDragStart,
      readonlySnapshot,
      expectedUrl,
      sideLabel,
      webviewInstanceId,
      onWebviewReady
    },
    ref
  ) => {
    const webviewRef = useRef<Electron.WebviewTag>(null)

    // 从 store 获取所有模型、状态和切换方法
    const models = useAppStore((state) => state.models)
    const swapModelInSlot = useAppStore((state) => state.swapModelInSlot)
    const productMode = useAppStore((state) => state.productMode)
    const setTaskAssignmentSlot = useAppStore((state) => state.setTaskAssignmentSlot)
    const isNewSession = useAppStore((state) => state.isNewSession)
    const textInserted = useAppStore((state) => state.textInserted)
    const activeModels = useAppStore((state) => state.activeModels)

    // 判断会话是否在进行中：如果不是新会话，或者输入框已经有内容（准备发送），则锁定当前阵容；处于隔离模式（如总结页）则不锁定
    const isSessionActive = !isolated && (!isNewSession || textInserted)
    // 如果当前处于活动会话，且当前模型在活动阵容中，则当前窗口被锁死；处于隔离模式则不锁死
    const isLockedModel = !isolated && isSessionActive && activeModels.some((m) => m.id === id)

    // 获取当前模型的选择器配置
    const selectors = defaultSelectors.models[id]

    // 生命周期与导航控制
    const {
      isLoading,
      isReady,
      loadError,
      urlMismatch,
      canGoBack,
      canGoForward,
      elapsedSeconds,
      isHibernated,
      methods,
      handleRefresh,
      handleRetry,
      handleCancelLoad,
      handleGoBack,
      handleGoForward,
      startNewConversation
    } = useWebviewLifecycle({
      webviewRef,
      id,
      name,
      url,
      enabled,
      selectors,
      expectedUrl,
      onWebviewReady
    })

    // 网页交互操作
    const { actions, sendStatus: _sendStatus } = useWebviewActions({
      webviewRef,
      id,
      name,
      selectors,
      isReady,
      isLoading,
      isHibernated
    })

    // 网页笔记高亮同步
    useWebviewNotes(webviewRef, enabled)

    // 暴露给父组件的 Ref
    useImperativeHandle(
      ref,
      () => ({
        ...actions,
        ...methods
      }),
      [actions, methods]
    )

    // 任务分配模式或隔离模式支持选择所有 AI，因此可选列表为全量模型；多 AI 模式下排除自身
    const availableModels =
      productMode === 'task_assignment' || isolated || !!onModelChange
        ? models
        : models.filter((m) => m.id !== id)

    // 将模型列表转换为下拉菜单选项格式
    const modelOptions: DropdownOption<string>[] = availableModels.map((m) => ({
      value: m.id,
      label: m.name,
      logo: m.logo
    }))

    const handleNewConversation = (): void => {
      startNewConversation()
      // 只有在非活动状态下才允许其重置全局会话标志，防止破坏其他窗口的锁
      if (!useAppStore.getState().activeModels.length) {
        useAppStore.getState().setNewSession(true)
      }
    }

    if (!enabled) {
      return (
        <div
          className={`flex flex-col h-full opacity-50 overflow-hidden ${flat ? 'bg-white' : 'rounded-2xl glass-panel shadow-soft'} ${compact ? '' : 'min-h-[480px]'}`}
        >
          <div
            className={`p-4 border-b ${flat ? 'border-gray-200/60 bg-white' : 'border-white/40'} flex justify-between items-center`}
          >
            <div className="flex items-center gap-3 opacity-50">
              <img alt={`${name} logo`} className="w-6 h-6" src={logo} />
              <h2 className="font-semibold text-text-secondary">{name}</h2>
            </div>
          </div>
          <div className="flex-1 p-4 flex items-center justify-center text-gray-600 min-h-0">
            此模型已禁用
          </div>
        </div>
      )
    }

    return (
      <div
        className={`flex flex-col h-full overflow-hidden ${flat ? 'bg-white' : 'rounded-2xl glass-panel shadow-soft'} ${compact ? '' : 'min-h-[480px]'}`}
      >
        {!hideHeader && (
          <div
            className={`p-3 border-b ${flat ? 'border-gray-200/60 bg-white' : 'border-white/40 p-4'} flex justify-between items-center ${draggableHeader ? 'drag-region select-none' : ''}`}
            onPointerDown={
              draggableHeader
                ? (e): void => {
                    const target = e.target as HTMLElement
                    if (
                      target.closest('button') ||
                      target.closest('.no-drag') ||
                      target.closest('input') ||
                      target.closest('select')
                    )
                      return
                    if (target.closest('.drag-region') || target === e.currentTarget) {
                      e.currentTarget.setPointerCapture(e.pointerId)
                      window.api.windowDragStart()
                      if (onDragStart) {
                        onDragStart(e)
                      }
                    }
                  }
                : undefined
            }
          >
            {/* 左侧：模型信息和下拉选择器 */}
            <div
              className={draggableHeader ? 'no-drag' : ''}
              title={isSessionActive ? '当前对话进行中，需开启新对话才可更换模型' : ''}
            >
              <CustomDropdown
                value={id}
                disabled={isSessionActive}
                onChange={(modelId): void => {
                  if (onModelChange) {
                    onModelChange(modelId)
                  } else if (productMode === 'task_assignment') {
                    setTaskAssignmentSlot(slotIndex, modelId)
                  } else {
                    swapModelInSlot(slotIndex, modelId)
                  }
                }}
                placeholder={name}
                className="relative"
                dropdownWidth="w-48"
                buttonClassName={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 -ml-2 transition-colors ${isSessionActive ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100'}`}
                renderButton={(): JSX.Element => (
                  <div className="flex items-center gap-2">
                    <img alt={`${name} logo`} className="w-6 h-6" src={logo} />
                    <h2 className="font-semibold text-text-primary">{name}</h2>
                    {sideLabel && (
                      <span
                        className={`text-xs font-bold px-1.5 py-0.5 rounded-md ${
                          sideLabel === '正方'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-orange-100 text-orange-700'
                        }`}
                      >
                        {sideLabel}
                      </span>
                    )}
                  </div>
                )}
                renderOption={(option, _isSelected, onSelect): JSX.Element => {
                  const model = models.find((m) => m.id === option.value)
                  const hasDeepResearch = model && DEEP_RESEARCH_SUPPORTED_MODEL_IDS.has(model.id)
                  const hasImageGen = model && IMAGE_GENERATION_SUPPORTED_MODEL_IDS.has(model.id)
                  return (
                    <button
                      type="button"
                      onClick={onSelect}
                      className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-gray-100 transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        <img
                          alt={model?.name || option.label}
                          className="w-5 h-5"
                          src={model?.logo || option.logo}
                        />
                        <span className="text-text-primary text-sm">{option.label}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {hasDeepResearch && (
                          <span
                            className="material-symbols-outlined text-base text-gray-400 hover:text-gray-600 transition-colors"
                            title="深度研究"
                          >
                            biotech
                          </span>
                        )}
                        {hasImageGen && (
                          <span
                            className="material-symbols-outlined text-base text-gray-400 hover:text-gray-600 transition-colors"
                            title="AI 生图"
                          >
                            image
                          </span>
                        )}
                      </div>
                    </button>
                  )
                }}
                options={modelOptions}
              />
            </div>

            {/* 右侧：刷新按钮 + 状态指示器 */}
            <div className={`flex items-center gap-3 group ${draggableHeader ? 'no-drag' : ''}`}>
              <button
                type="button"
                onClick={handleGoBack}
                disabled={!canGoBack}
                className={`flex items-center justify-center rounded-full transition-all opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto ${canGoBack ? 'text-text-secondary hover:text-primary' : 'text-text-secondary'}`}
                title="后退"
              >
                <span className="material-symbols-outlined text-xl">arrow_back</span>
              </button>
              <button
                type="button"
                onClick={handleGoForward}
                disabled={!canGoForward}
                className={`flex items-center justify-center rounded-full transition-all opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto ${canGoForward ? 'text-text-secondary hover:text-primary' : 'text-text-secondary'}`}
                title="前进"
              >
                <span className="material-symbols-outlined text-xl">arrow_forward</span>
              </button>
              <button
                type="button"
                onClick={handleRefresh}
                className="flex items-center justify-center rounded-full text-text-secondary hover:text-primary transition-colors"
                title="刷新当前窗口"
              >
                <span className="material-symbols-outlined text-xl">refresh</span>
              </button>
              {selectors?.newConversationUrl &&
                (productMode === 'task_assignment' || onNewConversation) && (
                  <button
                    type="button"
                    onClick={onNewConversation ?? handleNewConversation}
                    disabled={isLockedModel}
                    className={`flex items-center justify-center rounded-full transition-colors ${isLockedModel ? 'opacity-30 cursor-not-allowed text-text-secondary' : 'text-text-secondary hover:text-primary'}`}
                    title={
                      isLockedModel
                        ? '当前模型参与了全局会话，请使用底部的全局新对话按钮'
                        : '新对话'
                    }
                  >
                    <span className="material-symbols-outlined text-xl">add_comment</span>
                  </button>
                )}
              {headerActions}
            </div>
          </div>
        )}

        {/* Webview 容器 */}
        <div className="flex-1 relative min-h-0">
          {isLoading && !loadError && (
            <div className="absolute inset-0 flex items-center justify-center bg-app/50 z-10">
              <div className="flex flex-col items-center gap-3 p-4">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                <span className="text-sm text-text-secondary">
                  {elapsedSeconds >= 15
                    ? '页面加载较慢，请耐心等待...'
                    : `已等待 ${elapsedSeconds}s...`}
                </span>
                {elapsedSeconds >= 25 && (
                  <button
                    type="button"
                    onClick={handleCancelLoad}
                    className="px-4 py-1.5 bg-gray-100 text-text-secondary rounded-lg hover:bg-gray-200 transition-colors text-sm"
                  >
                    取消
                  </button>
                )}
              </div>
            </div>
          )}

          {(urlMismatch || loadError) && readonlySnapshot && (
            <div className="absolute inset-0 z-20 bg-app flex flex-col">
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs">
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                  history
                </span>
                <span className="font-medium">历史快照模式</span>
                <span className="text-amber-600">
                  {loadError
                    ? '· 页面加载失败'
                    : readonlySnapshot.reason === 'no_snapshot'
                      ? '· URL 与历史不符且无本地快照'
                      : '· URL 与历史记录不符，显示本地历史回复'}
                </span>
              </div>
              {readonlySnapshot.content ? (
                <div className="flex-1 min-h-0 overflow-auto">
                  <ModelOutputCard
                    id={id}
                    name={name}
                    logo={logo}
                    content={readonlySnapshot.content}
                    selected={true}
                    onToggle={(): void => {}}
                  />
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-text-secondary text-sm">
                  未保存该模型的本地回复，请重新加载原始网页
                </div>
              )}
              {loadError && (
                <div className="flex justify-center py-2 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="px-4 py-1.5 bg-primary text-white rounded-lg hover:opacity-90 transition-opacity text-sm"
                  >
                    重试加载
                  </button>
                </div>
              )}
            </div>
          )}

          {loadError && !readonlySnapshot && (
            <div className="absolute inset-0 flex items-center justify-center bg-app/80 z-10">
              <div className="flex flex-col items-center gap-3 p-6 max-w-sm bg-white rounded-2xl shadow-soft">
                <span className="material-symbols-outlined text-red-500" style={{ fontSize: 48 }}>
                  {loadError.icon}
                </span>
                <p className="text-sm text-text-primary text-center font-medium">
                  {loadError.title}
                </p>
                <p className="text-xs text-text-secondary text-center font-mono">
                  {loadError.subtitle}
                </p>
                <button
                  type="button"
                  onClick={handleRetry}
                  className="mt-1 px-4 py-2 bg-primary text-white rounded-lg hover:opacity-90 transition-opacity text-sm"
                >
                  重试
                </button>
              </div>
            </div>
          )}

          {/* 休眠覆盖层（片段 A，决策 D1）：真卸载页面层后展示，点击唤醒重新 loadURL + 恢复草稿。 */}
          {isHibernated && !readonlySnapshot && (
            <div className="absolute inset-0 flex items-center justify-center bg-app/90 z-20 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3 p-6 max-w-xs">
                <span className="material-symbols-outlined text-text-secondary text-4xl">
                  bedtime
                </span>
                <p className="text-sm text-text-primary font-medium text-center">
                  已休眠以节省内存
                </p>
                <p className="text-xs text-text-secondary text-center">点击唤醒以继续使用</p>
                <button
                  type="button"
                  onClick={(): void => {
                    void methods.resume()
                  }}
                  className="mt-2 px-4 py-2 bg-primary text-white rounded-lg hover:opacity-90 transition-opacity text-sm"
                >
                  立即唤醒
                </button>
              </div>
            </div>
          )}

          <webview
            ref={webviewRef}
            id={webviewInstanceId ?? `webview-${id}`}
            src="about:blank"
            partition="persist:shared"
            className={`w-full h-full ${((loadError || urlMismatch) && readonlySnapshot) || isHibernated ? 'invisible pointer-events-none' : ''}`}
            allowpopups
            tabIndex={-1}
          />
        </div>
      </div>
    )
  }
)

WebviewCard.displayName = 'WebviewCard'

export default WebviewCard
