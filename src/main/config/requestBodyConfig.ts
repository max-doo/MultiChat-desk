/**
 * 请求体配置模块
 * 根据不同供应商和模型构建适配的 API 请求体
 */

export interface RequestBodyConfigParams {
  model: string
  messages: Array<{ role: string; content: string }>
  temperature?: number
  topP?: number
  maxTokens?: number
  includeReasoning?: boolean
  baseUrl?: string
  /**
   * 是否流式输出。默认 true（总结链路）。
   * 任务拆解等一次性 JSON 解析场景需传 false，避免供应商网关对非流式请求路由差异导致的 Model Not Found。
   */
  stream?: boolean
}

/**
 * 构建 API 请求体
 * 根据供应商和模型自动适配思考过程参数
 */
export function buildRequestBody(params: RequestBodyConfigParams): Record<string, unknown> {
  const requestBody: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    temperature: params.temperature ?? 0.7,
    top_p: params.topP ?? 1,
    max_tokens: params.maxTokens ?? 4000,
    stream: params.stream ?? true  // 默认流式；任务拆解等一次性场景传 false 覆盖
  }

  // 根据供应商和模型添加思考过程相关参数
  if (params.includeReasoning) {
    applyReasoningConfig(requestBody, params.model, params.baseUrl)
  }

  return requestBody
}

/**
 * 应用思考过程配置
 * 根据不同供应商和模型添加相应的思考参数
 */
function applyReasoningConfig(
  requestBody: Record<string, unknown>,
  model: string,
  baseUrl?: string
): void {
  const modelLower = model.toLowerCase()
  const baseUrlLower = (baseUrl || '').toLowerCase()

  // 判断是否为 Gemini API（Google 官方 API）
  const isGeminiApi = baseUrlLower.includes('generativelanguage.googleapis.com') ||
                     baseUrlLower.includes('googleapis.com')
  const isGeminiModel = modelLower.includes('gemini')

  // Google Gemini API 支持
  // 官方文档: https://ai.google.dev/gemini-api/docs/openai
  // 注意：reasoning_effort 和 thinking_config 不能同时使用
  // 使用 thinking_config 可以同时控制思考深度并获取思考内容
  if (isGeminiApi || isGeminiModel) {
    // 通过 extra_body 传递 Gemini 特有配置
    // thinking_budget: 整数，表示思考 token 数量
    //   - Gemini 2.5 Flash: 0-24576，Gemini 2.5 Pro: 128-32768
    //   - -1 表示动态思考（模型自动调整）
    // include_thoughts: true 获取思考内容
    requestBody.extra_body = {
      google: {
        thinking_config: {
          thinking_budget: -1,  // 动态思考，让模型自动决定
          include_thoughts: true
        }
      }
    }
    console.log('[Summary API] 检测到 Gemini 模型，启用 thinking_config: thinking_budget=-1(动态), include_thoughts=true')
    return
  }

  // 阿里云百炼 (DashScope) 支持
  // 官方文档: https://help.aliyun.com/zh/model-studio/deep-thinking
  // Qwen3 系列混合思考模式需要 enable_thinking: true
  // 思考内容通过 reasoning_content 字段返回
  if (baseUrlLower.includes('dashscope') || baseUrlLower.includes('aliyuncs')) {
    requestBody.enable_thinking = true
    console.log('[Summary API] 检测到阿里云百炼，启用 enable_thinking')
    return
  }

  // DeepSeek 模型 - 直接支持 reasoning_content，无需额外参数
  // 但某些 API 代理可能需要显式开启
  if (modelLower.includes('deepseek') || modelLower.includes('r1')) {
    // 部分供应商使用 enable_thinking
    requestBody.enable_thinking = true
    console.log('[Summary API] 检测到 DeepSeek/R1 模型，启用 enable_thinking')
    return
  }

  // Qwen/通义千问 模型（非阿里云官方 API 时）
  if (modelLower.includes('qwen') || modelLower.includes('qwq')) {
    requestBody.enable_thinking = true
    console.log('[Summary API] 检测到 Qwen/QwQ 模型，启用 enable_thinking')
    return
  }

  // OpenRouter 支持
  if (baseUrlLower.includes('openrouter')) {
    requestBody.include_reasoning = true
    // OpenRouter 的一些模型可能需要 provider 配置
    requestBody.provider = {
      allow_fallbacks: false,
      require_parameters: true
    }
    console.log('[Summary API] 检测到 OpenRouter，启用 include_reasoning')
    return
  }

  // 硅基流动 (SiliconFlow) 支持
  if (baseUrlLower.includes('siliconflow')) {
    requestBody.enable_thinking = true
    console.log('[Summary API] 检测到 SiliconFlow，启用 enable_thinking')
    return
  }

  // 其他未知供应商：尝试通用参数 enable_thinking
  requestBody.enable_thinking = true
  console.log('[Summary API] 未知供应商，尝试启用 enable_thinking')
}

