import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  Sparkles,
  PenTool,
  ListChecks,
  BookOpen,
  FolderOpen,
  GitBranch,
  Copy,
  Pencil,
  ArrowUpRight
} from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import agentAvatar from '../../assets/logos/agent.png'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { useAgentSessionStore } from '../../store/agentSessionStore'
import CustomDropdown, { type DropdownOption } from '../CustomDropdown'
import { AppIcon } from '../icons/AppIcon'
import ConfirmModal from '../ConfirmModal'
import { ToolGroup } from './agent/ToolGroup'
import { ApprovalCard } from './agent/ApprovalCard'
import { ThinkingBlock } from './agent/ThinkingBlock'
import { AgentComposer } from './agent/AgentComposer'
import { MarkdownRenderer } from './agent/MarkdownRenderer'
import type { PiContentPart } from '../../types/agent'

interface AgentCardProps {
  onModelChange?: (modelId: string) => void
  headerActions?: React.ReactNode
}

export default function AgentCard({
  onModelChange,
  headerActions
}: AgentCardProps): JSX.Element {
  const models = useAppStore((s) => s.models)
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const closeRightPane = useWorkbenchStore((s) => s.closeRightPane)

  const messages = useAgentSessionStore((s) => s.messages)
  const isRunning = useAgentSessionStore((s) => s.isRunning)
  const sessions = useAgentSessionStore((s) => s.sessions)
  const currentSessionId = useAgentSessionStore((s) => s.currentSessionId)
  const currentCwd = useAgentSessionStore((s) => s.currentCwd)
  const pendingApprovals = useAgentSessionStore((s) => s.pendingApprovals)
  const setComposerInput = useAgentSessionStore((s) => s.setComposerInput)
  const newSession = useAgentSessionStore((s) => s.newSession)
  const resumeSession = useAgentSessionStore((s) => s.resumeSession)
  const deleteSession = useAgentSessionStore((s) => s.deleteSession)
  const initListeners = useAgentSessionStore((s) => s.initListeners)
  const rewindLastUserMessage = useAgentSessionStore((s) => s.rewindLastUserMessage)
  const forkSession = useAgentSessionStore((s) => s.forkSession)
  const copyText = useAgentSessionStore((s) => s.copyText)

  const [historyMenuOpen, setHistoryMenuOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)
  const [rewindConfirmOpen, setRewindConfirmOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [forkMenuOpenFor, setForkMenuOpenFor] = useState<string | null>(null)
  const [isForking, setIsForking] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)

  const handleConfirmFork = useCallback(async (): Promise<void> => {
    if (isForking) return
    setIsForking(true)
    try {
      await forkSession()
    } finally {
      setIsForking(false)
    }
  }, [forkSession, isForking])

  const copyTimerRef = useRef<number | null>(null)
  const handleCopy = useCallback(
    (key: string, text: string): void => {
      void copyText(text).then((ok) => {
        if (!ok) return
        setCopiedId(key)
        if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current)
        copyTimerRef.current = window.setTimeout(() => setCopiedId(null), 1500)
      })
    },
    [copyText]
  )

  // Initialize IPC listeners on mount
  useEffect(() => {
    const cleanup = initListeners()
    return () => cleanup()
  }, [initListeners])

  // Auto-scroll to bottom on messages update
  useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight
    }
  }, [messages, pendingApprovals])

  // Sync workspacePath to AgentSession
  const prevWorkspaceRef = useRef<string | null>(workspacePath)
  useEffect(() => {
    if (workspacePath && prevWorkspaceRef.current !== null && workspacePath !== prevWorkspaceRef.current) {
      void newSession(workspacePath)
    }
    prevWorkspaceRef.current = workspacePath
  }, [workspacePath, newSession])

  useEffect(() => {
    // Only reset the draft when the bound workspace actually diverges; a null
    // session id is already the draft state and needs no further reset.
    if (workspacePath && currentCwd && currentCwd !== workspacePath) {
      void newSession(workspacePath)
    }
  }, [currentCwd, workspacePath, newSession])

  // Model picker options
  const modelOptions = useMemo<DropdownOption<string>[]>(() => {
    const list: DropdownOption<string>[] = [
      {
        value: 'local-agent',
        label: '本地 Agent',
        description: '基于 Pi 的本地开发智能体'
      }
    ]
    for (const m of models) {
      list.push({
        value: m.id,
        label: m.name,
        logo: m.logo
      })
    }
    return list
  }, [models])

  const handleNewSession = useCallback((): void => {
    setHistoryMenuOpen(false)
    void newSession(workspacePath || undefined)
  }, [newSession, workspacePath])

  const handleSelectSession = useCallback(
    (sessionId: string): void => {
      setHistoryMenuOpen(false)
      if (sessionId !== currentSessionId) {
        void resumeSession(sessionId)
      }
    },
    [currentSessionId, resumeSession]
  )

  const handleConfirmDeleteSession = useCallback(async (): Promise<void> => {
    if (!deleteTarget) return
    await deleteSession(deleteTarget.id)
    setDeleteTarget(null)
  }, [deleteTarget, deleteSession])

  type GroupedBlock =
    | { type: 'reasoning'; reasoning: string; isRunning: boolean }
    | { type: 'text'; text: string }
    | { type: 'tool-group'; parts: PiContentPart[]; isRunning: boolean }

  const groupContentParts = (parts: PiContentPart[], isMsgRunning: boolean): GroupedBlock[] => {
    const blocks: GroupedBlock[] = []
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (part.type === 'reasoning') {
        blocks.push({
          type: 'reasoning',
          reasoning: part.reasoning || '',
          isRunning: isMsgRunning && i === parts.length - 1
        })
      } else if (part.type === 'text') {
        if (part.text?.trim()) {
          blocks.push({
            type: 'text',
            text: part.text
          })
        }
      } else if (part.type === 'tool-call') {
        const last = blocks[blocks.length - 1]
        const isPartRunning = isMsgRunning && part.result === undefined && !part.isError
        if (last && last.type === 'tool-group') {
          last.parts.push(part)
          last.isRunning = last.isRunning || isPartRunning
        } else {
          blocks.push({
            type: 'tool-group',
            parts: [part],
            isRunning: isPartRunning
          })
        }
      }
    }
    return blocks
  }

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Header — matches WebviewCard flat header layout: p-3 border-b border-gray-200/60 */}
      <div className="p-3 border-b border-gray-200/60 bg-white flex justify-between items-center shrink-0">
        {/* Left: Model Picker Dropdown — matches WebviewCard CustomDropdown pattern */}
        <div>
          <CustomDropdown
            value="local-agent"
            disabled={isRunning}
            onChange={(modelId): void => {
              if (modelId !== 'local-agent') {
                onModelChange?.(modelId)
              }
            }}
            placeholder="本地 Agent"
            className="relative"
            dropdownWidth="w-48"
            buttonClassName={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 -ml-2 transition-colors ${isRunning ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100'}`}
            renderButton={(): JSX.Element => (
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                  <AppIcon name="smart_toy" size={16} />
                </div>
                <h2 className="font-semibold text-text-primary">本地 Agent</h2>
              </div>
            )}
            renderOption={(option, _isSelected, onSelect): JSX.Element => {
              const model = models.find((m) => m.id === option.value)
              const isLocalAgent = option.value === 'local-agent'
              return (
                <button
                  type="button"
                  onClick={onSelect}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-gray-100 transition-colors text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {option.logo ? (
                      <img
                        alt={model?.name || option.label}
                        className="w-5 h-5 shrink-0"
                        src={model?.logo || option.logo}
                      />
                    ) : isLocalAgent ? (
                      <div className="w-5 h-5 rounded-md bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                        <AppIcon name="smart_toy" size={16} />
                      </div>
                    ) : null}
                    <span className="text-text-primary text-sm truncate">{option.label}</span>
                  </div>
                </button>
              )
            }}
            options={modelOptions}
          />
        </div>

          {/* Right Header Actions — matches WebviewCard icon button pattern */}
          <div className="flex items-center gap-3">
            {/* New Session */}
            <button
              type="button"
              onClick={handleNewSession}
              className="flex items-center justify-center rounded-full text-text-secondary hover:text-primary transition-colors"
              title="新建会话"
            >
              <AppIcon name="annotation" size={20} />
            </button>

            {/* History Popover */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setHistoryMenuOpen(!historyMenuOpen)}
                className="flex items-center justify-center rounded-full text-text-secondary hover:text-primary transition-colors"
                title="对话历史"
              >
                <AppIcon name="history" size={20} />
              </button>

              {historyMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-popover"
                    onClick={() => setHistoryMenuOpen(false)}
                  />
                  <div className="absolute right-0 top-full mt-1.5 w-64 rounded-xl border border-gray-200 py-1 shadow-lg z-popover bg-white text-text-primary text-label">
                    <div className="px-3 py-1.5 flex items-center justify-between border-b border-gray-100">
                      <span className="text-caption font-semibold text-text-secondary uppercase tracking-wider">
                        对话历史
                      </span>
                      <button
                        type="button"
                        onClick={handleNewSession}
                        className="text-caption text-primary hover:opacity-80 font-medium"
                      >
                        + 新对话
                      </button>
                    </div>

                    <div className="max-h-64 overflow-y-auto py-1">
                      {sessions.length === 0 ? (
                        <div className="px-3 py-4 text-center text-text-secondary text-caption">
                          暂无历史对话
                        </div>
                      ) : (
                        sessions.map((item) => {
                          const isCurrent = item.id === currentSessionId
                          const dateStr = item.updatedAt
                            ? new Date(item.updatedAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit'
                              })
                            : ''
                          return (
                            <div
                              key={item.id}
                              onClick={() => handleSelectSession(item.id)}
                              className={`group px-3 py-2 hover:bg-blue-50/60 cursor-pointer flex items-start gap-2 transition-colors ${
                                isCurrent ? 'bg-blue-50/40' : ''
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                                  isCurrent ? 'bg-primary' : 'bg-transparent'
                                }`}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="font-medium text-text-primary truncate">
                                  {item.title || '新对话'}
                                </div>
                                <div className="text-tiny font-mono text-text-secondary mt-0.5">
                                  {dateStr ? `${dateStr} · ` : ''}
                                  {item.model || 'SWE-2'}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setDeleteTarget({ id: item.id, title: item.title || '新对话' })
                                }}
                                className="shrink-0 mt-0.5 p-0.5 rounded text-gray-400 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 transition-all"
                                title="删除会话"
                              >
                                <AppIcon name="delete" size={14} />
                              </button>
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Collapse Panel or Custom Header Actions */}
            {headerActions || (
              <button
                type="button"
                onClick={closeRightPane}
                className="flex items-center justify-center rounded-full text-text-secondary hover:text-primary transition-colors"
                title="折叠 AI 侧边栏"
              >
                <AppIcon name="right_panel_close" size={20} />
              </button>
            )}
          </div>
        </div>

        {/* Main Thread Viewport */}
        <div className="flex-1 flex flex-col min-h-0 relative">
          <div
            ref={viewportRef}
            className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
          >
            {/* Empty state */}
            {messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 my-auto">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-2.5">
                  <AppIcon name="smart_toy" size={22} />
                </div>
                <h3 className="font-semibold text-text-primary text-body mb-1">本地开发 Agent</h3>
                <p className="text-caption text-text-secondary max-w-xs leading-relaxed mb-3">
                  已加载 AGENTS.md 规范与本地工具链，支持自主阅读、编辑代码并执行命令。
                </p>

                {workspacePath ? (
                  <div className="flex items-center gap-1.5 text-caption text-text-secondary bg-gray-50 border border-gray-200/70 px-2.5 py-1 rounded-full mb-3">
                    <FolderOpen className="w-3 h-3 text-primary" />
                    <span className="truncate max-w-[200px]">{workspacePath}</span>
                  </div>
                ) : (
                  <div className="text-caption text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg mb-3">
                    提示: 请先在工作台打开文件夹
                  </div>
                )}

                <div className="flex flex-col gap-1.5 w-full max-w-xs">
                  {[
                    { icon: Sparkles, text: '分析当前项目结构与工作区概览' },
                    { icon: FileCode2, text: '检查 AGENTS.md 规范与当前代码质量' },
                    { icon: Terminal, text: '运行代码检查与类型构建' }
                  ].map(({ icon: Icon, text }) => (
                    <button
                      key={text}
                      type="button"
                      onClick={() => void prompt(text)}
                      className="w-full text-left p-2 rounded-lg border border-gray-200 hover:bg-gray-50 hover:border-primary/40 transition-colors text-label text-text-primary flex items-center gap-2"
                    >
                      <Icon className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span>{text}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Messages Stream */}
            {messages
              .filter((m) => m.role === 'user' || m.role === 'assistant')
              .map((message) => {
              if (message.role === 'user') {
                const userText = message.content
                  .filter((c) => c.type === 'text')
                  .map((c) => c.text)
                  .join('')
                // Resolve the session-entry id bound to this bubble by text.
                // The main process already restricts rewind to the LAST user
                // message, so the edit button is only meaningful there.
                const lastUserIdx = messages.reduce((acc, m, i) => (m.role === 'user' ? i : acc), -1)
                const isLastUserMessage = messages.indexOf(message) === lastUserIdx
                const canRewind = !isRunning && isLastUserMessage
                return (
                  <div key={message.id} className="group my-1">
                    <div className="flex justify-end">
                      <div className="max-w-[85%] bg-primary text-white text-body leading-relaxed px-4 py-2.5 rounded-2xl rounded-tr-xs shadow-xs break-words whitespace-pre-wrap select-text">
                        {userText}
                      </div>
                    </div>
                    <div className="mt-1 flex items-center justify-end gap-0.5 pr-1 opacity-0 transition-opacity group-hover:opacity-100">
                      {canRewind && (
                        <button
                          type="button"
                          onClick={() => setRewindConfirmOpen(true)}
                          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-caption text-text-secondary transition-colors hover:bg-gray-100 hover:text-text-primary"
                          title="编辑并撤回此条消息"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          <span>编辑</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleCopy(message.id, userText)}
                        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-caption text-text-secondary transition-colors hover:bg-gray-100 hover:text-text-primary"
                        title="复制消息内容"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        <span>{copiedId === message.id ? '已复制' : '复制'}</span>
                      </button>
                    </div>
                  </div>
                )
              }

              // Assistant message
              const isMsgRunning = message.status === 'running'
              const blocks = groupContentParts(message.content, isMsgRunning)
              const assistantText = message.content
                .filter((c) => c.type === 'text')
                .map((c) => c.text ?? '')
                .join('\n')
                .trim()
              const msgIndex = messages.indexOf(message)
              // Only the final assistant message of a turn carries the
              // actions row — the branch/copy buttons belong to the turn's
              // closing reply, not to intermediate tool/reasoning bubbles.
              const nextMsg = messages[msgIndex + 1]
              const isTurnFinal = !nextMsg || nextMsg.role === 'user'
              const isForkMenuTarget = forkMenuOpenFor === message.id

              return (
                <div key={message.id} className="group space-y-2.5 my-2">
                  {blocks.map((block, bIdx) => {
                    if (block.type === 'reasoning') {
                      return (
                        <ThinkingBlock
                          key={bIdx}
                          thinking={block.reasoning}
                          isRunning={block.isRunning}
                        />
                      )
                    }

                    if (block.type === 'tool-group') {
                      return (
                        <ToolGroup
                          key={bIdx}
                          parts={block.parts}
                          isRunning={block.isRunning}
                        />
                      )
                    }

                    if (block.type === 'text') {
                      return (
                        <div key={bIdx} className="w-full">
                          <MarkdownRenderer content={block.text} />
                        </div>
                      )
                    }

                    return null
                  })}

                  {message.error && (
                    <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-body font-medium">
                      {message.error}
                    </div>
                  )}

                  {!isMsgRunning && isTurnFinal && (
                    <div className="relative flex items-center gap-0.5 -ml-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() =>
                          setForkMenuOpenFor((cur) => (cur === message.id ? null : message.id))
                        }
                        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-caption text-text-secondary transition-colors hover:bg-gray-100 hover:text-text-primary"
                        title="从当前位置创建分支会话"
                      >
                        <GitBranch className="h-3.5 w-3.5" />
                        <span>分支</span>
                      </button>
                      {isForkMenuTarget && (
                        <>
                          <div
                            className="fixed inset-0 z-popover"
                            onClick={() => setForkMenuOpenFor(null)}
                          />
                          <div className="absolute left-0 bottom-full mb-1.5 z-popover w-32 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                            <button
                              type="button"
                              disabled={isForking}
                              onClick={() => {
                                setForkMenuOpenFor(null)
                                void handleConfirmFork()
                              }}
                              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-caption text-text-primary transition-colors hover:bg-gray-50 disabled:opacity-50"
                            >
                              <GitBranch className="h-3.5 w-3.5 text-primary" />
                              <span>{isForking ? '创建中…' : '创建分支'}</span>
                            </button>
                          </div>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => handleCopy(message.id, assistantText)}
                        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-caption text-text-secondary transition-colors hover:bg-gray-100 hover:text-text-primary"
                        title="复制本轮回复文本"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        <span>{copiedId === message.id ? '已复制' : '复制'}</span>
                      </button>
                    </div>
                  )}
                </div>
              )
            })}

            {/* Pending Approvals */}
            {pendingApprovals.map((req) => (
              <ApprovalCard key={req.requestId} request={req} />
            ))}
          </div>

          {/* Composer */}
          <AgentComposer />
        </div>

        <ConfirmModal
          isOpen={deleteTarget !== null}
          title="删除会话"
          message={deleteTarget ? `确定要删除会话「${deleteTarget.title}」吗？此操作无法撤销。` : ''}
          confirmText="确认删除"
          onConfirm={handleConfirmDeleteSession}
          onCancel={() => setDeleteTarget(null)}
        />

        <ConfirmModal
          isOpen={rewindConfirmOpen}
          title="撤回并编辑"
          message="将回到这条提问之前的状态，原提问会重新填入输入框供修改后重新发送。本轮 Agent 已修改的文件不会被还原（当前版本不支持代码回滚）。"
          confirmText="撤回并编辑"
          type="warning"
          onConfirm={async () => {
            setRewindConfirmOpen(false)
            await rewindLastUserMessage()
          }}
          onCancel={() => setRewindConfirmOpen(false)}
        />
      </div>
  )
}
