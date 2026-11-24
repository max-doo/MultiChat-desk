import { useState, useRef, useEffect } from 'react'
import { Plus, ChevronDown, Loader2, ArrowUp, Square, X, Brain, Pencil, Play, TriangleAlert, Folder, Check } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAgentSessionStore } from '../../../store/agentSessionStore'
import { useWorkbenchStore } from '../../../store/workbenchStore'
import type { AgentPermissionMode, AgentSkill, AgentThinkingLevel } from '../../../types/agent'
import type { WorkbenchFileNode } from '../../../../../shared/types/workbench'
import FileTypeIcon from '../FileTypeIcon'
import { AgentModelPicker } from './AgentModelPicker'
import { THINKING_LABELS } from './AgentThinkingPicker'
import { AgentContextMeter } from './AgentContextMeter'
import { AgentPopover } from './AgentPopover'

interface AtMention {
  query: string
  triggerIndex: number
}

function flattenFileTree(nodes: WorkbenchFileNode[], out: WorkbenchFileNode[] = []): WorkbenchFileNode[] {
  for (const node of nodes) {
    out.push(node)
    if (node.children?.length) flattenFileTree(node.children, out)
  }
  return out
}

export function AgentComposer(): JSX.Element {
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const fileTree = useWorkbenchStore((s) => s.fileTree)
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
  const snapshot = useAgentSessionStore((s) => s.snapshot)
  const sessionStatus = useAgentSessionStore((s) => s.sessionStatus)
  const skills = useAgentSessionStore((s) => s.skills)
  const fetchSkills = useAgentSessionStore((s) => s.fetchSkills)

  const [accessMenuOpen, setAccessMenuOpen] = useState(false)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [atMention, setAtMention] = useState<AtMention | null>(null)
  const [atIndex, setAtIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const atListRef = useRef<HTMLDivElement>(null)

  const isWorkspaceReady = Boolean(workspacePath)

  // Refresh the skill list whenever the workspace changes so `/` suggestions
  // reflect the skills of the folder the user is actually working in.
  useEffect(() => {
    if (isWorkspaceReady) {
      void fetchSkills(workspacePath ?? undefined)
    }
  }, [isWorkspaceReady, workspacePath, fetchSkills])

  // Skill autocomplete: show suggestions when the input is a `/`-prefixed
  // command (pi expands `/skill:name args` to the skill's body on submit).
  const skillQuery = (() => {
    if (!composerInput.startsWith('/')) return null
    const head = composerInput.split(/\s/, 1)[0]
    return head.startsWith('/skill:') ? head.slice('/skill:'.length) : head.slice(1)
  })()
  const skillSuggestions = (() => {
    if (skillQuery === null || !skills.length) return []
    const q = skillQuery.toLowerCase()
    return skills.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 8)
  })()
  const skillMenuOpen = skillQuery !== null && skillSuggestions.length > 0

  const applySkill = (skill: AgentSkill): void => {
    const rest = composerInput.startsWith('/skill:')
      ? composerInput.slice(composerInput.indexOf(skill.name) + skill.name.length)
      : ''
    setComposerInput(`/skill:${skill.name}${rest.startsWith(' ') ? rest : ' '}`)
    textareaRef.current?.focus()
  }

  // `@` file mention: suggest workspace files/directories, reusing the same
  // popover pattern as the skill menu. Selecting a file inserts `@<relPath>`
  // into the text and attaches its absolute path so it reaches the agent.
  const flatFiles = (() => flattenFileTree(fileTree))()
  const atSuggestions = (() => {
    if (!atMention) return []
    const q = atMention.query.toLowerCase()
    const filtered = flatFiles.filter((f) =>
      !q || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
    )
    filtered.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.path.localeCompare(b.path))
    return filtered.slice(0, 30)
  })()
  const atMenuOpen = atMention !== null && atSuggestions.length > 0

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const value = e.target.value
    const cursor = e.target.selectionStart ?? value.length
    setComposerInput(value)

    const before = value.slice(0, cursor)
    const match = before.match(/(?:^|\s)@([^\s@]*)$/)
    if (match) {
      setAtMention({ query: match[1], triggerIndex: cursor - match[1].length - 1 })
      setAtIndex(0)
    } else {
      setAtMention(null)
    }
  }

  const applyAtMention = (node: WorkbenchFileNode): void => {
    if (!atMention) return
    const before = composerInput.slice(0, atMention.triggerIndex)
    const after = composerInput.slice(atMention.triggerIndex + atMention.query.length + 1)
    const insert = `@${node.path}`
    setComposerInput(`${before}${insert} ${after}`)
    addAttachment(node.fullPath)
    setAtMention(null)
    textareaRef.current?.focus()
  }

  useEffect(() => {
    const el = atListRef.current?.querySelector('[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [atIndex])

  // Close the @ menu when the composer is cleared externally (e.g. after send).
  useEffect(() => {
    if (atMention && !composerInput.includes('@')) setAtMention(null)
  }, [composerInput, atMention])

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
    if (atMenuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setAtIndex((i) => (i + 1) % atSuggestions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setAtIndex((i) => (i - 1 + atSuggestions.length) % atSuggestions.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        applyAtMention(atSuggestions[atIndex] || atSuggestions[0])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setAtMention(null)
        return
      }
    }
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

  const permissionModeLabels: Record<AgentPermissionMode, { label: string; color: string; desc: string; icon: LucideIcon }> = {
    default: { label: '默认模式', color: 'text-primary', desc: '工作区内编辑直接执行，命令需确认', icon: Pencil },
    auto: { label: '自动模式', color: 'text-amber-600', desc: '工作区内编辑和一般命令自动执行', icon: Play },
    bypass: { label: '全放行', color: 'text-rose-600', desc: '跳过可确认项，高危与未知仍拒绝', icon: TriangleAlert }
  }

  const currentModeInfo = permissionModeLabels[permissionMode] || permissionModeLabels.default
  const CurrentModeIcon = currentModeInfo.icon
  const active = sessionStatus?.active ?? snapshot?.active
  const modelLabel = active?.modelName || activeModel
  const thinkingLevel: AgentThinkingLevel = active?.thinkingLevel ?? 'off'
  const thinkingLevels = active?.availableThinkingLevels ?? []
  const supportsThinking = Boolean(active?.supportsThinking && thinkingLevels.length > 1)

  return (
    <footer className="p-3 pt-0 shrink-0 bg-transparent relative">
      {/* Attachment Chips */}
      {attachments.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5 px-1">
          {attachments.map((filePath, idx) => {
            const fileName = filePath.split(/[/\\]/).pop() || filePath
            return (
              <span
                key={idx}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200/70 text-blue-700 text-caption font-mono"
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

      {/* Main Capsule Container with Feathered Aura Flow */}
      <div
        onClick={() => textareaRef.current?.focus()}
        className="group relative w-full rounded-2xl cursor-text transition-all duration-300"
      >
        {/* 1. 外层弥散流光气场 (Ambient Flowing Aura: 12px 模糊，灵动流转) */}
        <div className="composer-ambient-aura" />

        {/* 2. 贴身柔化流光边缘 (Close Feathered Flow: 3px 羽化，无生硬粗线) */}
        <div className="composer-feathered-flow" />

        {/* 3. 输入框实体表面 (微透玻璃，将流光自然漫透) */}
        <div className="composer-surface relative w-full flex flex-col justify-between">
        {/* Skill Suggestions */}
        {skillMenuOpen && (
          <div className="absolute left-0 bottom-full mb-1.5 w-full rounded-xl border border-gray-200 py-1 shadow-lg z-popover bg-white text-text-primary text-label max-h-56 overflow-y-auto">
            {skillSuggestions.map((skill) => (
              <button
                key={skill.filePath}
                type="button"
                onClick={() => applySkill(skill)}
                className="w-full text-left px-3 py-1.5 hover:bg-gray-50 flex items-baseline gap-2 transition-colors"
              >
                <span className="font-medium text-primary shrink-0">/{skill.name}</span>
                <span className="truncate text-text-secondary text-caption">{skill.description}</span>
                {skill.disableModelInvocation && (
                  <span className="ml-auto shrink-0 text-tiny text-text-secondary/70">显式调用</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* @ File Mentions */}
        {atMenuOpen && (
          <div
            ref={atListRef}
            className="absolute left-0 bottom-full mb-1.5 w-full rounded-xl border border-gray-200 py-1 shadow-lg z-popover bg-white text-text-primary text-label max-h-56 overflow-y-auto"
          >
            {atSuggestions.map((node, idx) => (
              <button
                key={node.id}
                type="button"
                data-active={idx === atIndex}
                onMouseEnter={() => setAtIndex(idx)}
                onClick={() => applyAtMention(node)}
                className={`w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors ${
                  idx === atIndex ? 'bg-blue-50' : 'hover:bg-gray-50'
                }`}
              >
                {node.isDirectory ? (
                  <Folder className="w-3.5 h-3.5 shrink-0 text-amber-500" />
                ) : (
                  <FileTypeIcon node={node} className="w-3.5 h-3.5" />
                )}
                <span className="truncate text-text-primary">{node.name}</span>
                <span className="truncate text-text-secondary text-caption font-mono">{node.path}</span>
              </button>
            ))}
          </div>
        )}

        {/* Text Input Area */}
        <div className="px-3.5 pt-3 pb-1">
          <textarea
            ref={textareaRef}
            rows={2}
            disabled={!isWorkspaceReady}
            value={composerInput}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={
              !isWorkspaceReady
                ? '请先在工作台打开一个文件夹以启用 Agent'
                : '和 Agent 一起工作（Enter 发送，Shift+Enter 换行，@ 引用文件）...'
            }
            className="w-full bg-transparent resize-none border-none outline-none text-body leading-relaxed placeholder:text-text-secondary/70 text-text-primary disabled:cursor-not-allowed font-normal select-text min-h-[48px]"
            style={{ userSelect: 'text', minHeight: '48px' }}
          />
        </div>

        {/* Bottom Tool Bar */}
        <div className="px-3 pb-2.5 pt-1 flex items-center justify-between text-label">
          {/* Left: Attachment + Permission Mode */}
          <div className="flex items-center gap-1.5">
            {/* Attachment Button */}
            <button
              type="button"
              disabled={!isWorkspaceReady}
              onClick={() => void handleSelectFiles()}
              className="w-7 h-7 rounded-lg hover:bg-slate-200/70 disabled:opacity-40 text-slate-500 hover:text-slate-800 flex items-center justify-center transition-colors"
              title="添加附件 / 注入文件路径"
            >
              <Plus className="w-4 h-4" />
            </button>

            {/* Permission Mode Selector */}
            <div className="relative inline-flex items-center">
              <button
                type="button"
                onClick={() => setAccessMenuOpen(!accessMenuOpen)}
                className={`flex items-center gap-1 font-medium ${currentModeInfo.color} hover:opacity-80 transition-colors py-1 px-2 rounded-lg hover:bg-slate-200/50 text-label ${
                  accessMenuOpen ? 'bg-slate-200/50' : ''
                }`}
                title="切换权限模式"
              >
                <CurrentModeIcon className="w-3.5 h-3.5" />
                <span>{currentModeInfo.label}</span>
                <ChevronDown className="w-3 h-3" />
              </button>

              {/* Access Mode Menu 直接挂载在按钮上方 */}
              <AgentPopover
                open={accessMenuOpen}
                onClose={() => setAccessMenuOpen(false)}
                align="left"
                className="w-72 max-w-[calc(100vw-48px)] p-1"
              >
                <div className="flex flex-col text-label w-full select-none bg-white">
                  {/* 模式列表 */}
                  <div className="space-y-0.5">
                    {(['default', 'auto', 'bypass'] as AgentPermissionMode[]).map((mode) => {
                      const item = permissionModeLabels[mode]
                      const isCurrent = permissionMode === mode
                      const ModeIcon = item.icon
                      return (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => {
                            void setPermissionMode(mode)
                            setAccessMenuOpen(false)
                          }}
                          className={`w-full text-left px-2.5 py-2 rounded-lg flex items-center justify-between transition-colors ${
                            isCurrent
                              ? 'bg-blue-50/60 font-medium'
                              : 'hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div
                              className={`w-6.5 h-6.5 rounded-md flex items-center justify-center shrink-0 ${
                                mode === 'default'
                                  ? 'bg-blue-50 text-primary'
                                  : mode === 'auto'
                                  ? 'bg-amber-50 text-amber-600'
                                  : 'bg-rose-50 text-rose-600'
                              }`}
                            >
                              <ModeIcon size={13} className="shrink-0" />
                            </div>
                            <div className="min-w-0">
                              <div className={`text-body leading-tight ${isCurrent ? 'text-slate-900 font-semibold' : 'text-slate-800 font-medium'}`}>
                                {item.label}
                              </div>
                              <div className="text-caption text-text-secondary truncate mt-0.5 whitespace-nowrap">
                                {item.desc}
                              </div>
                            </div>
                          </div>
                          {isCurrent && (
                            <Check className="w-3.5 h-3.5 text-primary shrink-0 ml-1.5" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </AgentPopover>
            </div>
          </div>

          {/* Right: Context + Combined Model & Thinking Selector + Send */}
          <div className="flex items-center gap-2 min-w-0">
            {/* 上下文圆形仪表 */}
            <AgentContextMeter />

            {/* 合并后的模型选择与思考深度 Selector */}
            <div className="relative inline-flex items-center min-w-0">
              <button
                type="button"
                onClick={() => setModelPickerOpen((prev) => !prev)}
                disabled={isRunning}
                className={`flex items-center gap-1.5 text-slate-700 hover:text-slate-900 text-label px-2.5 py-1 rounded-lg bg-slate-100/70 hover:bg-slate-200/70 border border-slate-200/60 disabled:opacity-50 transition-all min-w-0 ${
                  modelPickerOpen ? 'bg-slate-200/80 border-slate-300' : ''
                }`}
                title={
                  supportsThinking
                    ? `${modelLabel} · 思考深度: ${THINKING_LABELS[thinkingLevel] ?? thinkingLevel}`
                    : modelLabel
                }
              >
                {isRunning ? (
                  <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
                ) : (
                  <Brain className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                )}
                <span className="font-medium truncate max-w-[120px]">{modelLabel}</span>
                {supportsThinking && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span className="text-slate-500 text-caption shrink-0">
                      {THINKING_LABELS[thinkingLevel] ?? thinkingLevel}
                    </span>
                  </>
                )}
                <ChevronDown
                  className={`w-3 h-3 text-slate-400 shrink-0 transition-transform duration-150 ${
                    modelPickerOpen ? 'rotate-180 text-primary' : ''
                  }`}
                />
              </button>

              {/* 直接在选择器上面弹出的 Model + Thinking 弹窗 */}
              <AgentPopover
                open={modelPickerOpen}
                onClose={() => setModelPickerOpen(false)}
                align="right"
                className="w-80 max-w-[calc(100vw-48px)]"
              >
                <AgentModelPicker onClose={() => setModelPickerOpen(false)} />
              </AgentPopover>
            </div>

            {/* Action Button: Send or Stop */}
            <button
              type="button"
              onClick={handleActionClick}
              disabled={!isRunning && (!isWorkspaceReady || (!composerInput.trim() && attachments.length === 0))}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-xs shrink-0 ${
                isRunning
                  ? 'bg-primary hover:opacity-90 text-white'
                  : !isWorkspaceReady || (!composerInput.trim() && attachments.length === 0)
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-primary hover:opacity-90 text-white'
              }`}
              title={isRunning ? '终止运行' : '发送消息'}
            >
              {isRunning ? (
                <Square className="w-3 h-3 fill-current" />
              ) : (
                <ArrowUp className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  </footer>
  )
}
