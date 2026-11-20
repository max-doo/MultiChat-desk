import { useWorkbenchStore } from '../../store/workbenchStore'

export default function WorkbenchStatusPill(): JSX.Element {
  const activeFileContent = useWorkbenchStore((s) => s.activeFileContent)
  const saveStatus = useWorkbenchStore((s) => s.saveStatus)

  const charCount = activeFileContent.length
  const wordCount = activeFileContent.trim()
    ? activeFileContent.trim().split(/\s+/).length
    : 0

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
