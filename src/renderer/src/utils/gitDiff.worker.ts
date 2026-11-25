/// <reference lib="webworker" />
/**
 * 大文件行级 Diff 的 Web Worker 入口。
 * 总行数超过 4,000 时由主线程派发，携带 seq 供乱序丢弃。
 */

import { runWorkerSideDiff, type GitDiffWorkerRequest } from './gitDiff'

self.onmessage = (event: MessageEvent<GitDiffWorkerRequest>): void => {
  try {
    const result = runWorkerSideDiff(event.data)
    self.postMessage(result)
  } catch {
    // Diff 内部异常（OOM/栈溢出等）统一回传 truncated，主线程降级为无标记，
    // 避免 workerCallbacks 残留与 Promise 悬挂。
    self.postMessage({
      seq: event.data.seq,
      lineMarks: [],
      deletedAfter: [],
      truncated: true
    })
  }
}
