/**
 * Agent CLI 任务契约
 * daemon（主进程 ipcServer）与 CLI（src/cli）共用；渲染层不参与该链路。
 */

export type AgentTaskPhase =
  | 'queued'      // 已入队，等待平台会话空闲
  | 'preparing'   // 建会话/导航/页面就绪检查
  | 'sending'     // 注入 prompt + 提交（含 DR 开启步骤）
  | 'generating'  // 已提交，轮询回复直至稳定
  | 'done'        // 回复采集完成
  | 'failed'      // 任何阶段失败
  | 'cancelled'   // 调用方取消

export type AgentTaskMode = 'chat' | 'deep_research'

export const AGENT_TASK_TERMINAL_PHASES: readonly AgentTaskPhase[] = ['done', 'failed', 'cancelled']

export function isAgentTaskTerminal(phase: AgentTaskPhase): boolean {
  return AGENT_TASK_TERMINAL_PHASES.includes(phase)
}

/** 稳定机器错误码（响应顶层 code 字段）。 */
export const AGENT_TASK_ERROR_CODES = [
  'DAEMON_UNAVAILABLE', // 应用未运行/管道不通/未授权
  'INVALID_PARAMS',     // 参数缺失/非法/URL 归属错误/query 超限
  'PLATFORM_UNKNOWN',   // 平台无选择器配置
  'CAPABILITY_UNSUPPORTED', // 如平台未适配 deep_research
  'PAGE_NOT_READY',     // 就绪探针超时（未登录/验证码/加载失败）或 generating 持续空采
  'AUTH_LOST',          // generating 中页面跳转登录墙
  'NOT_BLANK_CONVERSATION', // 新对话空白校验失败
  'SESSION_LOST',       // 会话窗口中途销毁 / app 退出
  'SEND_FAILED',        // 注入/提交失败（含 verifySubmission 未确认清空）
  'TASK_TIMEOUT',       // 到达任务硬超时
  'QUEUE_TIMEOUT',      // 排队超过 queueTimeoutMs
  'TASK_CANCELLED',     // 主动取消
  'TASK_NOT_FOUND',     // taskId 内存与磁盘均无
  'INTERNAL'            // 未分类异常
] as const

export type AgentTaskErrorCode = (typeof AGENT_TASK_ERROR_CODES)[number]

export interface AgentTaskError {
  code: AgentTaskErrorCode
  message: string
}

/** daemon 侧内部任务实体（CLI 不可见；abort 等内部字段不落盘外传）。 */
export interface AgentTask {
  id: string
  platform: string
  model?: string                 // 声明元数据（一期不做页面切换）
  mode: AgentTaskMode
  query: string                  // 纯图片任务可为空串
  images?: string[]              // 图片附件绝对路径（daemon 侧已校验存在性）
  sessionKey: string             // `__agent_${platform}`
  conversationUrl?: string       // 生成期间持续捕获
  followUpUrl?: string           // 入参 --conversation（已校验平台归属）
  phase: AgentTaskPhase
  reply: string                  // 当前已采集正文（generating 时为 partial）
  baseline: string               // 发送前页面最新回复，作差分基线
  busy: boolean                  // 页面停止按钮是否仍存在
  createdAt: number
  startedAt?: number             // 进入 preparing 时刻（timeoutMs 起点）
  completedAt?: number
  timeoutMs: number              // 任务硬超时（preparing→终态）
  queueTimeoutMs: number         // 排队超时（默认 = timeoutMs）
  error?: AgentTaskError
  cancelRequested?: boolean
  idempotencyKey?: string         // 调用方幂等键；submit 去重判定用，不外传
}

/** 对外任务视图（task.submit --wait / task.status / task.list 返回）。 */
export interface AgentTaskView {
  taskId: string
  platform: string
  model?: string
  mode: AgentTaskMode
  phase: AgentTaskPhase
  queuedPosition?: number
  replyChars: number
  busy: boolean
  elapsedMs: number
  conversationUrl?: string
  /** 仅 done 终态的单任务响应（task.status/task.submit --wait）内嵌完整回复；task.list 批量视图不带。 */
  reply?: string
  error?: AgentTaskError
}

/** task.result 返回结构。 */
export interface AgentTaskResult {
  taskId: string
  phase: AgentTaskPhase
  reply?: string
  conversationUrl?: string
  durationMs?: number
  error?: AgentTaskError
}

/** platforms 动作返回的平台能力标记。 */
export interface AgentPlatformCapability {
  id: string
  deepResearch: boolean
  busySignal: 'adapted' | 'generic'
  followUp: boolean
}

/** task.submit 请求字段。 */
export interface AgentTaskSubmitRequest {
  platform: string
  query: string
  /** 图片附件绝对路径列表；与 query 至少一项非空。路径必须在本机存在且为文件。 */
  images?: string[]
  model?: string
  mode?: AgentTaskMode
  conversationUrl?: string
  timeoutMs?: number
  queueTimeoutMs?: number
  waitMs?: number
  /** 幂等键：同 platform 下同键的任务仍存活（含终态内存记录）时复用原 taskId，防止重投重复排队。 */
  idempotencyKey?: string
}

export const AGENT_TASK_QUERY_MAX = 100_000
export const AGENT_TASK_IMAGE_MAX = 10
export const AGENT_TASK_DEFAULT_TIMEOUT_MS = 600_000
export const AGENT_TASK_RESEARCH_TIMEOUT_MS = 1_800_000
export const AGENT_TASK_MAX_TIMEOUT_MS = 7_200_000
export const AGENT_TASK_PERSIST_LIMIT = 200
export const AGENT_TASK_PERSIST_TTL_MS = 7 * 24 * 60 * 60_000
