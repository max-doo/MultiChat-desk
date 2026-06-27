import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle, type DragEvent } from 'react'
import { useAppStore, DEEP_RESEARCH_UNSUPPORTED_ERROR, IMAGE_GENERATION_UNSUPPORTED_ERROR } from '../store/appStore'


interface ControlBarProps {
  onGenerateReport: () => void
}

// 暴露给父组件的方法
export interface ControlBarRef {
  setMessage: (message: string) => void
  showNotification: (type: 'success' | 'error' | 'info', message: string, autoHide?: number) => void
  clearNotification: () => void
}

/**
 * 底部控制栏组件
 * 包含新对话、输入框和生成报告等按钮
 */
const ControlBar = forwardRef<ControlBarRef, ControlBarProps>(
  function ControlBar({ onGenerateReport }, ref) {
    const [message, setMessage] = useState('')
    const [isActivatingResearch, setIsActivatingResearch] = useState(false)
    const [isCancellingResearch, setIsCancellingResearch] = useState(false)
    const [isActivatingImageGeneration, setIsActivatingImageGeneration] = useState(false)
    const [isCancellingImageGeneration, setIsCancellingImageGeneration] = useState(false)
    const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null)
    const [isFileDragOver, setIsFileDragOver] = useState(false)
    const dragCounterRef = useRef(0)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const [isNewChatLoading, setIsNewChatLoading] = useState(false)
    const notificationTimeoutRef = useRef<NodeJS.Timeout | null>(null)

    // 用于追踪输入法状态（必须在 handleKeyDown 之前定义）
    const isComposingRef = useRef(false)

    const {
      sendMessageToAll,
      insertTextToAll,
      clearInputToAll,
      uploadFileToAll,
      enableDeepResearchForAll,
      disableDeepResearchForAll,
      enableImageGenerationForAll,
      disableImageGenerationForAll,
      isSending,
      lastSendResults,
      models,
      textInserted,
      setTextInserted,
      isUploading,
      isDeepResearch,
      setDeepResearch,
      isImageGeneration,
      setImageGeneration,
      webviewRefs
    } = useAppStore()

    // 清除通知
    const clearNotification = () => {
      if (notificationTimeoutRef.current) {
        clearTimeout(notificationTimeoutRef.current)
        notificationTimeoutRef.current = null
      }
      setNotification(null)
    }

    // 显示通知
    const showNotification = (type: 'success' | 'error' | 'info', msg: string, autoHide: number = 4000) => {
      // 清除之前的定时器
      if (notificationTimeoutRef.current) {
        clearTimeout(notificationTimeoutRef.current)
      }

      setNotification({ type, message: msg })

      // 如果 autoHide > 0，设置自动清除
      if (autoHide > 0) {
        notificationTimeoutRef.current = setTimeout(() => {
          setNotification(null)
          notificationTimeoutRef.current = null
        }, autoHide)
      }
    }

    const hasFileInDragEvent = (event: DragEvent): boolean => {
      const types = Array.from(event.dataTransfer?.types || [])
      if (types.includes('Files')) return true

      const items = Array.from(event.dataTransfer?.items || [])
      return items.some((item) => item.kind === 'file')
    }

    const handleFileDrop = async (event: DragEvent): Promise<void> => {
      event.preventDefault()
      event.stopPropagation()
      dragCounterRef.current = 0
      setIsFileDragOver(false)

      if (isSending || isUploading) {
        showNotification('info', '正在处理任务，请稍后再试')
        return
      }

      const files = Array.from(event.dataTransfer?.files || [])
      if (files.length === 0) return

      const file = files[0]
      const filePath = (file as File & { path?: string })?.path
      if (!filePath) {
        showNotification('error', '无法读取文件路径，拖拽上传失败')
        return
      }
      if (!window.api?.getFileInfo) {
        showNotification('error', 'API 不可用')
        return
      }

      if (files.length > 1) {
        showNotification('info', `检测到 ${files.length} 个文件，将上传第 1 个`)
      } else {
        showNotification('info', '正在获取文件信息...')
      }

      const infoResult = await window.api.getFileInfo(filePath)
      if (!infoResult.success || !infoResult.data) {
        showNotification('error', `获取文件信息失败: ${infoResult.error}`)
        return
      }

      const fileData = infoResult.data
      showNotification('info', `正在上传 ${fileData.fileName} 到所有模型...`)

      const results = await uploadFileToAll(fileData)

      const successCount = results.filter(r => r.success).length
      const failCount = results.filter(r => !r.success).length

      if (failCount === 0) {
        showNotification('success', `文件已上传到 ${successCount} 个模型`)
      } else if (successCount === 0) {
        const failed = results
          .filter(r => !r.success)
          .map(r => {
            const name = models.find(m => m.id === r.modelId)?.name || r.modelId
            const err = (r.error || '').toString().slice(0, 120)
            return err ? `${name}: ${err}` : name
          })
          .join(' | ')
        showNotification('error', failed ? `所有模型上传失败：${failed}` : '所有模型上传失败')
      } else {
        const failedModels = results
          .filter(r => !r.success)
          .map(r => models.find(m => m.id === r.modelId)?.name || r.modelId)
          .join(', ')
        showNotification('info', `${successCount} 个成功，${failCount} 个失败 (${failedModels})`)
      }
    }

    // 暴露方法给父组件
    useImperativeHandle(ref, () => ({
      setMessage: (msg: string) => {
        setMessage(msg)
        // 聚焦输入框
        setTimeout(() => {
          textareaRef.current?.focus()
        }, 100)
      },
      showNotification: (type: 'success' | 'error' | 'info', msg: string, autoHide?: number) => {
        showNotification(type, msg, autoHide)
      },
      clearNotification: () => {
        clearNotification()
      }
    }))

    // 监听粘贴事件，支持从剪贴板直接粘贴图片
    useEffect(() => {
      const handlePaste = async (event: ClipboardEvent): Promise<void> => {
        // 如果当前正在发送或上传，忽略粘贴
        if (isSending || isUploading) return

        const clipboardData = event.clipboardData
        if (!clipboardData) return

        // 检查剪贴板中是否有图片
        const items = Array.from(clipboardData.items)
        const imageItem = items.find((item) => item.type.startsWith('image/'))

        if (!imageItem) {
          // 剪贴板中没有图片，让浏览器默认处理（文本粘贴等）
          return
        }

        // 阻止默认行为，防止图片被插入到输入框
        event.preventDefault()

        if (!window.api?.readClipboardImage) {
          showNotification('error', '剪贴板图片读取 API 不可用')
          return
        }

        showNotification('info', '正在读取剪贴板图片...')

        const result = await window.api.readClipboardImage()
        if (!result.success || !result.data) {
          showNotification('error', `读取剪贴板图片失败: ${result.error}`)
          return
        }

        const fileData = result.data
        showNotification('info', `正在上传 ${fileData.fileName} 到所有模型...`)

        const results = await uploadFileToAll(fileData)

        const successCount = results.filter(r => r.success).length
        const failCount = results.filter(r => !r.success).length

        if (failCount === 0) {
          showNotification('success', `图片已粘贴并上传到 ${successCount} 个模型`)
        } else if (successCount === 0) {
          const failed = results
            .filter(r => !r.success)
            .map(r => {
              const name = models.find(m => m.id === r.modelId)?.name || r.modelId
              const err = (r.error || '').toString().slice(0, 120)
              return err ? `${name}: ${err}` : name
            })
            .join(' | ')
          showNotification('error', failed ? `所有模型上传失败：${failed}` : '所有模型上传失败')
        } else {
          const failedModels = results
            .filter(r => !r.success)
            .map(r => models.find(m => m.id === r.modelId)?.name || r.modelId)
            .join(', ')
          showNotification('info', `${successCount} 个成功，${failCount} 个失败 (${failedModels})`)
        }
      }

      window.addEventListener('paste', handlePaste)
      return () => {
        window.removeEventListener('paste', handlePaste)
      }
    }, [isSending, isUploading, uploadFileToAll, models, showNotification])

    // 监听发送结果
    useEffect(() => {
      if (lastSendResults.length > 0 && !isSending) {
        const successCount = lastSendResults.filter(r => r.success).length
        const failCount = lastSendResults.filter(r => !r.success).length

        if (failCount === 0) {
          showNotification('success', `消息已发送到 ${successCount} 个模型`)
        } else if (successCount === 0) {
          showNotification('error', '所有模型发送失败')
        } else {
          const failedModels = lastSendResults
            .filter(r => !r.success)
            .map(r => models.find(m => m.id === r.modelId)?.name || r.modelId)
            .join(', ')
          showNotification('info', `${successCount} 个成功，${failCount} 个失败 (${failedModels})`)
        }
      }
    }, [lastSendResults, isSending, models])

    // 两步发送流程
    const handleSend = useCallback(async (): Promise<void> => {
      if (!message.trim() || isSending) return

      const messageToSend = message.trim()

      // 第一步：如果文字还未输入到 webview，先输入
      if (!textInserted) {
        const results = await insertTextToAll(messageToSend)
        const successCount = results.filter(r => r.success).length

        if (successCount > 0) {
          showNotification('success', `文字已输入到 ${successCount} 个模型的输入框，按 Enter 确认发送`)
          // 自动聚焦到输入框，方便用户按 Enter 键
          setTimeout(() => {
            textareaRef.current?.focus()
          }, 100)
          // 不清空输入框，让用户可以再次点击发送
        } else {
          showNotification('error', '输入文字失败，请重试')
        }
        return
      }

      // 第二步：文字已输入，现在发送
      setMessage('') // 清空输入框
      setTextInserted(false) // 重置状态

      await sendMessageToAll(messageToSend)
      textareaRef.current?.focus()
    }, [message, isSending, textInserted, insertTextToAll, sendMessageToAll, setMessage, setTextInserted, showNotification])

    // 监听全局键盘事件，支持在确认发送状态下使用 Enter 键发送
    useEffect(() => {
      // 只在确认发送状态下添加全局监听器
      if (!textInserted) {
        return
      }

      const handleGlobalKeyDown = (e: KeyboardEvent): void => {
        // 检查输入框是否有焦点（包括 textarea 本身或其父容器）
        const activeElement = document.activeElement
        const isTextareaFocused = activeElement === textareaRef.current ||
          (textareaRef.current && textareaRef.current.contains(activeElement as Node))

        if (!isTextareaFocused) {
          return
        }

        // 如果正在输入法组合中，不处理 Enter 键
        if (isComposingRef.current) {
          return
        }

        // Enter 键确认发送，Shift+Enter 不做任何操作（因为此时是只读状态）
        if (e.key === 'Enter' && !e.shiftKey && !isSending && message.trim()) {
          e.preventDefault()
          e.stopPropagation()
          handleSend()
        }
      }

      window.addEventListener('keydown', handleGlobalKeyDown, true)
      return () => {
        window.removeEventListener('keydown', handleGlobalKeyDown, true)
      }
    }, [textInserted, isSending, handleSend, message])

    // 处理键盘事件
    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      // 如果正在输入法组合中，不处理 Enter 键
      if (isComposingRef.current) {
        return
      }

      // Enter 发送消息，Shift+Enter 换行
      // 支持两种状态：1. 未输入文字时，Enter 先输入文字；2. 已输入文字时，Enter 确认发送
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    }

    // 输入框内容变化时处理
    // 注意：完全禁用动态高度调整，使用固定高度，避免干扰 Electron 中的 IME
    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
      // 如果文字已输入到 webview，不允许编辑
      if (textInserted) {
        return
      }

      const newValue = e.target.value
      setMessage(newValue)
      // 不再调整高度，使用 CSS 固定高度 + overflow: auto
    }

    // 取消操作
    const handleCancel = async (): Promise<void> => {
      setTextInserted(false)

      await clearInputToAll()

      // 输入框重新获得焦点
      textareaRef.current?.focus()

      showNotification('info', '已取消，可以继续编辑')
    }

    // 处理文件选择和上传
    const handleFileSelect = async (): Promise<void> => {
      if (!window.api?.selectFile || !window.api?.getFileInfo) {
        showNotification('error', 'API 不可用')
        return
      }

      // 选择文件
      const filePath = await window.api.selectFile()
      if (!filePath) return

      showNotification('info', '正在获取文件信息...')

      const infoResult = await window.api.getFileInfo(filePath)
      if (!infoResult.success || !infoResult.data) {
        showNotification('error', `获取文件信息失败: ${infoResult.error}`)
        return
      }

      const fileData = infoResult.data
      showNotification('info', `正在上传 ${fileData.fileName} 到所有模型...`)

      // 上传到所有模型
      const results = await uploadFileToAll(fileData)
      console.warn('[Upload] uploadFileToAll results:', results)

      // 统计结果
      const successCount = results.filter(r => r.success).length
      const failCount = results.filter(r => !r.success).length

      if (failCount === 0) {
        showNotification('success', `文件已上传到 ${successCount} 个模型`)
      } else if (successCount === 0) {
        const failed = results
          .filter(r => !r.success)
          .map(r => {
            const name = models.find(m => m.id === r.modelId)?.name || r.modelId
            const err = (r.error || '').toString().slice(0, 120)
            return err ? `${name}: ${err}` : name
          })
          .join(' | ')
        showNotification('error', failed ? `所有模型上传失败：${failed}` : '所有模型上传失败')
      } else {
        const failedModels = results
          .filter(r => !r.success)
          .map(r => models.find(m => m.id === r.modelId)?.name || r.modelId)
          .join(', ')
        showNotification('info', `${successCount} 个成功，${failCount} 个失败 (${failedModels})`)
      }
    }

    // 开启新对话
    const handleNewChat = async (): Promise<void> => {
      if (isNewChatLoading) return
      const { setNewSession } = useAppStore.getState()
      setMessage('')
      setTextInserted(false)
      setDeepResearch(false) // 重置深度研究状态
      setImageGeneration(false) // 重置 AI 生图状态
      setNewSession(true) // 显式标记开启新会话
      const uniqueRefs = Array.from(new Set(webviewRefs.values()))
      if (uniqueRefs.length === 0) {
        showNotification('error', '未找到可用的模型窗口')
        return
      }
      setIsNewChatLoading(true)
      showNotification('info', '正在重新加载模型的初始页面...')
      try {
        const results = await Promise.all(uniqueRefs.map(ref => ref.resetToInitial()))
        const successCount = results.filter(r => r.success).length
        const failCount = results.length - successCount
        if (failCount === 0) {
          showNotification('success', `已重新加载 ${successCount} 个模型初始页面`)
        } else if (successCount === 0) {
          showNotification('error', '所有模型重新加载失败')
        } else {
          showNotification('info', `${successCount} 个成功，${failCount} 个失败`)
        }
      } catch (error) {
        showNotification('error', '重新加载时发生错误')
      } finally {
        setIsNewChatLoading(false)
      }
    }

    return (
      <footer className="mt-0 flex flex-col gap-4 w-full">
        {/* 控制栏主体 */}
        <div className="relative flex items-center gap-6">
          {/* 左侧：功能按钮 */}
          <div className="flex items-center gap-6">
            {/* 新对话按钮 */}
            <button
              onClick={handleNewChat}
              disabled={isNewChatLoading}
              className="flex flex-col items-center justify-center gap-2 text-xs font-medium text-text-secondary hover:text-primary group transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="flex items-center justify-center w-10 h-10 glass-panel shadow-soft rounded-full group-hover:bg-blue-50/50 group-hover:text-primary border border-transparent group-hover:border-blue-200 transition-all duration-200">
                <span className={`material-symbols-outlined text-2xl ${isNewChatLoading ? 'animate-spin' : ''}`}>{isNewChatLoading ? 'sync' : 'add'}</span>
              </span>
              开启新对话
            </button>

            {/* 深度研究切换 */}
            <button
              onClick={async () => {
                if (isDeepResearch) {
                  setIsCancellingResearch(true)
                  showNotification('info', '正在关闭深度研究模式...')
                  try {
                    const results = await disableDeepResearchForAll()
                    const actionableResults = results.filter(r => r.error !== DEEP_RESEARCH_UNSUPPORTED_ERROR)
                    if (actionableResults.length === 0) {
                      setDeepResearch(false)
                      showNotification('info', '当前页面模型不支持深度研究，无需关闭')
                      return
                    }
                    const successCount = results.filter(r => r.success).length
                    if (successCount > 0) {
                      setDeepResearch(false)
                      showNotification('success', `已在 ${successCount} 个模型中关闭深度研究`)
                    } else {
                      // 关闭失败时，也将按钮状态置为 false，让用户可以重新点击
                      setDeepResearch(false)
                      showNotification('info', '未检测到取消按钮，已手动关闭')
                    }
                  } catch (error) {
                    console.error('关闭深度研究失败:', error)
                    // 发生错误时，也重置按钮状态，让用户可以重新尝试
                    setDeepResearch(false)
                    showNotification('error', '关闭深度研究模式时发生错误')
                  } finally {
                    setIsCancellingResearch(false)
                  }
                  return
                }

                // 如果当前是关闭状态，点击则开启
                // 1. 设置为“正在激活”状态，并禁用按钮防止重复点击
                setIsActivatingResearch(true)
                showNotification('info', '正在启用深度研究模式...')

                try {
                  // 2. 尝试在各 webview 中激活
                  const results = await enableDeepResearchForAll()
                  const actionableResults = results.filter(r => r.error !== DEEP_RESEARCH_UNSUPPORTED_ERROR)
                  if (actionableResults.length === 0) {
                    setDeepResearch(false)
                    showNotification('info', '当前页面模型不支持深度研究')
                    return
                  }
                  const successCount = results.filter(r => r.success).length

                  // 3. 只有当至少一个模型成功激活时，才将状态置为 true 并高亮按钮
                  if (successCount > 0) {
                    setDeepResearch(true)
                    showNotification('success', `已在 ${successCount} 个模型中启用深度研究`)
                  } else {
                    // 如果全部失败，保持关闭状态
                    setDeepResearch(false)
                    showNotification('info', '未能自动开启深度研究，请手动操作')
                  }
                } catch (error) {
                  console.error('开启深度研究失败:', error)
                  showNotification('error', '开启深度研究模式时发生错误')
                  setDeepResearch(false)
                } finally {
                  // 4. 恢复按钮可点击状态
                  setIsActivatingResearch(false)
                }
              }}
              disabled={textInserted || isSending || isActivatingResearch || isCancellingResearch}
              className="flex flex-col items-center justify-center gap-2 text-xs font-medium text-text-secondary hover:text-primary group transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span
                className={`flex items-center justify-center w-10 h-10 rounded-full border shadow-soft transition-all duration-200 ${isDeepResearch
                  ? 'bg-blue-50/80 text-primary border-blue-200 scale-105 glass-panel'
                  : isActivatingResearch
                    ? 'glass-panel border-gray-200 animate-pulse text-text-primary'
                    : 'glass-panel border-transparent group-hover:bg-blue-50/50 group-hover:text-primary group-hover:border-blue-200'
                  }`}
              >
                <span className={`material-symbols-outlined text-2xl ${(isActivatingResearch || isCancellingResearch) ? 'animate-spin' : ''}`}>
                  {(isActivatingResearch || isCancellingResearch) ? 'sync' : 'biotech'}
                </span>
              </span>
              <span className={isDeepResearch ? 'text-primary' : ''}>
                {isActivatingResearch ? '开启中...' : isCancellingResearch ? '关闭中...' : '深度研究'}
              </span>
            </button>

            {/* AI 生图切换 */}
            <button
              onClick={async () => {
                if (isImageGeneration) {
                  setIsCancellingImageGeneration(true)
                  showNotification('info', '正在关闭 AI 生图模式...')
                  try {
                    const results = await disableImageGenerationForAll()
                    const actionableResults = results.filter(r => r.error !== IMAGE_GENERATION_UNSUPPORTED_ERROR)
                    if (actionableResults.length === 0) {
                      setImageGeneration(false)
                      showNotification('info', '当前页面模型不支持 AI 生图，无需关闭')
                      return
                    }
                    const successCount = results.filter(r => r.success).length
                    if (successCount > 0) {
                      setImageGeneration(false)
                      showNotification('success', `已在 ${successCount} 个模型中关闭 AI 生图`)
                    } else {
                      setImageGeneration(false)
                      showNotification('info', '未检测到取消按钮，已手动关闭')
                    }
                  } catch (error) {
                    console.error('关闭 AI 生图失败:', error)
                    setImageGeneration(false)
                    showNotification('error', '关闭 AI 生图模式时发生错误')
                  } finally {
                    setIsCancellingImageGeneration(false)
                  }
                  return
                }

                setIsActivatingImageGeneration(true)
                showNotification('info', '正在启用 AI 生图模式...')

                try {
                  const results = await enableImageGenerationForAll()
                  const actionableResults = results.filter(r => r.error !== IMAGE_GENERATION_UNSUPPORTED_ERROR)
                  if (actionableResults.length === 0) {
                    setImageGeneration(false)
                    showNotification('info', '当前页面模型不支持 AI 生图')
                    return
                  }
                  const successCount = results.filter(r => r.success).length

                  if (successCount > 0) {
                    setImageGeneration(true)
                    showNotification('success', `已在 ${successCount} 个模型中启用 AI 生图`)
                  } else {
                    setImageGeneration(false)
                    showNotification('info', '未能自动开启 AI 生图，请手动操作')
                  }
                } catch (error) {
                  console.error('开启 AI 生图失败:', error)
                  showNotification('error', '开启 AI 生图模式时发生错误')
                  setImageGeneration(false)
                } finally {
                  setIsActivatingImageGeneration(false)
                }
              }}
              disabled={textInserted || isSending || isActivatingImageGeneration || isCancellingImageGeneration}
              className="flex flex-col items-center justify-center gap-2 text-xs font-medium text-text-secondary hover:text-text-primary group transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span
                className={`flex items-center justify-center w-10 h-10 rounded-full border shadow-soft transition-all duration-200 ${isImageGeneration
                  ? 'bg-purple-500/10 text-purple-400 border-purple-500/50 shadow-[0_0_12px_rgba(168,85,247,0.3)] scale-105 glass-panel'
                  : isActivatingImageGeneration
                    ? 'glass-panel border-purple-500/30 animate-pulse text-text-secondary'
                    : 'glass-panel border-transparent group-hover:bg-purple-500/10 group-hover:text-purple-400 group-hover:border-purple-500/50'
                  }`}
              >
                <span className={`material-symbols-outlined text-2xl ${(isActivatingImageGeneration || isCancellingImageGeneration) ? 'animate-spin' : ''}`}>
                  {(isActivatingImageGeneration || isCancellingImageGeneration) ? 'sync' : 'image'}
                </span>
              </span>
              <span className={isImageGeneration ? 'text-text-primary' : ''}>
                {isActivatingImageGeneration ? '开启中...' : isCancellingImageGeneration ? '关闭中...' : 'AI 生图'}
              </span>
            </button>
          </div>

          {/* 中间：输入框 */}
          <div
            className={`relative flex-grow flex gap-4 p-3 rounded-[24px] glass-panel-heavy shadow-float focus-within:border-gray-200 focus-within:ring-1 focus-within:ring-gray-200 ${isFileDragOver ? 'border-primary/70 ring-2 ring-primary/30 bg-blue-50/50' : ''
              } ${message.trim() && !textInserted ? 'items-start' : 'items-center'}`}
            onDragEnter={(event) => {
              if (!hasFileInDragEvent(event)) return
              event.preventDefault()
              event.stopPropagation()
              dragCounterRef.current += 1
              setIsFileDragOver(true)
            }}
            onDragOver={(event) => {
              if (!hasFileInDragEvent(event)) return
              event.preventDefault()
              event.stopPropagation()
              setIsFileDragOver(true)
            }}
            onDragLeave={(event) => {
              if (!hasFileInDragEvent(event)) return
              event.preventDefault()
              event.stopPropagation()
              dragCounterRef.current -= 1
              if (dragCounterRef.current <= 0) {
                dragCounterRef.current = 0
                setIsFileDragOver(false)
              }
            }}
            onDrop={handleFileDrop}
          >
            {/* 通知弹窗 - 在输入框上方居中显示 */}
            {notification && (
              <div className={`absolute bottom-full left-1/2 transform -translate-x-1/2 mb-3 px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 shadow-float z-50 notification-popup backdrop-blur-md transition-all ${notification.type === 'success'
                ? 'bg-white/90 border border-green-200 text-green-700'
                : notification.type === 'error'
                  ? 'bg-white/90 border border-red-200 text-red-700'
                  : 'bg-white/90 border border-blue-200 text-blue-700'
                }`}>
                <span className={`material-symbols-outlined text-base flex-shrink-0 ${
                  notification.type === 'success' ? 'text-green-500' :
                  notification.type === 'error' ? 'text-red-500' : 'text-blue-500'
                }`}>
                  {notification.type === 'success' ? 'check_circle' :
                    notification.type === 'error' ? 'error' : 'info'}
                </span>
                <span className="whitespace-nowrap">{notification.message}</span>
              </div>
            )}
            {/* 附件按钮 */}
            <button
              onClick={handleFileSelect}
              disabled={isUploading || isSending}
              className={`transition-colors flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed self-end ${isUploading ? 'text-primary animate-pulse' : 'text-text-secondary hover:text-primary'
                }`}
              title={isUploading ? '正在上传文件...' : '上传文件'}
            >
              <span className={`material-symbols-outlined ${isUploading ? '' : '-rotate-90'}`}>
                {isUploading ? 'upload' : 'attachment'}
              </span>
            </button>

            {/* 输入框 */}
            <textarea
              ref={textareaRef}
              value={message}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={textInserted ? "文字已输入到所有模型，按 Enter 确认发送或点击取消" : "向 AI 模型提问..."}
              className={`flex-grow bg-transparent border-0 focus:ring-0 focus:outline-none text-text-primary placeholder-text-secondary p-0 resize-none disabled:cursor-not-allowed disabled:caret-transparent ${textInserted ? 'cursor-not-allowed caret-transparent' : ''
                }`}
              disabled={isSending}
              readOnly={textInserted}
              rows={1}
              tabIndex={0}
              onCompositionStart={() => {
                // 标记 IME 正在组合输入
                isComposingRef.current = true
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false
              }}
              style={{
                lineHeight: '24px',
                // 使用固定高度，禁用动态调整，解决 Electron IME 问题
                height: '72px',
                overflowY: 'auto'
              }}
            />

            {/* 取消按钮（仅在文字已输入时显示） */}
            {textInserted && (
              <button
                onClick={handleCancel}
                disabled={isSending}
                className="px-3 py-1.5 rounded-xl bg-gray-200 text-gray-600 hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm flex-shrink-0 self-end"
                title="取消发送，清空所有输入框"
              >
                取消
              </button>
            )}

            {/* 发送按钮 */}
            <button
              onClick={handleSend}
              disabled={!message.trim() || isSending}
              className={`rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0 self-end ${message.trim()
                ? textInserted
                  ? 'bg-primary text-white hover:opacity-90 px-3 py-3'
                  : 'bg-primary text-white hover:opacity-90 h-12 w-12 p-3'
                : 'h-12 w-12 bg-gray-100 hover:bg-gray-200 text-text-secondary p-3'
                }`}
              title={textInserted ? '点击发送消息' : message.trim() ? '点击输入文字到所有模型' : '输入消息后点击发送'}
            >
              {isSending ? (
                <span className="material-symbols-outlined">hourglass_empty</span>
              ) : textInserted ? (
                <span className="flex items-center gap-1.5 text-sm font-bold">
                  <span className="material-symbols-outlined">arrow_upward</span>
                  <span>确认发送</span>
                </span>
              ) : (
                <span className="material-symbols-outlined">arrow_upward</span>
              )}
            </button>
          </div>

          {/* 右侧：生成总结报告按钮 */}
          <button
            onClick={onGenerateReport}
            className="flex-shrink-0 px-4 py-2 text-sm font-bold rounded-[24px] bg-primary text-white hover:opacity-90 shadow-soft transition-opacity whitespace-nowrap flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-xl">auto_awesome</span>
            生成总结
          </button>
        </div>
      </footer>
    )
  })

export default ControlBar
