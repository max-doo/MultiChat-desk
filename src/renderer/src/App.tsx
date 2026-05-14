import { useState, useEffect } from 'react'
import Layout from './components/Layout'
import MainPage from './pages/MainPage'
import SummaryPage from './pages/SummaryPage'
import BrowserPage from './pages/BrowserPage'
import { initializeStore, SummaryHistoryItem } from './store/appStore'

function App(): JSX.Element {
  const [currentPage, setCurrentPage] = useState<'main' | 'summary' | 'browser'>('main')
  const [isInitialized, setIsInitialized] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 记录是否曾经打开过 SummaryPage，用于延迟渲染
  const [hasSummaryOpened, setHasSummaryOpened] = useState(false)
  const [initialSummaryItem, setInitialSummaryItem] = useState<SummaryHistoryItem | undefined>(undefined)

  // 初始化应用状态
  useEffect(() => {
    // 检查初始 hash 状态
    const checkHash = () => {
      if (window.location.hash.startsWith('#browser')) {
        setCurrentPage('browser')
        if (!isInitialized) {
          setIsInitialized(true) // Browser page doesn't need full store init immediately
        }
        return true
      }
      return false
    }

    // 初始检查
    if (checkHash()) {
      return
    }

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
    
    // 监听 hash 变化，用于从 SummaryPage 跳转到 BrowserPage
    const handleHashChange = () => {
      checkHash()
    }
    window.addEventListener('hashchange', handleHashChange)
    
    return () => {
      clearTimeout(timer)
      window.removeEventListener('hashchange', handleHashChange)
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

  // 处理 BrowserPage 的情况（单独渲染）
  if (currentPage === 'browser') {
    return (
      <Layout>
        <BrowserPage />
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
          />
        </div>
      )}
    </Layout>
  )
}

export default App
