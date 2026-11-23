import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'

export interface ParsedColor {
  hex: string
  alpha: number
  source: string
}

interface RgbColor {
  r: number
  g: number
  b: number
}

interface HsvColor {
  h: number
  s: number
  v: number
}

const CHECKERBOARD_STYLE: CSSProperties = {
  backgroundColor: '#ffffff',
  backgroundImage:
    'linear-gradient(45deg, #cbd5e1 25%, transparent 25%), linear-gradient(-45deg, #cbd5e1 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #cbd5e1 75%), linear-gradient(-45deg, transparent 75%, #cbd5e1 75%)',
  backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0',
  backgroundSize: '6px 6px'
}

const HUE_GRADIENT =
  'linear-gradient(to right, #ff0000 0%, #ffff00 16.66%, #00ff00 33.33%, #00ffff 50%, #0000ff 66.66%, #ff00ff 83.33%, #ff0000 100%)'

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function parseColorChannel(token: string, max: number): number {
  const value = parseFloat(token)
  if (!Number.isFinite(value)) return 0
  return clamp(token.endsWith('%') ? (value / 100) * max : value, 0, max)
}

function parseAlphaChannel(token: string | undefined): number {
  if (!token) return 1
  const value = parseFloat(token)
  if (!Number.isFinite(value)) return 1
  return clamp(token.endsWith('%') ? value / 100 : value, 0, 1)
}

function expandHexDigits(digits: string): string {
  if (digits.length === 3 || digits.length === 4) {
    return digits
      .split('')
      .map((digit) => `${digit}${digit}`)
      .join('')
  }
  return digits
}

