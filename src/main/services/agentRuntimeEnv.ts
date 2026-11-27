import { app } from 'electron'
import { existsSync } from 'fs'
import { delimiter, dirname, join } from 'path'
import type Store from 'electron-store'

/**
 * Agent 运行时环境注入（启动早期调用一次，幂等）。
 *
 * 内核 shell spawn 经 `getShellEnv()` 展开主进程 `process.env`，因此这里设置的
 * PATH 与 MULTICHAT_* 变量会通达所有 Agent shell。
 *
 * 三件套：
 * - PATH 前置 shim 目录（仅打包版）：resources/runtime/bin 里的 node.cmd 提供
 *   嵌套 shell 兜底入口；顶层 powershell 的 node 函数由 AgentSessionService 的
 *   spawnHook 注入，不依赖 PATH。
 * - MULTICHAT_AGENT_DIR：与 AgentSessionService 的 agentDir 完全同口径——
 *   dirname(store.path)/agent。禁止用 app.getPath('userData') 推导：便携模式下
 *   userData 被重定向为 <install>/data/session，而 store cwd 是 <install>/data，
 *   用前者会得出错误路径且只有便携版坏。
 * - MULTICHAT_RUNTIME_DIR：skill 共享脚本（ensure-python.mjs）的家。
 *   打包版 resources/runtime；dev 版仓库 build/runtime（由 prepare-runtime 生成）。
 *
 * ELECTRON_RUN_AS_NODE 绝不在这里设置——写进 process.env 会被 Chromium 子进程
 * 继承导致整个应用退化，它只能存在于 spawnHook/shim 的子进程作用域。
 */
export function initAgentRuntimeEnv(store: Store<Record<string, unknown>>): void {
  const agentDir = join(dirname(store.path), 'agent')
  process.env.MULTICHAT_AGENT_DIR = agentDir

  const runtimeDir = app.isPackaged
    ? join(process.resourcesPath, 'runtime')
    : join(app.getAppPath(), 'build', 'runtime')
  process.env.MULTICHAT_RUNTIME_DIR = runtimeDir

  if (app.isPackaged) {
    const shimDir = join(runtimeDir, 'bin')
    if (existsSync(shimDir)) {
      const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
      const current = process.env[pathKey] ?? ''
      const entries = current.split(delimiter).filter(Boolean)
      if (!entries.some((entry) => entry.toLowerCase() === shimDir.toLowerCase())) {
        process.env[pathKey] = [shimDir, current].filter(Boolean).join(delimiter)
      }
    }
  }
}

/**
 * 打包版 Agent shell 中可用的应用自身可执行文件路径。
 * spawnHook 用它构造 node 函数（ELECTRON_RUN_AS_NODE 模式）。
 * dev 返回 null——开发机用系统 node，不注入。
 */
export function getBundledNodeHostExe(): string | null {
  if (!app.isPackaged) return null
  return existsSync(process.execPath) ? process.execPath : null
}

/**
 * multichat CLI bundle（resources/cli/index.js 或 dev 的 out/cli/index.js）路径。
 * 侧边 Agent 的 spawnHook 用它注入 multichat 函数——CLI 本体是应用内部能力的
 * 命令行形态，multichat-cli skill（外部 agent 的文档）不在侧边 Agent 挂载范围，
 * 但命令入口必须在 shell 中可达，multi-ai-review 的扇出战法依赖它。
 * dev 与打包统一走 ELECTRON_RUN_AS_NODE + process.execPath（dev 下它就是
 * electron 二进制，本身就是 node 宿主），不存在时返回 null。
 */
export function getCliBundlePath(): string | null {
  const candidate = app.isPackaged
    ? join(process.resourcesPath, 'cli', 'index.js')
    : join(app.getAppPath(), 'out', 'cli', 'index.js')
  return existsSync(candidate) ? candidate : null
}
