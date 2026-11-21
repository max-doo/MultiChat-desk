import { useRef, useState } from 'react'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { AppIcon } from '../icons/AppIcon'
import type {
  WorkbenchSourceEditorHandle,
  SourceToolbarAction
} from './WorkbenchSourceEditor'
import WorkbenchDropDown, {
  WorkbenchDropDownItem,
  WorkbenchDropDownDivider
} from './WorkbenchDropDown'
import WorkbenchUrlInputPopover from './WorkbenchUrlInputPopover'

type SourceBlockType = 'paragraph' | 'h1' | 'h2' | 'h3' | 'h4' | 'bullet' | 'number' | 'check' | 'quote' | 'code'

const SOURCE_BLOCK_LABELS: Record<SourceBlockType, string> = {
  paragraph: '正文段落',
  h1: '一级标题',
  h2: '二级标题',
  h3: '三级标题',
  h4: '四级标题',
  bullet: '无序列表',
  number: '有序列表',
  check: '待办清单',
  quote: '引用区块',
  code: '代码区块'
}

const TABLE_TEMPLATE = '|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n|  |  |  |'

/**
 * 源码模式工具栏：与富文本工具栏同一布局骨架，但操作对象是纯文本。
 * 行内格式通过 wrap 切换 **..** / *..* 等标记；块级格式通过行前缀切换；
 * 撤销/重做依赖 textarea 原生编辑栈；对齐在 Markdown 中无对应语法，不展示。
 */
