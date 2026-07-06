import { useState, useCallback, useEffect } from 'react'

export default function AboutSection(): JSX.Element {
  const [currentVersion, setCurrentVersion] = useState<string>('')

  useEffect(() => {
    void window.api.getAppVersion().then((result) => {
      if (result.success && result.data) {
        setCurrentVersion(result.data)
      }
    })
  }, [])

  const handleCheckUpdate = useCallback(() => {
    void window.api.openBrowserWindow('https://github.com/max-doo/MultiChat-desk/releases')
  }, [])

  return (
    <div className="mt-3">
      {/* 检查更新 Card (样式与“查看使用说明”完全统一) */}
      <button
        type="button"
        onClick={handleCheckUpdate}
        className="w-full flex items-center justify-between p-3 glass-panel rounded-xl hover:bg-blue-50/40 transition-all group text-left"
      >
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-primary text-xl group-hover:scale-110 transition-transform duration-200">
            rocket_launch
          </span>
          <div className="flex flex-col">
            <span className="text-text-primary text-sm font-medium flex items-center gap-2">
              检查新版本
              {currentVersion && (
                <span className="text-primary font-mono text-[10px] bg-primary/10 px-1.5 py-0.5 rounded-full border border-primary/20 font-medium">
                  v{currentVersion}
                </span>
              )}
            </span>
            <span className="text-text-secondary text-[10px]">跳转至 GitHub Releases 页面查看更新</span>
          </div>
        </div>
        <span className="material-symbols-outlined text-text-secondary group-hover:text-primary transition-colors">
          open_in_new
        </span>
      </button>
    </div>
  )
}
