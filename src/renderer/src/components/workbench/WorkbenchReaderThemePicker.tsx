import type { ReaderBackgroundTheme } from '../../store/workbenchStore'
import { AppIcon } from '../icons/AppIcon'
import WorkbenchDropDown, { WorkbenchDropDownItem } from './WorkbenchDropDown'

export interface ReaderThemePreset {
  id: ReaderBackgroundTheme
  label: string
  swatch: string
}

export const READER_THEME_PRESETS: ReaderThemePreset[] = [
  { id: 'light', label: '默认纸白', swatch: '#FFFFFF' },
  { id: 'sepia', label: '羊皮纸', swatch: '#F7F1E3' },
  { id: 'green', label: '豆沙绿', swatch: '#E3EDCD' },
  { id: 'dark', label: '中性暗黑', swatch: '#1E1E1E' }
]

interface WorkbenchReaderThemePickerProps {
  value: ReaderBackgroundTheme
  onChange: (theme: ReaderBackgroundTheme) => void
}

export default function WorkbenchReaderThemePicker({
  value,
  onChange
}: WorkbenchReaderThemePickerProps): JSX.Element {
  const isDark = value === 'dark'
  const current = READER_THEME_PRESETS.find((item) => item.id === value) ?? READER_THEME_PRESETS[0]

  return (
    <WorkbenchDropDown
      isDark={isDark}
      buttonAriaLabel="切换阅读背景颜色"
      buttonTitle={`背景颜色 (${current.label})`}
      buttonClassName={`h-8 px-2 flex items-center gap-1.5 rounded-md transition-colors text-body ${
        isDark
          ? 'text-[#E4E4E7] hover:bg-white/10'
          : 'text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10'
      }`}
      buttonContent={
        <>
          <span
            className={`w-3.5 h-3.5 rounded-full shrink-0 border ${
              isDark ? 'border-white/35' : 'border-black/20'
            }`}
            style={{ backgroundColor: current.swatch }}
          />
          <span>背景</span>
          <AppIcon name="arrow_drop_down" size={16} />
        </>
      }
    >
      <div className="min-w-[144px]">
        {READER_THEME_PRESETS.map((preset) => {
          const active = preset.id === value
          return (
            <WorkbenchDropDownItem
              key={preset.id}
              onClick={() => onChange(preset.id)}
              className={`w-full text-left px-3 py-1.5 flex items-center gap-2.5 transition-colors ${
                active
                  ? isDark
                    ? 'bg-primary/20 text-blue-300 font-medium'
                    : 'bg-primary/10 text-primary font-medium'
                  : isDark
                    ? 'text-[#E4E4E7] hover:bg-white/10'
                    : 'text-text-primary hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              <span
                className={`w-3.5 h-3.5 rounded-full shrink-0 border ${
                  preset.id === 'dark'
                    ? isDark
                      ? 'border-white/35'
                      : 'border-black/20'
                    : 'border-black/15'
                }`}
                style={{ backgroundColor: preset.swatch }}
              />
              <span className="flex-1 text-body">{preset.label}</span>
              {active && <AppIcon name="check" size={14} className="shrink-0" />}
            </WorkbenchDropDownItem>
          )
        })}
      </div>
    </WorkbenchDropDown>
  )
}
