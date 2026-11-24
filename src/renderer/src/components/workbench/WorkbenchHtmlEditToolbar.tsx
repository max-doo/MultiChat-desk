import {
  useEffect,
  useRef,
  useState
} from 'react'
import { AppIcon } from '../icons/AppIcon'
import {
  ColorFill,
  ColorPickerMenu,
  parseComputedColor
} from './WorkbenchHtmlColorPicker'
import {
  WORKBENCH_FLOATING_TOOLBAR_BASE_CLASS,
  WorkbenchFloatingToolbarButton,
  WorkbenchFloatingToolbarDivider
} from './WorkbenchFloatingToolbarChrome'

export type WorkbenchHtmlEditCommand =
  | 'bold'
  | 'italic'
  | 'color'
  | 'backgroundColor'
  | 'fontUp'
  | 'fontDown'
  | 'add'
  | 'duplicate'
  | 'delete'

interface WorkbenchHtmlEditToolbarProps {
  canReorder: boolean
  textColor: string
  backgroundColor: string
  onCommand: (
    command: WorkbenchHtmlEditCommand,
    value?: string,
    options?: { preserveFocus?: boolean }
  ) => void
}

type ColorPickerKind = 'text' | 'background'

const TEXT_PALETTE = [
  '#0f172a',
  '#475569',
  '#94a3b8',
  '#ffffff',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899'
]

const BACKGROUND_PALETTE = [
  '#ffffff',
  '#f8fafc',
  '#f1f5f9',
  '#e2e8f0',
  '#fef3c7',
  '#fde68a',
  '#fee2e2',
  '#fecaca',
  '#dcfce7',
  '#dbeafe',
  '#ede9fe'
]

/**
 * 选中页面元素后浮出的工具条。容器、按钮态和图标与编辑器浮动格式条共用同一套
 * chrome 组件；这里只替换具体命令。
 */