function hexToRgb(hex: string): RgbColor {
  const digits = expandHexDigits(hex.trim().replace(/^#/, ''))
  if (!/^[0-9a-f]{6}$/i.test(digits)) return { r: 0, g: 0, b: 0 }
  return {
    r: parseInt(digits.slice(0, 2), 16),
    g: parseInt(digits.slice(2, 4), 16),
    b: parseInt(digits.slice(4, 6), 16)
  }
}

function rgbToHex({ r, g, b }: RgbColor): string {
  const toHex = (channel: number): string =>
    clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function rgbToHsv({ r, g, b }: RgbColor): HsvColor {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  let hue = 0

  if (delta > 0) {
    if (max === red) hue = ((green - blue) / delta) % 6
    else if (max === green) hue = (blue - red) / delta + 2
    else hue = (red - green) / delta + 4
    hue *= 60
    if (hue < 0) hue += 360
  }

  return {
    h: hue,
    s: max === 0 ? 0 : delta / max,
    v: max
  }
}

function hsvToRgb({ h, s, v }: HsvColor): RgbColor {
  const hue = ((h % 360) + 360) % 360
  const chroma = v * s
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const match = v - chroma
  let red = 0
  let green = 0
  let blue = 0

  if (hue < 60) {
    red = chroma
    green = x
  } else if (hue < 120) {
    red = x
    green = chroma
  } else if (hue < 180) {
    green = chroma
    blue = x
  } else if (hue < 240) {
    green = x
    blue = chroma
  } else if (hue < 300) {
    red = x
    blue = chroma
  } else {
    red = chroma
    blue = x
  }

  return {
    r: Math.round((red + match) * 255),
    g: Math.round((green + match) * 255),
    b: Math.round((blue + match) * 255)
  }
}

function formatColorValue(hex: string, alpha: number): string {
  const normalizedAlpha = clamp(alpha, 0, 1)
  if (normalizedAlpha >= 0.999) return hex.toLowerCase()
  const { r, g, b } = hexToRgb(hex)
  const alphaText = Number(normalizedAlpha.toFixed(3)).toString()
  return `rgba(${r}, ${g}, ${b}, ${alphaText})`
}

function colorSignature(hex: string, alpha: number): string {
  return `${hex.toLowerCase()}:${clamp(alpha, 0, 1).toFixed(3)}`
}

function normalizeHexInput(
  value: string
): { hex: string; alpha: number | null } | null {
  const digits = value.trim().replace(/^#/, '')
  if (!/^[0-9a-f]{3}$|^[0-9a-f]{4}$|^[0-9a-f]{6}$|^[0-9a-f]{8}$/i.test(digits)) {
    return null
  }
  const expanded = expandHexDigits(digits)
  return {
    hex: `#${expanded.slice(0, 6).toLowerCase()}`,
    alpha:
      expanded.length === 8
        ? parseInt(expanded.slice(6, 8), 16) / 255
        : null
  }
}

export function parseComputedColor(value: string, fallback: string): ParsedColor {
  const normalized = value.trim()
  if (normalized.toLowerCase() === 'transparent') {
    return { hex: '#000000', alpha: 0, source: 'transparent' }
  }

  const rgb = normalized.match(/^rgba?\(([^)]+)\)$/i)
  if (rgb) {
    const tokens = rgb[1].split(/[\s,/]+/).filter(Boolean)
    if (tokens.length >= 3) {
      const red = parseColorChannel(tokens[0], 255)
      const green = parseColorChannel(tokens[1], 255)
      const blue = parseColorChannel(tokens[2], 255)
      return {
        hex: rgbToHex({ r: red, g: green, b: blue }),
        alpha: parseAlphaChannel(tokens[3]),
        source: normalized
      }
    }
  }

  const hex = normalized.match(/^#([0-9a-f]{3,8})$/i)
  if (hex) {
    const expanded = expandHexDigits(hex[1])
    if (expanded.length === 6 || expanded.length === 8) {
      return {
        hex: `#${expanded.slice(0, 6).toLowerCase()}`,
        alpha:
          expanded.length === 8
            ? parseInt(expanded.slice(6, 8), 16) / 255
            : 1,
        source: normalized
      }
    }
  }

  return { hex: fallback, alpha: 1, source: fallback }
}

export function ColorFill({
  color,
  className = ''
}: {
  color: string
  className?: string
}): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={`overflow-hidden ${className}`}
      style={CHECKERBOARD_STYLE}
    >
      <span className="block h-full w-full" style={{ backgroundColor: color }} />
    </span>
  )
}

function ColorSlider({
  label,
  value,
  max,
  step,
  valueText,
  onChange,
  style,
  markerStyle
}: {
  label: string
  value: number
  max: number
  step: number
  valueText: string
  onChange: (value: number) => void
  style: CSSProperties
  markerStyle?: CSSProperties
}): JSX.Element {
  const trackRef = useRef<HTMLDivElement | null>(null)

  const updateFromPointer = (
    event: ReactPointerEvent<HTMLDivElement>
  ): void => {
    const track = trackRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()
    if (rect.width <= 0) return
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1)
    onChange(ratio * max)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const multiplier = event.shiftKey ? 10 : 1
    let next = value
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      next -= step * multiplier
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      next += step * multiplier
    } else if (event.key === 'Home') {
      next = 0
    } else if (event.key === 'End') {
      next = max
    } else {
      return
    }
    event.preventDefault()
    onChange(clamp(next, 0, max))
  }

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      aria-valuetext={valueText}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        updateFromPointer(event)
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        updateFromPointer(event)
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      }}
      className="relative h-3.5 touch-none cursor-pointer rounded-full border border-black/10 outline-none focus-visible:ring-2 focus-visible:ring-primary/30 dark:border-white/10"
      style={style}
    >
      <span
        aria-hidden="true"
        className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(15,23,42,0.35)]"
        style={{
          left: `${(clamp(value, 0, max) / max) * 100}%`,
          ...markerStyle
        }}
      />
    </div>
  )
}

