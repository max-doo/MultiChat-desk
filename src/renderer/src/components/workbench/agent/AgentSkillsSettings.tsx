import { useEffect, useState } from 'react'
import { useAgentSessionStore } from '../../../store/agentSessionStore'
import { AppIcon } from '../../icons/AppIcon'

const TOOL_OPTIONS = [
  { value: '*', label: '所有工具' },
  { value: 'bash', label: 'bash' },
  { value: 'powershell', label: 'powershell' },
  { value: 'read', label: 'read' },
  { value: 'write', label: 'write' },
  { value: 'edit', label: 'edit' }
]

const INPUT_CLASS =
  'h-9 rounded-lg border border-slate-200 bg-slate-50/80 px-3 text-label text-text-primary placeholder:text-gray-400 focus:border-primary focus:bg-white focus:outline-none dark:border-slate-700/80 dark:bg-slate-800/50 dark:focus:bg-slate-800'

export function AgentSkillsSettings({ compact = false }: { compact?: boolean } = {}): JSX.Element {
  const agentConfig = useAgentSessionStore((s) => s.agentConfig)
  const fetchConfig = useAgentSessionStore((s) => s.fetchConfig)
  const setSkillDirs = useAgentSessionStore((s) => s.setSkillDirs)
  const addAllowlist = useAgentSessionStore((s) => s.addAllowlist)
  const removeAllowlist = useAgentSessionStore((s) => s.removeAllowlist)

  const [extraDirs, setExtraDirs] = useState<string[]>([])
  const [newDir, setNewDir] = useState('')
  const [newTool, setNewTool] = useState('*')
  const [newPattern, setNewPattern] = useState('')
  const [savingDirs, setSavingDirs] = useState(false)

  useEffect(() => {
    void fetchConfig()
  }, [fetchConfig])

  useEffect(() => {
    if (agentConfig) setExtraDirs(agentConfig.extraSkillDirs)
  }, [agentConfig])

  const candidates = agentConfig?.skillDirCandidates ?? []
  const allowlist = agentConfig?.allowlist ?? []
  const customDirs = extraDirs.filter((dir) => !candidates.some((candidate) => candidate.path === dir))
  const dirty =
    agentConfig !== null &&
    (extraDirs.length !== agentConfig.extraSkillDirs.length ||
      extraDirs.some((dir) => !agentConfig.extraSkillDirs.includes(dir)))

  const handleSaveDirs = async (): Promise<void> => {
    setSavingDirs(true)
    await setSkillDirs(extraDirs)
    setSavingDirs(false)
  }

  return (
    <div className="space-y-5 text-label">
      <div>
        <div className="mb-2 flex items-center gap-2 text-body font-medium text-text-primary">
          <AppIcon name="folder_open" size={16} className="text-primary" />
          <span>全局 Skills 目录</span>
        </div>
        <div
          className={`overflow-hidden rounded-lg border border-white/70 bg-white/55 divide-y divide-black/[0.05] dark:border-white/10 dark:bg-white/5 dark:divide-white/10 ${
            compact ? 'max-h-40 overflow-y-auto' : ''
          }`}
        >
          {candidates.map((candidate) => {
            const checked = candidate.isDefault || extraDirs.includes(candidate.path)
            return (
              <label
                key={candidate.path}
                className="flex cursor-pointer items-center gap-2.5 px-3 py-2 transition-colors hover:bg-white/80 dark:hover:bg-white/10"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={candidate.isDefault}
                  onChange={(e) => {
                    setExtraDirs((prev) =>
                      e.target.checked ? [...prev, candidate.path] : prev.filter((dir) => dir !== candidate.path)
                    )
                  }}
                  className="rounded accent-primary"
                />
                <span className="truncate font-mono text-label text-text-primary" title={candidate.path}>
                  {candidate.path}
                </span>
                {candidate.isDefault && (
                  <span className="ml-auto shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-tiny font-medium text-primary">
                    默认
                  </span>
                )}
                {!candidate.isDefault && !candidate.exists && (
                  <span className="ml-auto shrink-0 text-tiny text-text-secondary/70">未创建</span>
                )}
              </label>
            )
          })}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="text"
            value={newDir}
            onChange={(e) => setNewDir(e.target.value)}
            placeholder="添加自定义绝对路径"
            className={`min-w-0 flex-1 font-mono ${INPUT_CLASS}`}
          />
          <button
            type="button"
            onClick={() => {
              const dir = newDir.trim()
              if (dir && !extraDirs.includes(dir)) setExtraDirs((prev) => [...prev, dir])
              setNewDir('')
            }}
            disabled={!newDir.trim()}
            className="flex h-9 shrink-0 items-center gap-1 rounded-lg border border-gray-200 bg-sidebar px-3 text-label font-medium text-text-primary transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40 dark:border-white/10 dark:bg-white/5"
          >
            <AppIcon name="add" size={14} />
            <span>添加</span>
          </button>
          {dirty && (
            <button
              type="button"
              onClick={() => void handleSaveDirs()}
              disabled={savingDirs}
              className="h-9 shrink-0 rounded-lg bg-primary px-3.5 text-label font-medium text-white shadow-soft transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {savingDirs ? '保存中…' : '保存变更'}
            </button>
          )}
        </div>
        {customDirs.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {customDirs.map((dir) => (
              <div
                key={dir}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1"
              >
                <span className="truncate font-mono text-caption text-text-primary" title={dir}>
                  {dir}
                </span>
                <button
                  type="button"
                  onClick={() => setExtraDirs((prev) => prev.filter((item) => item !== dir))}
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-rose-500/10 hover:text-rose-500"
                  title="移除"
                >
                  <AppIcon name="close" size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-black/[0.05] pt-4 dark:border-white/10">
        <div className="mb-2 text-body font-medium text-text-primary">命令放行名单</div>
        {allowlist.length > 0 && (
          <div
            className={`mb-2 overflow-hidden rounded-lg border border-white/70 bg-white/55 divide-y divide-black/[0.05] dark:border-white/10 dark:bg-white/5 dark:divide-white/10 ${
              compact ? 'max-h-32 overflow-y-auto' : ''
            }`}
          >
            {allowlist.map((entry) => (
              <div key={entry.id} className="flex items-center gap-2.5 px-3 py-2">
                <span className="shrink-0 rounded bg-black/5 px-1.5 py-0.5 font-mono text-caption text-text-secondary dark:bg-white/10">
                  {entry.tool}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-label text-text-primary" title={entry.pattern}>
                  {entry.pattern}
                </span>
                <button
                  type="button"
                  onClick={() => void removeAllowlist(entry.id)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-rose-500/10 hover:text-rose-500"
                  title="移除"
                >
                  <AppIcon name="delete" size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <select
            value={newTool}
            onChange={(e) => setNewTool(e.target.value)}
            className={`w-28 shrink-0 ${INPUT_CLASS}`}
          >
            {TOOL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={newPattern}
            onChange={(e) => setNewPattern(e.target.value)}
            placeholder="输入命令前缀（如 git status）"
            className={`min-w-0 flex-1 font-mono ${INPUT_CLASS}`}
          />
          <button
            type="button"
            onClick={() => {
              const pattern = newPattern.trim()
              if (!pattern) return
              void addAllowlist(newTool.trim() || '*', pattern)
              setNewPattern('')
            }}
            disabled={!newPattern.trim()}
            className="flex h-9 shrink-0 items-center gap-1 rounded-lg border border-gray-200 bg-sidebar px-3 text-label font-medium text-text-primary transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40 dark:border-white/10 dark:bg-white/5"
          >
            <AppIcon name="add" size={14} />
            <span>添加</span>
          </button>
        </div>
      </div>
    </div>
  )
}
