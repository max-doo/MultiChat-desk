import { useEffect, useState } from 'react'

const INITIAL_STATE: UpdateState = { status: 'idle' }

export function useUpdateState(): UpdateState {
  const [state, setState] = useState<UpdateState>(INITIAL_STATE)

  useEffect(() => {
    let disposed = false

    const unsubscribe = window.api.onUpdateStateChange((nextState) => {
      if (!disposed) setState(nextState)
    })

    void window.api.updateGetState()
      .then((result) => {
        if (!disposed && result.success && result.data) {
          setState(result.data)
        }
      })
      .catch((error: unknown) => {
        console.error('[Updater] 读取更新状态失败:', error)
      })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  return state
}

export function useUpdateReminder(): { hasUpdate: boolean; releaseUrl?: string } {
  const state = useUpdateState()

  return {
    hasUpdate: state.result?.hasUpdate === true,
    releaseUrl: state.result?.releaseUrl
  }
}

export function openUpdateRelease(releaseUrl?: string): void {
  if (releaseUrl) void window.api.openBrowserWindow(releaseUrl)
}
