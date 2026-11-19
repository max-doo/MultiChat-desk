import { useEffect, useRef } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $convertFromMarkdownString, $convertToMarkdownString, TRANSFORMERS } from '@lexical/markdown'
import { useWorkbenchStore } from '../../store/workbenchStore'

/**
 * 分离 YAML Frontmatter 元数据与正文 Markdown
 */
export function parseMarkdownWithFrontmatter(rawContent: string): { frontmatter: string | null; markdownBody: string } {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/
  const match = rawContent.match(frontmatterRegex)
  if (match) {
    return {
      frontmatter: match[0],
      markdownBody: rawContent.slice(match[0].length)
    }
  }
  return { frontmatter: null, markdownBody: rawContent }
}

/**
 * Markdown 双向同步插件
 * 1. 切换文件或从外部加载内容时，将 Markdown 解析为 Lexical AST
 * 2. 编辑器内容变化时，实时转换回 Markdown 字符串并保留 Frontmatter
 */
export default function MarkdownSyncPlugin(): null {
  const [editor] = useLexicalComposerContext()
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const activeFileContent = useWorkbenchStore((s) => s.activeFileContent)
  const updateActiveContent = useWorkbenchStore((s) => s.updateActiveContent)

  const frontmatterRef = useRef<string | null>(null)
  const isSyncingFromExternalRef = useRef(false)
  const lastLoadedPathRef = useRef<string | null>(null)

  // 当外部文件切换或初次载入时，更新 Lexical 编辑器内容
  useEffect(() => {
    if (activeFilePath !== lastLoadedPathRef.current) {
      lastLoadedPathRef.current = activeFilePath
      const { frontmatter, markdownBody } = parseMarkdownWithFrontmatter(activeFileContent)
      frontmatterRef.current = frontmatter

      isSyncingFromExternalRef.current = true
      editor.update(() => {
        $convertFromMarkdownString(markdownBody, TRANSFORMERS)
      })
      isSyncingFromExternalRef.current = false
    }
  }, [activeFilePath, activeFileContent, editor])

  // 监听 Lexical 内部改动，同步写回 workbenchStore
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
      // 忽略由外部载入触发的更新或无内容变化的选区变动
      if (isSyncingFromExternalRef.current) return
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return

      editorState.read(() => {
        const bodyMarkdown = $convertToMarkdownString(TRANSFORMERS)
        const fullMarkdown = (frontmatterRef.current || '') + bodyMarkdown

        // 仅在内容实质发生改变时通知 store
        const currentContent = useWorkbenchStore.getState().activeFileContent
        if (fullMarkdown !== currentContent) {
          updateActiveContent(fullMarkdown)
        }
      })
    })
  }, [editor, updateActiveContent])

  return null
}