export default function WorkbenchSourceToolbar({
  editorRef
}: {
  editorRef: React.RefObject<WorkbenchSourceEditorHandle>
}): JSX.Element {
  const editorMode = useWorkbenchStore((s) => s.editorMode)
  const setEditorMode = useWorkbenchStore((s) => s.setEditorMode)
  const isLeftCollapsed = useWorkbenchStore((s) => s.isLeftCollapsed)
  const toggleLeftCollapse = useWorkbenchStore((s) => s.toggleLeftCollapse)

  const lastBlockRef = useRef<SourceBlockType>('paragraph')
  const linkButtonRef = useRef<HTMLButtonElement | null>(null)
  const [linkPopover, setLinkPopover] = useState<{ anchorRect: DOMRect } | null>(null)

  const apply = (action: SourceToolbarAction): void => {
    editorRef.current?.applyAction(action)
  }

  const applyBlock = (type: SourceBlockType): void => {
    lastBlockRef.current = type
    switch (type) {
      case 'paragraph':
        // 去掉常见行前缀，回到普通段落
        apply({ kind: 'linePrefix', prefix: '# ' })
        break
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4': {
        const level = Number(type.slice(1))
        apply({ kind: 'linePrefix', prefix: '#'.repeat(level) + ' ' })
        break
      }
      case 'bullet':
        apply({ kind: 'linePrefix', prefix: '- ' })
        break
      case 'number':
        apply({ kind: 'linePrefix', prefix: '1. ' })
        break
      case 'check':
        apply({ kind: 'linePrefix', prefix: '- [ ] ' })
        break
      case 'quote':
        apply({ kind: 'linePrefix', prefix: '> ' })
        break
      case 'code':
        apply({ kind: 'insert', text: '```\n\n```', ensureBlankLine: true })
        break
    }
  }

  const insertLink = (): void => {
    const button = linkButtonRef.current
    if (!button) return
    setLinkPopover({ anchorRect: button.getBoundingClientRect() })
  }

  const insertImage = (): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.onchange = () => {
      const files = Array.from(input.files ?? [])
      if (!files.length) return
      void (async () => {
        const workspacePath = useWorkbenchStore.getState().workspacePath
        const activeFilePath = useWorkbenchStore.getState().activeFilePath
        if (!workspacePath || !activeFilePath) return
        for (const file of files) {
          try {
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const r = new FileReader()
              r.onload = () => resolve(r.result as string)
              r.onerror = reject
              r.readAsDataURL(file)
            })
            const res = await window.api.workbench.saveImage(workspacePath, activeFilePath, {
              dataUrl,
              fileName: file.name
            })
            if (res.success && res.data) {
              apply({ kind: 'insert', text: `![${file.name}](${res.data.relativePath})` })
            }
          } catch (err) {
            console.error('[SourceToolbar] 插入图片失败:', err)
          }
        }
        void useWorkbenchStore.getState().loadFileTree()
      })()
    }
    input.click()
  }

  // 撤销/重做走浏览器 textarea 原生栈
  const handleUndo = (): void => {
    document.execCommand('undo')
  }
  const handleRedo = (): void => {
    document.execCommand('redo')
  }

  const itemClass = (active: boolean) =>
    `w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors ${
      active
        ? 'bg-primary/10 text-primary font-medium'
        : 'text-text-primary hover:bg-black/5 dark:hover:bg-white/5'
    }`

  const iconBtnClass = (active: boolean) =>
    `w-8 h-8 flex items-center justify-center rounded-md transition-colors ${
      active
        ? 'bg-primary/15 text-primary'
        : 'text-text-primary hover:bg-black/5 dark:hover:bg-white/10'
    }`

  return (
    <>
      <div className="h-12 px-3 bg-white/70 dark:bg-gray-800/70 backdrop-blur-md border-b border-black/5 dark:border-white/5 flex items-center justify-between gap-2 shrink-0 select-none text-sm">
      <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar">
        {isLeftCollapsed && (
          <>
            <button
              type="button"
              onClick={toggleLeftCollapse}
              className="w-7 h-7 flex items-center justify-center rounded-full text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 transition-all duration-200"
              title="展开侧边栏"
              aria-label="展开侧边栏"
            >
              <AppIcon name="left_panel_open" size={16} />
            </button>
            <div className="w-[1px] h-4 bg-black/10 dark:bg-white/10 mx-1 shrink-0" />
          </>
        )}

        <button
          type="button"
          onClick={handleUndo}
          className="w-8 h-8 flex items-center justify-center rounded-md text-text-primary hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          title="撤销 (Ctrl+Z)"
        >
          <AppIcon name="undo" size={20} />
        </button>
        <button
          type="button"
          onClick={handleRedo}
          className="w-8 h-8 flex items-center justify-center rounded-md text-text-primary hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          title="重做 (Ctrl+Y)"
        >
          <AppIcon name="redo" size={20} />
        </button>

        <div className="w-[1px] h-4 bg-black/10 dark:bg-white/10 mx-1 shrink-0" />

        <WorkbenchDropDown
          buttonAriaLabel="段落格式选项"
          buttonTitle="段落格式"
          buttonClassName="h-8 px-2.5 flex items-center gap-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 text-text-primary transition-colors font-medium text-sm"
          buttonContent={
            <>
              <span className="min-w-[3.5rem] text-left">{SOURCE_BLOCK_LABELS[lastBlockRef.current]}</span>
              <AppIcon name="arrow_drop_down" size={18} />
            </>
          }
        >
          <WorkbenchDropDownItem className={itemClass(false)} onClick={() => applyBlock('paragraph')}>
            <AppIcon name="notes" size={18} className="text-text-secondary" />
            <span>正文段落</span>
          </WorkbenchDropDownItem>
          {(['h1', 'h2', 'h3', 'h4'] as const).map((level) => (
            <WorkbenchDropDownItem
              key={level}
              className={itemClass(false)}
              onClick={() => applyBlock(level)}
            >
              <span className="text-xs font-mono text-text-secondary w-5">{level.toUpperCase()}</span>
              <span className={level === 'h1' ? 'font-bold' : level === 'h2' ? 'font-semibold' : ''}>
                {SOURCE_BLOCK_LABELS[level]}
              </span>
            </WorkbenchDropDownItem>
          ))}
          <WorkbenchDropDownDivider />
          <WorkbenchDropDownItem className={itemClass(false)} onClick={() => applyBlock('bullet')}>
            <AppIcon name="format_list_bulleted" size={18} className="text-text-secondary" />
            <span>无序列表</span>
          </WorkbenchDropDownItem>
          <WorkbenchDropDownItem className={itemClass(false)} onClick={() => applyBlock('number')}>
            <AppIcon name="format_list_numbered" size={18} className="text-text-secondary" />
            <span>有序列表</span>
          </WorkbenchDropDownItem>
          <WorkbenchDropDownItem className={itemClass(false)} onClick={() => applyBlock('check')}>
            <AppIcon name="checklist" size={18} className="text-text-secondary" />
            <span>待办清单</span>
          </WorkbenchDropDownItem>
          <WorkbenchDropDownDivider />
          <WorkbenchDropDownItem className={itemClass(false)} onClick={() => applyBlock('quote')}>
            <AppIcon name="format_quote" size={18} className="text-text-secondary" />
            <span>引用区块</span>
          </WorkbenchDropDownItem>
          <WorkbenchDropDownItem className={itemClass(false)} onClick={() => applyBlock('code')}>
            <AppIcon name="terminal" size={18} className="text-text-secondary" />
            <span>代码区块</span>
          </WorkbenchDropDownItem>
        </WorkbenchDropDown>

        <div className="w-[1px] h-4 bg-black/10 dark:bg-white/10 mx-1 shrink-0" />

        <button
          type="button"
          onClick={() => apply({ kind: 'wrap', before: '**' })}
          className={iconBtnClass(false)}
          title="粗体 (**text**)"
          aria-label="粗体"
        >
          <AppIcon name="format_bold" size={20} />
        </button>
        <button
          type="button"
          onClick={() => apply({ kind: 'wrap', before: '*' })}
          className={iconBtnClass(false)}
          title="斜体 (*text*)"
          aria-label="斜体"
        >
          <AppIcon name="format_italic" size={20} />
        </button>
        <button
          type="button"
          onClick={() => apply({ kind: 'wrap', before: '<u>', after: '</u>' })}
          className={iconBtnClass(false)}
          title="下划线 (<u>text</u>)"
          aria-label="下划线"
        >
          <AppIcon name="format_underlined" size={20} />
        </button>
        <button
          type="button"
          onClick={() => apply({ kind: 'wrap', before: '~~' })}
          className={iconBtnClass(false)}
          title="删除线 (~~text~~)"
          aria-label="删除线"
        >
          <AppIcon name="format_strikethrough" size={20} />
        </button>
        <button
          type="button"
          onClick={() => apply({ kind: 'wrap', before: '`' })}
          className={iconBtnClass(false)}
          title="行内代码 (`code`)"
          aria-label="行内代码"
        >
          <AppIcon name="code" size={20} />
        </button>
        <button
          type="button"
          onClick={() => apply({ kind: 'wrap', before: '==' })}
          className={iconBtnClass(false)}
          title="高亮 (==text==)"
          aria-label="高亮"
        >
          <AppIcon name="ink_highlighter" size={20} />
        </button>

        <div className="w-[1px] h-4 bg-black/10 dark:bg-white/10 mx-1 shrink-0" />

        <button
          type="button"
          onClick={() => applyBlock('bullet')}
          className={iconBtnClass(false)}
          title="无序列表"
        >
          <AppIcon name="format_list_bulleted" size={20} />
        </button>
        <button
          type="button"
          onClick={() => applyBlock('number')}
          className={iconBtnClass(false)}
          title="有序列表"
        >
          <AppIcon name="format_list_numbered" size={20} />
        </button>
        <button
          type="button"
          onClick={() => applyBlock('check')}
          className={iconBtnClass(false)}
          title="待办清单 (Checklist)"
        >
          <AppIcon name="checklist" size={20} />
        </button>

        <div className="w-[1px] h-4 bg-black/10 dark:bg-white/10 mx-1 shrink-0" />

        <button
          type="button"
          onClick={() => apply({ kind: 'insert', text: TABLE_TEMPLATE, ensureBlankLine: true })}
          className={iconBtnClass(false)}
          title="插入表格 (3x3)"
        >
          <AppIcon name="table_chart" size={20} />
        </button>
        <button
          type="button"
          onClick={() => apply({ kind: 'insert', text: '---\n', ensureBlankLine: true })}
          className={iconBtnClass(false)}
          title="插入水平分割线"
        >
          <AppIcon name="horizontal_rule" size={20} />
        </button>
        <button
          ref={linkButtonRef}
          type="button"
          onClick={insertLink}
          className={iconBtnClass(false)}
          title="插入超链接"
        >
          <AppIcon name="link" size={20} />
        </button>
        <button
          type="button"
          onClick={insertImage}
          className={iconBtnClass(false)}
          title="插入图片"
        >
          <AppIcon name="image" size={20} />
        </button>
      </div>

      <div className="flex items-center gap-2.5 text-text-secondary text-sm shrink-0">
        <div className="flex items-center p-0.5 bg-black/5 dark:bg-white/5 rounded-lg border border-black/5 dark:border-white/5">
          <button
            type="button"
            onClick={() => setEditorMode('wysiwyg')}
            className={`px-2.5 py-1 rounded-md text-sm font-medium transition-all ${
              editorMode === 'wysiwyg'
                ? 'bg-white dark:bg-gray-700 text-primary shadow-xs'
                : 'text-text-secondary hover:text-text-primary'
            }`}
            title="预览模式"
          >
            预览
          </button>
          <button
            type="button"
            onClick={() => setEditorMode('source')}
            className={`px-2.5 py-1 rounded-md text-sm font-medium transition-all ${
              editorMode === 'source'
                ? 'bg-white dark:bg-gray-700 text-primary shadow-xs'
                : 'text-text-secondary hover:text-text-primary'
            }`}
            title="原始 Markdown 源码模式"
          >
            源码
          </button>
        </div>
      </div>
      </div>
      {linkPopover && (
        <WorkbenchUrlInputPopover
          anchorRect={linkPopover.anchorRect}
          initialUrl={null}
          onApply={(url) => {
            apply({
              kind: 'wrap',
              before: '[',
              after: `](${url})`,
              placeholder: '链接文本'
            })
          }}
          onClose={() => setLinkPopover(null)}
        />
      )}
    </>
  )
}