export default function WorkbenchHtmlEditToolbar({
  canReorder,
  textColor,
  backgroundColor,
  onCommand
}: WorkbenchHtmlEditToolbarProps): JSX.Element {
  const parsedTextColor = parseComputedColor(textColor, '#1f2937')
  const parsedBackgroundColor = parseComputedColor(backgroundColor, '#ffffff')
  const backgroundTransparent = parsedBackgroundColor.alpha <= 0.001
  const [openPicker, setOpenPicker] = useState<ColorPickerKind | null>(null)
  const pickerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!openPicker) return
    const closeOutside = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-html-color-trigger]')) {
        return
      }
      if (target instanceof Node && pickerRef.current?.contains(target)) return
      setOpenPicker(null)
    }
    const closeOnFocusOutside = (event: FocusEvent): void => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-html-color-trigger]')) {
        return
      }
      if (target instanceof Node && pickerRef.current?.contains(target)) return
      setOpenPicker(null)
    }
    const closeOnKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpenPicker(null)
    }
    const closeOnWindowBlur = (): void => setOpenPicker(null)

    window.addEventListener('pointerdown', closeOutside, true)
    document.addEventListener('focusin', closeOnFocusOutside, true)
    window.addEventListener('keydown', closeOnKeyDown)
    window.addEventListener('blur', closeOnWindowBlur)
    return () => {
      window.removeEventListener('pointerdown', closeOutside, true)
      document.removeEventListener('focusin', closeOnFocusOutside, true)
      window.removeEventListener('keydown', closeOnKeyDown)
      window.removeEventListener('blur', closeOnWindowBlur)
    }
  }, [openPicker])

  const chooseColor = (
    command: 'color' | 'backgroundColor',
    value: string
  ): void => {
    onCommand(command, value)
    setOpenPicker(null)
  }

  const applyColor = (
    command: 'color' | 'backgroundColor',
    value: string
  ): void => {
    // 实时调色时保持父窗口焦点，避免每次输入都让 iframe 抢走焦点并关闭菜单。
    onCommand(command, value, { preserveFocus: true })
  }

  const togglePicker = (kind: ColorPickerKind): void => {
    setOpenPicker((current) => (current === kind ? null : kind))
  }

  const triggerClass = (active: boolean): string =>
    `relative flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
      active
        ? 'bg-primary/15 text-primary'
        : 'text-text-primary hover:bg-black/5 dark:hover:bg-white/10'
    }`

  return (
    <div
      role="toolbar"
      aria-label="HTML 编辑工具栏"
      className={`${WORKBENCH_FLOATING_TOOLBAR_BASE_CLASS} text-text-primary`}
      onMouseDown={(event) => {
        if ((event.target as HTMLElement).tagName !== 'INPUT') event.preventDefault()
      }}
    >
      <WorkbenchFloatingToolbarButton
        icon="format_bold"
        label="加粗"
        onClick={() => onCommand('bold')}
      />
      <WorkbenchFloatingToolbarButton
        icon="format_italic"
        label="斜体"
        onClick={() => onCommand('italic')}
      />
      <WorkbenchFloatingToolbarButton
        label="缩小字号"
        onClick={() => onCommand('fontDown')}
      >
        <span className="text-label font-semibold leading-none">A-</span>
      </WorkbenchFloatingToolbarButton>
      <WorkbenchFloatingToolbarButton
        label="放大字号"
        onClick={() => onCommand('fontUp')}
      >
        <span className="text-label font-semibold leading-none">A+</span>
      </WorkbenchFloatingToolbarButton>

      <div className="relative">
        <button
          type="button"
          data-html-color-trigger
          title={`文字颜色 ${parsedTextColor.hex.toUpperCase()}`}
          aria-label="文字颜色"
          aria-haspopup="dialog"
          aria-expanded={openPicker === 'text'}
          onClick={() => togglePicker('text')}
          className={triggerClass(openPicker === 'text')}
        >
          <AppIcon name="format_color_text" size={19} />
          <ColorFill
            color={parsedTextColor.source}
            className="absolute bottom-1 left-1.5 right-1.5 h-[3px] rounded-full border border-black/10 dark:border-white/20"
          />
        </button>
        {openPicker === 'text' && (
          <div
            ref={pickerRef}
            className="absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2"
            onBlur={(event) => {
              const next = event.relatedTarget
              if (next instanceof Node && event.currentTarget.contains(next)) return
              setOpenPicker(null)
            }}
          >
            <ColorPickerMenu
              label="文字颜色"
              value={parsedTextColor}
              palette={TEXT_PALETTE}
              onApply={(value) => applyColor('color', value)}
              onChoose={(value) => chooseColor('color', value)}
            />
          </div>
        )}
      </div>

      <div className="relative">
        <button
          type="button"
          data-html-color-trigger
          title={
            backgroundTransparent
              ? '背景颜色 · 透明'
              : `背景颜色 ${parsedBackgroundColor.hex.toUpperCase()}`
          }
          aria-label="背景颜色"
          aria-haspopup="dialog"
          aria-expanded={openPicker === 'background'}
          onClick={() => togglePicker('background')}
          className={triggerClass(openPicker === 'background')}
        >
          <AppIcon name="format_color_fill" size={19} />
          <ColorFill
            color={parsedBackgroundColor.source}
            className="absolute bottom-1 left-1.5 right-1.5 h-[3px] rounded-full border border-black/10 dark:border-white/20"
          />
        </button>
        {openPicker === 'background' && (
          <div
            ref={pickerRef}
            className="absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2"
            onBlur={(event) => {
              const next = event.relatedTarget
              if (next instanceof Node && event.currentTarget.contains(next)) return
              setOpenPicker(null)
            }}
          >
            <ColorPickerMenu
              label="背景颜色"
              value={parsedBackgroundColor}
              palette={BACKGROUND_PALETTE}
              includeTransparent
              onApply={(value) => applyColor('backgroundColor', value)}
              onChoose={(value) => chooseColor('backgroundColor', value)}
            />
          </div>
        )}
      </div>

      <WorkbenchFloatingToolbarDivider />

      <WorkbenchFloatingToolbarButton
        icon="add"
        label="插入同款元素"
        disabled={!canReorder}
        onClick={() => onCommand('add')}
      />
      <WorkbenchFloatingToolbarButton
        icon="file_copy"
        label="复制当前元素"
        disabled={!canReorder}
        onClick={() => onCommand('duplicate')}
      />
      <WorkbenchFloatingToolbarButton
        icon="delete"
        label="删除当前元素"
        disabled={!canReorder}
        onClick={() => onCommand('delete')}
      />
    </div>
  )
}
