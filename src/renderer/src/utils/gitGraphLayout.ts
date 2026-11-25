import type { GitHistoryItem } from '../../../shared/types/workbench'

export const GIT_GRAPH_LANE_WIDTH = 12
export const GIT_GRAPH_ROW_HEIGHT = 40
const GIT_GRAPH_COLOR_COUNT = 5

export interface GitGraphLane {
  /** 泳道当前等待的提交 hash */
  id: string
  color: number
}

export interface GitGraphRow {
  item: GitHistoryItem
  inputLanes: GitGraphLane[]
  outputLanes: GitGraphLane[]
  /** 提交节点所在的泳道；顶部没有对应输入泳道时位于当前泳道数之后 */
  nodeLane: number
  /** 节点颜色；没有父提交时沿用输入泳道颜色 */
  color: number
}

export interface GitGraphLayout {
  rows: GitGraphRow[]
  laneCount: number
}

function cloneLanes(lanes: GitGraphLane[]): GitGraphLane[] {
  return lanes.map(lane => ({ ...lane }))
}

/**
 * 按提交顺序计算每一行顶部和底部的泳道。
 * 第一个父提交继承当前泳道，其余父提交追加新泳道；合并提交因此能保持分支线的连续性。
 */
export function buildGitGraphLayout(commits: GitHistoryItem[]): GitGraphLayout {
  let colorIndex = -1
  let lanes: GitGraphLane[] = []
  let laneCount = 1
  const rows: GitGraphRow[] = []

  for (const item of commits) {
    const inputLanes = cloneLanes(lanes)
    const foundNodeLane = inputLanes.findIndex(lane => lane.id === item.id)
    const nodeLane = foundNodeLane >= 0 ? foundNodeLane : inputLanes.length
    const outputLanes: GitGraphLane[] = []
    let firstParentAdded = false

    for (const lane of inputLanes) {
      if (lane.id === item.id) {
        if (!firstParentAdded && item.parentIds[0]) {
          outputLanes.push({ id: item.parentIds[0], color: lane.color })
          firstParentAdded = true
        }
        continue
      }
      outputLanes.push({ ...lane })
    }

    for (let index = firstParentAdded ? 1 : 0; index < item.parentIds.length; index++) {
      const parentId = item.parentIds[index]
      // 第一个父提交必须落在节点泳道；其他父提交若已有泳道则直接复用
      if (index > 0 && outputLanes.some(lane => lane.id === parentId)) continue
      colorIndex = (colorIndex + 1) % GIT_GRAPH_COLOR_COUNT
      outputLanes.push({ id: parentId, color: colorIndex })
    }

    const color = outputLanes[nodeLane]?.color ?? inputLanes[nodeLane]?.color ?? 0
    rows.push({ item, inputLanes, outputLanes, nodeLane, color })
    laneCount = Math.max(laneCount, inputLanes.length, outputLanes.length, nodeLane + 1)
    lanes = outputLanes
  }

  return { rows, laneCount }
}
