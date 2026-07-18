import { useCallback, useEffect, useState } from 'react'
import { openUpdateRelease, useUpdateState } from '../hooks/useUpdateState'

export default function AboutSection(): JSX.Element {
  const [currentVersion, setCurrentVersion] = useState('')
  const state = useUpdateState()

  useEffect(() => {
    void window.api.getAppVersion().then((result) => {
      if (result.success && result.data) {
        setCurrentVersion(result.data)
      }
    })
  }, [])

  const handleCheck = useCallback(async () => {
    try {
      const response = await window.api.updateCheck()
      if (!response.data) {
        console.error('[Updater] 检查更新失败:', response.error)
      }
    } catch (error: unknown) {
      console.error('[Updater] 检查更新 IPC 调用失败:', error)
    }
  }, [])

  const handleOpenRelease = useCallback(() => {
    openUpdateRelease(state.result?.releaseUrl)
  }, [state.result?.releaseUrl])

  const hasUpdate = state.result?.hasUpdate === true
  const isChecking = state.status === 'checking'
  const statusText = isChecking
    ? '正在检查更新…'
    : hasUpdate
      ? '有新版本可用'
      : state.status === 'ready'
        ? '当前已是最新版本'
        : state.status === 'error'
          ? state.error || '检查失败，请稍后重试'
          : '后台会定期检查更新'

  return (
    <div className="mt-3 p-3 rounded-xl glass-panel flex items-center gap-3">
      <span className="material-symbols-outlined text-primary text-xl shrink-0">rocket_launch</span>
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-text-primary text-sm font-medium flex items-center gap-2 truncate">
          检查新版本
          {hasUpdate && (
            <span className="text-red-500 text-[10px] bg-red-50 px-1.5 py-0.5 rounded-full border border-red-200 font-medium whitespace-nowrap">
              发现新版本 v{state.result?.latestVersion}
            </span>
          )}
        </span>
        <span className={`text-[10px] truncate ${state.status === 'error' ? 'text-red-500' : 'text-text-secondary'}`}>
          当前版本 v{currentVersion || state.result?.currentVersion || '—'} · {statusText}
        </span>
      </div>
      {hasUpdate ? (
        <button
          type="button"
          onClick={handleOpenRelease}
          className="px-3 py-1.5 text-xs rounded-full bg-primary text-white hover:opacity-90 transition-all font-medium shrink-0"
        >
          前往下载
        </button>
      ) : (
        <button
          type="button"
          onClick={() => { void handleCheck() }}
          disabled={isChecking}
          className="px-3 py-1.5 text-xs rounded-full glass-panel text-text-primary hover:text-primary hover:bg-blue-50/50 transition-all font-medium disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {isChecking ? '检查中…' : state.status === 'error' ? '重试' : '检查更新'}
        </button>
      )}
    </div>
  )
}
