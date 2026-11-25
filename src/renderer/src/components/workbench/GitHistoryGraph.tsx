import type { GitGraphRow } from '../../utils/gitGraphLayout'
import { GIT_GRAPH_LANE_WIDTH, GIT_GRAPH_ROW_HEIGHT } from '../../utils/gitGraphLayout'

const LANE_COLOR_CLASSES = [
  'text-emerald-500 dark:text-emerald-400',
  'text-sky-500 dark:text-sky-400',
  'text-violet-500 dark:text-violet-400',
  'text-amber-500 dark:text-amber-400',
  'text-rose-500 dark:text-rose-400'
] as const

const NODE_Y = GIT_GRAPH_ROW_HEIGHT / 2

function laneX(index: number): number {
  return (index + 1) * GIT_GRAPH_LANE_WIDTH
}

function laneClassName(color: number): string {
  return LANE_COLOR_CLASSES[color % LANE_COLOR_CLASSES.length]
}

function findLastLaneIndex(lanes: GitGraphRow['outputLanes'], id: string): number {
  for (let index = lanes.length - 1; index >= 0; index--) {
    if (lanes[index].id === id) return index
  }
  return -1
}

/**
 * 在两个泳道之间画圆角折线；同一泳道则保持竖直。
 * 连接线始终从行顶贯穿到行底，保证相邻行能严丝合缝地接上。
 */
function transitionPath(fromX: number, toX: number, fromY: number, toY: number): string {
  if (fromX === toX) return `M ${fromX} ${fromY} V ${toY}`
  const direction = toX > fromX ? 1 : -1
  const radius = Math.min(5, Math.abs(toX - fromX) / 2)
  const middleY = fromY + (toY - fromY) / 2
  return [
    `M ${fromX} ${fromY}`,
    `V ${middleY - radius}`,
    `Q ${fromX} ${middleY} ${fromX + direction * radius} ${middleY}`,
    `H ${toX - direction * radius}`,
    `Q ${toX} ${middleY} ${toX} ${middleY + radius}`,
    `V ${toY}`
  ].join(' ')
}

export default function GitHistoryGraph({
  row,
  laneCount
}: {
  row: GitGraphRow
  laneCount: number
}): JSX.Element {
  const width = (laneCount + 1) * GIT_GRAPH_LANE_WIDTH
  const isHead = row.item.refs.some(ref => ref === 'HEAD' || ref.startsWith('HEAD ->'))
  const isMerge = row.item.parentIds.length > 1
  const nodeX = laneX(row.nodeLane)

  return (
    <svg
      aria-hidden="true"
      className="shrink-0 select-none"
      width={width}
      height={GIT_GRAPH_ROW_HEIGHT}
      viewBox={`0 0 ${width} ${GIT_GRAPH_ROW_HEIGHT}`}
    >
      {row.inputLanes.map((lane, index) => {
        if (lane.id === row.item.id) {
          return (
            <path
              key={`incoming-${lane.id}-${index}`}
              className={laneClassName(lane.color)}
              d={transitionPath(laneX(index), nodeX, 0, NODE_Y)}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.25}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )
        }

        const outputIndex = row.outputLanes.findIndex(output => output.id === lane.id)
        if (outputIndex < 0) return null
        return (
          <path
            key={`through-${lane.id}-${index}`}
            className={laneClassName(lane.color)}
            d={transitionPath(laneX(index), laneX(outputIndex), 0, GIT_GRAPH_ROW_HEIGHT)}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.25}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )
      })}

      {row.item.parentIds.map((parentId, index) => {
        const outputIndex = index === 0 && row.outputLanes[row.nodeLane]?.id === parentId
          ? row.nodeLane
          : findLastLaneIndex(row.outputLanes, parentId)
        if (outputIndex < 0) return null
        return (
          <path
            key={`parent-${parentId}-${index}`}
            className={laneClassName(row.outputLanes[outputIndex].color)}
            d={transitionPath(nodeX, laneX(outputIndex), NODE_Y, GIT_GRAPH_ROW_HEIGHT)}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.25}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )
      })}

      <g className={laneClassName(row.color)}>
        {isHead || isMerge ? (
          <>
            <circle
              cx={nodeX}
              cy={NODE_Y}
              r={isHead ? 5.25 : 4.5}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            />
            <circle cx={nodeX} cy={NODE_Y} r={isHead ? 2.25 : 1.75} fill="currentColor" />
          </>
        ) : (
          <circle cx={nodeX} cy={NODE_Y} r={3.25} fill="currentColor" />
        )}
      </g>
    </svg>
  )
}
