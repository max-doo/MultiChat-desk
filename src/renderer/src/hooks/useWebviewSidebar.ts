import { useState, useRef, useCallback, useEffect } from 'react'
import { WebviewCardRef } from '../components/WebviewCard'

export type SidebarMode = 'model' | 'mindmap'

export const MINDMAP_SIDEBAR_ID = '__mindmap__'
const HIBERNATE_DELAY_MS = 30 * 1000 // 30 秒休眠

export interface UseWebviewSidebarOptions {
  storagePrefix: string
  models: Array<{ id: string; name: string; url: string; logo: string }>
  activeModelId?: string
  instancePrefix: string
  onExpandedChange?: (expanded: boolean, panelWidth: number) => void
  maxSidebarAvailableWidth?: () => number
}

export function useWebviewSidebar({
  storagePrefix,
  models,
  activeModelId,
  instancePrefix: _instancePrefix,
  onExpandedChange,
  maxSidebarAvailableWidth
}: UseWebviewSidebarOptions) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const sidebarOpenRef = useRef(false)
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('model')
  const sidebarModeRef = useRef<SidebarMode>('model')
  const [isMindmapMounted, setIsMindmapMounted] = useState(false)
  const mindmapRef = useRef<WebviewCardRef | null>(null)
  const isVisibleRef = useRef(true)

  const [sidebarModelId, setSidebarModelId] = useState('')
  const sidebarModelIdRef = useRef('')
  const [mountedSidebarModels, setMountedSidebarModels] = useState<Set<string>>(new Set())
  const sidebarRefs = useRef<Map<string, WebviewCardRef>>(new Map())
  const sidebarResuming = useRef<Set<string>>(new Set())
  const sidebarTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const pendingSidebarText = useRef<{ id: number; text: string } | null>(null)
  const pendingSequence = useRef(0)
  const activeInjection = useRef<number | null>(null)
  const [injectionRevision, setInjectionRevision] = useState(0)
  const [sidebarError, setSidebarError] = useState('')

  const [sidebarWidth, setSidebarWidth] = useState(420)
  const sidebarWidthRef = useRef(420)
  const resizingSidebar = useRef(false)

  // 清除指定对象的休眠倒计时
  const clearSidebarTimer = useCallback((targetId: string) => {
    const timer = sidebarTimers.current.get(targetId)
    if (timer) clearTimeout(timer)
    sidebarTimers.current.delete(targetId)
  }, [])

  // 调度休眠
  const scheduleSidebarHibernate = useCallback((targetId: string) => {
    if (!targetId) return
    clearSidebarTimer(targetId)
    const timer = setTimeout(() => {
      sidebarTimers.current.delete(targetId)
      if (targetId === MINDMAP_SIDEBAR_ID) {
        if (isVisibleRef.current && sidebarOpenRef.current && sidebarModeRef.current === 'mindmap') return
        const ref = mindmapRef.current
        if (ref && !ref.isHibernated()) {
          void ref.suspend().then(() => {
            if (isVisibleRef.current && sidebarOpenRef.current && sidebarModeRef.current === 'mindmap' && ref.isHibernated()) {
              sidebarResuming.current.add(MINDMAP_SIDEBAR_ID)
              void ref.resume().finally(() => {
                sidebarResuming.current.delete(MINDMAP_SIDEBAR_ID)
              })
            }
          })
        }
        return
      }

      if (isVisibleRef.current && sidebarOpenRef.current && sidebarModeRef.current === 'model' && sidebarModelIdRef.current === targetId) return
      const ref = sidebarRefs.current.get(targetId)
      if (ref && !ref.isHibernated()) {
        void ref.suspend().then(() => {
          if (isVisibleRef.current && sidebarOpenRef.current && sidebarModeRef.current === 'model' && sidebarModelIdRef.current === targetId && ref.isHibernated()) {
            sidebarResuming.current.add(targetId)
            void ref.resume().finally(() => {
              sidebarResuming.current.delete(targetId)
              setInjectionRevision(value => value + 1)
            })
          }
        })
      }
    }, HIBERNATE_DELAY_MS)
    sidebarTimers.current.set(targetId, timer)
  }, [clearSidebarTimer])

  // 强行休眠所有侧边栏资源并清理定时器
  const hibernateAll = useCallback(() => {
    sidebarTimers.current.forEach(timer => clearTimeout(timer))
    sidebarTimers.current.clear()

    if (mindmapRef.current && !mindmapRef.current.isHibernated()) {
      void mindmapRef.current.suspend()
    }
    sidebarRefs.current.forEach(ref => {
      if (ref && !ref.isHibernated()) {
        void ref.suspend()
      }
    })
  }, [])

  // 打开模型侧边栏
  const openSidebar = useCallback(() => {
    sidebarModeRef.current = 'model'
    setSidebarMode('model')
    const modelId = sidebarModelIdRef.current || activeModelId || models[0]?.id
    if (!modelId) return
    sidebarModelIdRef.current = modelId
    setSidebarModelId(modelId)
    setMountedSidebarModels(prev => new Set(prev).add(modelId))
    clearSidebarTimer(modelId)
    sidebarOpenRef.current = true
    setSidebarOpen(true)
    if (onExpandedChange) {
      onExpandedChange(true, sidebarWidthRef.current + 4)
    }
    const ref = sidebarRefs.current.get(modelId)
    if (ref?.isHibernated() && !sidebarResuming.current.has(modelId)) {
      sidebarResuming.current.add(modelId)
      void ref.resume().finally(() => {
        sidebarResuming.current.delete(modelId)
        setInjectionRevision(value => value + 1)
      })
    }
  }, [activeModelId, models, clearSidebarTimer, onExpandedChange])

  // 打开思维导图侧边栏
  const openMindmapSidebar = useCallback(() => {
    sidebarModeRef.current = 'mindmap'
    setSidebarMode('mindmap')
    setIsMindmapMounted(true)
    clearSidebarTimer(MINDMAP_SIDEBAR_ID)
    sidebarOpenRef.current = true
    setSidebarOpen(true)
    if (onExpandedChange) {
      onExpandedChange(true, sidebarWidthRef.current + 4)
    }
    const ref = mindmapRef.current
    if (ref?.isHibernated() && !sidebarResuming.current.has(MINDMAP_SIDEBAR_ID)) {
      sidebarResuming.current.add(MINDMAP_SIDEBAR_ID)
      void ref.resume().finally(() => {
        sidebarResuming.current.delete(MINDMAP_SIDEBAR_ID)
      })
    }
  }, [clearSidebarTimer, onExpandedChange])

  // 关闭侧边栏
  const closeSidebar = useCallback(() => {
    const maxAvailable = maxSidebarAvailableWidth ? maxSidebarAvailableWidth() : Math.max(0, window.innerWidth - 324)
    const panelWidth = Math.min(sidebarWidthRef.current, maxAvailable) + 4
    sidebarOpenRef.current = false
    setSidebarOpen(false)
    if (sidebarModeRef.current === 'mindmap') {
      scheduleSidebarHibernate(MINDMAP_SIDEBAR_ID)
    } else {
      scheduleSidebarHibernate(sidebarModelIdRef.current)
    }
    if (onExpandedChange) {
      onExpandedChange(false, panelWidth)
    }
  }, [scheduleSidebarHibernate, onExpandedChange, maxSidebarAvailableWidth])

  // 切换副模型侧边栏显示状态
  const toggleModelSidebar = useCallback(() => {
    if (sidebarOpen && sidebarMode === 'model') {
      closeSidebar()
    } else {
      const prevMode = sidebarModeRef.current
      if (sidebarOpen && prevMode === 'mindmap') {
        scheduleSidebarHibernate(MINDMAP_SIDEBAR_ID)
      }
      openSidebar()
    }
  }, [sidebarOpen, sidebarMode, closeSidebar, openSidebar, scheduleSidebarHibernate])

  // 切换思维导图侧边栏显示状态
  const toggleMindmapSidebar = useCallback(() => {
    if (sidebarOpen && sidebarMode === 'mindmap') {
      closeSidebar()
    } else {
      const prevMode = sidebarModeRef.current
      if (sidebarOpen && prevMode === 'model') {
        scheduleSidebarHibernate(sidebarModelIdRef.current)
      }
      openMindmapSidebar()
    }
  }, [sidebarOpen, sidebarMode, closeSidebar, openMindmapSidebar, scheduleSidebarHibernate])

  // 切换副模型
  const changeSidebarModel = useCallback((modelId: string) => {
    const oldId = sidebarModelIdRef.current
    sidebarModelIdRef.current = modelId
    setSidebarModelId(modelId)
    setMountedSidebarModels(prev => new Set(prev).add(modelId))
    void window.api.storeSet(`${storagePrefix}SidebarModelId`, modelId)
    clearSidebarTimer(modelId)
    const ref = sidebarRefs.current.get(modelId)
    if (ref?.isHibernated() && !sidebarResuming.current.has(modelId)) {
      sidebarResuming.current.add(modelId)
      void ref.resume().finally(() => {
        sidebarResuming.current.delete(modelId)
        setInjectionRevision(value => value + 1)
      })
    }
    if (oldId && oldId !== modelId) scheduleSidebarHibernate(oldId)
  }, [storagePrefix, clearSidebarTimer, scheduleSidebarHibernate])

  // 划词在侧边栏提问
  const handleAskSidebar = useCallback((text: string) => {
    if (!text.trim()) return
    pendingSidebarText.current = { id: ++pendingSequence.current, text }
    setSidebarError('')
    if (sidebarModeRef.current === 'mindmap') {
      scheduleSidebarHibernate(MINDMAP_SIDEBAR_ID)
    }
    openSidebar()
    setInjectionRevision(value => value + 1)
  }, [openSidebar, scheduleSidebarHibernate])

  // 划词文本注入处理
  useEffect(() => {
    const pending = pendingSidebarText.current
    if (!sidebarOpen || !pending || activeInjection.current === pending.id) return
    activeInjection.current = pending.id
    let cancelled = false
    const inject = async (): Promise<void> => {
      for (let attempt = 0; attempt < 60; attempt++) {
        if (cancelled || !sidebarOpenRef.current || pendingSidebarText.current?.id !== pending.id) break
        const ref = sidebarRefs.current.get(sidebarModelIdRef.current)
        if (ref && !ref.isHibernated() && !sidebarResuming.current.has(sidebarModelIdRef.current)) {
          const existing = await ref.getInputText()
          if (existing.success && pendingSidebarText.current?.id === pending.id) {
            const combined = existing.text ? `${existing.text}\n\n${pending.text}` : pending.text
            const result = await ref.insertText(combined)
            if (result.success) {
              if (pendingSidebarText.current?.id === pending.id) pendingSidebarText.current = null
              setSidebarError('')
              break
            }
          }
        }
        await new Promise(resolve => setTimeout(resolve, 500))
      }
      if (!cancelled && pendingSidebarText.current?.id === pending.id && sidebarOpenRef.current) {
        setSidebarError('文字尚未写入输入框，请点击重试')
      }
      if (activeInjection.current === pending.id) activeInjection.current = null
    }
    void inject()
    return () => { cancelled = true; if (activeInjection.current === pending.id) activeInjection.current = null }
  }, [sidebarOpen, sidebarModelId, injectionRevision])

  // 读取上次保存的侧边栏副模型与宽度
  useEffect(() => {
    void window.api.storeGet(`${storagePrefix}SidebarModelId`).then(saved => {
      if (!sidebarOpenRef.current && typeof saved === 'string' && models.some(model => model.id === saved)) {
        sidebarModelIdRef.current = saved
        setSidebarModelId(saved)
      }
    })
    void window.api.storeGet(`${storagePrefix}SidebarWidth`).then(saved => {
      if (typeof saved === 'number' && saved >= 320 && saved <= 1200) {
        sidebarWidthRef.current = saved
        setSidebarWidth(saved)
      }
    })
  }, [storagePrefix, models])

  // 拖拽宽度手柄处理
  const handlePointerDownResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    resizingSidebar.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [])

  const handlePointerMoveResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (resizingSidebar.current) {
      const maxAvailable = maxSidebarAvailableWidth ? maxSidebarAvailableWidth() : Math.max(320, window.innerWidth - 324)
      const width = Math.max(320, Math.min(1200, Math.min(maxAvailable, window.innerWidth - event.clientX)))
      sidebarWidthRef.current = width
      setSidebarWidth(width)
    }
  }, [maxSidebarAvailableWidth])

  const handlePointerUpResize = useCallback(() => {
    if (resizingSidebar.current) {
      resizingSidebar.current = false
      void window.api.storeSet(`${storagePrefix}SidebarWidth`, sidebarWidthRef.current)
    }
  }, [storagePrefix])

  return {
    sidebarOpen,
    sidebarMode,
    sidebarWidth,
    sidebarModelId,
    isMindmapMounted,
    mountedSidebarModels,
    sidebarError,
    sidebarRefs,
    mindmapRef,
    resizingSidebar,
    openSidebar,
    closeSidebar,
    toggleModelSidebar,
    toggleMindmapSidebar,
    changeSidebarModel,
    handleAskSidebar,
    hibernateAll,
    setSidebarError,
    setInjectionRevision,
    handlePointerDownResize,
    handlePointerMoveResize,
    handlePointerUpResize
  }
}
