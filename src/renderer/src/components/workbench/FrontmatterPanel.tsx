import { useMemo, useState } from 'react'

interface Props {
  frontmatter: string | null
}

interface Field {
  key: string
  value: string
}

const URL_RE = /^https?:\/\//i
const LIST_ITEM_RE = /^\s*-\s+(.+)$/

// 极简 YAML 解析：顶层 key + 标量/单行 [a,b]/- 多行列表，覆盖笔记场景够用
function parseFrontmatter(fm: string | null): Field[] {
  if (!fm) return []
  const body = fm.replace(/^---\r?\n/, '').replace(/\r?\n---\r?\n$/, '')
  const fields: Field[] = []
  let current: Field | null = null

  for (const line of body.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const listMatch = line.match(LIST_ITEM_RE)
    if (listMatch && current) {
      const item = listMatch[1].trim()
      if (item) current.value += (current.value ? ' ' : '') + item
      continue
    }
    const kv = line.match(/^([A-Za-z0-9_\-一-龥]+)\s*:\s*(.*)$/)
    if (kv) {
      current = { key: kv[1], value: (kv[2] || '').trim() }
      fields.push(current)
    } else {
      current = null
    }
  }

  for (const f of fields) {
    const v = f.value
    if (v.startsWith('[') && v.endsWith(']')) {
      f.value = v
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
        .join(' ')
    } else {
      f.value = v.replace(/^["']|["']$/g, '')
    }
  }
  return fields
}

// Obsidian 式「笔记属性」两列表单：左 key + 图标，右值；
// tags 渲染成 chip、URL 渲染为可点链接（走 setWindowOpenHandler → 系统浏览器）
export default function FrontmatterPanel({ frontmatter }: Props): JSX.Element | null {
  const fields = useMemo(() => parseFrontmatter(frontmatter), [frontmatter])
  const [collapsed, setCollapsed] = useState(false)
  if (!fields.length) return null

  const isTagField = (k: string): boolean => /tags?|标签/i.test(k)
  const isDateField = (k: string): boolean => /date|time|created|updated|日期|时间/i.test(k)
  const icon = (k: string): string => {
    if (isTagField(k)) return 'sell'
    if (isDateField(k)) return 'calendar_month'
    const f = fields.find((x) => x.key === k)
    if (f && URL_RE.test(f.value)) return 'link'
    return 'description'
  }

  return (
    <div
      className="mb-5 select-none rounded-xl border border-gray-200/80 dark:border-gray-700/60 bg-gray-50/70 dark:bg-gray-800/40"
      data-frontmatter-panel="true"
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center gap-1.5 px-4 pt-3 pb-2 text-left text-[12px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-400 transition-colors"
      >
        <span
          className={`material-symbols-outlined text-[16px] transition-transform ${
            collapsed ? '' : 'rotate-90'
          }`}
        >
          expand_more
        </span>
        笔记属性
      </button>
      {!collapsed && (
        <dl className="px-4 pb-3 space-y-1.5">
          {fields.map((f) => (
            <div key={f.key} className="flex items-center gap-3 min-h-[26px]">
              <dt className="flex items-center gap-1.5 w-28 shrink-0 text-[13px] text-gray-500 dark:text-gray-400">
                <span className="material-symbols-outlined text-[15px] opacity-60">
                  {icon(f.key)}
                </span>
                <span className="truncate">{f.key}</span>
              </dt>
              <dd className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                {isTagField(f.key) ? (
                  f.value
                    .split(/\s+/)
                    .filter(Boolean)
                    .map((tag, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center px-2 py-[2px] rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-300 text-[12.5px] leading-5"
                      >
                        {tag}
                      </span>
                    ))
                ) : URL_RE.test(f.value) ? (
                  <a
                    href={f.value}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[13px] text-primary hover:underline truncate"
                  >
                    {f.value}
                  </a>
                ) : (
                  <span className="text-[13px] text-text-primary truncate">{f.value}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
