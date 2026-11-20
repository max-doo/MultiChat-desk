import { useWorkbenchStore } from '../../store/workbenchStore'
import { AppIcon } from '../icons/AppIcon'
import { requestSendFileToAi } from './workbenchAiEvents'

interface WorkbenchSendToAiButtonProps {
  size?: 'sm' | 'md'
}

export default function WorkbenchSendToAiButton({
  size = 'md'
}: WorkbenchSendToAiButtonProps): JSX.Element | null {
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const activeFileSize = useWorkbenchStore((s) => s.activeFileSize)
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)

  if (!activeFilePath || !workspacePath) return null

  const handleSendToAi = () => {
    const root = workspacePath.replace(/\\/g, '/').replace(/\/+$/, '')
    const relativePath = activeFilePath.replace(/\\/g, '/').replace(/^\/+/, '')
    requestSendFileToAi({
      filePath: `${root}/${relativePath}`,
      fileName: relativePath.slice(relativePath.lastIndexOf('/') + 1),
      size: activeFileSize ?? undefined
    })
  }

  const className =
    size === 'sm'
      ? 'flex h-8 items-center gap-1.5 rounded-full border border-blue-200/70 bg-blue-50 px-2.5 text-xs font-medium text-blue-700 shadow-sm transition-all hover:border-blue-300 hover:bg-blue-100 hover:shadow dark:border-blue-400/20 dark:bg-blue-500/10 dark:text-blue-300 dark:hover:border-blue-400/30 dark:hover:bg-blue-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
      : 'flex h-9 items-center gap-1.5 rounded-full border border-blue-200/70 bg-blue-50 px-3 text-xs font-medium text-blue-700 shadow-sm transition-all hover:border-blue-300 hover:bg-blue-100 hover:shadow disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:border-blue-200/70 disabled:hover:bg-blue-50 dark:border-blue-400/20 dark:bg-blue-500/10 dark:text-blue-300 dark:hover:border-blue-400/30 dark:hover:bg-blue-500/20 dark:disabled:hover:border-blue-400/20 dark:disabled:hover:bg-blue-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'

  return (
    <button
      type="button"
      onClick={handleSendToAi}
      className={className}
      title="将整个文件发送到 AI 侧边栏"
    >
      <AppIcon name="send" size={size === 'sm' ? 14 : 16} />
      <span className="whitespace-nowrap">发送到 AI</span>
    </button>
  )
}
