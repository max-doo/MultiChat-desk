import { useState, useEffect } from 'react'
import Modal, { ModalHeader, ModalFooter } from './ui/Modal'
interface ImportCacheConfirmModalProps {
  isOpen: boolean
  file: string
  keys: string[]
  conflicts: string[]
  businessCounts?: Record<string, { added: number; unchanged: number; conflicts: number }>
  onConfirm: (overwriteBusiness: boolean) => void | Promise<void>
  onCancel: () => void
}

// 缓存键 → 中文标签
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

/**
 * 缓存导入确认弹窗：列出将导入的键，标注会覆盖现有值的键，
 * 业务数据按 ID 合并，冲突默认保留本地；配置仍按用户确认覆盖。
 */
function ImportCacheConfirmModal({
  isOpen,
  file,
  keys,
  conflicts,
  businessCounts,
  onConfirm,
  onCancel
}: ImportCacheConfirmModalProps): JSX.Element | null {
  const [overwriteBusiness, setOverwriteBusiness] = useState(false)
  const [importing, setImporting] = useState(false)
  useEffect(() => { if (isOpen) setOverwriteBusiness(false) }, [isOpen])

  return (
    <Modal open={isOpen} onClose={onCancel} size="lg" variant="solid" maxHeight="80vh">
      <ModalHeader title="恢复配置与业务数据" onClose={onCancel} />

      {/* 内容 */}
      <div className="flex-1 space-y-3 overflow-y-auto p-4 text-body">
        <p className="text-text-secondary">
          将从文件导入以下数据，<span className="font-medium text-yellow-600">覆盖</span>现有同名配置；历史、笔记和导图按 ID 合并：
        </p>
        <div className="truncate text-caption text-gray-500" title={file}>来源：{file}</div>

        <div className="space-y-1">
          {keys.map(k => {
            const isConflict = conflicts.includes(k)
            const label = CACHE_KEY_LABELS[k] || k
            return (
              <div key={k} className="flex items-center justify-between rounded bg-sidebar/50 px-3 py-1.5">
                <span className="text-text-primary">{label}</span>
                <span className={`text-tiny ${isConflict ? 'text-yellow-600' : 'text-gray-500'}`}>
                  {businessCounts?.[k] ? `新增 ${businessCounts[k].added} · 相同 ${businessCounts[k].unchanged} · 冲突 ${businessCounts[k].conflicts}` : isConflict ? '将覆盖现有配置' : '新增'}
                </span>
              </div>
            )
          })}
        </div>

        {businessCounts && <label className="flex items-center gap-2 text-body text-text-secondary"><input type="checkbox" checked={overwriteBusiness} onChange={event => setOverwriteBusiness(event.target.checked)} />覆盖同 ID 的冲突业务记录（默认保留本地）</label>}
        <p className="text-caption text-gray-500">
          导入前已自动备份当前缓存为导出文件（若失败不阻断导入）。导入后建议重启应用以使全部变更生效。
        </p>
      </div>

      {/* 底部操作 */}
      <ModalFooter className="justify-end">
        <button
          onClick={onCancel}
          className="h-9 rounded-lg border border-gray-200 bg-sidebar px-4 text-body text-text-secondary transition-colors hover:bg-gray-100 dark:border-white/10"
        >
          取消
        </button>
        <button
          disabled={importing}
          onClick={async () => { setImporting(true); try { await onConfirm(overwriteBusiness) } finally { setImporting(false) } }}
          className="h-9 rounded-lg bg-primary px-4 text-body font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
        >
          确认导入
        </button>
      </ModalFooter>
    </Modal>
  )
}

export default ImportCacheConfirmModal
