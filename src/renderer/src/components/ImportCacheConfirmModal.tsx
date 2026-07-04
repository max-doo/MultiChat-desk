interface ImportCacheConfirmModalProps {
  isOpen: boolean
  file: string
  keys: string[]
  conflicts: string[]
  /** 导入数据中是否含 REDACTED apiKey 的供应商（需标注保留本地 Key） */
  redactedProviderCount: number
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

// 缓存键 → 中文标签
const CACHE_KEY_LABELS: Record<string, string> = {
  displayMode: '显示模式',
  models: '主界面模型列表',
  apiConfig: 'API 配置（供应商/总结模式/导出目录等）',
  summaryModels: '可用总结模型',
  history: '主界面对话历史',
  summaryHistory: '总结历史记录',
  geminiAccountUrl: 'Gemini 账户 URL'
}

/**
 * 缓存导入确认弹窗：列出将导入的键，标注会覆盖现有值的键，
 * 标注含 REDACTED apiKey 的供应商（将保留本地现有 Key）。
 * history/summaryHistory 为覆盖语义（与导出全量快照对齐）。
 */
function ImportCacheConfirmModal({
  isOpen,
  file,
  keys,
  conflicts,
  redactedProviderCount,
  onConfirm,
  onCancel
}: ImportCacheConfirmModalProps): JSX.Element | null {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative w-[520px] max-h-[80vh] bg-app border border-gray-200 rounded-lg shadow-2xl flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-text-primary">导入缓存数据</h3>
          <button onClick={onCancel} className="text-text-secondary hover:text-text-primary transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 p-4 space-y-3 overflow-y-auto text-sm">
          <p className="text-text-secondary">
            将从文件导入以下数据，<span className="text-yellow-600 font-medium">覆盖</span>现有同名配置：
          </p>
          <div className="text-[11px] text-gray-500 truncate" title={file}>来源：{file}</div>

          <div className="space-y-1">
            {keys.map(k => {
              const isConflict = conflicts.includes(k)
              const label = CACHE_KEY_LABELS[k] || k
              return (
                <div key={k} className="flex items-center justify-between px-3 py-1.5 bg-sidebar/50 rounded">
                  <span className="text-text-primary">{label}</span>
                  <span className={`text-[10px] ${isConflict ? 'text-yellow-600' : 'text-gray-500'}`}>
                    {isConflict ? '将覆盖现有' : '新增'}
                  </span>
                </div>
              )
            })}
          </div>

          {conflicts.includes('history') && (
            <p className="text-[11px] text-red-500">⚠ 将覆盖现有主界面对话历史记录</p>
          )}
          {conflicts.includes('summaryHistory') && (
            <p className="text-[11px] text-red-500">⚠ 将覆盖现有总结历史记录</p>
          )}
          {redactedProviderCount > 0 && (
            <p className="text-[11px] text-text-secondary">
              🔒 导入文件中有 {redactedProviderCount} 个供应商的 API Key 已脱敏，将保留本地现有 Key。
            </p>
          )}
          <p className="text-[11px] text-gray-500">
            导入前已自动备份当前缓存为导出文件（若失败不阻断导入）。导入后建议重启应用以使全部变更生效。
          </p>
        </div>

        {/* 底部操作 */}
        <div className="flex justify-end gap-3 p-4 border-t border-gray-200">
          <button onClick={onCancel} className="px-4 py-2 text-text-secondary hover:text-text-primary transition-colors text-sm">取消</button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-primary text-white font-medium rounded-md hover:opacity-90 transition-colors text-sm"
          >
            确认导入
          </button>
        </div>
      </div>
    </div>
  )
}

export default ImportCacheConfirmModal
