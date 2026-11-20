import { useState, useMemo } from 'react'
import { useWorkbenchStore } from '../../store/workbenchStore'

export default function WorkbenchPdfPreview(): JSX.Element {
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const activeFileUrl = useWorkbenchStore((s) => s.activeFileUrl)
  const activeFileSize = useWorkbenchStore((s) => s.activeFileSize)
  const activeFileOversized = useWorkbenchStore((s) => s.activeFileOversized)
  const openInSystem = useWorkbenchStore((s) => s.openInSystem)
  const revealFile = useWorkbenchStore((s) => s.revealFile)

  const [reloadKey, setReloadKey] = useState(0)

  // 格式化文件大小
  const formattedSize = useMemo(() => {
    if (!activeFileSize && activeFileSize !== 0) return ''
    if (activeFileSize < 1024) return `${activeFileSize} B`
    if (activeFileSize < 1024 * 1024) return `${(activeFileSize / 1024).toFixed(1)} KB`
    return `${(activeFileSize / (1024 * 1024)).toFixed(1)} MB`
  }, [activeFileSize])

  // PDF 走 workbench-file:// 流式协议，由 Chromium PDFium 原生渲染，零内存拷贝
  const pdfUrl = activeFileUrl

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden bg-slate-100 dark:bg-gray-900 select-none">
      {/* 顶部工具栏 */}
      <div className="h-12 px-3 bg-white/80 dark:bg-gray-800/80 border-b border-black/5 dark:border-white/5 flex items-center justify-between gap-2 shrink-0 text-sm">
        {/* 左侧：文件信息与规格 */}
        <div className="flex items-center gap-2 truncate">
          <span className="material-symbols-outlined text-[19px] text-rose-500">picture_as_pdf</span>
          <span className="font-medium text-text-primary truncate" title={activeFilePath || ''}>
            {activeFilePath}
          </span>
        </div>

        {/* 右侧：操作与系统集成 */}
        <div className="flex items-center gap-1.5 text-text-secondary">
          {/* 重新加载 */}
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors"
            title="刷新文档渲染"
          >
            <span className="material-symbols-outlined text-[19px]">refresh</span>
          </button>

          {/* 在系统阅读器打开 (如 Edge / Adobe Acrobat) */}
          <button
            type="button"
            onClick={() => {
              if (activeFilePath) void openInSystem(activeFilePath)
            }}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors"
            title="使用系统默认程序打开"
          >
            <span className="material-symbols-outlined text-[19px]">open_in_new</span>
          </button>

          {/* 在资源管理器定位 */}
          <button
            type="button"
            onClick={() => {
              if (activeFilePath) void revealFile(activeFilePath)
            }}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 hover:text-text-primary transition-colors"
            title="在系统资源管理器中定位"
          >
            <span className="material-symbols-outlined text-[19px]">folder_open</span>
          </button>
        </div>
      </div>

      {/* PDF 渲染容器 */}
      <div className="flex-1 w-full h-full relative overflow-hidden bg-gray-200 dark:bg-gray-950">
        {activeFileOversized ? (
          <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-white dark:bg-gray-900 text-text-primary">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-500 mb-4">
              <span className="material-symbols-outlined text-3xl">picture_as_pdf</span>
            </div>
            <h3 className="text-base font-semibold mb-2">PDF 文档超出内嵌预览上限</h3>
            <p className="text-sm text-text-secondary max-w-sm mb-6 leading-relaxed">
              该文件大小为 <span className="font-semibold text-text-primary">{formattedSize}</span>，超出工作台内嵌 50MB 预览上限。建议直接使用系统默认的专业 PDF 阅读器（如 Edge、Adobe Acrobat 或 Foxit）查看与批注。
            </p>
            <button
              type="button"
              onClick={() => {
                if (activeFilePath) void openInSystem(activeFilePath)
              }}
              className="h-10 px-5 rounded-xl bg-primary text-white hover:bg-primary/90 text-sm font-medium flex items-center gap-2 shadow-sm transition-all"
            >
              <span className="material-symbols-outlined text-[19px]">open_in_new</span>
              <span>在系统阅读器中打开</span>
            </button>
          </div>
        ) : pdfUrl ? (
          <object
            key={`${activeFilePath}-${reloadKey}`}
            data={pdfUrl}
            type="application/pdf"
            className="w-full h-full border-0 block"
            title={activeFilePath || 'PDF Preview'}
          >
            {/* 兜底渲染 (若环境不支持直接内嵌) */}
            <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-white dark:bg-gray-900 text-text-primary">
              <div className="w-16 h-16 rounded-2xl bg-rose-500/10 flex items-center justify-center text-rose-500 mb-4">
                <span className="material-symbols-outlined text-3xl">picture_as_pdf</span>
              </div>
              <h3 className="text-base font-semibold mb-2">已就绪的 PDF 文档</h3>
              <p className="text-sm text-text-secondary max-w-sm mb-6 leading-relaxed">
                当前平台内置预览环境受限或已开启原生安全沙箱。您可以直接使用操作系统默认的专业 PDF 阅读器查看与批注。
              </p>
              <button
                type="button"
                onClick={() => {
                  if (activeFilePath) void openInSystem(activeFilePath)
                }}
                className="h-10 px-5 rounded-xl bg-primary text-white hover:bg-primary/90 text-sm font-medium flex items-center gap-2 shadow-sm transition-all"
              >
                <span className="material-symbols-outlined text-[19px]">open_in_new</span>
                <span>在系统阅读器中打开</span>
              </button>
            </div>
          </object>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-text-secondary">
            <span className="material-symbols-outlined text-4xl text-rose-400 mb-2">error</span>
            <p className="text-sm mb-4">未能加载 PDF 数据或文件已损坏</p>
            <button
              type="button"
              onClick={() => {
                if (activeFilePath) void openInSystem(activeFilePath)
              }}
              className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium"
            >
              在外部阅读器中打开
            </button>
          </div>
        )}

        {/* 右下角状态 Pill（与 Markdown 源码一致） */}
        {formattedSize && (
          <div className="pointer-events-none absolute bottom-3 right-3 z-10 flex items-center gap-2 rounded-full border border-black/5 bg-white/85 px-2.5 py-1 text-xs text-text-secondary shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-gray-900/80">
            <span className="whitespace-nowrap" title={`大小 ${formattedSize}`}>
              {formattedSize}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
