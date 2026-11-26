import { useCallback, useEffect, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  $getSelection,
  $isElementNode,
  $isNodeSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_SPACE_COMMAND,
  type LexicalNode
} from 'lexical'
import { mergeRegister } from '@lexical/utils'
import { $isWorkbenchImageNode, WorkbenchImageNode } from './WorkbenchImageNode'
import WorkbenchImageLightbox, { type LightboxImageItem } from './WorkbenchImageLightbox'
import {
  OPEN_WORKBENCH_IMAGE_LIGHTBOX_COMMAND,
  type OpenImageLightboxPayload
} from './workbenchImageUtils'
import { useWorkbenchStore } from '../../store/workbenchStore'

/** 兼容 Vite HMR 重载后旧实例 instanceof 失效的问题，同时按 node.getType() 识别图片节点。 */
function isWorkbenchImageNodeLike(
  node: LexicalNode | null | undefined
): node is WorkbenchImageNode {
  return Boolean(
    node && ($isWorkbenchImageNode(node) || node.getType() === WorkbenchImageNode.getType())
  )
}

function toImagePayload(node: WorkbenchImageNode): OpenImageLightboxPayload {
  return {
    nodeKey: node.getKey(),
    src: node.getSrc(),
    altText: node.getAltText(),
    title: node.getTitle()
  }
}

/** 按文档阅读顺序（深度优先）收集全部 Markdown 图片节点。 */
function collectDocumentImages(): LightboxImageItem[] {
  const result: LightboxImageItem[] = []
  const visit = (node: LexicalNode): void => {
    if (isWorkbenchImageNodeLike(node)) {
      result.push(toImagePayload(node))
      return
    }
    if ($isElementNode(node)) {
      for (const child of node.getChildren()) {
        visit(child)
      }
    }
  }
  visit($getRoot())
  return result
}

function getSingleSelectedImage(): OpenImageLightboxPayload | null {
  const selection = $getSelection()
  if (!$isNodeSelection(selection)) return null
  const nodes = selection.getNodes()
  if (nodes.length !== 1) return null
  const node = nodes[0]
  return isWorkbenchImageNodeLike(node) ? toImagePayload(node) : null
}

/**
 * 工作台 Markdown 图片查看视窗插件：
 * - 响应 OPEN_WORKBENCH_IMAGE_LIGHTBOX_COMMAND（双击 / 悬浮按钮 / 右键菜单）
 * - 选中单张图片节点时按 Space 快速预览，并阻止 Lexical 用空格覆盖该图片节点
 */
export default function WorkbenchImageLightboxPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const [items, setItems] = useState<LightboxImageItem[]>([])
  const [activeIndex, setActiveIndex] = useState<number>(-1)

  const open = activeIndex >= 0 && activeIndex < items.length

  const openForNode = useCallback(
    (payload: OpenImageLightboxPayload) => {
      const collected = editor.getEditorState().read(() => collectDocumentImages())
      const nextItems = collected.length ? collected : [payload]
      const idx = nextItems.findIndex((item) => item.nodeKey === payload.nodeKey)
      setItems(nextItems)
      setActiveIndex(idx >= 0 ? idx : 0)
    },
    [editor]
  )

  const closeLightbox = useCallback(() => {
    setActiveIndex(-1)
    setItems([])
  }, [])

  useEffect(() => {
    closeLightbox()
  }, [activeFilePath, closeLightbox])

  // 注册打开命令与 Space 快捷键拦截（防止空格删掉选中的图片节点）
  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        OPEN_WORKBENCH_IMAGE_LIGHTBOX_COMMAND,
        (payload) => {
          openForNode(payload)
          return true
        },
        COMMAND_PRIORITY_HIGH
      ),
      editor.registerCommand(
        KEY_SPACE_COMMAND,
        (event) => {
          if (open) return false
          const selected = getSingleSelectedImage()
          if (!selected) return false
          event?.preventDefault()
          openForNode(selected)
          return true
        },
        COMMAND_PRIORITY_HIGH
      )
    )
  }, [editor, open, openForNode])

  // 若点击图片 Decorator 导致焦点移出 ContentEditable，兜底捕获 Space 唤醒查看器
  useEffect(() => {
    if (open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.code !== 'Space' ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return
      }
      const target = event.target as HTMLElement | null
      const root = editor.getRootElement()
      if (!root) return
      if (
        target &&
        target !== document.body &&
        target !== root &&
        !root.contains(target)
      ) {
        return
      }
      if (target && target.closest('input, textarea, select, button, [role="button"], a[href]')) {
        return
      }
      if (target && target.isContentEditable && target !== root && !root.contains(target)) {
        return
      }
      const selected = editor.getEditorState().read(() => getSingleSelectedImage())
      if (!selected) return
      event.preventDefault()
      event.stopPropagation()
      openForNode(selected)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [editor, open, openForNode])

  return (
    <WorkbenchImageLightbox
      open={open}
      items={items}
      activeIndex={activeIndex}
      onSelectIndex={setActiveIndex}
      onClose={closeLightbox}
    />
  )
}
