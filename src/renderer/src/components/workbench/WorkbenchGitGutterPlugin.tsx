import { useEffect, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { createPortal } from 'react-dom'
import { $getRoot, type NodeKey } from 'lexical'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { computeGitLineDiff } from '../../utils/gitDiff'
import {
  extractMarkdownEnvelope,
  scanMarkdownSourceBlocks,
  getLexicalBlockKind,
  getLexicalNodeHint,
  alignWithPatienceAnchors
} from './markdownSourceMap'
import { $isPendingInsertNode } from './PendingInsertNode'

interface Props {
  /** 正文舞台容器（px-6 pt-6 pb-20 的相对定位层） */
  stageRef: React.RefObject<HTMLDivElement | null>
}

interface OverlayBar {
  key: NodeKey
  kind: 'added' | 'modified' | 'deleted'
}

const SYNC_DEBOUNCE_MS = 250

/**
 * Markdown 预览模式的块级 Git Gutter 外挂覆盖层。
 * 自包含响应式链路：订阅 store 的 baseline/activeFileContent →
 * 重扫 body 块行号 → diff → 顶层 Lexical 节点对齐 → DOM 投影。
 * 不进入 ContentEditable、不注册 LexicalNode、不触发 editor.update。
 */
export default function WorkbenchGitGutterPlugin({ stageRef }: Props): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const activeFilePath = useWorkbenchStore(s => s.activeFilePath)
  const activeFileContent = useWorkbenchStore(s => s.activeFileContent)
  const gitBaselineContent = useWorkbenchStore(s => s.gitBaselineContent)
  const gitBaselineStatus = useWorkbenchStore(s => s.gitBaselineStatus)
  const gitBaselinePath = useWorkbenchStore(s => s.gitBaselinePath)

  const [bars, setBars] = useState<OverlayBar[]>([])
  const [positions, setPositions] = useState<Map<string, { top: number; height: number; left: number; kind: OverlayBar['kind'] }>>(new Map())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seqRef = useRef(0)

  // 响应式重算：baseline 就绪/变化、activeFileContent 回写（含 250ms 防抖节拍）
  useEffect(() => {
    const seq = ++seqRef.current
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }

    const compute = (): void => {
      if (
        gitBaselineStatus !== 'ok' ||
        gitBaselineContent === null ||
        gitBaselinePath !== activeFilePath ||
        !activeFilePath
      ) {
        setBars([])
        return
      }

      const baselineBody = extractMarkdownEnvelope(gitBaselineContent).body
      const currentBody = extractMarkdownEnvelope(activeFileContent).body
      const diff = computeGitLineDiff(baselineBody, currentBody)
      if (diff.truncated) {
        setBars([])
        return
      }

      const scanned = scanMarkdownSourceBlocks(currentBody)
      const nextBars: OverlayBar[] = []

      editor.getEditorState().read(() => {
        const topNodes = $getRoot()
          .getChildren()
          .filter((n) => !$isPendingInsertNode(n))

        // 将 diff 行号区间标记到源码块（与导入顺序一致）
        interface MarkedBlock {
          kind: 'added' | 'modified' | 'deleted'
        }
        const blockMarks = new Map<number, MarkedBlock>()
        scanned.blocks.forEach((block, idx) => {
          if (block.startLine === undefined || block.endLine === undefined) return
          let hasAdded = false
          let hasModified = false
          for (let i = block.startLine; i <= block.endLine && i < diff.lineMarks.length; i++) {
            if (diff.lineMarks[i] === 'modified') hasModified = true
            else if (diff.lineMarks[i] === 'added') hasAdded = true
          }
          if (hasModified) blockMarks.set(idx, { kind: 'modified' })
          else if (hasAdded) blockMarks.set(idx, { kind: 'added' })
        })
        // 纯删除：锚到其后仍存在（起始行 ≥ 删除行号）的第一个块；
        // 若该块本身已有 added/modified 标记，则额外登记一条 deleted 供 overlay 叠加三角
        const extraDeletedBlockIdx: number[] = []
        for (const [lineNo] of diff.deletedAfter) {
          let bestIdx = -1
          let bestStart = Infinity
          scanned.blocks.forEach((block, idx) => {
            if (block.startLine === undefined) return
            if (block.startLine >= lineNo && block.startLine < bestStart) {
              bestIdx = idx
              bestStart = block.startLine
            }
          })
          if (bestIdx >= 0) {
            const prev = blockMarks.get(bestIdx)
            blockMarks.set(bestIdx, { kind: prev ? prev.kind : 'deleted' })
            if (prev) extraDeletedBlockIdx.push(bestIdx)
          }
        }

        // blocks → 顶层 Lexical 节点对齐：先 fast-path 1:1，失配走锚点 LIS
        const nodeInfos = topNodes.map((n) => ({
          key: n.getKey(),
          kind: getLexicalBlockKind(n),
          hint: getLexicalNodeHint(n)
        }))
        const blocks = scanned.blocks

        const nodeKeyToBlockIdx = new Map<NodeKey, number>()
        const exactFastPath =
          nodeInfos.length === blocks.length &&
          nodeInfos.every((info, i) => {
            const blockKind = blocks[i].kind
            return info.kind === blockKind || (info.kind === 'paragraph' && blockKind === 'image')
          })

        if (exactFastPath) {
          for (let i = 0; i < nodeInfos.length; i++) {
            nodeKeyToBlockIdx.set(nodeInfos[i].key, i)
          }
        } else if (blocks.length > 0 && nodeInfos.length > 0) {
          const segments = alignWithPatienceAnchors(nodeInfos, blocks)
          for (const seg of segments) {
            if (!seg.matched) continue
            if (seg.cEnd - seg.cStart === 1 && seg.bEnd - seg.bStart === 1) {
              nodeKeyToBlockIdx.set(nodeInfos[seg.cStart].key, seg.bStart)
            } else {
              // 复合段：首个节点锚到组首块，其余节点共享该组
              for (let c = seg.cStart; c < seg.cEnd; c++) {
                nodeKeyToBlockIdx.set(nodeInfos[c].key, seg.bStart)
              }
            }
          }
        }

        for (const [nodeKey, blockIdx] of nodeKeyToBlockIdx) {
          const mark = blockMarks.get(blockIdx)
          if (mark) nextBars.push({ key: nodeKey, kind: mark.kind })
          if (extraDeletedBlockIdx.includes(blockIdx)) {
            nextBars.push({ key: nodeKey, kind: 'deleted' })
          }
        }
      })

      if (seq === seqRef.current) setBars(nextBars)
    }

    debounceRef.current = setTimeout(compute, SYNC_DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }
  }, [
    editor,
    activeFilePath,
    activeFileContent,
    gitBaselineContent,
    gitBaselineStatus,
    gitBaselinePath
  ])

  // 文件切换时立即清空，避免上一文档的标记闪现
  useEffect(() => {
    setBars([])
    setPositions(new Map())
  }, [activeFilePath])

  // 根据 NodeKey 集合读取真实 DOM 坐标；先读后写，rAF 批量执行
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || bars.length === 0) {
      setPositions(new Map())
      return
    }

    let frameId = 0
    const measure = (): void => {
      const next = new Map<string, { top: number; height: number; left: number; kind: OverlayBar['kind'] }>()
      const stageRect = stage.getBoundingClientRect()
      // 贴滚动容器右缘：stage 的 clientWidth 即 scroller 内容宽（不含滚动条），
      // 色条落在滚动条之前，与正文保持距离。
      const barLeft = Math.max(0, stage.clientWidth - 6)
      // 同一 NodeKey 可能被 added/modified 与 deleted 同时命中，叠加展示
      for (const bar of bars) {
        const el = editor.getElementByKey(bar.key)
        if (!el) continue
        const rect = el.getBoundingClientRect()
        const key = `${bar.key}:${bar.kind}`
        next.set(key, {
          top: rect.top - stageRect.top,
          height: rect.height,
          left: barLeft,
          kind: bar.kind
        })
      }
      setPositions(next)
    }
    frameId = requestAnimationFrame(measure)

    // 图片/公式加载会撑高正文，监听 stage 尺寸变化重算
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frameId)
      frameId = requestAnimationFrame(measure)
    })
    observer.observe(stage)
    return () => {
      cancelAnimationFrame(frameId)
      observer.disconnect()
    }
  }, [editor, bars, stageRef])

  const stage = stageRef.current
  if (!stage) return null

  return createPortal(
    <div className="workbench-git-gutter-overlay" aria-hidden="true">
      {Array.from(positions.entries()).map(([key, pos]) => (
        <div
          key={key}
          className={`git-block-bar git-${pos.kind}`}
          style={{
            top: pos.top,
            left: pos.left,
            height: pos.kind === 'deleted' ? 5 : Math.max(pos.height, 4)
          }}
        />
      ))}
    </div>,
    stage
  )
}
