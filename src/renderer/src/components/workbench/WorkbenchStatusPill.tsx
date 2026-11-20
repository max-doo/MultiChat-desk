import { useWorkbenchStore } from '../../store/workbenchStore'

export default function WorkbenchStatusPill(): JSX.Element {
  const activeFileContent = useWorkbenchStore((s) => s.activeFileContent)
  const saveStatus = useWorkbenchStore((s) => s.saveStatus)
  const conflictDiskContent = useWorkbenchStore((s) => s.conflictDiskContent)
  const resolveExternalConflict = useWorkbenchStore((s) => s.resolveExternalConflict)

  const charCount = activeFileContent.length
  const wordCount = activeFileContent.trim()
    ? activeFileContent.trim().split(/\s+/).length
    : 0

  // 冲突态：脱离纯展示定位，变成可操作浮层
  if (saveStatus === 'conflict') {
    return (
      <div className="absolute bottom-3 right-3 z-30 flex flex-col gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 shadow-md backdrop-blur-md dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200 max-w-[420px]">
        <div className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[15px]">warning</span>
          <span className="font-medium">文件在磁盘上被修改</span>
        </div>
        {conflictDiskContent !== null && (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-amber-100/60 dark:bg-amber-900/30 p-2 font-mono text-[11px] leading-relaxed text-amber-900/90 dark:text-amber-100/80">
            {conflictDiskContent}
          </pre>
        )}
        <div className="flex items-center gap-2 self-end">
          <button
            type="button"
            onClick={() => void resolveExternalConflict('take-disk')}
            className="rounded-md px-2.5 py-1 font-medium hover:bg-amber-100 dark:hover:bg-amber-500/20"
            title="放弃未保存的改动，载入磁盘最新版本"
          >
            重载磁盘版
          </button>
          <button
            type="button"
            onClick={() => void resolveExternalConflict('keep-mine')}
            className="rounded-md bg-amber-500/90 px-2.5 py-1 font-medium text-white hover:bg-amber-500"
            title="用当前编辑内容覆盖磁盘版本"
          >
            保留我的修改
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-30 flex items-center gap-2 rounded-full border border-black/5 bg-white/85 px-2.5 py-1 text-xs text-text-secondary shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-gray-900/80">
      <span className="whitespace-nowrap" title={`字数: ${wordCount}，字符数: ${charCount}`}>
        {wordCount} 词 · {charCount} 字符
      </span>
      <span className="h-3 w-px bg-black/10 dark:bg-white/10" />
      {saveStatus === 'saving' ? (
        <span className="flex items-center gap-1 text-amber-500">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
          <span>保存中</span>
        </span>
      ) : saveStatus === 'error' ? (
        <span className="flex items-center gap-1 text-rose-500">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
          <span>保存失败</span>
        </span>
      ) : (
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/80" />
          <span>已保存</span>
        </span>
      )}
    </div>
  )
}
