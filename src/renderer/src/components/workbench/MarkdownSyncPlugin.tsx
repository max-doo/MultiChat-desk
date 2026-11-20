import { useEffect, useRef } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import type { LexicalNode } from 'lexical'
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
  CHECK_LIST,
  type ElementTransformer
} from '@lexical/markdown'
import {
  HorizontalRuleNode,
  $createHorizontalRuleNode,
  $isHorizontalRuleNode
} from '@lexical/react/LexicalHorizontalRuleNode'
import { useWorkbenchStore } from '../../store/workbenchStore'

export const HR_TRANSFORMER: ElementTransformer = {
  dependencies: [HorizontalRuleNode],
  export: (node: LexicalNode) => {
    return $isHorizontalRuleNode(node) ? '***' : null
  },
  regExp: /^(---|\*\*\*|___)\s*$/,
  replace: (parentNode) => {
    const line = $createHorizontalRuleNode()
    parentNode.replace(line)
  },
  type: 'element'
}

export const WORKBENCH_TRANSFORMERS = [CHECK_LIST, HR_TRANSFORMER, ...TRANSFORMERS]

/**
 * 分离 YAML Frontmatter 元数据与正文 Markdown
 */
export function parseMarkdownWithFrontmatter(rawContent: string): {
  frontmatter: string | null
  markdownBody: string
} {
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
 * 1. 切换文件或从源码模式切回富文本模式时，将 Markdown 解析为 Lexical AST
 * 2. 编辑器内容变化时，实时转换回 Markdown 字符串并保留 Frontmatter
 */
export default function MarkdownSyncPlugin(): null {
  const [editor] = useLexicalComposerContext()
  const activeFilePath = useWorkbenchStore((s) => s.activeFilePath)
  const activeFileContent = useWorkbenchStore((s) => s.activeFileContent)
  const updateActiveContent = useWorkbenchStore((s) => s.updateActiveContent)
  const editorMode = useWorkbenchStore((s) => s.editorMode)

  const frontmatterRef = useRef<string | null>(null)
  const isSyncingFromExternalRef = useRef(false)
  const lastLoadedPathRef = useRef<string | null>(null)
  const lastSyncedContentRef = useRef<string>('')

  // 当外部文件切换或从源码模式切回富文本时，更新 Lexical 编辑器内容
  useEffect(() => {
    const isNewFile = activeFilePath !== lastLoadedPathRef.current
    const isReturningToWysiwyg =
      editorMode === 'wysiwyg' && activeFileContent !== lastSyncedContentRef.current

    if (isNewFile || isReturningToWysiwyg) {
      lastLoadedPathRef.current = activeFilePath
      lastSyncedContentRef.current = activeFileContent
      const { frontmatter, markdownBody } = parseMarkdownWithFrontmatter(activeFileContent)
      frontmatterRef.current = frontmatter

      isSyncingFromExternalRef.current = true
      editor.update(
        () => {
          $convertFromMarkdownString(markdownBody, WORKBENCH_TRANSFORMERS)
        },
        { tag: 'sync-external', discrete: true }
      )
      isSyncingFromExternalRef.current = false
    }
  }, [activeFilePath, activeFileContent, editorMode, editor])

  // 监听 Lexical 内部改动，同步写回 workbenchStore
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves, tags }) => {
      // 忽略由外部载入触发的更新或无内容变化的选区变动
      if (tags.has('sync-external') || isSyncingFromExternalRef.current) return
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return

      editorState.read(() => {
        const bodyMarkdown = $convertToMarkdownString(WORKBENCH_TRANSFORMERS)
        const fullMarkdown = (frontmatterRef.current || '') + bodyMarkdown

        // 仅在内容实质发生改变时通知 store
        if (fullMarkdown !== lastSyncedContentRef.current) {
          lastSyncedContentRef.current = fullMarkdown
          updateActiveContent(fullMarkdown)
        }
      })
    })
  }, [editor, updateActiveContent])

  return null
}
