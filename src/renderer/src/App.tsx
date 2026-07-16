import { useState, useEffect, lazy, Suspense } from 'react'
import Layout from './components/Layout'
import MainPage from './pages/MainPage'
import SummaryPage from './pages/SummaryPage'
import QuickPage from './pages/QuickPage'
import ToolbarPage from './pages/ToolbarPage'
import HistoryDrawer from './components/HistoryDrawer'
import { initializeStore, useAppStore, SummaryHistoryItem } from './store/appStore'

// 诊断页仅在 dev 构建 reachable：生产构建里 import.meta.env.DEV=false，
// 下面的动态 import 会被 Rollup 当作死代码剔除，DiagnosticsPage 不会进包。
const DiagnosticsPage = import.meta.env.DEV
  ? lazy(() => import('./pages/DiagnosticsPage'))
  : null

function MainApp(): JSX.Element {
  const { currentPage, setCurrentPage } = useAppStore()
  const isHistoryOpen = useAppStore((s) => s.isHistoryOpen)
  const setHistoryOpen = useAppStore((s) => s.setHistoryOpen)
  const historyInitialTab = useAppStore((s) => s.historyInitialTab)
  const setPendingHistoryRestore = useAppStore((s) => s.setPendingHistoryRestore)
  const [isInitialized, setIsInitialized] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 记录是否曾经打开过 SummaryPage，用于延迟渲染
  const [hasSummaryOpened, setHasSummaryOpened] = useState(false)
  const [initialSummaryItem, setInitialSummaryItem] = useState<SummaryHistoryItem | undefined>(undefined)

  // 监听 location hash 自动进入 quick 页
  useEffect(() => {
    const checkHash = () => {
      if (window.location.hash === '#quick') {
        setCurrentPage('quick')
      }
      if (import.meta.env.DEV && window.location.hash === '#diagnostics') {
        setCurrentPage('diagnostics')
      }
    }
    checkHash()
    window.addEventListener('hashchange', checkHash)
    return () => window.removeEventListener('hashchange', checkHash)
  }, [setCurrentPage])

  // 初始化应用状态
  useEffect(() => {
    const init = async () => {
      try {
        console.log('开始初始化...')
        await initializeStore()
        console.log('初始化完成')
      } catch (err) {
        console.error('Store 初始化失败:', err)
        setError(String(err))
      } finally {
        setIsInitialized(true)
      }
    }
    
    // 延迟执行，确保 DOM 和 API 准备好
    const timer = setTimeout(init, 100)
    
    return () => {
      clearTimeout(timer)
    }
  }, [isInitialized])

  // 初始化超时保护：超时后显示错误界面而非用未初始化状态渲染
  useEffect(() => {
    if (isInitialized) return
    const timeout = setTimeout(() => {
      if (!isInitialized) {
        console.warn('初始化超时，显示错误界面')
        setError('初始化超时，请点击重新加载')
      }
    }, 10000) // 放宽到 10 秒，冷启动磁盘 IO 可能较慢
    return () => clearTimeout(timeout)
  }, [isInitialized])

  // 当首次切换到 SummaryPage 时，记录状态
  useEffect(() => {
    if (currentPage === 'summary' && !hasSummaryOpened) {
      setHasSummaryOpened(true)
    }
  }, [currentPage, hasSummaryOpened])

  // 注册诊断窗口透传监听（仅 dev，生产构建不注册无入口的空监听）
  const registerDiagnosticsRelay = useAppStore((s) => s.registerDiagnosticsRelay)
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const off = registerDiagnosticsRelay()
    return off
  }, [registerDiagnosticsRelay])

  if (currentPage === 'quick') {
    return <QuickPage />
  }

  if (import.meta.env.DEV && currentPage === 'diagnostics' && DiagnosticsPage) {
    return (
      <Suspense fallback={null}>
        <DiagnosticsPage />
      </Suspense>
    )
  }

  // 显示错误状态
  if (error) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-4 text-red-400">
            <p>初始化错误: {error}</p>
            <button 
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-gray-700 rounded hover:bg-gray-600"
            >
              重新加载
            </button>
          </div>
        </div>
      </Layout>
    )
  }

  // 显示加载状态
  if (!isInitialized) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
            <p className="text-gray-400">正在加载...</p>
          </div>
        </div>
      </Layout>
    )
  }

  // 主页面和总结页面使用 CSS 控制显示/隐藏，避免 webview 重新加载
  // MainPage 始终挂载，SummaryPage 在首次打开后保持挂载
  return (
    <Layout>
      {/* MainPage 始终挂载，通过 CSS 控制显示/隐藏 */}
      <div 
        className="h-full" 
        style={{ display: currentPage === 'main' ? 'block' : 'none' }}
      >
        <MainPage onNavigateToSummary={(item) => {
          setInitialSummaryItem(item)
          setCurrentPage('summary')
        }} isActive={currentPage === 'main'} />
      </div>
      
      {/* SummaryPage 在首次打开后保持挂载，避免重复渲染 */}
      {hasSummaryOpened && (
        <div 
          className="h-full" 
          style={{ display: currentPage === 'summary' ? 'block' : 'none' }}
        >
          <SummaryPage 
            onNavigateBack={() => setCurrentPage('main')} 
            initialHistoryItem={initialSummaryItem}
            isActive={currentPage === 'summary'}
          />
        </div>
      )}

      {/* 历史记录抽屉：渲染在页面容器外，两个页面均可显示 */}
      <HistoryDrawer
        isOpen={isHistoryOpen}
        onClose={() => setHistoryOpen(false)}
        initialTab={historyInitialTab}
        onSelectHistory={(item) => {
          // 跨页传递给 MainPage 消费：先切换到主页，再通过 pendingHistoryRestore 恢复
          setHistoryOpen(false)
          setPendingHistoryRestore(item)
          setCurrentPage('main')
        }}
        onSelectSummaryHistory={(item) => {
          // 选中总结历史：导航到总结页并恢复该记录
          setHistoryOpen(false)
          setInitialSummaryItem(item)
          setCurrentPage('summary')
        }}
      />
    </Layout>
  )
}

// 顶层短路拦截：#toolbar 窗口跳过所有 Store 初始化，实现毫秒级渲染
export default function App(): JSX.Element {
  if (window.location.hash === '#toolbar') {
    return <ToolbarPage />
  }
  return <MainApp />
}
