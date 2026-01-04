import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'

interface ModelOutputCardProps {
  id: string
  name: string
  logo: string
  content: string
  selected: boolean
  onToggle: () => void
}

/**
 * 模型输出卡片组件
 * 显示单个模型的输出内容，支持勾选和展开/收起功能
 */
function ModelOutputCard({
  name,
  logo,
  content,
  selected,
  onToggle
}: ModelOutputCardProps): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false)
  const [shouldShowExpand, setShouldShowExpand] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // 检测内容是否过长，需要显示展开按钮
  useEffect(() => {
    // 使用 ResizeObserver 监听内容区域高度变化，确保在 Markdown 渲染完成后检查
    if (!contentRef.current) return

    const checkHeight = (): void => {
      if (contentRef.current) {
        const contentHeight = contentRef.current.scrollHeight
        const maxHeight = 200 // 最大显示高度（约 8-10 行）
        setShouldShowExpand(contentHeight > maxHeight)
      }
    }

    // 立即检查一次（处理内容已存在的情况）
    checkHeight()

    // 使用 ResizeObserver 监听 DOM 尺寸变化（Markdown 渲染完成后会触发）
    const resizeObserver = new ResizeObserver(() => {
      checkHeight()
    })

    resizeObserver.observe(contentRef.current)

    // 同时使用 setTimeout 作为兜底方案，确保在异步渲染完成后也能检查
    const timeoutId = setTimeout(() => {
      checkHeight()
    }, 100)

    return () => {
      resizeObserver.disconnect()
      clearTimeout(timeoutId)
    }
  }, [content])

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current)
        toastTimeoutRef.current = null
      }
    }
  }, [])

  // 切换展开/收起状态
  const toggleExpand = (): void => {
    setIsExpanded(!isExpanded)
  }

  const showToast = (type: 'success' | 'error', message: string, autoHide: number = 2000): void => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current)
      toastTimeoutRef.current = null
    }
    setToast({ type, message })
    if (autoHide > 0) {
      toastTimeoutRef.current = setTimeout(() => {
        setToast(null)
        toastTimeoutRef.current = null
      }, autoHide)
    }
  }

  const handleCopyMarkdown = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(content)
      showToast('success', '已复制 Markdown')
    } catch (error) {
      showToast('error', '复制失败')
    }
  }

  /**
   * 自定义链接组件：处理外部链接点击，在新窗口（BrowserPage）中打开
   */
  const customLinkComponent: Components['a'] = ({ href, children, ...props }) => {
    const handleClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
      // 如果没有 href，使用默认行为
      if (!href) return

      // 检查是否是外部链接（http/https 协议）
      const isExternalLink = href.startsWith('http://') || href.startsWith('https://')
      
      if (isExternalLink) {
        e.preventDefault()
        e.stopPropagation()
        
        // 通过 IPC 调用主进程，在新窗口中打开链接
        try {
          await window.api.openBrowserWindow(href)
          console.log('[ModelOutputCard] 打开外部链接:', href)
        } catch (error) {
          console.error('[ModelOutputCard] 打开外部链接失败:', error)
        }
      }
      // 内部链接（如锚点链接）使用默认行为
    }

    return (
      <a
        href={href}
        onClick={handleClick}
        className="text-primary no-underline hover:underline"
        {...props}
      >
        {children}
      </a>
    )
  }

  // ReactMarkdown 自定义组件配置
  const markdownComponents: Components = {
    a: customLinkComponent
  }

  return (
    <div className={`relative rounded-lg border transition-colors ${
      selected 
        ? 'bg-gray-800/50 border-primary/50' 
        : 'bg-gray-800/30 border-gray-700'
    }`}>
      {toast && (
        <div className={`absolute top-3 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm flex items-center gap-2 shadow-2xl z-50 notification-popup ${
          toast.type === 'success'
            ? 'bg-primary/20 border border-primary/40 text-primary'
            : 'bg-red-500/20 border border-red-500/40 text-red-300'
        }`}>
          <span className="material-symbols-outlined text-base">
            {toast.type === 'success' ? 'check_circle' : 'error'}
          </span>
          <span className="whitespace-nowrap">{toast.message}</span>
        </div>
      )}
      {/* 卡片头部 */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          {/* 勾选框 */}
          <button
            onClick={onToggle}
            className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
              selected
                ? 'bg-primary border-primary'
                : 'border-gray-500 hover:border-gray-400'
            }`}
          >
            {selected && (
              <span className="material-symbols-outlined text-sm text-black">check</span>
            )}
          </button>

          {/* Logo 和名称 */}
          <img src={logo} alt={name} className="w-5 h-5" />
          <span className="font-medium text-white">{name}</span>
        </div>

        <button
          onClick={handleCopyMarkdown}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-300 hover:text-white hover:bg-gray-700/50 transition-colors"
          title="复制 Markdown"
          aria-label="复制 Markdown"
        >
          <span className="material-symbols-outlined text-base">content_copy</span>
        </button>
      </div>

      {/* 输出内容 - 使用 Markdown 渲染 */}
      <div className="p-4">
        <div className={shouldShowExpand && !isExpanded ? 'relative' : ''}>
          <div 
            ref={contentRef}
            className={`text-gray-300 prose prose-invert prose-sm max-w-none 
              prose-headings:text-gray-200 prose-headings:font-semibold
              prose-p:text-gray-300 prose-p:leading-relaxed
              prose-a:text-primary prose-a:no-underline hover:prose-a:underline
              prose-strong:text-gray-200
              prose-code:text-primary prose-code:bg-gray-800 prose-code:px-1 prose-code:rounded
              prose-pre:bg-gray-900 prose-pre:border prose-pre:border-gray-700
              prose-ul:text-gray-300 prose-ol:text-gray-300
              prose-li:marker:text-gray-500
              prose-table:text-gray-300 prose-table:border-collapse
              prose-th:text-gray-200 prose-th:font-semibold prose-th:border prose-th:border-gray-600 prose-th:px-4 prose-th:py-2 prose-th:bg-gray-800/50
              prose-td:text-gray-300 prose-td:border prose-td:border-gray-700 prose-td:px-4 prose-td:py-2
              prose-tr:border-b prose-tr:border-gray-700 hover:prose-tr:bg-gray-800/30
              transition-all duration-300 ${
                shouldShowExpand && !isExpanded 
                  ? 'max-h-[200px] overflow-y-auto' 
                  : ''
              }`}
          >
            <ReactMarkdown 
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
            >
              {content}
            </ReactMarkdown>
          </div>
          
          {/* 渐变遮罩层（仅在折叠状态且需要展开时显示，固定在容器底部） */}
          {shouldShowExpand && !isExpanded && (
            <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-gray-800/50 via-gray-800/30 to-transparent pointer-events-none z-10"></div>
          )}
        </div>

        {/* 展开/收起按钮 */}
        {shouldShowExpand && (
          <button
            onClick={toggleExpand}
            className="mt-3 flex items-center gap-1 text-primary hover:text-primary/80 transition-colors text-sm font-medium"
          >
            <span className="material-symbols-outlined text-base">
              {isExpanded ? 'expand_less' : 'expand_more'}
            </span>
            <span>{isExpanded ? '收起' : '展开'}</span>
          </button>
        )}
      </div>
    </div>
  )
}

export default ModelOutputCard
