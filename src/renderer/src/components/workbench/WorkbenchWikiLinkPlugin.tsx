import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { LexicalTypeaheadMenuPlugin, MenuOption } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import type { MenuRenderFn, MenuTextMatch } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import {
  $createRangeSelectionFromDom,
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  DROP_COMMAND,
  type LexicalEditor,
  type TextNode
} from 'lexical'
import type { WorkbenchFileNode } from '../../../../shared/types/workbench'
import { flattenSortedFiles, useWorkbenchStore } from '../../store/workbenchStore'
import { WorkbenchDocumentIcon } from './FileTypeIcon'
import { $createWorkbenchWikiLinkNode } from './WorkbenchWikiLinkNode'
import {
  computeWikiLinkTarget,
  filterWorkspaceFiles,
  resolveWikiLinkTargetFromTree
} from './workbenchWikiLinks'

const WORKSPACE_FILES_MIME = 'application/x-multichat-workspace-files'

function getParentRelativeDir(relativePath: string): string {
  const idx = relativePath.lastIndexOf('/')
  return idx === -1 ? '根目录' : relativePath.slice(0, idx)
}

/**
 * 双链的 @ / [[ 触发匹配。
 * 与 useBasicTypeaheadTriggerMatch 语义一致（行首 / 空白 / 左括号后触发），
 * 但允许查询串包含空格（文件名常带空格）且支持两位触发符 [[。
 */
