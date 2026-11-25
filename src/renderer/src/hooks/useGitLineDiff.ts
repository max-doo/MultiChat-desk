import { useEffect, useRef, useState } from 'react'
import { useWorkbenchStore } from '../store/workbenchStore'
import {
  computeGitLineDiff,
  GIT_DIFF_WORKER_LINE_THRESHOLD,
  type GitDiffWorkerResponse
} from '../utils/gitDiff'
import type { GitLineChangeKind } from '../../../shared/types/workbench'

export interface GitLineDiffState {
  lineMarks: Array<GitLineChangeKind | undefined>
  deletedAfter: Map<number, number>
  /** 基线就绪且未触发熔断；false 时所有标记均不显示 */
  active: boolean
}

const EMPTY_STATE: GitLineDiffState = {
  lineMarks: [],
  deletedAfter: new Map(),
  active: false
}

let workerInstance: Worker | null = null
let workerSeq = 0
const workerCallbacks = new Map<number, (response: GitDiffWorkerResponse) => void>()

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null
  if (!workerInstance) {
    try {
      workerInstance = new Worker(new URL('../utils/gitDiff.worker.ts', import.meta.url), {
        type: 'module'
      })
      workerInstance.onmessage = (event: MessageEvent<GitDiffWorkerResponse>) => {
        const cb = workerCallbacks.get(event.data.seq)
        if (cb) {
          workerCallbacks.delete(event.data.seq)
          cb(event.data)
        }
      }
    } catch {
      workerInstance = null
    }
  }
  return workerInstance
}

/**
 * 编辑器通用的行级 Git 标记 Hook。
 * - 基线仅绑定「当前活动文件」，切文件/非仓库/未跟踪自动失活。
 * - 250ms 防抖：打字过程不调用 Git，纯内存重算。
 * - 总行数 > 4,000 时自动派发到 Web Worker，seq 过期即丢弃。
 */
export function useGitLineDiff(currentText: string): GitLineDiffState {
  const gitBaselinePath = useWorkbenchStore(s => s.gitBaselinePath)
  const gitBaselineStatus = useWorkbenchStore(s => s.gitBaselineStatus)
  const gitBaselineContent = useWorkbenchStore(s => s.gitBaselineContent)
  const activeFilePath = useWorkbenchStore(s => s.activeFilePath)

  const [state, setState] = useState<GitLineDiffState>(EMPTY_STATE)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seqRef = useRef(0)

  useEffect(() => {
    const valid =
      gitBaselineStatus === 'ok' &&
      typeof gitBaselineContent === 'string' &&
      gitBaselinePath !== null &&
      gitBaselinePath === activeFilePath

    if (!valid) {
      setState(EMPTY_STATE)
      return
    }

    const seq = ++seqRef.current
    const baseline = gitBaselineContent
    // baseline 行数缓存：避免每次 content 变化都对基准做全量 split
    const baselineLineCount = baseline.split('\n').length

    const schedule = (): void => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        const totalLines = baselineLineCount + currentText.split('\n').length
        if (totalLines > GIT_DIFF_WORKER_LINE_THRESHOLD) {
          const worker = getWorker()
          if (worker) {
            const requestSeq = ++workerSeq
            workerCallbacks.set(requestSeq, (response) => {
              if (seq !== seqRef.current) return
              setState({
                lineMarks: response.lineMarks.map(mark => mark ?? undefined),
                deletedAfter: new Map(response.deletedAfter),
                active: !response.truncated
              })
            })
            worker.postMessage({
              seq: requestSeq,
              baselineText: baseline,
              currentText
            })
            return
          }
        }
        const result = computeGitLineDiff(baseline, currentText)
        if (seq !== seqRef.current) return
        setState({
          lineMarks: result.lineMarks,
          deletedAfter: result.deletedAfter,
          active: !result.truncated
        })
      }, 250)
    }

    schedule()
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [gitBaselinePath, gitBaselineStatus, gitBaselineContent, activeFilePath, currentText])

  return state
}
