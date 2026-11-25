import { useMemo } from 'react'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { formatFileSize } from '../../utils/formatBytes'
import { AppIcon } from '../icons/AppIcon'
import FileTypeIcon from './FileTypeIcon'
import WorkbenchSendToAiButton from './WorkbenchSendToAiButton'
import { PreviewHeader, PreviewMetaPill } from './WorkbenchPreviewChrome'

export default function WorkbenchDocxCard(): JSX.Element {
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const activeFileSize = useWorkbenchStore((s) => s.activeFileSize)
  const openInSystem = useWorkbenchStore((s) => s.openInSystem)

  const ext = useMemo(() => {
    if (!activeFilePath) return ''
    const idx = activeFilePath.lastIndexOf('.')
    return idx !== -1 ? activeFilePath.slice(idx).toLowerCase() : ''
  }, [activeFilePath])

  const formattedSize = useMemo(() => formatFileSize(activeFileSize, '未知大小'), [activeFileSize])

  const handleOpen = () => {
    if (activeFilePath) void openInSystem(activeFilePath)
  }

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden bg-slate-50 dark:bg-gray-900 select-none">
      <PreviewHeader
        left={
          <>
            {activeFilePath && (
              <FileTypeIcon
                node={{
                  id: activeFilePath,
                  name: activeFilePath.split(/[/\\]/).pop() || activeFilePath,
                  path: activeFilePath,
                  fullPath: activeFilePath,
                  isDirectory: false,
                  extension: ext
                }}
                className="w-[19px] h-[19px]"
              />
            )}
            <span className="font-medium text-text-primary truncate" title={activeFilePath || ''}>
              {activeFilePath}
            </span>
          </>
        }
      />

      <div className="flex-1 overflow-auto flex flex-col items-center justify-center px-8 pb-10 relative text-center">
        <AppIcon name="info" size={24} className="text-primary" />
        <p className="mt-3 max-w-md text-body leading-6 text-text-secondary">
          当前格式暂不支持在工作台内预览，可用本地默认应用打开查看与编辑。
        </p>
        <button
          type="button"
          onClick={handleOpen}
          className="mt-5 h-9 px-4 rounded-lg bg-primary text-white hover:opacity-90 text-body font-medium flex items-center gap-1.5 shadow-sm transition-colors"
        >
          <AppIcon name="open_in_new" size={19} />
          <span>用本地默认应用打开</span>
        </button>

        <div className="absolute bottom-3 right-3 z-dropdown flex items-center gap-2">
          <WorkbenchSendToAiButton />
          {formattedSize && formattedSize !== '未知大小' && (
            <PreviewMetaPill title={`大小 ${formattedSize}`}>
              <span className="whitespace-nowrap">{formattedSize}</span>
            </PreviewMetaPill>
          )}
        </div>
      </div>
    </div>
  )
}
