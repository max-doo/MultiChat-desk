import { useCallback } from 'react'
import type { LexicalEditor } from 'lexical'
import ConfirmModal from '../ConfirmModal'
import type { Annotation } from '../../../../shared/types/annotations'
import { exportAnnotationsAsFootnotedMarkdown } from './annotationFootnoteExport'
import { parseMarkdownWithFrontmatter } from './MarkdownSyncPlugin'

interface Props {
  open: boolean
  onClose: () => void
  editor: LexicalEditor
  workspaceRoot: string | null
  /** 已定位的 document 标注（anchored / shifted） */
  anchoredAnnotations: Annotation[]
  /** source 标注总数（仅用于提示） */
  sourceCount: number
  /** 未定位 document 标注数（仅用于提示） */
  unresolvedCount: number
  activeFileContent: string
  activeFilePath: string | null
}

export default function AnnotationExportFootnoteModal({
  open,
  onClose,
  editor,
  workspaceRoot,
  anchoredAnnotations,
  sourceCount,
  unresolvedCount,
  activeFileContent,
  activeFilePath
}: Props): JSX.Element | null {
  const skippedInfoParts: string[] = []
  if (sourceCount > 0) {
    skippedInfoParts.push(`${sourceCount} 条原对话标注`)
  }
  if (unresolvedCount > 0) {
    skippedInfoParts.push(`${unresolvedCount} 条未定位标注`)
  }

  const buildMarkdown = useCallback((): string => {
    const result = exportAnnotationsAsFootnotedMarkdown(
      editor,
      anchoredAnnotations,
      'highlight-footnote'
    )
    const { bom, frontmatter } = parseMarkdownWithFrontmatter(activeFileContent)
    return `${bom}${frontmatter ?? ''}${result.markdown}`
  }, [editor, anchoredAnnotations, activeFileContent])

  const handleSaveAs = (): void => {
    const md = buildMarkdown()
    const baseName = activeFilePath
      ? activeFilePath.replace(/\.[^.]+$/, '').split(/[\\/]/).pop() ?? 'export'
      : 'export'
    const defaultName = `${baseName}-footnoted.md`

    void (async (): Promise<void> => {
      if (!workspaceRoot) {
        window.alert('请先打开工作空间再导出')
        return
      }
      const result = await window.api.workbench.saveTextAs(workspaceRoot, {
        title: '导出标注为脚注',
        defaultFileName: defaultName,
        content: md,
        extensions: ['md']
      })
      if (!result.success) {
        window.alert(result.error ?? '保存失败，请重试')
        return
      }
      if (!result.data) return // 用户取消
      onClose()
    })()
  }

  const message =
    skippedInfoParts.length > 0
      ? `将 ${anchoredAnnotations.length} 条已定位文档标注导出为带脚注的 Markdown 文件；另有 ${skippedInfoParts.join('、')} 不参与导出。`
      : `将 ${anchoredAnnotations.length} 条文档标注导出为带脚注的 Markdown 文件。`

  return (
    <ConfirmModal
      isOpen={open}
      title="导出标注为脚注"
      message={message}
      confirmText="另存为文件"
      cancelText="取消"
      type="info"
      onConfirm={handleSaveAs}
      onCancel={onClose}
    />
  )
}
