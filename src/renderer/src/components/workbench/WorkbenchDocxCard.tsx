import { useMemo } from 'react'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { AppIcon } from '../icons/AppIcon'
import FileTypeIcon from './FileTypeIcon'
import WorkbenchSendToAiButton from './WorkbenchSendToAiButton'

export default function WorkbenchDocxCard(): JSX.Element {
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const activeFileSize = useWorkbenchStore((s) => s.activeFileSize)
  const openInSystem = useWorkbenchStore((s) => s.openInSystem)

  const ext = useMemo(() => {
    if (!activeFilePath) return ''
    const idx = activeFilePath.lastIndexOf('.')
    return idx !== -1 ? activeFilePath.slice(idx).toLowerCase() : ''
  }, [activeFilePath])

  const formattedSize = useMemo(() => {
    if (!activeFileSize && activeFileSize !== 0) return '未知大小'
    if (activeFileSize < 1024) return `${activeFileSize} B`
    if (activeFileSize < 1024 * 1024) return `${(activeFileSize / 1024).toFixed(1)} KB`
    return `${(activeFileSize / (1024 * 1024)).toFixed(1)} MB`
  }, [activeFileSize])

  const handleOpen = () => {
    if (activeFilePath) void openInSystem(activeFilePath)
  }

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden bg-slate-50 dark:bg-gray-900 select-none">
      <div className="h-12 px-3 bg-white/80 dark:bg-gray-800/80 border-b border-black/5 dark:border-white/5 flex items-center justify-between gap-2 shrink-0 text-sm">
        <div className="flex items-center gap-2 truncate">
          {activeFilePath && (
            <FileTypeIcon
              node={{
                id: activeFilePath,
                name: activeFilePath.split(/[/\\]/).pop() || activeFilePath,
                path: activeFilePath,
                isDirectory: false,
                extension: ext
              }}
              className="w-[19px] h-[19px]"
            />
          )}
          <span className="font-medium text-text-primary truncate" title={activeFilePath || ''}>
            {activeFilePath}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-auto flex flex-col items-center justify-center px-8 pb-10 relative text-center">
        <AppIcon name="info" size={28} className="text-primary" />
        <p className="mt-3 max-w-md text-sm leading-6 text-text-secondary">
          当前格式暂不支持在工作台内预览，可用本地默认应用打开查看与编辑。
        </p>
        <button
          type="button"
          onClick={handleOpen}
          className="mt-5 h-9 px-4 rounded-lg bg-primary text-white hover:bg-primary/90 text-sm font-medium flex items-center gap-1.5 shadow-sm transition-colors"
        >
          <AppIcon name="open_in_new" size={18} />
          <span>用本地默认应用打开</span>
        </button>

        <div className="absolute bottom-3 right-3 z-10 flex items-center gap-2">
          <WorkbenchSendToAiButton />
          {formattedSize && formattedSize !== '未知大小' && (
            <div className="flex items-center gap-2 rounded-full border border-black/5 bg-white/85 px-2.5 py-1 text-xs text-text-secondary shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-gray-900/80">
              <span className="whitespace-nowrap" title={`大小 ${formattedSize}`}>
                {formattedSize}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
