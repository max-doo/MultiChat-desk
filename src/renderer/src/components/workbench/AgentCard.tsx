import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Sparkles,
  FileCode2,
  Terminal,
  FolderOpen
} from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { useAgentSessionStore } from '../../store/agentSessionStore'
import CustomDropdown, { type DropdownOption } from '../CustomDropdown'
import { AppIcon } from '../icons/AppIcon'
import { BashToolUI } from './agent/BashToolUI'
import { EditToolUI } from './agent/EditToolUI'
import { ReadToolUI } from './agent/ReadToolUI'
import { ToolFallback } from './agent/ToolFallback'
import { ApprovalCard } from './agent/ApprovalCard'
import { ThinkingBlock } from './agent/ThinkingBlock'
import { AgentComposer } from './agent/AgentComposer'
import { AgentSettingsModal } from './agent/AgentSettingsModal'
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
  const closeRightPane = useWorkbenchStore((s) => s.closeRightPane)

  const messages = useAgentSessionStore((s) => s.messages)
  const isRunning = useAgentSessionStore((s) => s.isRunning)
  const sessions = useAgentSessionStore((s) => s.sessions)
  const currentSessionId = useAgentSessionStore((s) => s.currentSessionId)
  const currentCwd = useAgentSessionStore((s) => s.currentCwd)
  const pendingApprovals = useAgentSessionStore((s) => s.pendingApprovals)
  const prompt = useAgentSessionStore((s) => s.prompt)
  const newSession = useAgentSessionStore((s) => s.newSession)
  const resumeSession = useAgentSessionStore((s) => s.resumeSession)
  const initListeners = useAgentSessionStore((s) => s.initListeners)

  const [historyMenuOpen, setHistoryMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)

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
    // If no session or current session's workspace doesn't match active workspace
    if (workspacePath && (!currentSessionId || (currentCwd && currentCwd !== workspacePath))) {
      void newSession(workspacePath)
    }
  }, [currentSessionId, currentCwd, workspacePath, newSession])

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

  const renderToolPart = (part: PiContentPart, idx: number, isMsgRunning: boolean): JSX.Element => {
    const toolName = (part.toolName || '').toLowerCase()
    const isPartRunning = isMsgRunning && part.result === undefined && !part.isError

    if (
      toolName === 'bash' ||
      toolName === 'powershell' ||
      toolName === 'cmd' ||
      toolName === 'terminal' ||
      toolName === 'shell'
    ) {
      const command =
        typeof part.args === 'string'
          ? part.args
          : (part.args as { command?: string; cmd?: string })?.command ||
            (part.args as { command?: string; cmd?: string })?.cmd ||
            ''
      return (
        <BashToolUI
          key={idx}
          command={command}
          result={part.result}
          isError={part.isError}
          isRunning={isPartRunning}
          durationMs={part.durationMs}
        />
      )
    }

    if (toolName === 'edit' || toolName === 'write' || toolName === 'edit_file') {
      const obj = part.args as { path?: string; filePath?: string; diff?: string } | undefined
      return (
        <EditToolUI
          key={idx}
          path={obj?.path || obj?.filePath || ''}
          diff={obj?.diff || ''}
          result={part.result}
          isError={part.isError}
          isRunning={isPartRunning}
        />
      )
    }

    if (toolName === 'read' || toolName === 'read_file') {
      const obj = part.args as { path?: string; filePath?: string; lines?: string | number[] } | undefined
      return (
        <ReadToolUI
          key={idx}
          path={obj?.path || obj?.filePath || ''}
          lines={obj?.lines}
          result={part.result}
          isError={part.isError}
          isRunning={isPartRunning}
        />
      )
    }

    return (
      <ToolFallback
        key={idx}
        toolName={part.toolName || 'tool'}
        args={part.args}
        result={part.result}
        isError={part.isError}
        isRunning={isPartRunning}
      />
    )
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
                    className="fixed inset-0 z-40"
                    onClick={() => setHistoryMenuOpen(false)}
                  />
                  <div className="absolute right-0 top-full mt-1.5 w-64 rounded-xl border border-gray-200 py-1 shadow-xl z-50 bg-white text-text-primary text-xs">
                    <div className="px-3 py-1.5 flex items-center justify-between border-b border-gray-100">
                      <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">
                        对话历史
                      </span>
                      <button
                        type="button"
                        onClick={handleNewSession}
                        className="text-[11px] text-primary hover:opacity-80 font-medium"
                      >
                        + 新对话
                      </button>
                    </div>

                    <div className="max-h-64 overflow-y-auto py-1">
                      {sessions.length === 0 ? (
                        <div className="px-3 py-4 text-center text-text-secondary text-xs">
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
                              className={`px-3 py-2 hover:bg-blue-50/60 cursor-pointer flex items-start gap-2 transition-colors ${
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
                                <div className="text-[10px] text-text-secondary mt-0.5">
                                  {dateStr ? `${dateStr} · ` : ''}
                                  {item.model || 'SWE-2'}
                                </div>
                              </div>
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
                <h3 className="font-semibold text-text-primary text-sm mb-1">本地开发 Agent</h3>
                <p className="text-xs text-text-secondary max-w-xs leading-relaxed mb-3">
                  已加载 AGENTS.md 规范与本地工具链，支持自主阅读、编辑代码并执行命令。
                </p>

                {workspacePath ? (
                  <div className="flex items-center gap-1.5 text-[11px] text-text-secondary bg-gray-50 border border-gray-200/70 px-2.5 py-1 rounded-full mb-3">
                    <FolderOpen className="w-3 h-3 text-primary" />
                    <span className="truncate max-w-[200px]">{workspacePath}</span>
                  </div>
                ) : (
                  <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg mb-3">
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
                      className="w-full text-left p-2 rounded-lg border border-gray-200 hover:bg-gray-50 hover:border-primary/40 transition-colors text-xs text-text-primary flex items-center gap-2"
                    >
                      <Icon className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span>{text}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Messages Stream */}
            {messages.map((message) => {
              if (message.role === 'user') {
                const userText = message.content
                  .filter((c) => c.type === 'text')
                  .map((c) => c.text)
                  .join('')
                return (
                  <div key={message.id} className="flex justify-end">
                    <div className="max-w-[88%] bg-primary text-white text-[13px] leading-relaxed px-3.5 py-2 rounded-2xl rounded-tr-sm shadow-xs break-words whitespace-pre-wrap">
                      {userText}
                    </div>
                  </div>
                )
              }

              // Assistant message
              const isMsgRunning = message.status === 'running'
              return (
                <div key={message.id} className="space-y-1.5">
                  {message.content.map((part, pIdx) => {
                    if (part.type === 'reasoning') {
                      return (
                        <ThinkingBlock
                          key={pIdx}
                          thinking={part.reasoning || ''}
                          isRunning={isMsgRunning && pIdx === message.content.length - 1}
                        />
                      )
                    }

                    if (part.type === 'text') {
                      if (!part.text?.trim()) return null
                      return (
                        <div
                          key={pIdx}
                          className="prose prose-sm max-w-none text-text-primary text-[13px] leading-relaxed select-text prose-code:before:content-none prose-code:after:content-none prose-headings:text-text-primary prose-strong:text-text-primary prose-table:text-text-secondary prose-th:text-text-primary"
                        >
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              pre({ children }) {
                                return (
                                  <pre className="p-2.5 my-2 rounded-lg bg-gray-900 text-gray-100 font-mono text-xs overflow-x-auto select-text">
                                    {children}
                                  </pre>
                                )
                              },
                              code({ className, children, ...props }) {
                                const isBlock = Boolean(className && /language-/.test(className))
                                if (isBlock) {
                                  return (
                                    <code className={className} {...props}>
                                      {children}
                                    </code>
                                  )
                                }
                                return (
                                  <code
                                    className="px-1.5 py-0.5 mx-0.5 rounded bg-gray-100 text-gray-800 font-mono text-[11.5px] border border-gray-200/60"
                                    {...props}
                                  >
                                    {children}
                                  </code>
                                )
                              },
                              p({ children }) {
                                return <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>
                              }
                            }}
                          >
                            {part.text || ''}
                          </ReactMarkdown>
                        </div>
                      )
                    }

                    if (part.type === 'tool-call') {
                      return renderToolPart(part, pIdx, isMsgRunning)
                    }

                    return null
                  })}

                  {message.error && (
                    <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs">
                      {message.error}
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
          <AgentComposer onOpenSettings={() => setSettingsOpen(true)} />
        </div>

        {/* Settings Modal */}
        <AgentSettingsModal
          isOpen={settingsOpen}
          onClose={() => setSettingsOpen(false)}
        />
      </div>
  )
}
