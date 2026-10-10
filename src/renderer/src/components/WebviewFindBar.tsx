import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

type FindShortcutPayload = { wcId: number; action: 'open' | 'close' }

const shortcutSubscribers = new Set<(payload: FindShortcutPayload) => void>()
let unsubscribeIpc: (() => void) | null = null

function subscribeFindShortcut(cb: (payload: FindShortcutPayload) => void): () => void {
  shortcutSubscribers.add(cb)
  if (!unsubscribeIpc && window.api?.onWebviewFindShortcut) {
    unsubscribeIpc = window.api.onWebviewFindShortcut((payload) => {
      shortcutSubscribers.forEach((fn) => fn(payload))
    })
  }
  return () => {
    shortcutSubscribers.delete(cb)
    if (shortcutSubscribers.size === 0 && unsubscribeIpc) {
      unsubscribeIpc()
      unsubscribeIpc = null
    }
  }
}

function getSafeWebContentsId(webview: Electron.WebviewTag | null): number | null {
  if (!webview) return null
  try {
    return webview.getWebContentsId()
  } catch {
    return null
  }
}

function safeStopFind(
  webview: Electron.WebviewTag | null,
  action: 'clearSelection' | 'keepSelection' | 'activateSelection' = 'clearSelection'
): void {
  if (!webview) return
  try {
    webview.stopFindInPage(action)
  } catch {
    // Webview 尚未就绪或已销毁时忽略
  }
}

interface WebviewFindBarProps {
  webviewRef: RefObject<Electron.WebviewTag>
  disabled?: boolean
}

