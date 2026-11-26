import { useCallback, useEffect, useState } from 'react'
import { openUpdateRelease, useUpdateState } from '../hooks/useUpdateState'
import { AppIcon } from './icons/AppIcon'

const secondaryActionClass =
  'flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-sidebar px-3 text-label font-medium text-text-primary transition-colors hover:border-primary/40 hover:text-primary dark:border-white/10 dark:bg-white/5'

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
    <div className="mt-3 flex items-center gap-3 rounded-xl glass-panel p-3">
      <AppIcon name="rocket_launch" size={20} className="text-primary shrink-0" />
      <div className="flex flex-col min-w-0 flex-1">
        <span className="flex items-center gap-2 truncate text-body font-medium text-text-primary">
          检查新版本
          {hasUpdate && (
            <span className="text-red-500 text-tiny bg-red-50 px-1.5 py-0.5 rounded-full border border-red-200 font-medium whitespace-nowrap">
              发现新版本 v{state.result?.latestVersion}
            </span>
          )}
        </span>
        <span className={`truncate text-caption ${state.status === 'error' ? 'text-red-500' : 'text-text-secondary'}`}>
          当前版本 v{currentVersion || state.result?.currentVersion || '—'} · {statusText}
        </span>
      </div>
      {hasUpdate ? (
        <button
          type="button"
          onClick={handleOpenRelease}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 text-body font-medium text-white transition-opacity hover:opacity-90"
        >
          <AppIcon name="download" size={14} />
          <span>前往下载</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => { void handleCheck() }}
          disabled={isChecking}
          className={`${secondaryActionClass} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <AppIcon name="refresh" size={14} />
          <span>{isChecking ? '检查中…' : state.status === 'error' ? '重试' : '检查更新'}</span>
        </button>
      )}
    </div>
  )
}
