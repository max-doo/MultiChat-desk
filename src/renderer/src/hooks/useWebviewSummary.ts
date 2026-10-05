import { useRef, useState, useCallback } from "react"
import type { WebviewCardRef } from "../components/WebviewCard"

const PAGE_READY_BUFFER_MS = 800
const FILE_UPLOAD_THRESHOLD = 8000 // 字符阈值，超过则使用文件上传

export type WebviewSummaryPhase =
  | "idle"
  | "loading-page"
  | "uploading-file"
  | "injecting"
  | "done"
  | "aborted"
  | "error"

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
  resetUploadedDoc: () => void
}

/**
 * 从拼接的提示词中拆解系统指令、模型回答内容、用户要求与附件分析短指令
 */
function parsePromptParts(promptText: string): {
  systemPrompt: string
  modelOutputs: string
  userRequirement: string
  instruction: string
} {
  const SYSTEM_MARKER = "[系统指令]\n"
  const CONTENT_MARKER = "\n\n[待分析内容]\n"
  const REQUIREMENT_MARKER = "\n\n[用户要求]\n"
  const systemStart = promptText.indexOf(SYSTEM_MARKER)
  const contentStart = promptText.indexOf(CONTENT_MARKER)
  const requirementStart = promptText.indexOf(REQUIREMENT_MARKER)

  let systemPrompt = ""
  let modelOutputs = ""
  let userRequirement = ""

  if (systemStart === 0 && contentStart !== -1 && requirementStart !== -1) {
    systemPrompt = promptText.slice(SYSTEM_MARKER.length, contentStart)
    modelOutputs = promptText.slice(contentStart + CONTENT_MARKER.length, requirementStart)
    userRequirement = promptText.slice(requirementStart + REQUIREMENT_MARKER.length)
  } else {
    modelOutputs = promptText
  }

  const parts: string[] = []
  if (systemPrompt) parts.push(systemPrompt)
  if (userRequirement) parts.push(userRequirement)
  parts.push("请分析附件中的模型回答，按照上述要求生成总结报告。")
  const instruction = parts.join("\n\n")

  return { systemPrompt, modelOutputs, userRequirement, instruction }
}

/**
 * 总结页 Webview 模式：把总结提示词注入平台输入框，不自动点击平台发送按钮。
 * 长文本模式（>=8000字符）生成 Markdown 并上传为附件，注入分析指令。
 * 支持附件智能复用：在撤回或修改提示词时，若底层模型数据未变，跳过重复上传文件。
 */