function SaturationValueArea({
  hsv,
  onChange
}: {
  hsv: HsvColor
  onChange: (hsv: HsvColor) => void
}): JSX.Element {
  const areaRef = useRef<HTMLDivElement | null>(null)
  const markerHex = rgbToHex(hsvToRgb(hsv))

  const updateFromPointer = (
    event: ReactPointerEvent<HTMLDivElement>
  ): void => {
    const area = areaRef.current
    if (!area) return
    const rect = area.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    onChange({
      ...hsv,
      s: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      v: clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1)
    })
  }

  return (
    <div
      ref={areaRef}
      role="group"
      tabIndex={0}
      aria-label="饱和度和明度"
      onKeyDown={(event) => {
        const multiplier = event.shiftKey ? 0.1 : 0.01
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          onChange({ ...hsv, s: clamp(hsv.s - multiplier, 0, 1) })
        } else if (event.key === 'ArrowRight') {
          event.preventDefault()
          onChange({ ...hsv, s: clamp(hsv.s + multiplier, 0, 1) })
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          onChange({ ...hsv, v: clamp(hsv.v + multiplier, 0, 1) })
        } else if (event.key === 'ArrowDown') {
          event.preventDefault()
          onChange({ ...hsv, v: clamp(hsv.v - multiplier, 0, 1) })
        }
      }}
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        updateFromPointer(event)
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        updateFromPointer(event)
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      }}
      data-html-color-area
      className="relative mt-2.5 h-[104px] w-full touch-none cursor-crosshair overflow-hidden rounded-lg border border-black/10 outline-none focus-visible:ring-2 focus-visible:ring-primary/30 dark:border-white/10"
      style={{
        backgroundColor: `hsl(${hsv.h} 100% 50%)`,
        backgroundImage:
          'linear-gradient(to top, #000000, transparent), linear-gradient(to right, #ffffff, transparent)'
      }}
    >
      <span
        aria-hidden="true"
        className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(15,23,42,0.45)]"
        style={{
          left: `calc(${hsv.s * 100}% + ${(0.5 - hsv.s) * 14}px)`,
          top: `calc(${(1 - hsv.v) * 100}% + ${(hsv.v - 0.5) * 14}px)`,
          backgroundColor: markerHex
        }}
      />
    </div>
  )
}

