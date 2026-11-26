import { useEffect, useRef, useState } from 'react'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { formatFileSize } from '../../utils/formatBytes'
import { countWords } from '../../utils/wordCount'
import { AppIcon } from '../icons/AppIcon'
import WorkbenchSendToAiButton from './WorkbenchSendToAiButton'

const COUNT_DEBOUNCE_MS = 300

function countLines(text: string): number {
  let lines = 1
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lines += 1
  }
  return lines
}

function computeStats(
  content: string,
  isCodeView: boolean
): { words: number; chars: number; lines: number } {
  if (isCodeView) {
    return { words: 0, chars: 0, lines: countLines(content) }
  }
  const { words, chars } = countWords(content)
  return { words, chars, lines: 0 }
}

export default function WorkbenchStatusPill(): JSX.Element {
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const activeFileContent = useWorkbenchStore((s) => s.activeFileContent)
  const activeFileCategory = useWorkbenchStore((s) => s.activeFileCategory)
  const activeFileSize = useWorkbenchStore((s) => s.activeFileSize)
  const saveStatus = useWorkbenchStore((s) => s.saveStatus)
  const conflictDiskContent = useWorkbenchStore((s) => s.conflictDiskContent)
  const resolveExternalConflict = useWorkbenchStore((s) => s.resolveExternalConflict)
  const htmlVisualEditing = useWorkbenchStore((s) => s.htmlVisualEditing)
  const codePreviewEditable = useWorkbenchStore((s) => s.codePreviewEditable)

  const isCodeView = activeFileCategory === 'code' || activeFileCategory === 'text'
  // 保存徽标只在可编辑的表面上有意义：只读预览态不显示。
  // Markdown 编辑器全程可编辑；代码/文本走预览组件上报的可编辑态。
  const showSaveBadge = activeFileCategory === 'markdown' || codePreviewEditable
  const [stats, setStats] = useState<{ words: number; chars: number; lines: number }>(() =>
    computeStats(activeFileContent, isCodeView)
  )
  const prevFilePathRef = useRef(activeFilePath)

  useEffect(() => {
    if (prevFilePathRef.current !== activeFilePath) {
      prevFilePathRef.current = activeFilePath
      setStats(computeStats(activeFileContent, isCodeView))
      return
    }
    const timer = setTimeout(() => {
      setStats(computeStats(activeFileContent, isCodeView))
    }, COUNT_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [activeFileContent, activeFilePath, isCodeView])

  // 可视化编辑自带底部状态条与浮动工具条；通用胶囊会遮挡它们。
  // 冲突面板仍保留，用户需要在编辑态直接裁决磁盘版本。
  if (htmlVisualEditing && saveStatus !== 'conflict') return <></>

  const { words: wordCount, chars: charCount, lines: lineCount } = stats
  const formattedSize = formatFileSize(activeFileSize)

  // 冲突态：脱离纯展示定位，变成可操作浮层
  if (saveStatus === 'conflict') {
    return (
      <div className="absolute bottom-3 right-3 z-dropdown flex flex-col gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-label text-amber-900 shadow-md backdrop-blur-md dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200 max-w-[420px]">
        <div className="flex items-center gap-1.5">
          <AppIcon name="warning" size={15} />
          <span className="font-medium">文件在磁盘上被修改</span>
        </div>
        {conflictDiskContent !== null && (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-amber-100/60 dark:bg-amber-900/30 p-2 font-mono text-caption leading-relaxed text-amber-900/90 dark:text-amber-100/80">
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
    <div className="absolute bottom-3 right-3 z-dropdown flex items-center gap-2">
      <WorkbenchSendToAiButton />
      <div className="flex h-9 items-center gap-2 rounded-full border border-black/5 bg-white/85 px-2.5 text-label text-text-secondary shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-gray-900/80">
        {isCodeView ? (
          <span
            className="whitespace-nowrap font-mono"
            title={`${lineCount} 行${formattedSize ? ` · 大小 ${formattedSize}` : ''}`}
          >
            {lineCount} 行{formattedSize && ` · ${formattedSize}`}
          </span>
        ) : (
          <span className="whitespace-nowrap" title={`字数: ${wordCount}，字符数: ${charCount}`}>
            {wordCount} 字 · {charCount} 字符
          </span>
        )}
        {showSaveBadge && (
          <>
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
          </>
        )}
      </div>
    </div>
  )
}