export function useWebviewSummary({
  webviewRef,
  buildPrompt
}: UseWebviewSummaryParams): UseWebviewSummaryReturn {
  const [phase, setPhase] = useState<WebviewSummaryPhase>("idle")
  const [error, setError] = useState<string | null>(null)

  const abortedRef = useRef(false)
  const isRunningRef = useRef(false)
  const buildPromptRef = useRef(buildPrompt)
  buildPromptRef.current = buildPrompt

  // 记录当前页面上已成功挂载的文件模型内容指纹（modelOutputs 文本）
  const uploadedOutputsRef = useRef<string | null>(null)

  const resetUploadedDoc = useCallback(() => {
    uploadedOutputsRef.current = null
  }, [])

  const uploadAndInject = async (
    ref: WebviewCardRef,
    modelOutputs: string,
    instruction: string
  ): Promise<{ success: boolean; error?: string }> => {
    const markdownContent = `# MultiChat 模型回答汇总\n\n${modelOutputs}`

    let filePath: string
    try {
      const writeResult = await window.api.writeTempMarkdown({ content: markdownContent })
      if (!writeResult.success || !writeResult.filePath) {
        return { success: false, error: writeResult.error || "写入临时文件失败" }
      }
      filePath = writeResult.filePath
    } catch (e) {
      return { success: false, error: `写入临时文件异常: ${String(e)}` }
    }

    let fileData: { filePath: string; fileName: string; mimeType: string; size: number }
    try {
      const infoResult = await window.api.getFileInfo(filePath)
      if (!infoResult.success || !infoResult.data) {
        return { success: false, error: infoResult.error || "获取文件信息失败" }
      }
      fileData = infoResult.data
    } catch (e) {
      return { success: false, error: `获取文件信息异常: ${String(e)}` }
    }

    setPhase("uploading-file")
    const uploadResult = await ref.uploadFile(fileData)
    if (!uploadResult.success) {
      return { success: false, error: uploadResult.error || "文件上传失败" }
    }

    if (abortedRef.current) return { success: false, error: "已终止" }
    setPhase("injecting")
    return await ref.insertText(instruction)
  }

  const startSummary = useCallback(async () => {
    if (isRunningRef.current) return

    isRunningRef.current = true
    abortedRef.current = false
    setError(null)
    setPhase("loading-page")

    const ref = webviewRef.current
    if (!ref) {
      isRunningRef.current = false
      setPhase("error")
      setError("webview ref 未就绪")
      return
    }

    const prompt = buildPromptRef.current()
    const isAttachmentMode = prompt.length >= FILE_UPLOAD_THRESHOLD

    if (isAttachmentMode) {
      const { modelOutputs, instruction } = parsePromptParts(prompt)
      const alreadyUploaded = uploadedOutputsRef.current !== null
      const outputsUnchanged = uploadedOutputsRef.current === modelOutputs

      // 场景 1：当前页面已成功挂载相同文档（撤回后仅修改提示词/模式），直接复用页面已有附件，绝不重复上传
      if (alreadyUploaded && outputsUnchanged) {
        console.log("[useWebviewSummary] 检测到当前页面已存在相同模型文档，复用已有附件，仅重新注入指令")
        setPhase("injecting")
        const insertResult = await ref.insertText(instruction)
        if (abortedRef.current) {
          isRunningRef.current = false
          return
        }
        if (!insertResult.success) {
          isRunningRef.current = false
          setPhase("error")
          setError(insertResult.error || "注入失败")
          return
        }
        isRunningRef.current = false
        setPhase("done")
        return
      }

      // 场景 2：当前页面挂着旧文档，但模型内容发生改变（用户增减了选中的模型），先重置页面清空旧附件
      if (alreadyUploaded && !outputsUnchanged) {
        console.log("[useWebviewSummary] 检测到模型回答内容已改变，重置页面以清空旧附件")
        uploadedOutputsRef.current = null
        await ref.resetToInitial()
        await new Promise((resolve) => setTimeout(resolve, PAGE_READY_BUFFER_MS))
        if (abortedRef.current) {
          isRunningRef.current = false
          return
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, PAGE_READY_BUFFER_MS))
        if (abortedRef.current) {
          isRunningRef.current = false
          return
        }
      }

      // 场景 3：当前页面无附件，执行生成 Markdown 并上传
      console.log(`[useWebviewSummary] 提示词长度 ${prompt.length} >= 阈值 ${FILE_UPLOAD_THRESHOLD}，生成并上传附件`)
      try {
        const insertResult = await uploadAndInject(ref, modelOutputs, instruction)
        if (insertResult.success) {
          uploadedOutputsRef.current = modelOutputs
        } else if (!abortedRef.current) {
          // 文件上传失败时，降级到直接注入完整提示词；仍不自动发送
          console.warn(`[useWebviewSummary] 文件上传失败: ${insertResult.error}，降级到直接注入`)
          setPhase("injecting")
          const directResult = await ref.insertText(prompt)
          if (directResult.success) {
            uploadedOutputsRef.current = null
          }
        }
      } catch (e) {
        isRunningRef.current = false
        setPhase("error")
        setError((e as Error)?.message || "文件上传或注入失败")
        return
      }
    } else {
      // 纯文本模式（< 8000 字符）
      // 若当前页面之前挂载了附件，先重置页面清空残留附件
      if (uploadedOutputsRef.current !== null) {
        console.log("[useWebviewSummary] 纯文本模式：检测到页面存在旧附件残留，重置页面以清空附件")
        uploadedOutputsRef.current = null
        await ref.resetToInitial()
        await new Promise((resolve) => setTimeout(resolve, PAGE_READY_BUFFER_MS))
        if (abortedRef.current) {
          isRunningRef.current = false
          return
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, PAGE_READY_BUFFER_MS))
        if (abortedRef.current) {
          isRunningRef.current = false
          return
        }
      }

      console.log(`[useWebviewSummary] 提示词长度 ${prompt.length} < 阈值 ${FILE_UPLOAD_THRESHOLD}，使用直接注入模式`)
      setPhase("injecting")
      try {
        const insertResult = await ref.insertText(prompt)
        if (abortedRef.current) {
          isRunningRef.current = false
          return
        }
        if (!insertResult.success) {
          isRunningRef.current = false
          setPhase("error")
          setError(insertResult.error || "注入失败")
          return
        }
      } catch (e) {
        isRunningRef.current = false
        setPhase("error")
        setError((e as Error)?.message || "注入失败")
        return
      }
    }

    if (abortedRef.current) {
      isRunningRef.current = false
      return
    }

    isRunningRef.current = false
    setPhase("done")
  }, [webviewRef])

  const abortSummary = useCallback(() => {
    if (!isRunningRef.current) return
    abortedRef.current = true
    isRunningRef.current = false
    setPhase("aborted")
  }, [])

  const isGenerating =
    phase === "loading-page" || phase === "uploading-file" || phase === "injecting"

  return { phase, isGenerating, error, startSummary, abortSummary, resetUploadedDoc }
}
