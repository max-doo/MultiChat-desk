import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_EDITOR,
  PASTE_COMMAND,
  DROP_COMMAND,
  createCommand,
  type LexicalCommand,
  type PasteCommandType
} from 'lexical'
import { mergeRegister } from '@lexical/utils'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { $createWorkbenchImageNode } from './WorkbenchImageNode'

export const INSERT_WORKBENCH_IMAGE_COMMAND: LexicalCommand<{
  src: string
  altText?: string
}[]> = createCommand('INSERT_WORKBENCH_IMAGE')

const ACCEPTED_IMAGE_TYPES = /^image\//

/**
 * 工作台图片插入插件
 * - 粘贴（PASTE_COMMAND）：clipboard 中的图片 File → IPC 写 assets → 插入节点
 * - 拖拽（DROP_COMMAND）：本地图片文件路径 → IPC 复制进 assets → 插入节点
 * - 工具栏（INSERT_WORKBENCH_IMAGE_COMMAND）：已知相对路径直接插入
 */
export default function WorkbenchImagePlugin(): null {
  const [editor] = useLexicalComposerContext()
  const workspacePath = useWorkbenchStore((s) => s.workspacePath)
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)

  // 批量插入图片节点（复用一次 update 减少 diff 开销）
  const insertImageNodes = (srcs: { src: string; altText?: string }[]): void => {
    if (!srcs.length) return
    editor.update(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return
      const nodes = srcs.map(({ src, altText }) => $createWorkbenchImageNode(src, altText || ''))
      selection.insertNodes(nodes)
      nodes[nodes.length - 1].selectNext()
    })
  }

  // 保存单张图片到 assets 并返回相对路径
  const saveToAssets = async (
    payload: { dataUrl?: string; base64?: string; fileName?: string },
    sourceAbsPath?: string
  ): Promise<{ relativePath: string; thumbnailDataUrl: string } | null> => {
    if (!workspacePath || !activeFilePath) {
      console.warn('[WorkbenchImage] 无工作区或激活文档')
      return null
    }
    try {
      const res = sourceAbsPath
        ? await window.api.workbench.importImageFile(workspacePath, activeFilePath, sourceAbsPath)
        : await window.api.workbench.saveImage(workspacePath, activeFilePath, payload)
      if (res.success && res.data) {
        return res.data
      }
      console.error('[WorkbenchImage] 保存失败:', res.error)
      return null
    } catch (err) {
      console.error('[WorkbenchImage] 保存异常:', err)
      return null
    }
  }

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

  // 粘贴：clipboardData.files 中的图片
  // 注意：此处理器以 COMMAND_PRIORITY_HIGH 注册，必须在同步阶段就返回
  // 是否已处理（Lexical 以返回值决定后续处理器是否继续执行），否则
  // 纯文本粘贴会被永远吞掉。图片处理本身在后台异步完成后插入节点。
  const handlePaste = (event: PasteCommandType): boolean => {
    const files = event instanceof ClipboardEvent
      ? Array.from(event.clipboardData?.files ?? [])
      : []
    const images = files.filter((f) => ACCEPTED_IMAGE_TYPES.test(f.type))
    if (!images.length) return false
    event.preventDefault()

    void (async () => {
      const results: { src: string; altText?: string }[] = []
      for (const file of images) {
        try {
          const dataUrl = await fileToDataUrl(file)
          // 粘贴不传 fileName，主进程按 `Pasted image <ts>` 统一命名
          const saved = await saveToAssets({ dataUrl })
          if (saved) {
            results.push({ src: saved.relativePath, altText: file.name })
          }
        } catch (err) {
          console.error('[WorkbenchImage] 粘贴图片失败:', err)
        }
      }
      if (results.length) {
        insertImageNodes(results)
        // 图片落盘到 assets/ 后主动刷新文件树，避免等下一次操作才显示
        void useWorkbenchStore.getState().loadFileTree()
      }
    })()
    return true
  }

  // 拖拽：dataTransfer.files 中的本地图片文件
  // 与 PASTE_COMMAND 相同：同步返回 false 才能放行非图片拖拽
  const handleDrop = (event: DragEvent): boolean => {
    const files = Array.from(event.dataTransfer?.files ?? [])
    const images = files.filter((f) => ACCEPTED_IMAGE_TYPES.test(f.type))
    if (!images.length) return false
    event.preventDefault()

    void (async () => {
      const results: { src: string; altText?: string }[] = []
      for (const file of images) {
        try {
          // webUtils.getPathForFile 仅 Electron；降级用 .path（新版 Electron）
          const absPath =
            (file as File & { path?: string }).path ??
            ((window as Window & { electron?: { webUtils?: { getPathForFile?: (f: File) => string } } }).electron?.webUtils?.getPathForFile?.(file) ?? '')
          if (absPath) {
            const saved = await saveToAssets({}, absPath)
            if (saved) {
              results.push({ src: saved.relativePath, altText: file.name })
            }
          } else {
            // 无法拿到路径（如从浏览器拖拽），退化为 dataUrl 保存
            const dataUrl = await fileToDataUrl(file)
            const saved = await saveToAssets({ dataUrl, fileName: file.name })
            if (saved) {
              results.push({ src: saved.relativePath, altText: file.name })
            }
          }
        } catch (err) {
          console.error('[WorkbenchImage] 拖拽图片失败:', err)
        }
      }
      if (results.length) {
        insertImageNodes(results)
        void useWorkbenchStore.getState().loadFileTree()
      }
    })()
    return true
  }

  useEffect(() => {
    if (!editor) return

    return mergeRegister(
      // 粘贴图片：clipboard 直接含 File 对象
      editor.registerCommand(
        PASTE_COMMAND,
        (event: PasteCommandType) => {
          return handlePaste(event)
        },
        COMMAND_PRIORITY_HIGH
      ),
      // 拖拽图片：本地文件 / 浏览器图片
      editor.registerCommand(
        DROP_COMMAND,
        (event: DragEvent) => {
          return handleDrop(event)
        },
        COMMAND_PRIORITY_HIGH
      ),
      // 工具栏插入：已知相对路径
      editor.registerCommand(
        INSERT_WORKBENCH_IMAGE_COMMAND,
        (payload) => {
          insertImageNodes(payload)
          return true
        },
        COMMAND_PRIORITY_EDITOR
      )
    )
  }, [editor, workspacePath, activeFilePath])

  return null
}
