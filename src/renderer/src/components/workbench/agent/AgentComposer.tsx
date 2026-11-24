import { useState, useRef, useEffect } from 'react'
import { Plus, ChevronDown, Loader2, ArrowUp, Square, X, Settings2 } from 'lucide-react'
import { useAgentSessionStore } from '../../../store/agentSessionStore'
import { useWorkbenchStore } from '../../../store/workbenchStore'
import type { AgentPermissionMode } from '../../../types/agent'

interface AgentComposerProps {
  onOpenSettings: () => void
}

export function AgentComposer({ onOpenSettings }: AgentComposerProps): JSX.Element {
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const isRunning = useAgentSessionStore((s) => s.isRunning)
  const permissionMode = useAgentSessionStore((s) => s.permissionMode)
  const setPermissionMode = useAgentSessionStore((s) => s.setPermissionMode)
  const composerInput = useAgentSessionStore((s) => s.composerInput)
  const setComposerInput = useAgentSessionStore((s) => s.setComposerInput)
  const attachments = useAgentSessionStore((s) => s.attachments)
  const addAttachment = useAgentSessionStore((s) => s.addAttachment)
  const removeAttachment = useAgentSessionStore((s) => s.removeAttachment)
  const prompt = useAgentSessionStore((s) => s.prompt)
  const abort = useAgentSessionStore((s) => s.abort)
  const activeModel = useAgentSessionStore((s) => s.activeModel)

  const [accessMenuOpen, setAccessMenuOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isWorkspaceReady = Boolean(workspacePath)

  // Auto-resize textarea height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      const scrollHeight = textareaRef.current.scrollHeight
      const minHeight = 44
      const nextHeight = Math.max(minHeight, Math.min(scrollHeight || minHeight, 140))
      textareaRef.current.style.height = `${nextHeight}px`
    }
  }, [composerInput])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (isRunning) return
      if (!isWorkspaceReady) return
      if (composerInput.trim() || attachments.length > 0) {
        void prompt(composerInput)
      }
    }
  }

  const handleActionClick = (): void => {
    if (isRunning) {
      void abort()
    } else {
      if (!isWorkspaceReady) return
      if (composerInput.trim() || attachments.length > 0) {
        void prompt(composerInput)
      }
    }
  }

  const handleSelectFiles = async (): Promise<void> => {
    try {
      if (window.api?.selectFile) {
        const filePath = await window.api.selectFile()
        if (filePath) {
          addAttachment(filePath)
        }
      }
    } catch {
      // ignore
    }
  }

  const permissionModeLabels: Record<AgentPermissionMode, { label: string; color: string; desc: string }> = {
    full: { label: '完全访问', color: 'text-amber-600', desc: '除高危黑名单外自动放行' },
    restricted: { label: '受限模式', color: 'text-primary', desc: '写操作/高危命令需弹窗确认' },
    readonly: { label: '只读模式', color: 'text-purple-600', desc: '仅允许只读查询，禁止修改' }
  }

  const currentModeInfo = permissionModeLabels[permissionMode] || permissionModeLabels.restricted

  return (
    <footer className="p-3 pt-0 shrink-0 bg-white relative">
      {/* Attachment Chips */}
      {attachments.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5 px-1">
          {attachments.map((filePath, idx) => {
            const fileName = filePath.split(/[/\\]/).pop() || filePath
            return (
              <span
                key={idx}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200/70 text-blue-700 text-[11px] font-mono"
              >
                <span className="truncate max-w-[140px]">{fileName}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(idx)}
                  className="hover:text-blue-900 rounded-full p-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )
          })}
        </div>
      )}

      {/* Main Capsule Container */}
      <div
        onClick={() => textareaRef.current?.focus()}
        className="w-full rounded-xl border border-gray-200 bg-gray-50/80 focus-within:bg-white focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/10 transition-all duration-150 flex flex-col justify-between cursor-text"
      >
        {/* Text Input Area */}
        <div className="px-3 pt-2.5 pb-1">
          <textarea
            ref={textareaRef}
            rows={2}
            disabled={!isWorkspaceReady}
            value={composerInput}
            onChange={(e) => setComposerInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              !isWorkspaceReady
                ? '请先在工作台打开一个文件夹以启用本地 Agent'
                : '和 本地 Agent 一起工作（Enter 发送，Shift+Enter 换行）...'
            }
            className="w-full bg-transparent resize-none border-none outline-none text-[13px] leading-relaxed placeholder:text-text-secondary/70 text-text-primary disabled:cursor-not-allowed font-normal select-text min-h-[44px]"
            style={{ userSelect: 'text', minHeight: '44px' }}
          />
        </div>

        {/* Bottom Tool Bar */}
        <div className="px-2.5 pb-2 pt-0.5 flex items-center justify-between text-xs">
          {/* Left: Attachment + Permission Mode */}
          <div className="flex items-center gap-1.5">
            {/* Attachment Button */}
            <button
              type="button"
              disabled={!isWorkspaceReady}
              onClick={() => void handleSelectFiles()}
              className="w-6 h-6 rounded-md hover:bg-gray-200/70 disabled:opacity-40 text-text-secondary hover:text-text-primary flex items-center justify-center transition-colors"
              title="添加附件 / 注入文件路径"
            >
              <Plus className="w-4 h-4" />
            </button>

            {/* Permission Mode Selector */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setAccessMenuOpen(!accessMenuOpen)}
                className={`flex items-center gap-0.5 font-medium ${currentModeInfo.color} hover:opacity-80 transition-colors py-0.5 px-1.5 rounded hover:bg-gray-200/50 text-[11px]`}
                title="切换权限模式"
              >
                <span>{currentModeInfo.label}</span>
                <ChevronDown className="w-3 h-3" />
              </button>

              {/* Access Mode Menu */}
              {accessMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setAccessMenuOpen(false)}
                  />
                  <div className="absolute left-0 bottom-full mb-2 w-48 rounded-xl border border-gray-200 py-1 shadow-xl z-50 bg-white text-text-primary text-xs">
                    {(['restricted', 'full', 'readonly'] as AgentPermissionMode[]).map((mode) => {
                      const item = permissionModeLabels[mode]
                      const isCurrent = permissionMode === mode
                      return (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => {
                            void setPermissionMode(mode)
                            setAccessMenuOpen(false)
                          }}
                          className={`w-full text-left px-3 py-1.5 hover:bg-gray-50 flex items-center justify-between transition-colors ${
                            isCurrent ? 'bg-blue-50/50' : ''
                          }`}
                        >
                          <div>
                            <div className={`font-medium ${item.color}`}>{item.label}</div>
                            <div className="text-[10px] text-text-secondary">{item.desc}</div>
                          </div>
                          {isCurrent && <span className="text-[10px] text-primary font-medium">当前</span>}
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Right: Model Indicator + Send / Abort Button */}
          <div className="flex items-center gap-2">
            {/* Model Indicator & Settings Trigger */}
            <button
              type="button"
              onClick={onOpenSettings}
              className="flex items-center gap-1.5 text-text-secondary hover:text-text-primary text-[11px] px-2 py-0.5 rounded hover:bg-gray-200/60 transition-colors"
              title="配置本地 Agent 模型与 API 凭证"
            >
              {isRunning ? (
                <Loader2 className="w-3 h-3 text-primary animate-spin" />
              ) : (
                <Settings2 className="w-3 h-3 text-text-secondary" />
              )}
              <span className="font-normal text-text-secondary truncate max-w-[120px]">
                {activeModel}
              </span>
            </button>

            {/* Action Button: Send or Stop */}
            <button
              type="button"
              onClick={handleActionClick}
              disabled={!isRunning && (!isWorkspaceReady || (!composerInput.trim() && attachments.length === 0))}
              className={`w-7 h-7 rounded-full flex items-center justify-center transition-all shadow-xs shrink-0 ${
                isRunning
                  ? 'bg-primary hover:opacity-90 text-white'
                  : !isWorkspaceReady || (!composerInput.trim() && attachments.length === 0)
                  ? 'bg-gray-200 text-text-secondary cursor-not-allowed'
                  : 'bg-primary hover:opacity-90 text-white'
              }`}
              title={isRunning ? '终止运行' : '发送消息'}
            >
              {isRunning ? (
                <Square className="w-2.5 h-2.5 fill-current" />
              ) : (
                <ArrowUp className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </footer>
  )
}
