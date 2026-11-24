import { useEffect, useState } from 'react'
import { Plus, Trash2, FolderOpen } from 'lucide-react'
import { useAgentSessionStore } from '../../../store/agentSessionStore'

const TOOL_OPTIONS = [
  { value: '*', label: '所有工具' },
  { value: 'bash', label: 'bash' },
  { value: 'powershell', label: 'powershell' },
  { value: 'read', label: 'read' },
  { value: 'write', label: 'write' },
  { value: 'edit', label: 'edit' }
]

export function AgentSkillsSettings(): JSX.Element {
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
    <div className="space-y-4 text-label">
      <div>
        <div className="flex items-center gap-1.5 text-text-primary font-medium mb-2">
          <FolderOpen className="w-3.5 h-3.5 text-text-secondary" />
          <span>全局 Skills 目录</span>
        </div>
        <div className="rounded-lg border border-gray-100 divide-y divide-gray-100 max-h-40 overflow-y-auto">
          {candidates.map((candidate) => {
            const checked = candidate.isDefault || extraDirs.includes(candidate.path)
            return (
              <label
                key={candidate.path}
                className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-black/[0.02] cursor-pointer"
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
                <span className="font-mono text-caption text-text-secondary truncate" title={candidate.path}>
                  {candidate.path}
                </span>
                {candidate.isDefault && <span className="ml-auto shrink-0 text-tiny text-primary">默认</span>}
                {!candidate.isDefault && !candidate.exists && (
                  <span className="ml-auto shrink-0 text-tiny text-text-secondary/70">不存在</span>
                )}
              </label>
            )
          })}
        </div>
        <div className="mt-1.5 flex gap-1.5">
          <input
            type="text"
            value={newDir}
            onChange={(e) => setNewDir(e.target.value)}
            placeholder="自定义绝对路径"
            className="flex-1 px-2.5 py-1.5 rounded-lg glass-panel font-mono text-caption text-text-primary placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <button
            type="button"
            onClick={() => {
              const dir = newDir.trim()
              if (dir && !extraDirs.includes(dir)) setExtraDirs((prev) => [...prev, dir])
              setNewDir('')
            }}
            className="px-2.5 rounded-lg glass-panel text-text-secondary hover:text-primary flex items-center gap-1 text-caption transition-colors"
          >
            <Plus className="w-3 h-3" />
            添加
          </button>
          <button
            type="button"
            onClick={() => void handleSaveDirs()}
            disabled={!dirty || savingDirs}
            className="px-2.5 rounded-lg bg-primary/90 text-white disabled:opacity-40 text-caption transition-opacity"
          >
            {savingDirs ? '保存中' : '保存'}
          </button>
        </div>
        {customDirs.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {customDirs.map((dir) => (
              <div
                key={dir}
                className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-primary/5 border border-primary/15"
              >
                <span className="font-mono text-caption text-text-secondary truncate flex-1" title={dir}>
                  {dir}
                </span>
                <button
                  type="button"
                  onClick={() => setExtraDirs((prev) => prev.filter((item) => item !== dir))}
                  className="text-text-secondary hover:text-rose-600 shrink-0 transition-colors"
                  title="移除"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="text-text-primary font-medium mb-2">命令放行名单</div>
        {allowlist.length > 0 && (
          <div className="rounded-lg border border-gray-100 divide-y divide-gray-100 max-h-32 overflow-y-auto mb-1.5">
            {allowlist.map((entry) => (
              <div key={entry.id} className="flex items-center gap-2 px-2.5 py-1.5">
                <span className="px-1.5 py-0.5 rounded bg-black/5 text-text-secondary font-mono text-tiny shrink-0">
                  {entry.tool}
                </span>
                <span className="font-mono text-caption text-text-secondary truncate flex-1" title={entry.pattern}>
                  {entry.pattern}
                </span>
                <button
                  type="button"
                  onClick={() => void removeAllowlist(entry.id)}
                  className="text-text-secondary hover:text-rose-600 shrink-0 transition-colors"
                  title="移除"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-1.5">
          <select
            value={newTool}
            onChange={(e) => setNewTool(e.target.value)}
            className="w-24 px-2 py-1.5 rounded-lg glass-panel text-caption text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
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
            placeholder="命令前缀"
            className="flex-1 px-2.5 py-1.5 rounded-lg glass-panel font-mono text-caption text-text-primary placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20"
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
            className="px-2.5 rounded-lg glass-panel text-text-secondary hover:text-primary disabled:opacity-40 text-caption transition-colors"
          >
            添加
          </button>
        </div>
      </div>
    </div>
  )
}
