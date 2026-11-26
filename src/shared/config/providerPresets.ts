import type { AgentGatewayApiType } from '../types/agentRuntime'

export type ProviderPresetCategory = 'relay' | 'domestic' | 'official' | 'local'

export interface ProviderPreset {
  id: string
  name: string
  category: ProviderPresetCategory
  description: string
  defaultBaseUrl: string
  defaultApi: AgentGatewayApiType
  requiresKey: boolean
  baseUrlPlaceholder?: string
  keyPlaceholder?: string
  keysUrl?: string
  /** Built-in provider id if this preset maps to an existing pi-ai provider. */
  builtinProviderId?: string
  /** Optional known balance endpoint template when user creates a custom gateway from it. */
  balanceHint?: string
}

export const PROVIDER_PRESET_CATEGORIES: Array<{
  id: ProviderPresetCategory
  label: string
}> = [
  { id: 'relay', label: '中转与聚合网关' },
  { id: 'domestic', label: '国内直连 / 套餐' },
  { id: 'official', label: '通用兼容协议' },
  { id: 'local', label: '本地模型服务' }
]

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'newapi-relay',
    name: 'New-API / One-API 中转',
    category: 'relay',
    description: '兼容主流中转站，自动识别模型与 Token 余额',
    defaultBaseUrl: 'https://your-relay.com/v1',
    defaultApi: 'openai-completions',
    requiresKey: true,
    baseUrlPlaceholder: 'https://your-relay.com/v1',
    keyPlaceholder: 'sk-...',
    balanceHint: '自动探测 /api/usage/token 与 /v1/usage'
  },
  {
    id: 'sub2api-relay',
    name: 'Sub2API 订阅中转',
    category: 'relay',
    description: '支持 5 小时 / 7 天限额窗口与剩余美元探测',
    defaultBaseUrl: 'https://your-sub2api.com/v1',
    defaultApi: 'openai-responses',
    requiresKey: true,
    baseUrlPlaceholder: 'https://your-sub2api.com/v1',
    keyPlaceholder: 'sk-...',
    balanceHint: '自动探测 /v1/usage 订阅窗口与余额'
  },
  {
    id: 'openrouter-custom',
    name: 'OpenRouter（自定义）',
    category: 'relay',
    description: '多厂商聚合平台，支持按量余额查询',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultApi: 'openai-completions',
    requiresKey: true,
    keyPlaceholder: 'sk-or-v1-...',
    keysUrl: 'https://openrouter.ai/settings/keys',
    builtinProviderId: 'openrouter'
  },
  {
    id: 'siliconflow',
    name: '硅基流动 (SiliconFlow)',
    category: 'relay',
    description: '国内高速模型聚合推理平台',
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    defaultApi: 'openai-completions',
    requiresKey: true,
    keyPlaceholder: 'sk-...',
    keysUrl: 'https://cloud.siliconflow.cn/account/ak'
  },
  {
    id: 'aihubmix',
    name: 'AiHubMix',
    category: 'relay',
    description: '一站式多模型中转与余额查询',
    defaultBaseUrl: 'https://aihubmix.com/v1',
    defaultApi: 'openai-completions',
    requiresKey: true,
    keyPlaceholder: 'sk-...',
    keysUrl: 'https://aihubmix.com/token'
  },
  {
    id: 'deepseek-custom',
    name: 'DeepSeek',
    category: 'domestic',
    description: 'DeepSeek 官方 API，支持余额明细查询',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultApi: 'openai-completions',
    requiresKey: true,
    keyPlaceholder: 'sk-...',
    keysUrl: 'https://platform.deepseek.com/api_keys',
    builtinProviderId: 'deepseek'
  },
  {
    id: 'zhipu-coding',
    name: '智谱 GLM Coding Plan',
    category: 'domestic',
    description: '智谱包月编程套餐，支持 5h/7d 与 MCP 用量查询',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    defaultApi: 'openai-completions',
    requiresKey: true,
    keyPlaceholder: '智谱 API Key',
    keysUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys'
  },
  {
    id: 'moonshot-custom',
    name: 'Kimi (Moonshot)',
    category: 'domestic',
    description: '月之暗面官方 API，支持账户余额查询',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    defaultApi: 'openai-completions',
    requiresKey: true,
    keyPlaceholder: 'sk-...',
    keysUrl: 'https://platform.moonshot.cn/console/api-keys',
    builtinProviderId: 'moonshotai-cn'
  },
  {
    id: 'minimax-coding',
    name: 'MiniMax Token Plan',
    category: 'domestic',
    description: 'MiniMax 编程套餐，支持 5h/周额度窗口查询',
    defaultBaseUrl: 'https://api.minimaxi.com/v1',
    defaultApi: 'openai-completions',
    requiresKey: true,
    keyPlaceholder: 'sk-cp-... 或 API Key',
    keysUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key'
  },
  {
    id: 'dashscope',
    name: '阿里云百炼 (Qwen)',
    category: 'domestic',
    description: '通义千问 DashScope OpenAI 兼容端点',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultApi: 'openai-completions',
    requiresKey: true,
    keyPlaceholder: 'sk-...',
    keysUrl: 'https://bailian.console.aliyun.com/?apiKey=1'
  },
  {
    id: 'openai-compat',
    name: 'OpenAI Chat 兼容',
    category: 'official',
    description: '任意提供 /v1/chat/completions 与 /v1/models 的接口',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultApi: 'openai-completions',
    requiresKey: true,
    baseUrlPlaceholder: 'https://host/v1',
    keyPlaceholder: 'sk-...'
  },
  {
    id: 'openai-responses-compat',
    name: 'OpenAI Responses 兼容',
    category: 'official',
    description: '支持 GPT-5 / Codex 等 Responses API 的官方或中转接口',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultApi: 'openai-responses',
    requiresKey: true,
    baseUrlPlaceholder: 'https://host/v1',
    keyPlaceholder: 'sk-...'
  },
  {
    id: 'anthropic-compat',
    name: 'Anthropic Messages 兼容',
    category: 'official',
    description: '支持 Claude 原生 /v1/messages 协议的官方或中转接口',
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultApi: 'anthropic-messages',
    requiresKey: true,
    baseUrlPlaceholder: 'https://your-claude-relay.com',
    keyPlaceholder: 'sk-ant-...'
  },
  {
    id: 'ollama-local',
    name: 'Ollama (本地)',
    category: 'local',
    description: '本地 Ollama 服务，无需 API Key',
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    defaultApi: 'openai-completions',
    requiresKey: false,
    keyPlaceholder: 'ollama（可选）'
  },
  {
    id: 'lmstudio-local',
    name: 'LM Studio / vLLM',
    category: 'local',
    description: '本地 OpenAI 兼容推理服务',
    defaultBaseUrl: 'http://127.0.0.1:1234/v1',
    defaultApi: 'openai-completions',
    requiresKey: false,
    keyPlaceholder: '留空或任意字符'
  }
]
