import { useState, useMemo } from 'react'
import { useWorkbenchStore } from '../../store/workbenchStore'

export default function WorkbenchDocxCard(): JSX.Element {
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const activeFileSize = useWorkbenchStore((s) => s.activeFileSize)
  const lastSavedAt = useWorkbenchStore((s) => s.lastSavedAt)
  const openInSystem = useWorkbenchStore((s) => s.openInSystem)
  const revealFile = useWorkbenchStore((s) => s.revealFile)

  const [copied, setCopied] = useState(false)

  const fileName = useMemo(() => {
    return activeFilePath ? activeFilePath.split(/[/\\]/).pop() : ''
  }, [activeFilePath])

  const format = useMemo(() => {
    if (!activeFilePath) return 'DOCX'
    const ext = activeFilePath.split('.').pop() || ''
    return ext.toUpperCase()
  }, [activeFilePath])

  const formattedSize = useMemo(() => {
    if (!activeFileSize && activeFileSize !== 0) return '未知大小'
    if (activeFileSize < 1024) return `${activeFileSize} B`
    if (activeFileSize < 1024 * 1024) return `${(activeFileSize / 1024).toFixed(1)} KB`
    return `${(activeFileSize / (1024 * 1024)).toFixed(1)} MB`
  }, [activeFileSize])

  const formattedDate = useMemo(() => {
    if (!lastSavedAt) return ''
    return new Date(lastSavedAt).toLocaleString()
  }, [lastSavedAt])

  const handleCopyPath = async () => {
    if (!activeFilePath) return
    try {
      await navigator.clipboard.writeText(activeFilePath)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch (err) {
      console.error('Failed to copy path:', err)
    }
  }

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden bg-slate-50 dark:bg-gray-900 select-none">
      {/* 顶部工具栏 */}
      <div className="h-10 px-3 bg-white/80 dark:bg-gray-800/80 border-b border-black/5 dark:border-white/5 flex items-center justify-between gap-2 shrink-0 text-xs">
        <div className="flex items-center gap-2 truncate">
          <span className="material-symbols-outlined text-[17px] text-indigo-600 dark:text-indigo-400">
            article
          </span>
          <span className="font-medium text-text-primary truncate" title={activeFilePath || ''}>
            {activeFilePath}
          </span>
          <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
            {format}
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-text-secondary">
          <button
            type="button"
            onClick={() => {
              if (activeFilePath) void openInSystem(activeFilePath)
            }}
            className="h-7 px-2.5 flex items-center gap-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 font-medium transition-colors shadow-xs"
            title="使用本地办公软件打开"
          >
            <span className="material-symbols-outlined text-[16px]">open_in_new</span>
            <span>在 Word / WPS 中打开</span>
          </button>
        </div>
      </div>

      {/* 文档详情展示卡片 */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-8">
        <div className="w-full max-w-lg bg-white dark:bg-gray-800 rounded-3xl p-8 shadow-xl border border-black/5 dark:border-white/5 flex flex-col items-center text-center">
          {/* 大图标 */}
          <div className="w-20 h-20 rounded-3xl bg-indigo-500/10 dark:bg-indigo-400/10 flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-5 shadow-inner">
            <span className="material-symbols-outlined text-4xl">article</span>
          </div>

          <h2 className="text-lg font-bold text-text-primary mb-1 break-all">
            {fileName}
          </h2>
          <p className="text-xs font-mono text-text-secondary mb-6 break-all">
            {activeFilePath}
          </p>

          {/* 元信息网格 */}
          <div className="grid grid-cols-2 gap-3 w-full max-w-sm mb-6 text-left">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-gray-700/50 border border-black/5 dark:border-white/5">
              <span className="text-[11px] text-text-secondary block mb-0.5">文件大小</span>
              <span className="text-xs font-semibold text-text-primary">{formattedSize}</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-gray-700/50 border border-black/5 dark:border-white/5">
              <span className="text-[11px] text-text-secondary block mb-0.5">文件格式</span>
              <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">{format} 规范文档</span>
            </div>
            {formattedDate && (
              <div className="col-span-2 p-3 rounded-xl bg-slate-50 dark:bg-gray-700/50 border border-black/5 dark:border-white/5">
                <span className="text-[11px] text-text-secondary block mb-0.5">修改时间</span>
                <span className="text-xs font-semibold text-text-primary">{formattedDate}</span>
              </div>
            )}
          </div>

          {/* 渲染说明 */}
          <div className="w-full p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 text-xs text-left mb-6 leading-relaxed">
            <div className="flex items-center gap-1.5 font-semibold mb-1">
              <span className="material-symbols-outlined text-[16px]">info</span>
              <span>格式渲染建议</span>
            </div>
            <p className="text-[11px] opacity-90">
              Word 文档 (.docx) 采用复杂的 OpenXML 压缩架构与专有版式排版规则。为了避免格式错位并保持表格、样式与公式的 100% 还原，推荐使用本地默认办公应用直接打开查看与编辑。
            </p>
          </div>

          {/* 核心操作按钮 */}
          <div className="flex flex-wrap items-center justify-center gap-3 w-full">
            <button
              type="button"
              onClick={() => {
                if (activeFilePath) void openInSystem(activeFilePath)
              }}
              className="h-10 px-6 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 text-xs font-semibold flex items-center gap-2 shadow-md hover:shadow-lg transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">open_in_new</span>
              <span>在本地办公软件中打开</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (activeFilePath) void revealFile(activeFilePath)
              }}
              className="h-10 px-4 rounded-xl border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 text-text-primary text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              <span className="material-symbols-outlined text-[17px]">folder_open</span>
              <span>在文件夹中显示</span>
            </button>
            <button
              type="button"
              onClick={() => void handleCopyPath()}
              className="h-10 px-4 rounded-xl border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 text-text-primary text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              <span className="material-symbols-outlined text-[17px]">
                {copied ? 'check' : 'content_copy'}
              </span>
              <span>{copied ? '已复制' : '复制相对路径'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