export default function WebviewFindBar({
  webviewRef,
  disabled = false
}: WebviewFindBarProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [matches, setMatches] = useState(0)
  const [activeOrdinal, setActiveOrdinal] = useState(0)

  const anchorRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastRequestIdRef = useRef<number | null>(null)
  const isHoveredRef = useRef(false)

  const openRef = useRef(open)
  openRef.current = open
  const queryRef = useRef(query)
  queryRef.current = query
  const matchCaseRef = useRef(matchCase)
  matchCaseRef.current = matchCase
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled

  const runFind = useCallback(
    (text: string, opts: { forward: boolean; findNext: boolean; matchCase: boolean }): void => {
      const webview = webviewRef.current
      if (!webview || disabledRef.current) return
      if (!text) {
        lastRequestIdRef.current = null
        safeStopFind(webview, 'clearSelection')
        setMatches(0)
        setActiveOrdinal(0)
        return
      }
      try {
        const reqId = webview.findInPage(text, {
          forward: opts.forward,
          findNext: opts.findNext,
          matchCase: opts.matchCase
        })
        if (typeof reqId === 'number') {
          lastRequestIdRef.current = reqId
        }
      } catch {
        // Webview 尚未挂载完成时忽略
      }
    },
    [webviewRef]
  )

  const openFindBar = useCallback((): void => {
    if (disabledRef.current) return
    const wasOpen = openRef.current
    setOpen(true)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    if (!wasOpen && queryRef.current) {
      runFind(queryRef.current, {
        forward: true,
        findNext: true,
        matchCase: matchCaseRef.current
      })
    }
  }, [runFind])

  const closeFindBar = useCallback(
    (restoreWebviewFocus = false): void => {
      if (!openRef.current) return
      setOpen(false)
      lastRequestIdRef.current = null
      safeStopFind(webviewRef.current, 'clearSelection')
      setMatches(0)
      setActiveOrdinal(0)
      if (restoreWebviewFocus) {
        try {
          webviewRef.current?.focus()
        } catch {
          // 忽略焦点恢复异常
        }
      }
    },
    [webviewRef]
  )

  // 当 Webview 进入休眠、卸载或切换到快照覆盖层时，自动收起查找框并清理高亮
  useEffect(() => {
    if (disabled && open) {
      setOpen(false)
      lastRequestIdRef.current = null
      safeStopFind(webviewRef.current, 'clearSelection')
      setMatches(0)
      setActiveOrdinal(0)
    }
  }, [disabled, open, webviewRef])

  // 订阅主进程转发的 Webview 内部快捷键（Ctrl+F / Cmd+F / Esc）
  useEffect(() => {
    return subscribeFindShortcut(({ wcId, action }) => {
      const currentWcId = getSafeWebContentsId(webviewRef.current)
      if (currentWcId === null || currentWcId !== wcId) return
      if (action === 'open') {
        openFindBar()
      } else if (action === 'close') {
        closeFindBar(false)
      }
    })
  }, [webviewRef, openFindBar, closeFindBar])

  // 兜底：焦点在宿主渲染层但鼠标悬停在当前 Webview 卡片上时，按 Ctrl+F 同样唤醒该卡片的查找框
  useEffect(() => {
    const container = anchorRef.current?.parentElement
    const cardRoot = container?.parentElement ?? container
    if (!cardRoot) return

    const onMouseEnter = (): void => {
      isHoveredRef.current = true
    }
    const onMouseLeave = (): void => {
      isHoveredRef.current = false
    }

    const onWindowKeyDown = (e: KeyboardEvent): void => {
      if (disabledRef.current || !isHoveredRef.current) return
      if (cardRoot.offsetParent === null) return
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        !e.shiftKey &&
        (e.key.toLowerCase() === 'f' || e.code === 'KeyF')
      ) {
        e.preventDefault()
        openFindBar()
      }
    }

    cardRoot.addEventListener('mouseenter', onMouseEnter)
    cardRoot.addEventListener('mouseleave', onMouseLeave)
    window.addEventListener('keydown', onWindowKeyDown)
    return () => {
      cardRoot.removeEventListener('mouseenter', onMouseEnter)
      cardRoot.removeEventListener('mouseleave', onMouseLeave)
      window.removeEventListener('keydown', onWindowKeyDown)
    }
  }, [openFindBar])

  // 监听 Webview 的 found-in-page 结果及页面导航重置
  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return

    const handleFoundInPage = (event: Electron.FoundInPageEvent): void => {
      const result = event.result
      if (!result) return
      if (
        lastRequestIdRef.current !== null &&
        typeof result.requestId === 'number' &&
        result.requestId !== lastRequestIdRef.current
      ) {
        return
      }
      if (typeof result.matches === 'number') {
        setMatches(result.matches)
      }
      if (typeof result.activeMatchOrdinal === 'number') {
        setActiveOrdinal(result.activeMatchOrdinal)
      }
    }

    const handleNavigate = (): void => {
      if (!openRef.current) return
      setMatches(0)
      setActiveOrdinal(0)
    }

    const handleStopLoading = (): void => {
      if (!openRef.current || disabledRef.current || !queryRef.current) return
      runFind(queryRef.current, {
        forward: true,
        findNext: true,
        matchCase: matchCaseRef.current
      })
    }

    webview.addEventListener('found-in-page', handleFoundInPage)
    webview.addEventListener('did-navigate', handleNavigate)
    webview.addEventListener('did-stop-loading', handleStopLoading)
    return () => {
      webview.removeEventListener('found-in-page', handleFoundInPage)
      webview.removeEventListener('did-navigate', handleNavigate)
      webview.removeEventListener('did-stop-loading', handleStopLoading)
    }
  }, [webviewRef, disabled, runFind])

  // 组件卸载时确保清理页面内查找高亮
  useEffect(() => {
    const webview = webviewRef.current
    return () => {
      safeStopFind(webview, 'clearSelection')
    }
  }, [webviewRef])

  const handleQueryChange = (nextQuery: string): void => {
    setQuery(nextQuery)
    queryRef.current = nextQuery
    runFind(nextQuery, {
      forward: true,
      findNext: true,
      matchCase: matchCaseRef.current
    })
  }

  const handleToggleMatchCase = (): void => {
    const nextMatchCase = !matchCase
    setMatchCase(nextMatchCase)
    matchCaseRef.current = nextMatchCase
    if (queryRef.current) {
      runFind(queryRef.current, {
        forward: true,
        findNext: true,
        matchCase: nextMatchCase
      })
    }
    inputRef.current?.focus()
  }

  const handleStep = (forward: boolean): void => {
    if (!queryRef.current || matches === 0) return
    runFind(queryRef.current, {
      forward,
      findNext: false,
      matchCase: matchCaseRef.current
    })
  }

  return (
    <div ref={anchorRef} className="pointer-events-none">
      {open && !disabled && (
        <div
          role="search"
          aria-label="页面内查找"
          className="pointer-events-auto absolute top-2.5 right-3 z-30 flex items-center gap-1.5 px-2.5 py-1.5 bg-white/95 backdrop-blur-md border border-gray-200/90 rounded-xl shadow-lg no-drag"
        >
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (
                (e.ctrlKey || e.metaKey) &&
                !e.altKey &&
                !e.shiftKey &&
                (e.key.toLowerCase() === 'f' || e.code === 'KeyF')
              ) {
                e.preventDefault()
                e.stopPropagation()
                inputRef.current?.select()
                return
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                closeFindBar(true)
                return
              }
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                e.stopPropagation()
                handleStep(!e.shiftKey)
              }
            }}
            placeholder="在页面中查找..."
            aria-label="查找关键词"
            className="w-44 text-sm text-text-primary placeholder:text-text-secondary/60 bg-transparent focus:outline-none px-1"
          />

          <span
            className={`text-xs tabular-nums select-none px-1 min-w-[3rem] text-right ${
              query && matches === 0 ? 'text-red-500 font-medium' : 'text-text-secondary'
            }`}
          >
            {query ? `${matches > 0 ? activeOrdinal : 0} / ${matches}` : '0 / 0'}
          </span>

          <button
            type="button"
            onClick={handleToggleMatchCase}
            title={matchCase ? '区分大小写：已开启' : '区分大小写：已关闭'}
            aria-pressed={matchCase}
            className={`w-7 h-7 flex items-center justify-center rounded-lg text-xs font-semibold transition-colors ${
              matchCase
                ? 'bg-blue-100 text-primary'
                : 'text-text-secondary hover:bg-gray-100 hover:text-text-primary'
            }`}
          >
            Aa
          </button>

          <div className="w-px h-4 bg-gray-200 mx-0.5" />

          <button
            type="button"
            onClick={() => handleStep(false)}
            disabled={!query || matches === 0}
            title="上一个匹配项 (Shift+Enter)"
            aria-label="上一个匹配项"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-text-secondary hover:bg-gray-100 hover:text-text-primary disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            <span className="material-symbols-outlined text-lg">keyboard_arrow_up</span>
          </button>

          <button
            type="button"
            onClick={() => handleStep(true)}
            disabled={!query || matches === 0}
            title="下一个匹配项 (Enter)"
            aria-label="下一个匹配项"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-text-secondary hover:bg-gray-100 hover:text-text-primary disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            <span className="material-symbols-outlined text-lg">keyboard_arrow_down</span>
          </button>

          <button
            type="button"
            onClick={() => closeFindBar(true)}
            title="关闭查找 (Esc)"
            aria-label="关闭查找"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-text-secondary hover:bg-gray-100 hover:text-text-primary transition-colors"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>
      )}
    </div>
  )
}
