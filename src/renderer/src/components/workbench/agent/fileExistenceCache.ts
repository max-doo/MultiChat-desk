import { useSyncExternalStore } from 'react'
import { normalizePath } from './filePathUtils'

/**
 * Agent 行内 chip 的磁盘存在性缓存。
 *
 * 背景：文件树刻意隐藏 .multichat/.git 等内部目录，工作区外的文件也不在树中，
 * 仅靠 findTreePathByAbs 无法支撑"能点必能开"的校验。这里用磁盘 stat 作为兜底，
 * 并通过模块级缓存保证性能：
 * - 同一路径整个会话生命周期最多一次 IPC；
 * - 渲染期只做同步 Map 查询，不产生额外开销；
 * - 流式输出期间的反复重渲染命中缓存，零成本。
 *
 * 用法：`peekFileExistence(abs)` 同步读取并触发后台查询（unknown 时），
 * `useFileExistenceVersion()` 订阅版本号，结果到达后触发消费组件重渲染升级。
 */

type ExistenceState = 'unknown' | 'exists' | 'missing'

const cache = new Map<string, ExistenceState>()
const pending = new Set<string>()
const listeners = new Set<() => void>()
let version = 0

function notify(): void {
  version += 1
  for (const listener of listeners) listener()
}

function requestStat(absPath: string): void {
  const key = normalizePath(absPath)
  if (!key || pending.has(key) || cache.has(key)) return
  pending.add(key)
  void window.api
    .agentStatFile(absPath)
    .then((res) => {
      cache.set(key, res.success && res.data ? 'exists' : 'missing')
    })
    .catch(() => {
      cache.set(key, 'missing')
    })
    .finally(() => {
      pending.delete(key)
      notify()
    })
}

/**
 * 同步读取路径的磁盘存在性；首次遇到 unknown 路径时触发后台 stat。
 * unknown 阶段调用方应渲染为非交互形态，结果到达后经版本订阅升级。
 */
export function peekFileExistence(absPath: string): ExistenceState {
  const key = normalizePath(absPath)
  if (!key) return 'missing'
  const cached = cache.get(key)
  if (cached) return cached
  requestStat(absPath)
  return 'unknown'
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getVersion(): number {
  return version
}

/** 订阅存在性缓存版本号：任意 stat 结果到达时 +1，驱动消费组件重渲染。 */
export function useFileExistenceVersion(): number {
  return useSyncExternalStore(subscribe, getVersion, getVersion)
}
