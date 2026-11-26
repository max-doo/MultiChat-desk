import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { AppIcon } from '../../icons/AppIcon'
import { useAgentSessionStore } from '../../../store/agentSessionStore'
import { useWorkbenchStore } from '../../../store/workbenchStore'
import { THINKING_LABELS, type AgentPermissionMode, type AgentSkill, type AgentThinkingLevel } from '../../../types/agent'
import type { WorkbenchFileNode } from '../../../../../shared/types/workbench'
import FileTypeIcon from '../FileTypeIcon'
import { extractLocalPath } from '../WorkbenchFileTree'
import { AgentModelPicker } from './AgentModelPicker'
import { AgentContextMeter } from './AgentContextMeter'
import { AgentComposerEditor, type AgentComposerEditorHandle } from './AgentComposerEditor'
import { AgentPopover } from './AgentPopover'
import { isFileMentioned } from './filePathUtils'

interface AtMention {
  query: string
  triggerIndex: number
}

const EMPTY_QUEUE: readonly string[] = []
const EMPTY_FILES: WorkbenchFileNode[] = []

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
  const mentionFile = useAgentSessionStore((s) => s.mentionFile)
  const imageAttachments = useAgentSessionStore((s) => s.imageAttachments)
  const addImageAttachment = useAgentSessionStore((s) => s.addImageAttachment)
  const removeImageAttachment = useAgentSessionStore((s) => s.removeImageAttachment)
  const prompt = useAgentSessionStore((s) => s.prompt)
  const abort = useAgentSessionStore((s) => s.abort)
  const queuedSteering = useAgentSessionStore((s) =>
    s.currentSessionId ? s.queuedSteering[s.currentSessionId] ?? EMPTY_QUEUE : EMPTY_QUEUE
  )
  const queuedFollowUp = useAgentSessionStore((s) =>
    s.currentSessionId ? s.queuedFollowUp[s.currentSessionId] ?? EMPTY_QUEUE : EMPTY_QUEUE
  )
  const activeModel = useAgentSessionStore((s) => s.activeModel)
  const snapshot = useAgentSessionStore((s) => s.snapshot)
  const sessionStatus = useAgentSessionStore((s) => s.sessionStatus)
  const skills = useAgentSessionStore((s) => s.skills)
  const fetchSkills = useAgentSessionStore((s) => s.fetchSkills)

  const [accessMenuOpen, setAccessMenuOpen] = useState(false)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [atMention, setAtMention] = useState<AtMention | null>(null)
  const [atIndex, setAtIndex] = useState(0)
  const editorRef = useRef<AgentComposerEditorHandle>(null)
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
    editorRef.current?.focus()
  }

  // `@` file mention: suggest workspace files/directories, reusing the same
  // popover pattern as the skill menu. Selecting a file inserts `@<relPath>`
  // into the text and attaches its absolute path so it reaches the agent.
  const isAtMentionOpen = atMention !== null
  const flatFiles = useMemo(
    () => (isAtMentionOpen ? flattenFileTree(fileTree) : EMPTY_FILES),
    [isAtMentionOpen, fileTree]
  )
  const atSuggestions = useMemo(() => {
    if (!atMention) return EMPTY_FILES
    const q = atMention.query.toLowerCase()
    const filtered = flatFiles.filter((f) =>
      !q || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
    )
    filtered.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.path.localeCompare(b.path))
    return filtered.slice(0, 30)
  }, [atMention, flatFiles])
  const atMenuOpen = atMention !== null && atSuggestions.length > 0

  const handleInputChange = (value: string, cursor: number): void => {
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
    // 已存在指向该文件的 @token 时不再重复插入，只替换当前正在输入的查询段。
    const exists = isFileMentioned(composerInput, node.fullPath, workspacePath)
    const insert = exists ? '' : `@${node.path}`
    setComposerInput(`${before}${insert} ${after}`)
    addAttachment(node.fullPath)
    setAtMention(null)
    editorRef.current?.focus()
  }

  useEffect(() => {
    const el = atListRef.current?.querySelector('[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [atIndex])

  useEffect(() => {
    if (atMention && !composerInput.includes('@')) setAtMention(null)
  }, [composerInput, atMention])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    // IME 组合输入期间的 Enter 用于上屏，不能拦截成发送。
    if (e.nativeEvent.isComposing) return
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
      if (!isWorkspaceReady) return
      if (composerInput.trim() || attachments.length > 0 || imageAttachments.length > 0) {
        void prompt(composerInput)
      }
    }
  }

  const handleSendClick = (): void => {
    if (!isWorkspaceReady) return
    if (composerInput.trim() || attachments.length > 0 || imageAttachments.length > 0) {
      void prompt(composerInput)
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>): void => {
    const items = e.clipboardData?.items
    if (!items?.length) return
    const imageFiles = Array.from(items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null)
    if (imageFiles.length === 0) return
    // 有图片时接管粘贴：文件走附件，不再向 textarea 插入二进制占位文本。
    e.preventDefault()
    setAtMention(null)
    for (const file of imageFiles) {
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = typeof reader.result === 'string' ? reader.result : ''
        if (!dataUrl) return
        addImageAttachment({
          dataUrl,
          mimeType: file.type || 'image/png',
          name: file.name || 'pasted-image'
        })
      }
      reader.readAsDataURL(file)
    }
  }

  const handleSelectFiles = async (): Promise<void> => {
    try {
      if (window.api?.selectFile) {
        const filePath = await window.api.selectFile()
        if (filePath) {
          mentionFile(filePath)
        }
      }
    } catch {
      // ignore
    }
  }

  const handleComposerDrop = useCallback(
    (e: React.DragEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      setAtMention(null)

      const customData = e.dataTransfer?.getData('application/x-multichat-workspace-files')
      if (customData) {
        try {
          const nodes = JSON.parse(customData) as Array<{
            path: string
            fullPath?: string
            name?: string
            isDirectory?: boolean
          }>
          const files = nodes.filter((n) => !n.isDirectory)
          if (files.length > 0) {
            for (const node of files) {
              const abs = node.fullPath || node.path
              mentionFile(abs)
            }
            return
          }
        } catch {
          // fall through
        }
      }

      const types = e.dataTransfer ? Array.from(e.dataTransfer.types) : []
      if (types.includes('Files') && e.dataTransfer?.files?.length) {
        const paths = Array.from(e.dataTransfer.files)
          .map((f) => extractLocalPath(f))
          .filter(Boolean)
        if (paths.length > 0) {
          for (const abs of paths) mentionFile(abs)
          return
        }
      }

      const textPlain = e.dataTransfer?.getData('text/plain')
      if (textPlain) {
        const lines = textPlain
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
        const looksLikePath = (s: string): boolean =>
          /^[A-Za-z]:[\\/]/.test(s) || s.startsWith('/') || s.startsWith('~/')
        const pathLines = lines.filter(looksLikePath)
        if (pathLines.length > 0) {
          for (const abs of pathLines) mentionFile(abs)
        }
      }
    },
    [mentionFile]
  )

  const permissionModeLabels: Record<AgentPermissionMode, { label: string; color: string; desc: string; icon: string }> = {
    default: { label: '默认模式', color: 'text-primary', desc: '工作区内编辑直接执行，命令需确认', icon: 'edit' },
    auto: { label: '自动模式', color: 'text-amber-600 dark:text-amber-400', desc: '只读与工作区内写入自动执行，越权写/高危需确认', icon: 'play_arrow' },
    bypass: { label: '全放行', color: 'text-rose-600 dark:text-rose-400', desc: '跳过确认，仅拦截系统破坏与凭据目录（无 OS 沙箱）', icon: 'warning' }
  }

  const currentModeInfo = permissionModeLabels[permissionMode] || permissionModeLabels.default
  const active = sessionStatus?.active ?? snapshot?.active
  const modelLabel = active?.modelName || activeModel
  const thinkingLevel: AgentThinkingLevel = active?.thinkingLevel ?? 'off'
  const thinkingLevels = active?.availableThinkingLevels ?? []
  const supportsThinking = Boolean(active?.supportsThinking && thinkingLevels.length > 1)

  return (
    <footer className="agent-composer px-5 pb-3 pt-0 shrink-0 bg-transparent relative">
      {(queuedFollowUp.length > 0 || queuedSteering.length > 0) && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {queuedFollowUp.map((text, i) => (
            <span
              key={`fu-${i}`}
              className="inline-flex items-center gap-1 max-w-full truncate rounded-full border border-slate-200 bg-slate-50/80 px-2.5 py-1 text-caption text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
              title={`待执行：${text}`}
            >
              <AppIcon name="progress_activity" size={12} className="animate-spin text-slate-400 shrink-0" />
              <span className="truncate">{text}</span>
            </span>
          ))}
          {queuedSteering.map((text, i) => (
            <span
              key={`st-${i}`}
              className="inline-flex items-center gap-1 max-w-full truncate rounded-full border border-amber-200 bg-amber-50/80 px-2.5 py-1 text-caption text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
              title={`打断中：${text}`}
            >
              <AppIcon name="send" size={12} className="shrink-0" />
              <span className="truncate">{text}</span>
            </span>
          ))}
        </div>
      )}
      {/* 图片附件缩略图：文件引用已经内联在输入框里，不再保留双轨 chip 行。 */}
      {imageAttachments.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5 px-1">
          {imageAttachments.map((img, idx) => (
            <span
              key={`img-${idx}`}
              className="group/img relative inline-flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border border-blue-200/70 bg-blue-50 dark:border-blue-400/25 dark:bg-blue-500/10"
            >
              <img
                src={img.dataUrl}
                alt={img.name || '粘贴的图片'}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => removeImageAttachment(idx)}
                className="absolute right-0.5 top-0.5 rounded-full bg-black/55 p-0.5 text-white opacity-0 transition-opacity group-hover/img:opacity-100"
                title="移除图片"
              >
                <AppIcon name="close" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div
        onClick={() => editorRef.current?.focus()}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (e.dataTransfer) {
            try {
              e.dataTransfer.dropEffect = 'copy'
            } catch {
              // ignore
            }
          }
        }}
        onDrop={handleComposerDrop}
        className="group relative w-full rounded-2xl cursor-text transition-all duration-300"
      >
        {/* 1. 外层弥散流光气场 */}
        <div className="composer-ambient-aura" />

        {/* 2. 贴身柔化流光边缘 */}
        <div className="composer-feathered-flow" />

        {/* 3. 输入框实体表面 */}
        <div className="composer-surface relative w-full flex flex-col justify-between">
        {skillMenuOpen && (
          <div className="absolute left-0 bottom-full mb-1.5 w-full liquid-glass-menu rounded-xl py-1 z-popover text-text-primary text-label max-h-56 overflow-y-auto">
            {skillSuggestions.map((skill) => (
              <button
                key={skill.filePath}
                type="button"
                onClick={() => applySkill(skill)}
                className="w-full text-left px-3 py-1.5 hover:bg-black/[0.045] dark:hover:bg-white/[0.07] flex items-baseline gap-2 transition-colors"
              >
                <span className="font-medium text-primary shrink-0">/{skill.name}</span>
                <span className="truncate text-text-secondary text-caption">{skill.description}</span>
                {skill.disableModelInvocation && (
                  <span className="ml-auto shrink-0 text-caption text-text-secondary/70">显式调用</span>
                )}
              </button>
            ))}
          </div>
        )}

        {atMenuOpen && (
          <div
            ref={atListRef}
            className="absolute left-0 bottom-full mb-1.5 w-full liquid-glass-menu rounded-xl py-1 z-popover text-text-primary text-label max-h-56 overflow-y-auto"
          >
            {atSuggestions.map((node, idx) => (
              <button
                key={node.id}
                type="button"
                data-active={idx === atIndex}
                onMouseEnter={() => setAtIndex(idx)}
                onClick={() => applyAtMention(node)}
                className={`w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors ${
                  idx === atIndex ? 'bg-blue-50/80 dark:bg-primary/15' : 'hover:bg-black/[0.045] dark:hover:bg-white/[0.07]'
                }`}
              >
                {node.isDirectory ? (
                  <AppIcon name="folder" size={14} className="shrink-0 text-amber-500" />
                ) : (
                  <FileTypeIcon node={node} className="w-3.5 h-3.5" />
                )}
                <span className="truncate text-text-primary">{node.name}</span>
                <span className="truncate text-text-secondary text-caption font-mono">{node.path}</span>
              </button>
            ))}
          </div>
        )}

        {/* Text Input Area：contenteditable 内联 chip 编辑器 */}
        <div className="px-3.5 pt-3 pb-1">
          <AgentComposerEditor
            ref={editorRef}
            value={composerInput}
            attachments={attachments}
            workspacePath={workspacePath}
            disabled={!isWorkspaceReady}
            onInputChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              !isWorkspaceReady
                ? '请先在工作台打开一个文件夹以启用 Agent'
                : isRunning
                ? '补充要求，可粘贴图片，Enter 排队执行，Shift+Enter 换行'
                : '和 Agent 一起工作（Enter 发送，可粘贴图片，@ 引用文件）...'
            }
          />
        </div>

        <div className="px-3 pb-2.5 pt-1 flex items-center justify-between text-label">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={!isWorkspaceReady}
              onClick={() => void handleSelectFiles()}
              className="w-7 h-7 rounded-lg hover:bg-slate-200/70 disabled:opacity-40 text-slate-500 hover:text-slate-800 flex items-center justify-center transition-colors dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-gray-200"
              title="添加附件 / 注入文件路径"
            >
              <AppIcon name="add" size={16} />
            </button>

            <div className="relative inline-flex items-center">
              <button
                type="button"
                onClick={() => setAccessMenuOpen(!accessMenuOpen)}
                className={`flex items-center gap-1 font-medium whitespace-nowrap ${currentModeInfo.color} hover:opacity-80 transition-colors py-1 px-2 rounded-lg hover:bg-slate-200/50 dark:hover:bg-white/10 text-label ${
                  accessMenuOpen ? 'bg-slate-200/50 dark:bg-white/10' : ''
                }`}
                title={`${currentModeInfo.label} · ${currentModeInfo.desc}`}
              >
                <AppIcon name={currentModeInfo.icon} size={14} />
                <span className="agent-composer-permission-label">{currentModeInfo.label}</span>
                <AppIcon name="expand_more" size={12} className="agent-composer-permission-chevron shrink-0" />
              </button>

              <AgentPopover
                open={accessMenuOpen}
                onClose={() => setAccessMenuOpen(false)}
                align="left"
                className="w-72 max-w-[calc(100vw-48px)] p-1"
              >
                <div className="flex flex-col text-label w-full select-none">
                  <div className="space-y-0.5">
                    {(['default', 'auto', 'bypass'] as AgentPermissionMode[]).map((mode) => {
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
                          className={`w-full text-left px-2.5 py-2 rounded-lg flex items-center justify-between transition-colors ${
                            isCurrent
                              ? 'bg-blue-50/75 dark:bg-primary/15 font-medium'
                              : 'hover:bg-black/[0.045] dark:hover:bg-white/[0.07]'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div
                              className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${
                                mode === 'default'
                                  ? 'bg-blue-50 text-primary dark:bg-primary/15'
                                  : mode === 'auto'
                                  ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400'
                                  : 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400'
                              }`}
                            >
                              <AppIcon name={item.icon} size={12} className="shrink-0" />
                            </div>
                            <div className="min-w-0">
                              <div
                                className={`text-body leading-tight ${
                                  isCurrent
                                    ? 'text-slate-900 dark:text-white font-semibold'
                                    : 'text-slate-800 dark:text-gray-200 font-medium'
                                }`}
                              >
                                {item.label}
                              </div>
                              <div className="text-caption text-text-secondary truncate mt-0.5 whitespace-nowrap">
                                {item.desc}
                              </div>
                            </div>
                          </div>
                          {isCurrent && (
                            <AppIcon name="check" size={14} className="text-primary shrink-0 ml-1.5" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </AgentPopover>
            </div>
          </div>

          <div className="flex items-center gap-2 min-w-0">
            {/* 上下文圆形仪表 */}
            <AgentContextMeter />

            <div className="relative inline-flex items-center min-w-0">
              <button
                type="button"
                onClick={() => setModelPickerOpen((prev) => !prev)}
                className={`flex items-center gap-1.5 text-text-primary hover:bg-slate-100/80 text-label px-2 py-1 rounded-lg disabled:opacity-50 transition-colors min-w-0 dark:text-gray-200 dark:hover:bg-white/10 ${
                  modelPickerOpen ? 'bg-slate-100 dark:bg-white/10' : ''
                }`}
                title={
                  supportsThinking
                    ? `${modelLabel} · 思考强度: ${THINKING_LABELS[thinkingLevel] ?? thinkingLevel}`
                    : modelLabel
                }
              >
                <span className="font-medium truncate max-w-[140px]">{modelLabel}</span>
                {supportsThinking && (
                  <>
                    <span className="text-slate-300 dark:text-slate-600">·</span>
                    <span className="text-primary font-medium text-label shrink-0">
                      {THINKING_LABELS[thinkingLevel] ?? thinkingLevel}
                    </span>
                  </>
                )}
                <AppIcon
                  name="expand_more"
                  size={12}
                  className={`text-text-secondary shrink-0 transition-transform duration-150 ${
                    modelPickerOpen ? 'rotate-180 text-primary' : ''
                  }`}
                />
              </button>

              <AgentPopover
                open={modelPickerOpen}
                onClose={() => setModelPickerOpen(false)}
                align="right"
                className="w-80 max-w-[calc(100vw-48px)]"
              >
                <AgentModelPicker onClose={() => setModelPickerOpen(false)} />
              </AgentPopover>
            </div>

            {/* Action Button: while running, input present → queue (追加);
                input empty → stop (暂停). Same blue either way. */}
            {isRunning ? (
              <button
                type="button"
                onClick={() => {
                  if (composerInput.trim() || attachments.length > 0 || imageAttachments.length > 0) {
                    handleSendClick()
                  } else {
                    void abort()
                  }
                }}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-sm shrink-0 bg-primary hover:opacity-90 text-white"
                title={
                  composerInput.trim() || attachments.length > 0 || imageAttachments.length > 0
                    ? '排队到当前任务后执行'
                    : '终止运行'
                }
              >
                {composerInput.trim() || attachments.length > 0 || imageAttachments.length > 0 ? (
                  <AppIcon name="arrow_upward" size={16} />
                ) : (
                  <AppIcon name="stop" size={12} className="fill-current" />
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSendClick}
                disabled={
                  !isWorkspaceReady ||
                  (!composerInput.trim() && attachments.length === 0 && imageAttachments.length === 0)
                }
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-sm shrink-0 ${
                  !isWorkspaceReady ||
                  (!composerInput.trim() && attachments.length === 0 && imageAttachments.length === 0)
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed dark:bg-white/10 dark:text-slate-500'
                    : 'bg-primary hover:opacity-90 text-white'
                }`}
                title="发送消息"
              >
                <AppIcon name="arrow_upward" size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  </footer>
  )
}
