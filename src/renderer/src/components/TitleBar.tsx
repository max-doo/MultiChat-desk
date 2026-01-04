/**
 * 自定义标题栏组件
 * 提供窗口控制按钮（最小化、最大化、关闭）
 */
function TitleBar(): JSX.Element {
  const handleMinimize = (): void => {
    if (window.api?.minimizeWindow) {
      window.api.minimizeWindow()
    }
  }

  const handleMaximize = (): void => {
    if (window.api?.maximizeWindow) {
      window.api.maximizeWindow()
    }
  }

  const handleClose = (): void => {
    if (window.api?.closeWindow) {
      window.api.closeWindow()
    }
  }

  return (
    <div 
      className="h-8 bg-background-dark flex items-center justify-between px-4 border-b border-gray-800"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* 应用标题 */}
      <div 
        className="text-sm font-medium text-gray-400"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        ModelMash
      </div>

      {/* 窗口控制按钮 */}
      <div 
        className="flex items-center gap-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* 最小化 */}
        <button
          onClick={handleMinimize}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-700 transition-colors"
          title="最小化"
        >
          <span className="material-symbols-outlined text-sm text-gray-400">remove</span>
        </button>

        {/* 最大化 */}
        <button
          onClick={handleMaximize}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-700 transition-colors"
          title="最大化"
        >
          <span className="material-symbols-outlined text-sm text-gray-400">crop_square</span>
        </button>

        {/* 关闭 */}
        <button
          onClick={handleClose}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-600 transition-colors"
          title="关闭"
        >
          <span className="material-symbols-outlined text-sm text-gray-400">close</span>
        </button>
      </div>
    </div>
  )
}

export default TitleBar