export function ColorPickerMenu({
  label,
  value,
  palette,
  includeTransparent,
  onApply,
  onChoose
}: {
  label: string
  value: ParsedColor
  palette: string[]
  includeTransparent?: boolean
  onApply: (value: string) => void
  onChoose: (value: string) => void
}): JSX.Element {
  const [hsv, setHsv] = useState<HsvColor>(() =>
    rgbToHsv(hexToRgb(value.hex))
  )
  const [alpha, setAlpha] = useState(value.alpha)
  const [draft, setDraft] = useState(value.hex.toUpperCase())
  const lastEmittedRef = useRef('')

  useEffect(() => {
    const signature = colorSignature(value.hex, value.alpha)
    if (lastEmittedRef.current === signature) return
    setHsv(rgbToHsv(hexToRgb(value.hex)))
    setAlpha(value.alpha)
    setDraft(value.hex.toUpperCase())
  }, [value.alpha, value.hex])

  const currentHex = rgbToHex(hsvToRgb(hsv))
  const currentColor = formatColorValue(currentHex, alpha)

  const commitHsv = (
    nextHsv: HsvColor,
    nextAlpha: number,
    close: boolean
  ): void => {
    const hex = rgbToHex(hsvToRgb(nextHsv))
    const nextValue = formatColorValue(hex, nextAlpha)
    lastEmittedRef.current = colorSignature(hex, nextAlpha)
    setHsv(nextHsv)
    setAlpha(nextAlpha)
    setDraft(hex.toUpperCase())
    if (close) onChoose(nextValue)
    else onApply(nextValue)
  }

  const commitHex = (raw: string, close: boolean): void => {
    const parsed = normalizeHexInput(raw)
    if (!parsed) {
      setDraft(value.hex.toUpperCase())
      return
    }
    const nextAlpha = parsed.alpha ?? alpha
    const nextHsv = rgbToHsv(hexToRgb(parsed.hex))
    const nextValue = formatColorValue(parsed.hex, nextAlpha)
    lastEmittedRef.current = colorSignature(parsed.hex, nextAlpha)
    setHsv(nextHsv)
    setAlpha(nextAlpha)
    setDraft(parsed.hex.toUpperCase())
    if (close) onChoose(nextValue)
    else onApply(nextValue)
  }

  return (
    <div
      role="dialog"
      aria-label={`${label}选择器`}
      className="w-[228px] rounded-xl border border-black/10 bg-white p-2.5 text-sm shadow-2xl dark:border-white/10 dark:bg-gray-800"
    >
      <div className="flex items-center gap-2">
        <ColorFill
          color={currentColor}
          className="h-7 w-7 shrink-0 rounded-md border border-black/10 dark:border-white/15"
        />
        <input
          type="text"
          value={draft}
          maxLength={9}
          spellCheck={false}
          aria-label={`自定义${label}`}
          placeholder="#RRGGBB"
          onChange={(event) => {
            const next = event.target.value
            if (!/^#?[0-9a-f]*$/i.test(next)) return
            setDraft(next)
            const digits = next.trim().replace(/^#/, '')
            if (digits.length === 6 || digits.length === 8) {
              commitHex(next, false)
            }
          }}
          onBlur={() => commitHex(draft, false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitHex(draft, true)
            }
          }}
          className="h-7 min-w-0 flex-1 rounded-md border border-black/10 bg-black/[0.02] px-2 font-mono text-[11px] uppercase text-text-primary outline-none focus:border-primary dark:border-white/10 dark:bg-white/[0.03]"
        />
        <span className="w-8 shrink-0 text-right font-mono text-[10px] tabular-nums text-text-secondary">
          {Math.round(alpha * 100)}%
        </span>
      </div>

      <SaturationValueArea
        hsv={hsv}
        onChange={(nextHsv) => commitHsv(nextHsv, alpha, false)}
      />

      <div className="mt-2.5">
        <ColorSlider
          label="色相"
          value={hsv.h}
          max={360}
          step={1}
          valueText={`${Math.round(hsv.h)}°`}
          onChange={(nextHue) =>
            commitHsv({ ...hsv, h: nextHue }, alpha, false)
          }
          style={{ backgroundImage: HUE_GRADIENT }}
          markerStyle={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
        />
      </div>

      <div className="mt-2">
        <div
          className="relative rounded-full border border-black/10 dark:border-white/10"
        >
          <div
            className="absolute inset-0 overflow-hidden rounded-full"
            style={CHECKERBOARD_STYLE}
          >
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: `linear-gradient(to right, transparent, ${currentHex})`
              }}
            />
          </div>
          <ColorSlider
            label="不透明度"
            value={alpha * 100}
            max={100}
            step={1}
            valueText={`${Math.round(alpha * 100)}%`}
            onChange={(nextAlpha) =>
              commitHsv(hsv, clamp(nextAlpha / 100, 0, 1), false)
            }
            style={{ background: 'transparent', borderColor: 'transparent' }}
            markerStyle={{ backgroundColor: currentHex }}
          />
        </div>
      </div>

      <div className="mt-2.5 grid grid-cols-6 gap-1.5">
        {includeTransparent && (
          <button
            type="button"
            title="透明"
            aria-label="透明背景"
            aria-pressed={alpha <= 0.001}
            onClick={() => onChoose('transparent')}
            className={`relative h-5 w-5 overflow-hidden rounded-[4px] border transition-transform hover:scale-110 ${
              alpha <= 0.001
                ? 'border-primary ring-2 ring-primary/30 ring-offset-1 ring-offset-white dark:ring-offset-gray-800'
                : 'border-black/15 dark:border-white/20'
            }`}
          >
            <span className="absolute inset-0" style={CHECKERBOARD_STYLE} />
          </button>
        )}
        {palette.map((color) => {
          const selected =
            alpha >= 0.999 && currentHex.toLowerCase() === color.toLowerCase()
          return (
            <button
              key={color}
              type="button"
              title={color.toUpperCase()}
              aria-label={`${label} ${color.toUpperCase()}`}
              aria-pressed={selected}
              onClick={() => onChoose(color)}
              className={`h-5 w-5 rounded-[4px] border transition-transform hover:scale-110 ${
                selected
                  ? 'border-primary ring-2 ring-primary/30 ring-offset-1 ring-offset-white dark:ring-offset-gray-800'
                  : 'border-black/15 dark:border-white/20'
              }`}
              style={{ backgroundColor: color }}
            />
          )
        })}
      </div>
    </div>
  )
}
