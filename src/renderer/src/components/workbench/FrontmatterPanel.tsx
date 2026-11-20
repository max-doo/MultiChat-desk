import { useEffect, useMemo, useRef, useState } from 'react'

interface Props {
  frontmatter: string | null
  /** 面板把编辑后的完整 frontmatter 块（含 --- 分隔线）回传；null 表示整块删除 */
  onChange: (nextFrontmatter: string | null) => void
}

interface Field {
  key: string
  value: string
  /** 该字段在 YAML 中是列表（- 多行 / [a,b] 单行）；序列化时按多行列表写回 */
  isList: boolean
}

const URL_RE = /^https?:\/\//i
const LIST_ITEM_RE = /^\s*-\s+(.+)$/
const KEY_RE = /^[A-Za-z0-9_\-一-龥]+$/

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
      const item = listMatch[1].trim().replace(/^["']|["']$/g, '')
      if (item) {
        current.isList = true
        current.value += (current.value ? ' ' : '') + item
      }
      continue
    }
    const kv = line.match(/^([A-Za-z0-9_\-一-龥]+)\s*:\s*(.*)$/)
    if (kv) {
      current = { key: kv[1], value: (kv[2] || '').trim(), isList: false }
      fields.push(current)
    } else {
      current = null
    }
  }

  for (const f of fields) {
    const v = f.value
    if (v.startsWith('[') && v.endsWith(']')) {
      f.isList = true
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

// YAML 标量转义：含特殊字符或长得像其他类型时加双引号
function yamlScalar(value: string): string {
  const v = value.trim()
  if (!v) return '""'
  const needsQuote =
    /[:#[\]{}",'\n]|^[-?@`]/.test(v) ||
    /^(true|false|null|~|yes|no|on|off)$/i.test(v) ||
    /^[-+]?\d+(\.\d+)?$/.test(v)
  return needsQuote ? `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : v
}

// 字段序列化回 YAML 块：isList 字段写成多行 `-` 列表（对齐 Obsidian 写出格式）
function serializeFrontmatter(fields: Field[]): string | null {
  const valid = fields.filter((f) => KEY_RE.test(f.key))
  if (!valid.length) return null
  const lines = valid.map((f) => {
    if (f.isList) {
      const items = f.value
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean)
      if (!items.length) return `${f.key}:`
      return `${f.key}:\n${items.map((i) => `  - ${yamlScalar(i)}`).join('\n')}`
    }
    return `${f.key}: ${yamlScalar(f.value)}`
  })
  return `---\n${lines.join('\n')}\n---\n`
}

const isTagField = (k: string): boolean => /tags?|标签/i.test(k)
const isDateField = (k: string): boolean => /date|time|created|updated|日期|时间/i.test(k)

// 对齐 Obsidian「笔记属性」：点击 key 重命名、值行内编辑、tags 可增删 chip、
// hover 出行尾删除按钮、底部"添加属性"；无属性时同样露出"添加属性"入口
export default function FrontmatterPanel({ frontmatter, onChange }: Props): JSX.Element {
  const fields = useMemo(() => parseFrontmatter(frontmatter), [frontmatter])
  const [collapsed, setCollapsed] = useState(false)
  const [editingKeyIdx, setEditingKeyIdx] = useState<number | null>(null)
  const [keyDraft, setKeyDraft] = useState('')
  const [editingUrlIdx, setEditingUrlIdx] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [newKey, setNewKey] = useState('')
  // tags 输入框只放"正在追加的新 tag"草稿，已完成项留在 f.value 渲染成 chip
  const [tagDrafts, setTagDrafts] = useState<Record<number, string>>({})
  const addInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (adding) addInputRef.current?.focus()
  }, [adding])

  const icon = (f: Field): string => {
    if (isTagField(f.key)) return 'sell'
    if (isDateField(f.key)) return 'calendar_month'
    if (URL_RE.test(f.value)) return 'link'
    return 'description'
  }

  const commitFields = (next: Field[]): void => {
    onChange(serializeFrontmatter(next))
  }

  const updateValue = (idx: number, value: string): void => {
    commitFields(fields.map((f, i) => (i === idx ? { ...f, value } : f)))
  }

  const commitKeyRename = (idx: number): void => {
    const k = keyDraft.trim()
    setEditingKeyIdx(null)
    if (!k || k === fields[idx]?.key) return
    if (!KEY_RE.test(k)) return
    // 与已有 key 冲突时放弃改名，避免静默吞掉另一字段
    if (fields.some((f, i) => i !== idx && f.key === k)) return
    commitFields(fields.map((f, i) => (i === idx ? { ...f, key: k } : f)))
  }

  const removeField = (idx: number): void => {
    commitFields(fields.filter((_, i) => i !== idx))
  }

  const commitTagDraft = (idx: number): void => {
    const draft = (tagDrafts[idx] || '').trim()
    if (!draft) {
      setTagDrafts((d) => ({ ...d, [idx]: '' }))
      return
    }
    const f = fields[idx]
    const merged = `${f.value ? `${f.value} ` : ''}${draft}`
    updateValue(idx, merged)
    setTagDrafts((d) => ({ ...d, [idx]: '' }))
  }

  const removeTag = (idx: number, tag: string): void => {
    const f = fields[idx]
    const rest = f.value.split(/\s+/).filter((t) => t && t !== tag)
    updateValue(idx, rest.join(' '))
  }

  const submitNewProperty = (): void => {
    const k = newKey.trim()
    setAdding(false)
    setNewKey('')
    if (!k || !KEY_RE.test(k) || fields.some((f) => f.key === k)) return
    commitFields([...fields, { key: k, value: '', isList: isTagField(k) }])
  }

  const hasFields = fields.length > 0

  return (
    <div
      className="mb-4"
      data-frontmatter-panel="true"
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center gap-1.5 px-0 pt-0 pb-1.5 text-left text-[12px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-400 transition-colors select-none"
      >
        <span className="material-symbols-outlined text-[16px]">
          {collapsed ? 'chevron_right' : 'expand_more'}
        </span>
        笔记属性
        {hasFields && (
          <span className="ml-auto text-[11px] font-normal opacity-70">{fields.length}</span>
        )}
      </button>

      {!collapsed && (
        <div className="pb-1">
          {hasFields && (
            <dl className="space-y-1">
              {fields.map((f, idx) => (
                <div
                  key={idx}
                  className="group flex items-center gap-3 min-h-[28px] rounded-md -mx-1 px-1 hover:bg-gray-200/50 dark:hover:bg-gray-700/40 transition-colors"
                >
                  {/* 左列：图标 + 点击可重命名的 key */}
                  <dt className="flex items-center gap-1.5 w-32 shrink-0 text-[13px] text-gray-500 dark:text-gray-400">
                    <span className="material-symbols-outlined text-[15px] opacity-60">
                      {icon(f)}
                    </span>
                    {editingKeyIdx === idx ? (
                      <input
                        autoFocus
                        value={keyDraft}
                        onChange={(e) => setKeyDraft(e.target.value)}
                        onBlur={() => commitKeyRename(idx)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitKeyRename(idx)
                          if (e.key === 'Escape') setEditingKeyIdx(null)
                        }}
                        className="w-full min-w-0 bg-white dark:bg-gray-800 border border-primary/50 rounded px-1 py-0 text-[12.5px] text-text-primary focus:outline-none focus:border-primary"
                      />
                    ) : (
                      <button
                        type="button"
                        title="点击重命名属性"
                        onClick={() => {
                          setEditingKeyIdx(idx)
                          setKeyDraft(f.key)
                        }}
                        className="truncate text-left hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                      >
                        {f.key}
                      </button>
                    )}
                  </dt>

                  {/* 右列：值编辑区 */}
                  <dd className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                    {isTagField(f.key) ? (
                      <>
                        {f.value
                          .split(/\s+/)
                          .filter(Boolean)
                          .map((tag) => (
                            <span
                              key={tag}
                              className="inline-flex items-center gap-0.5 px-2 py-[2px] rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-300 text-[12.5px] leading-5"
                            >
                              {tag}
                              <button
                                type="button"
                                aria-label={`移除标签 ${tag}`}
                                onClick={() => removeTag(idx, tag)}
                                className="material-symbols-outlined text-[13px] leading-none opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                              >
                                close
                              </button>
                            </span>
                          ))}
                        <input
                          value={tagDrafts[idx] || ''}
                          onChange={(e) =>
                            setTagDrafts((d) => ({ ...d, [idx]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ' || e.key === ',') {
                              e.preventDefault()
                              commitTagDraft(idx)
                            }
                            // 空草稿时 Backspace 删最后一个 chip（对齐 Obsidian）
                            if (e.key === 'Backspace' && !(tagDrafts[idx] || '').length) {
                              const tags = f.value.split(/\s+/).filter(Boolean)
                              if (tags.length) removeTag(idx, tags[tags.length - 1])
                            }
                          }}
                          onBlur={() => commitTagDraft(idx)}
                          placeholder={f.value ? '' : '添加标签'}
                          className="flex-1 min-w-[90px] bg-transparent text-[13px] text-text-primary placeholder:text-gray-400/70 focus:outline-none"
                        />
                      </>
                    ) : URL_RE.test(f.value) && editingUrlIdx !== idx ? (
                      <a
                        href={f.value}
                        target="_blank"
                        rel="noreferrer"
                        title="Ctrl/Cmd+点击行内编辑，直接点击打开链接"
                        onClick={(e) => {
                          if (e.ctrlKey || e.metaKey) {
                            e.preventDefault()
                            setEditingUrlIdx(idx)
                          }
                        }}
                        className="text-[13px] text-primary hover:underline truncate"
                      >
                        {f.value}
                      </a>
                    ) : (
                      <input
                        value={f.value}
                        onChange={(e) => updateValue(idx, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                        }}
                        onBlur={() => setEditingUrlIdx(null)}
                        placeholder="空"
                        className="flex-1 min-w-[80px] bg-transparent text-[13px] text-text-primary placeholder:text-gray-400/70 focus:outline-none"
                      />
                    )}
                  </dd>

                  {/* 行尾删除：对齐 Obsidian hover 行操作 */}
                  <button
                    type="button"
                    aria-label={`删除属性 ${f.key}`}
                    onClick={() => removeField(idx)}
                    className="material-symbols-outlined shrink-0 text-[16px] text-gray-400 opacity-0 group-hover:opacity-70 hover:!opacity-100 hover:text-red-500 transition-opacity"
                  >
                    delete
                  </button>
                </div>
              ))}
            </dl>
          )}

          {/* 底部"添加属性"：有字段时追加行，无字段时新建整块 frontmatter */}
          {adding ? (
            <div className="flex items-center gap-1.5 mt-1.5 min-h-[28px]">
              <span className="material-symbols-outlined text-[15px] text-gray-400">add</span>
              <input
                ref={addInputRef}
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                onBlur={submitNewProperty}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitNewProperty()
                  if (e.key === 'Escape') {
                    setAdding(false)
                    setNewKey('')
                  }
                }}
                placeholder="属性名"
                className="flex-1 bg-white dark:bg-gray-800 border border-primary/50 rounded px-2 py-0.5 text-[12.5px] text-text-primary focus:outline-none focus:border-primary"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className={`flex items-center gap-1 text-[12px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors ${
                hasFields ? 'mt-1.5' : 'py-1'
              }`}
            >
              <span className="material-symbols-outlined text-[15px]">add</span>
              添加属性
            </button>
          )}
        </div>
      )}
    </div>
  )
}
