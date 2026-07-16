import { useRef, useState, useCallback } from 'react'
import type { WebviewCardRef } from '../components/WebviewCard'

const PAGE_READY_BUFFER_MS = 800
const FILE_UPLOAD_THRESHOLD = 8000 // 字符阈值，超过则使用文件上传

export type WebviewSummaryPhase =
  | 'idle'
  | 'loading-page'
  | 'uploading-file'
  | 'injecting'
  | 'done'
  | 'aborted'
  | 'error'

interface UseWebviewSummaryParams {
  webviewRef: React.RefObject<WebviewCardRef>
  buildPrompt: () => string
}

interface UseWebviewSummaryReturn {
  phase: WebviewSummaryPhase
  isGenerating: boolean
  error: string | null
  startSummary: () => Promise<void>
  abortSummary: () => void
}

/**
 * 总结页 Webview 模式：把总结提示词注入平台输入框，不自动点击平台发送按钮。
 * 长文本仍会先生成 Markdown 并上传为附件，随后只注入附件分析指令。
 */
export function useWebviewSummary({
  webviewRef,
  buildPrompt
}: UseWebviewSummaryParams): UseWebviewSummaryReturn {
  const [phase, setPhase] = useState<WebviewSummaryPhase>('idle')
  const [error, setError] = useState<string | null>(null)

  const abortedRef = useRef(false)
  const isRunningRef = useRef(false)
  const buildPromptRef = useRef(buildPrompt)
  buildPromptRef.current = buildPrompt

  const uploadAndInject = async (
    ref: WebviewCardRef,
    promptText: string
  ): Promise<{ success: boolean; error?: string }> => {
    // 拆分系统指令、待分析内容、用户要求
    // promptText 格式：[系统指令]\n{systemPrompt}\n\n[待分析内容]\n<context>...\n\n[用户要求]\n{requirement}
    const SYSTEM_MARKER = '[系统指令]\n'
    const CONTENT_MARKER = '\n\n[待分析内容]\n'
    const REQUIREMENT_MARKER = '\n\n[用户要求]\n'
    const systemStart = promptText.indexOf(SYSTEM_MARKER)
    const contentStart = promptText.indexOf(CONTENT_MARKER)
    const requirementStart = promptText.indexOf(REQUIREMENT_MARKER)

    let systemPrompt = ''
    let modelOutputs = ''
    let userRequirement = ''

    if (systemStart === 0 && contentStart !== -1 && requirementStart !== -1) {
      systemPrompt = promptText.slice(SYSTEM_MARKER.length, contentStart)
      modelOutputs = promptText.slice(contentStart + CONTENT_MARKER.length, requirementStart)
      userRequirement = promptText.slice(requirementStart + REQUIREMENT_MARKER.length)
    } else {
      // 如果格式不匹配，fallback：全部内容放文件中，对话框只注入分析指令
      modelOutputs = promptText
    }

    const markdownContent = `# MultiChat 模型回答汇总\n\n${modelOutputs}`

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

    setPhase('uploading-file')
    const uploadResult = await ref.uploadFile(fileData)
    if (!uploadResult.success) {
      return { success: false, error: uploadResult.error || '文件上传失败' }
    }

    const parts: string[] = []
    if (systemPrompt) parts.push(systemPrompt)
    if (userRequirement) parts.push(userRequirement)
    parts.push('请分析附件中的模型回答，按照上述要求生成总结报告。')
    const instruction = parts.join('\n\n')

    if (abortedRef.current) return { success: false, error: '已终止' }
    setPhase('injecting')
    return await ref.insertText(instruction)
  }

  const startSummary = useCallback(async () => {
    if (isRunningRef.current) return

    isRunningRef.current = true
    abortedRef.current = false
    setError(null)
    setPhase('loading-page')

    const ref = webviewRef.current
    if (!ref) {
      isRunningRef.current = false
      setPhase('error')
      setError('webview ref 未就绪')
      return
    }

    await new Promise((resolve) => setTimeout(resolve, PAGE_READY_BUFFER_MS))
    if (abortedRef.current) {
      isRunningRef.current = false
      return
    }

    const prompt = buildPromptRef.current()
    let insertResult: { success: boolean; error?: string }

    if (prompt.length >= FILE_UPLOAD_THRESHOLD) {
      console.log(`[useWebviewSummary] 提示词长度 ${prompt.length} >= 阈值 ${FILE_UPLOAD_THRESHOLD}，使用文件上传模式`)
      try {
        insertResult = await uploadAndInject(ref, prompt)
      } catch (e) {
        isRunningRef.current = false
        setPhase('error')
        setError((e as Error)?.message || '文件上传或注入失败')
        return
      }

      if (!insertResult.success && !abortedRef.current) {
        // 文件上传失败时，降级到直接注入完整提示词；仍不自动发送。
        console.warn(`[useWebviewSummary] 文件上传失败: ${insertResult.error}，降级到直接注入`)
        try {
          setPhase('injecting')
          insertResult = await ref.insertText(prompt)
        } catch (e) {
          isRunningRef.current = false
          setPhase('error')
          setError((e as Error)?.message || '注入失败')
          return
        }
      }
    } else {
      console.log(`[useWebviewSummary] 提示词长度 ${prompt.length} < 阈值 ${FILE_UPLOAD_THRESHOLD}，使用直接注入模式`)
      setPhase('injecting')
      try {
        insertResult = await ref.insertText(prompt)
      } catch (e) {
        isRunningRef.current = false
        setPhase('error')
        setError((e as Error)?.message || '注入失败')
        return
      }
    }

    if (abortedRef.current) {
      isRunningRef.current = false
      return
    }
    if (!insertResult.success) {
      isRunningRef.current = false
      setPhase('error')
      setError(insertResult.error || '注入失败')
      return
    }

    isRunningRef.current = false
    setPhase('done')
  }, [webviewRef])

  const abortSummary = useCallback(() => {
    if (!isRunningRef.current) return
    abortedRef.current = true
    isRunningRef.current = false
    setPhase('aborted')
  }, [])

  const isGenerating =
    phase === 'loading-page' || phase === 'uploading-file' || phase === 'injecting'

  return { phase, isGenerating, error, startSummary, abortSummary }
}
