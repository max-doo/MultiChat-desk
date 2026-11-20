export type TaskSplitPhase = 'loading' | 'generating' | 'done' | 'error' | 'cancelled'

export interface TaskSplitSubtask {
  text: string
}

export interface TaskSplitTask {
  id: string
  platform: string
  goal: string
  windowCount: number
  phase: TaskSplitPhase
  subtasks?: TaskSplitSubtask[]
  error?: string
}