function wikiLinkTriggerFn(trigger: '@' | '[[') {
  const re =
    trigger === '@'
      ? /(^|\s|\()(@([^\][]{0,75}))$/
      : /(^|\s|\()(\[\[([^\][]{0,75}))$/
  return (text: string, _editor: LexicalEditor): MenuTextMatch | null => {
    const match = re.exec(text)
    if (match === null) return null
    const maybeLeadingWhitespace = match[1]
    const matchingString = match[3]
    return {
      leadOffset: match.index + maybeLeadingWhitespace.length,
      matchingString,
      replaceableString: match[2]
    }
  }
}

class WikiFileOption extends MenuOption {
  file: WorkbenchFileNode

  constructor(file: WorkbenchFileNode) {
    super(file.path)
    this.file = file
  }
}

const AT_TRIGGER_FN = wikiLinkTriggerFn('@')
const BRACKET_TRIGGER_FN = wikiLinkTriggerFn('[[')

/** 从文件树拖拽 payload 中提取工作区文件相对路径列表（忽略目录）。 */
function extractDroppedFilePaths(dataTransfer: DataTransfer): string[] {
  const raw = dataTransfer.getData(WORKSPACE_FILES_MIME)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as Array<{ path?: string; isDirectory?: boolean }>
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item) => item && typeof item.path === 'string' && !item.isDirectory)
      .map((item) => item.path as string)
  } catch {
    return []
  }
}

export default function WorkbenchWikiLinkPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const fileTree = useWorkbenchStore((s) => s.fileTree)
  const fileSort = useWorkbenchStore((s) => s.fileSort)

  const allFiles = useMemo<WorkbenchFileNode[]>(
    () => flattenSortedFiles(fileTree, fileSort),
    [fileTree, fileSort]
  )
  // 两个触发（@ 与 [[）互斥，但各自的 typeahead 实例在不匹配时也会回报 null，
  // 必须分开记录，否则一个实例会把另一个实例的查询覆盖掉。
  const [atQuery, setAtQuery] = useState<string | null>(null)
  const [bracketQuery, setBracketQuery] = useState<string | null>(null)
  const queryString = atQuery ?? bracketQuery

  const filteredFiles = useMemo(
    () => (queryString === null ? [] : filterWorkspaceFiles(allFiles, queryString, 30)),
    [allFiles, queryString]
  )
  const options = useMemo(() => filteredFiles.map((file) => new WikiFileOption(file)), [filteredFiles])

  useEffect(() => {
    const handleClick = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      const host = target.closest('[data-wiki-target]')
      if (!(host instanceof HTMLElement)) return
      event.preventDefault()
      event.stopPropagation()
      const wikiTarget = host.getAttribute('data-wiki-target')
      if (!wikiTarget) return
      const state = useWorkbenchStore.getState()
      const resolution = resolveWikiLinkTargetFromTree(wikiTarget, state.fileTree)
      if (resolution.path) {
        void state.openFile(resolution.path, { forcePermanent: true })
      }
    }

    const attach = (root: HTMLElement | null): (() => void) => {
      if (!root) return () => {}
      root.addEventListener('click', handleClick, true)
      return () => root.removeEventListener('click', handleClick, true)
    }

    let cleanup = attach(editor.getRootElement())
    const unregisterRoot = editor.registerRootListener((root) => {
      cleanup()
      cleanup = attach(root)
    })
    return () => {
      unregisterRoot()
      cleanup()
    }
  }, [editor])

  useEffect(() => {
    return editor.registerCommand(
      DROP_COMMAND,
      (event: DragEvent) => {
        const dataTransfer = event.dataTransfer
        if (!dataTransfer) return false
        const paths = extractDroppedFilePaths(dataTransfer)
        if (paths.length === 0) return false
        event.preventDefault()

        const files = flattenSortedFiles(
          useWorkbenchStore.getState().fileTree,
          useWorkbenchStore.getState().fileSort
        )
        const byPath = new Map(files.map((file) => [file.path, file]))

        editor.update(() => {
          // 用落点计算插入位置：优先 document.caretRangeFromPoint
          let positioned = false
          const caretRangeFromPoint = (
            document as Document & {
              caretRangeFromPoint?: (x: number, y: number) => Range | null
            }
          ).caretRangeFromPoint
          if (typeof caretRangeFromPoint === 'function') {
            const domRange = caretRangeFromPoint.call(document, event.clientX, event.clientY)
            if (domRange) {
              const domSelection = window.getSelection()
              if (domSelection) {
                const previousRanges: Range[] = []
                for (let i = 0; i < domSelection.rangeCount; i++) {
                  previousRanges.push(domSelection.getRangeAt(i).cloneRange())
                }
                domSelection.setBaseAndExtent(
                  domRange.startContainer,
                  domRange.startOffset,
                  domRange.startContainer,
                  domRange.startOffset
                )
                const lexicalSelection = $createRangeSelectionFromDom(domSelection, editor)
                if (lexicalSelection) {
                  $setSelection(lexicalSelection)
                  positioned = true
                }
                domSelection.removeAllRanges()
                for (const range of previousRanges) {
                  domSelection.addRange(range)
                }
              }
            }
          }

          const selection = $getSelection()
          if (!$isRangeSelection(selection)) return
          if (!positioned && !selection.isCollapsed()) return

          const nodes = []
          for (const path of paths) {
            const file = byPath.get(path)
            if (!file) continue
            const target = computeWikiLinkTarget(file, files)
            nodes.push($createWorkbenchWikiLinkNode(target, null), $createTextNode(' '))
          }
          if (nodes.length === 0) return
          selection.insertNodes(nodes)
        })
        return true
      },
      COMMAND_PRIORITY_HIGH
    )
  }, [editor])

  const onSelectOption = useCallback(
    (
      option: WikiFileOption,
      textNodeContainingQuery: TextNode | null,
      closeMenu: () => void
    ): void => {
      const files = flattenSortedFiles(
        useWorkbenchStore.getState().fileTree,
        useWorkbenchStore.getState().fileSort
      )
      const target = computeWikiLinkTarget(option.file, files)
      editor.update(() => {
        const wikiNode = $createWorkbenchWikiLinkNode(target, null)
        if (textNodeContainingQuery) {
          textNodeContainingQuery.replace(wikiNode)
        } else {
          const selection = $getSelection()
          if (!$isRangeSelection(selection)) return
          selection.insertNodes([wikiNode])
        }
        const trailingSpace = $createTextNode(' ')
        wikiNode.insertAfter(trailingSpace)
        trailingSpace.select(1, 1)
      })
      closeMenu()
    },
    [editor]
  )

  const renderMenu: MenuRenderFn<WikiFileOption> = (
    anchorElementRef,
    { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }
  ) =>
    anchorElementRef.current == null
      ? null
      : createPortal(
          <div
            id="typeahead-menu"
            className="workbench-wiki-typeahead min-w-[280px] max-w-[360px] max-h-[300px] overflow-y-auto rounded-xl border border-black/10 dark:border-white/15 bg-white/95 dark:bg-gray-900/95 shadow-float backdrop-blur-xl p-1.5 space-y-0.5 select-none"
          >
            {options.length === 0 ? (
              <div className="py-6 text-center text-label text-text-secondary">未找到匹配文件</div>
            ) : (
              options.map((option, index) => {
                const active = index === selectedIndex
                return (
                  <button
                    key={option.key}
                    type="button"
                    ref={option.setRefElement}
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectOptionAndCleanUp(option)}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                      active
                        ? 'bg-primary/10 text-primary'
                        : 'text-text-primary hover:bg-black/5 dark:hover:bg-white/10'
                    }`}
                  >
                    <WorkbenchDocumentIcon node={option.file} size={15} className="w-[15px] h-[15px]" />
                    <div className="flex-1 min-w-0">
                      <div className={`text-label truncate ${active ? 'font-medium' : ''}`}>
                        {option.file.name}
                      </div>
                      <div className="text-caption text-text-secondary truncate font-mono">
                        {getParentRelativeDir(option.file.path)}
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>,
          anchorElementRef.current
        )

  return (
    <>
      <LexicalTypeaheadMenuPlugin<WikiFileOption>
        onQueryChange={setAtQuery}
        onSelectOption={onSelectOption}
        triggerFn={AT_TRIGGER_FN}
        options={options}
        menuRenderFn={renderMenu}
      />
      <LexicalTypeaheadMenuPlugin<WikiFileOption>
        onQueryChange={setBracketQuery}
        onSelectOption={onSelectOption}
        triggerFn={BRACKET_TRIGGER_FN}
        options={options}
        menuRenderFn={renderMenu}
      />
    </>
  )
}
