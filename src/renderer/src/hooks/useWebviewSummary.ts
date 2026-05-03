import { useRef, useState, useCallback } from 'react'
import type { WebviewCardRef } from '../components/WebviewCard'
import type { ChatMessage } from '../types/summary'

const POLL_INTERVAL_MS = 600
const STREAM_IDLE_TIMEOUT_MS = 4000
const STREAM_HARD_TIMEOUT_MS = 5 * 60 * 1000
const PAGE_READY_BUFFER_MS = 800
const FILE_UPLOAD_THRESHOLD = 8000  // 字符阈值，超过则使用文件上传

export type WebviewSummaryPhase =
  | 'idle'
  | 'loading-page'
  | 'uploading-file'
  | 'sending'
  | 'streaming'
  | 'done'
  | 'aborted'
  | 'error'

interface UseWebviewSummaryParams {
  webviewRef: React.RefObject<WebviewCardRef>
  buildPrompt: () => string
  onAssistantMessage: (msg: ChatMessage) => void
}

interface UseWebviewSummaryReturn {
  phase: WebviewSummaryPhase
  isGenerating: boolean
  streamingContent: string
  error: string | null
  startSummary: () => Promise<void>
  abortSummary: () => void
}

export function useWebviewSummary({
  webviewRef,
  buildPrompt,
  onAssistantMessage
}: UseWebviewSummaryParams): UseWebviewSummaryReturn {
  const [phase, setPhase] = useState<WebviewSummaryPhase>('idle')
  const [streamingContent, setStreamingContent] = useState('')
  const [error, setError] = useState<string | null>(null)

  const intervalRef = useRef<number | null>(null)
  const lastTextRef = useRef('')
  const lastChangeAtRef = useRef(0)
  const startedAtRef = useRef(0)
  const consecutiveFailsRef = useRef(0)
  const abortedRef = useRef(false)
  const isRunningRef = useRef(false)

  const onAssistantMessageRef = useRef(onAssistantMessage)
  onAssistantMessageRef.current = onAssistantMessage
  const buildPromptRef = useRef(buildPrompt)
  buildPromptRef.current = buildPrompt

  const cleanupPolling = () => {
    if (intervalRef.current !== null) {
      clearTimeout(intervalRef.current)
      intervalRef.current = null
    }
  }

  const finish = useCallback((kind: 'done' | 'aborted') => {
    cleanupPolling()
    isRunningRef.current = false
    const finalText = lastTextRef.current
    if (finalText && kind === 'done') {
      const timestamp = Date.now()
      onAssistantMessageRef.current({
        id: `webview-${timestamp}-${Math.random().toString(36).slice(2, 9)}`,
        role: 'assistant',
        content: finalText,
        timestamp,
        versions: [
          {
            content: finalText,
            timestamp,
            modelId: 'webview',
            modelName: 'Webview'
          }
        ],
        currentVersionIndex: 0
      })
    }
    setPhase(kind)
  }, [])

  const scheduleNextPoll = useCallback((ref: WebviewCardRef) => {
    intervalRef.current = window.setTimeout(async () => {
      if (!isRunningRef.current) return
      const now = Date.now()
      try {
        const result = await ref.getLatestResponse()
        const current = (result?.content || '').trim()
        if (current && current !== lastTextRef.current) {
          if (
            current.length >= lastTextRef.current.length &&
            current.startsWith(lastTextRef.current)
          ) {
            // 增量追加
          } else {
            // 整段重写（少数平台会中途回填整段）
          }
          lastTextRef.current = current
          setStreamingContent(current)
          lastChangeAtRef.current = now
          consecutiveFailsRef.current = 0
        }
      } catch (e) {
        consecutiveFailsRef.current += 1
        if (consecutiveFailsRef.current >= 5) {
          cleanupPolling()
          isRunningRef.current = false
          setPhase('error')
          setError('无法读取回复内容，请确认是否已登录该平台')
          return
        }
      }

      if (
        lastTextRef.current &&
        now - lastChangeAtRef.current > STREAM_IDLE_TIMEOUT_MS
      ) {
        finish('done')
        return
      }
      if (now - startedAtRef.current > STREAM_HARD_TIMEOUT_MS) {
        finish('done')
        return
      }
      scheduleNextPoll(ref)
    }, POLL_INTERVAL_MS)
  }, [finish])

  const sendViaFileUpload = async (ref: WebviewCardRef, promptText: string): Promise<{ success: boolean; error?: string }> => {
    // 将提示词包装为 markdown 文件内容
    const markdownContent = `# ModelMash 模型回答汇总\n\n${promptText}`

    // 写入临时文件
    let filePath: string
    try {
      const writeResult = await window.api.writeTempMarkdown({ content: markdownContent })
      if (!writeResult.success || !writeResult.filePath) {
        return { success: false, error: writeResult.error || '写入临时文件失败' }
      }
      filePath = writeResult.filePath
    } catch (e) {
      return { success: false, error: `写入临时文件异常: ${String(e)}` }
    }

    // 获取文件信息
    let fileData: { filePath: string; fileName: string; mimeType: string; size: number }
    try {
      const infoResult = await window.api.getFileInfo(filePath)
      if (!infoResult.success || !infoResult.data) {
        return { success: false, error: infoResult.error || '获取文件信息失败' }
      }
      fileData = infoResult.data
    } catch (e) {
      return { success: false, error: `获取文件信息异常: ${String(e)}` }
    }

    // 上传文件到 webview
    setPhase('uploading-file')
    const uploadResult = await ref.uploadFile(fileData)
    if (!uploadResult.success) {
      return { success: false, error: uploadResult.error || '文件上传失败' }
    }

    // 上传成功后，发送分析指令
    const instruction = '请分析附件中的内容，按照其中的系统指令要求生成总结报告。'
    return await ref.sendMessage(instruction)
  }

  const startSummary = useCallback(async () => {
    if (isRunningRef.current) return
    isRunningRef.current = true
    setError(null)
    setStreamingContent('')
    lastTextRef.current = ''
    lastChangeAtRef.current = 0
    consecutiveFailsRef.current = 0
    abortedRef.current = false
    setPhase('loading-page')

    const ref = webviewRef.current
    if (!ref) {
      isRunningRef.current = false
      setPhase('error')
      setError('webview ref 未就绪')
      return
    }

    await new Promise((r) => setTimeout(r, PAGE_READY_BUFFER_MS))
    if (abortedRef.current) {
      isRunningRef.current = false
      return
    }

    const prompt = buildPromptRef.current()
    const promptLength = prompt.length

    // 长文本：使用文件上传模式
    if (promptLength >= FILE_UPLOAD_THRESHOLD) {
      console.log(`[useWebviewSummary] 提示词长度 ${promptLength} >= 阈值 ${FILE_UPLOAD_THRESHOLD}，使用文件上传模式`)
      let sendResult: { success: boolean; error?: string }
      try {
        sendResult = await sendViaFileUpload(ref, prompt)
      } catch (e) {
        isRunningRef.current = false
        setPhase('error')
        setError((e as Error)?.message || '文件上传发送失败')
        return
      }
      if (!sendResult.success) {
        // 文件上传失败时，降级到直接粘贴
        console.warn(`[useWebviewSummary] 文件上传失败: ${sendResult.error}，降级到直接粘贴`)
        try {
          sendResult = await ref.sendMessage(prompt)
        } catch (e) {
          isRunningRef.current = false
          setPhase('error')
          setError((e as Error)?.message || '发送失败')
          return
        }
      }
      if (!sendResult.success) {
        isRunningRef.current = false
        setPhase('error')
        setError(sendResult.error || '发送失败')
        return
      }
      if (abortedRef.current) {
        isRunningRef.current = false
        return
      }

      setPhase('streaming')
      startedAtRef.current = Date.now()
      lastChangeAtRef.current = Date.now()
      scheduleNextPoll(ref)
      return
    }

    // 短文本：直接粘贴（原有逻辑）
    console.log(`[useWebviewSummary] 提示词长度 ${promptLength} < 阈值 ${FILE_UPLOAD_THRESHOLD}，使用直接粘贴模式`)
    setPhase('sending')
    let sendResult: { success: boolean; error?: string }
    try {
      sendResult = await ref.sendMessage(prompt)
    } catch (e) {
      isRunningRef.current = false
      setPhase('error')
      setError((e as Error)?.message || '发送失败')
      return
    }
    if (!sendResult.success) {
      isRunningRef.current = false
      setPhase('error')
      setError(sendResult.error || '发送失败')
      return
    }
    if (abortedRef.current) {
      isRunningRef.current = false
      return
    }

    setPhase('streaming')
    startedAtRef.current = Date.now()
    lastChangeAtRef.current = Date.now()
    scheduleNextPoll(ref)
  }, [webviewRef, scheduleNextPoll])

  const abortSummary = useCallback(() => {
    if (!isRunningRef.current) return
    abortedRef.current = true
    cleanupPolling()
    isRunningRef.current = false
    setPhase('aborted')
  }, [])

  const isGenerating =
    phase === 'loading-page' || phase === 'uploading-file' || phase === 'sending' || phase === 'streaming'

  return { phase, isGenerating, streamingContent, error, startSummary, abortSummary }
}
