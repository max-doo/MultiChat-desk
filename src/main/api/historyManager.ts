/**
 * History Manager
 * 只读分页访问 + 磁盘上限 enforcement。
 * 写路径仍由 renderer 通过 store-set 直写，本类不参与写入，仅在 store-set 后 enforce 磁盘上限。
 */
import type Store from 'electron-store'

/** 与 appStore.ts 的 HistoryItem 结构对齐（分页只读，结构兼容即可） */
export interface HistoryItem {
  id: string
  createdAt: number
  updatedAt: number
  models: string[]
  title?: string
  turns: Array<{
    turnId: string
    userMessage: string
    timestamp: number
    responses: Record<string, string>
  }>
  urls?: Record<string, string>
  productMode?: string
  displayMode?: string
}

/** 与 appStore.ts 的 SummaryHistoryItem 结构对齐（精简到分页所需字段） */
export interface SummaryHistoryItem {
  id: string
  title: string
  timestamp: number
  messages: Array<{ role: string; content: string }>
  selectedModels: string[]
}

export const DISK_LIMIT = 1000

export class HistoryManager {
  constructor(private store: Store<Record<string, unknown>>) {}

  private getHistory(): HistoryItem[] {
    return (this.store.get('history') as HistoryItem[] | undefined) ?? []
  }

  private getSummaryHistory(): SummaryHistoryItem[] {
    return (this.store.get('summaryHistory') as SummaryHistoryItem[] | undefined) ?? []
  }

  private setHistory(items: HistoryItem[]): void {
    this.store.set('history', items)
  }

  private setSummaryHistory(items: SummaryHistoryItem[]): void {
    this.store.set('summaryHistory', items)
  }

  getHistoryPage(offset: number, limit: number): HistoryItem[] {
    return this.getHistory().slice(offset, offset + limit)
  }

  getSummaryHistoryPage(offset: number, limit: number): SummaryHistoryItem[] {
    return this.getSummaryHistory().slice(offset, offset + limit)
  }

  getHistoryTotalCount(): number {
    return this.getHistory().length
  }

  getSummaryHistoryTotalCount(): number {
    return this.getSummaryHistory().length
  }

  /**
   * 把 history / summaryHistory 磁盘数组各自裁到 DISK_LIMIT。
   * 在 store-set 写 history/summaryHistory 后由 ipcHandlers 调用。
   * 异常不影响主流程：调用方已 try/catch 包裹。
   */
  enforceDiskLimit(): void {
    const history = this.getHistory()
    if (history.length > DISK_LIMIT) {
      this.setHistory(history.slice(0, DISK_LIMIT))
    }
    const summaryHistory = this.getSummaryHistory()
    if (summaryHistory.length > DISK_LIMIT) {
      this.setSummaryHistory(summaryHistory.slice(0, DISK_LIMIT))
    }
  }
}
