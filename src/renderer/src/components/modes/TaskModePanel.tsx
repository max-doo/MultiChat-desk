import { useRef, useState } from 'react'
import { useAppStore, waitForSavableUrl, captureResponseTargets } from '../../store/appStore'
import { useTaskSplit } from '../../hooks/useTaskSplit'
import SubtaskList from './SubtaskList'
import CustomDropdown from '../CustomDropdown'
import { AppIcon } from '../icons/AppIcon'

interface TaskModePanelProps {
  showNotification: (type: 'success' | 'error' | 'info', msg: string, autoHide?: number) => void
}

/**
 * 任务模式 ControlBar 中段：
 * - idle: 输入框可编辑 query，按钮=拆解
 * - split: 输入框只读显示原 query，上方子任务弹层，按钮=一键发送；取消回到 idle
 * - sent: 已发送
 */
function TaskModePanel({ showNotification }: TaskModePanelProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isComposingRef = useRef(false)
  const taskState = useAppStore((s) => s.taskState)
  const setTaskQuery = useAppStore((s) => s.setTaskQuery)
  const setTaskPhase = useAppStore((s) => s.setTaskPhase)
  const setTaskSubtasks = useAppStore((s) => s.setTaskSubtasks)
  const resetTask = useAppStore((s) => s.resetTask)
  const webviewRefs = useAppStore((s) => s.webviewRefs)
  const { split, cancel, show, isLoading, task } = useTaskSplit()
  const [isSending, setIsSending] = useState(false)
  const displayMode = useAppStore((s) => s.displayMode)
  const taskAssignmentSlots = useAppStore((s) => s.taskAssignmentSlots)

  const isSplit = taskState.phase === 'split'
  const isInserted = taskState.phase === 'inserted'

  const apiConfig = useAppStore((s) => s.apiConfig)
  const setApiConfig = useAppStore((s) => s.setApiConfig)
  const models = useAppStore((s) => s.models)

  // 拆解平台：与 webview 顶部下拉一致可选全部 models；持久化到 apiConfig.taskSplitPlatform。
  const platform = apiConfig.taskSplitPlatform && models.find(m => m.id === apiConfig.taskSplitPlatform)
    ? apiConfig.taskSplitPlatform
    : (models.find(m => m.enabled)?.id || models[0]?.id || '')
  const platformModel = models.find(m => m.id === platform)
  const splitting = isLoading && task && (task.phase === 'loading' || task.phase === 'generating')

  const handleSplit = async () => {
    if (!taskState.query.trim() || isLoading) return
    if (!platform) { showNotification('error', '没有可用平台可用来拆解'); return }
    const r = await split(taskState.query, platform, (msg) => showNotification('error', msg))
    if (!r.ok) showNotification('error', r.error ?? '拆解失败')
  }

  // 取消：清空已注入槽位的 webview 文字（inserted 阶段已注入，需清理），
  // 再重置任务状态。清空复用多 AI 模式的 clearInput 路径（已验证，不涉 \\n 插入）。
  const handleCancel = async () => {
    // 收集所有涉及到的槽位（split 阶段未注入，清空无害；inserted 阶段已注入需清空）
    const slotSet = new Set<number>()
    taskState.subtasks.forEach((st) => slotSet.add(Math.max(0, st.slotIndex)))
    const clearPromises: Promise<void>[] = []
    slotSet.forEach((slotIndex) => {
      const ref = webviewRefs.get(`slot-${slotIndex}`)
      if (ref) {
        clearPromises.push(ref.clearInput().then(() => undefined).catch(() => {}))
      }
    })
    await Promise.all(clearPromises)
    setTaskPhase('idle')
    setTaskSubtasks([])
    setTimeout(() => textareaRef.current?.focus(), 50)
    showNotification('info', '已取消拆解，可继续编辑')
  }

  // 按子任务 slotIndex 分组，每个槽位只取一条子任务（每窗口只接一个子任务）。
  // 直接用 slotIndex（而非 modelId 反查 taskAssignmentSlots）——多窗口选同一模型时
  // modelId 无法区分槽位，靠 slotIndex 才能保证每个窗口各收一条。
  // 两步都从 taskState.subtasks 重新计算 bySlot，无需在两步间保存额外状态。
  // 注：useTaskSplit 用 i % slotCount 轮询指派，子任务数 > 槽数时同一槽会多条；
  // 此处取第一条，多余子任务不注入（如需排队/告警另行处理）。
  // n 为子任务在 subtasks 数组中的序号（1-based），用于提示词中的【任务n】。
  const buildBySlot = (): Map<number, { text: string; n: number }> => {
    const bySlot = new Map<number, { text: string; n: number }>()
    taskState.subtasks.forEach((st, i) => {
      const slotIndex = Math.max(0, st.slotIndex)
      if (!bySlot.has(slotIndex)) bySlot.set(slotIndex, { text: st.text, n: i + 1 })
    })
    return bySlot
  }

  // 在子任务内容前拼接研究提示词，要求模型在报告标题前标注【任务n】。
  // 提示词与任务内容分行显示（\n）。n 为子任务序号，动态注入。
  const withPrompt = (text: string, n: number): string => {
    return `按照以下要求开展研究，报告的标题前面需标注【任务${n}】，如任务${n}：xxxxxxxx\n${text}`
  }

  // 第一步：逐槽注入子任务文本（不发送）。复用多 AI 模式的 insertText 路径
  // （generateInsertTextScript，含 isAlreadySame 守卫，避免 Slate 重复注入报错）。
  // 并行注入（Promise.all），与多 AI 模式 insertTextToAll 调用方式一致。
  const handleInsert = async () => {
    if (taskState.subtasks.length === 0 || isSending) return
    setIsSending(true)
    const bySlot = buildBySlot()
    const insertPromises: Promise<boolean>[] = []
    for (const [slotIndex, { text, n }] of bySlot) {
      const ref = webviewRefs.get(`slot-${slotIndex}`)
      if (!ref) { insertPromises.push(Promise.resolve(false)); continue }
      insertPromises.push(
        ref.insertText(withPrompt(text, n)).then((r) => !!r.success).catch(() => false)
      )
    }
    const results = await Promise.all(insertPromises)
    const okCount = results.filter(Boolean).length
    const failCount = results.length - okCount
    setIsSending(false)
    if (okCount === 0) {
      showNotification('error', '所有槽位注入失败')
      return
    }
    setTaskPhase('inserted')
    if (failCount === 0) showNotification('success', `已向 ${okCount} 个槽位注入子任务，再次点击确认发送`)
    else showNotification('info', `${okCount} 注入成功，${failCount} 失败；再次点击发送已注入的槽位`)
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  // 第二步：逐槽发送。复用多 AI 模式的单脚本 sendMessage 路径
  // （generateSendMessageScript，含 Enter 回退 + 强制 InputEvent 同步受控组件 + isAlreadySame 守卫）。
  // bySlot 重新计算；已注入的槽位因 isAlreadySame 守卫不会重复设值，直接进入找按钮/发送。
  const handleConfirmSend = async () => {
    if (taskState.subtasks.length === 0 || isSending) return
    setIsSending(true)
    setTaskPhase('sent')
    const bySlot = buildBySlot()
    useAppStore.getState().stopMonitoring()
    const targets = await captureResponseTargets(Array.from(bySlot.keys()).map(slotIndex => ({ slotIndex, modelId: taskAssignmentSlots[slotIndex] })))
    // 记录每个 slot 发送的组合文本（用于历史 userMessage）与成功与否
    const sentTexts: Record<number, string> = {}
    const successSlotIndices: number[] = []
    let okCount = 0
    let failCount = 0
    for (const [slotIndex, { text, n }] of bySlot) {
      const ref = webviewRefs.get(`slot-${slotIndex}`)
      if (!ref) { failCount++; continue }
      const promptText = withPrompt(text, n)
      try {
        // 不传 twoPhase：两阶段语义已由 handleInsert→handleConfirmSend 的 UI 流程承担
        const r = await ref.sendMessage(promptText)
        if (r.success) {
          okCount++
          successSlotIndices.push(slotIndex)
          sentTexts[slotIndex] = promptText
        } else {
          failCount++
        }
      } catch {
        failCount++
      }
    }
    if (failCount === 0) showNotification('success', `已向 ${okCount} 个槽位发送子任务`)
    else if (okCount === 0) showNotification('error', '所有槽位发送失败')
    else showNotification('info', `${okCount} 成功，${failCount} 失败`)

    // —— 接入历史 + 监控（仅当至少一个 slot 成功；必须在 resetTask 之前完成数据采集）——
    if (successSlotIndices.length > 0) {
      const store = useAppStore.getState()
      // 直接用 taskAssignmentSlots[i] 取 modelId，避免 getDisplayedModels 按 displayMode 截断
      // displayCount 后高 slot 索引越界（任务分配 displayMode 通常为 'four'，但 'two' 时
      // slot 3/4 会被 getDisplayedModels 截掉）。与 handleConfirmSend 用 slotIndex 的语义一致。
      const successModelIds = successSlotIndices
        .map(i => taskAssignmentSlots[i])
        .filter(Boolean) as string[]
      if (successModelIds.length > 0) {
        // 槽位地址独立保存，modelId 地址兼容旧历史与总结入口。
        const currentUrls: Record<string, string> = {}
        const slotCount = displayMode === 'four' ? 4 : displayMode === 'three' ? 3 : 2
        const historyModelIds = taskAssignmentSlots.slice(0, slotCount)
        for (let slotIndex = 0; slotIndex < historyModelIds.length; slotIndex++) {
          const ref = webviewRefs.get(`slot-${slotIndex}`)
          const modelId = taskAssignmentSlots[slotIndex]
          if (ref && modelId) {
            currentUrls[modelId] ??= ref.getCurrentUrl()
            currentUrls[`slot-${slotIndex}`] = ref.getCurrentUrl()
          }
        }

        const { conversationId } = await store.beginConversation({
          // 历史保留完整布局；轮询仍只处理实际发送成功的窗口。
          successModelIds: historyModelIds,
          currentUrls,
          productMode: 'task_assignment',
          displayMode,
          title: taskState.query.trim(),
        })
        const userMessage = successSlotIndices.map(i => `【slot ${i + 1}】${sentTexts[i]}`).join('\n\n')
        const turnId = `${conversationId}-${crypto.randomUUID()}`
        await store.recordConversationTurn(conversationId, { turnId, userMessage, timestamp: Date.now(), responses: {} })
        store.startMonitoring(conversationId, turnId, userMessage, targets.filter(target => successSlotIndices.includes(target.slotIndex)))
        // 地址可以晚于发送产生；问题先保存，之后仅更新仍属于当前会话的来源。
        void (async () => {
          const urls: Record<string, string> = {}
          await Promise.all(successSlotIndices.map(async slotIndex => {
            const ref = webviewRefs.get(`slot-${slotIndex}`)
            const modelId = taskAssignmentSlots[slotIndex]
            if (!ref || !modelId) return
            const url = await waitForSavableUrl(modelId, ref)
            const current = useAppStore.getState()
            const target = targets.find(target => target.slotIndex === slotIndex)
            if (url && current.currentConversationId === conversationId && current.webviewRefs.get(`slot-${slotIndex}`)?.getWebContentsId() === target?.webContentsId) {
              urls[modelId] ??= url
              urls[`slot-${slotIndex}`] = url
            }
          }))
          const current = useAppStore.getState()
          if (current.currentConversationId === conversationId && current.history.find(item => item.id === conversationId)?.turns.at(-1)?.turnId === turnId && Object.keys(urls).length) await current.updateHistory(conversationId, { urls })
        })().catch(() => showNotification('error', '任务已发送，但会话地址获取失败'))
      }
    }

    setIsSending(false)
    resetTask()
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  return (
    <div className="relative flex-grow flex items-center gap-4 p-3 rounded-[24px] glass-panel-heavy shadow-float focus-within:border-gray-200 focus-within:ring-1 focus-within:ring-gray-200" style={{ height: '96px', flexShrink: 0, boxSizing: 'border-box' }}>
      {/* 子任务弹层（split / inserted 阶段） */}
      {(isSplit || isInserted) && <SubtaskList subtasks={taskState.subtasks} collapsed={taskState.collapsed} />}

      {/* 输入框 */}
      <textarea
        ref={textareaRef}
        value={taskState.query}
        onChange={(e) => { if (taskState.phase === 'idle') setTaskQuery(e.target.value) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !isComposingRef.current && taskState.phase === 'idle') {
            e.preventDefault()
            handleSplit()
          }
        }}
        onCompositionStart={() => {
          isComposingRef.current = true
        }}
        onCompositionEnd={() => {
          isComposingRef.current = false
        }}
        readOnly={isSplit || isInserted || isSending}
        placeholder="输入总目标，点击拆解自动分配子任务…"
        className="flex-grow bg-transparent border-0 focus:ring-0 focus:outline-none text-text-primary placeholder-text-secondary p-0 resize-none disabled:cursor-not-allowed"
        style={{ lineHeight: '24px', height: '72px', overflowY: 'auto' }}
      />

      {/* 按钮区 */}
      <div className="flex items-center gap-2 flex-shrink-0 self-end">
        {/* 拆解平台选择器（放在「开启新对话」之后、拆解按钮之前），菜单向上展开 */}
        <CustomDropdown
          value={platform}
          onChange={(value) => setApiConfig({ ...apiConfig, taskSplitPlatform: value })}
          disabled={isLoading || isSending}
          direction="up"
          dropdownWidth="w-44"
          className="relative"
          hideArrow
          buttonClassName="flex items-center gap-2 rounded-lg px-2.5 py-2 transition-colors hover:bg-gray-100 disabled:opacity-50"
          renderButton={() => (
            <>
              {platformModel?.logo
                ? <img alt={`${platformModel.name} logo`} className="w-6 h-6" src={platformModel.logo} />
                : <AppIcon name="smart_toy" size={20} className="text-text-secondary" />}
              <span className="text-sm font-medium text-text-secondary">{platformModel?.name || '拆解平台'}</span>
            </>
          )}
          renderOption={(option, _isSelected, onSelect) => {
            const model = models.find(m => m.id === option.value)
            return (
              <button type="button" onClick={onSelect} className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-100 transition-colors text-left">
                {model?.logo || option.logo
                  ? <img alt={model?.name || option.label} className="w-[18px] h-[18px]" src={model?.logo || option.logo} />
                  : <AppIcon name="smart_toy" size={16} className="text-text-secondary" />}
                <span className="text-text-primary text-sm">{option.label}</span>
              </button>
            )
          }}
          options={models.map(m => ({ value: m.id, label: m.name, logo: m.logo }))}
        />
        {/* 拆解进行中/结束后提供后台网页查看入口（导图同款排障） */}
        {task && (splitting || task.phase === 'error') && (
          <button
            onClick={() => { void show().then(r => { if (!r.success) showNotification('error', r.error || '无法打开拆解网页') }) }}
            className="text-xs text-primary hover:underline whitespace-nowrap"
            title="查看拆解网页"
          >
            查看网页
          </button>
        )}
        {splitting && (
          <button onClick={() => void cancel()} className="text-xs text-text-secondary hover:text-primary whitespace-nowrap">取消</button>
        )}
        {(isSplit || isInserted) && !isSending && (
          <button
            onClick={handleCancel}
            className="px-3 py-1.5 rounded-xl bg-gray-200 text-gray-600 hover:bg-gray-300 text-sm"
          >
            取消
          </button>
        )}
        <button
          onClick={isSplit ? handleInsert : isInserted ? handleConfirmSend : handleSplit}
          disabled={isLoading || isSending || (!isSplit && !isInserted && !taskState.query.trim())}
          className={`rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5 h-12 ${
            isLoading || isSending ? 'w-12' : 'px-4'
          } ${
            isSplit || isInserted
              ? 'bg-primary text-white hover:opacity-90'
              : taskState.query.trim()
                ? 'bg-primary text-white hover:opacity-90'
                : 'bg-gray-100 hover:bg-gray-200 text-text-secondary'
          }`}
          title={isSplit ? '注入子任务到各槽位' : isInserted ? '确认发送已注入的子任务' : '拆解总目标'}
        >
          {isLoading || isSending ? (
            <AppIcon name="sync" className="animate-spin" />
          ) : isSplit ? (
            <span className="text-sm font-bold">确认</span>
          ) : isInserted ? (
            <>
              <AppIcon name="arrow_upward" />
              <span className="text-sm font-bold">确认发送</span>
            </>
          ) : (
            <>
              <AppIcon name="call_split" />
              <span className="text-sm font-bold">拆解任务</span>
            </>
          )}
        </button>
      </div>
    </div>
  )
}

export default TaskModePanel
