import { useEffect, useMemo, useRef, useState } from 'react'
import { AppIcon } from '../icons/AppIcon'
import { useAppStore } from '../../store/appStore'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { resolveSourceConversation } from '../../utils/noteSourceConversation'
import {
  isTagField,
  parseTagsFromFrontmatterValue,
  normalizeTag,
  isValidTag
} from '../../../../shared/utils/workbenchTags'

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
  const body = fm.replace(/^---\s*\r?\n/, '').replace(/\r?\n---\s*$/, '')
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
      current = { key: kv[1], value: (kv[2] || '').trim(), isList: isTagField(kv[1]) }
      fields.push(current)
    } else {
      current = null
    }
  }

  for (const f of fields) {
    if (isTagField(f.key)) {
      f.isList = true
      const parsedTags = parseTagsFromFrontmatterValue(f.value)
      f.value = parsedTags.join(' ')
    } else {
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
      if (isTagField(f.key)) {
        const items = parseTagsFromFrontmatterValue(f.value)
        if (!items.length) return `${f.key}:`
        return `${f.key}:\n${items.map((i) => `  - ${yamlScalar(i)}`).join('\n')}`
      }
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

const isDateField = (k: string): boolean => /date|time|created|updated|captured|日期|时间/i.test(k)
const isSourceField = (k: string): boolean => /^(?:source|source_?url|source_?link|来源)$/i.test(k)
const isTitleField = (k: string): boolean => /^(?:title|name|标题|名称)$/i.test(k)
const isDescriptionField = (k: string): boolean => /^(?:description|summary|desc|描述|摘要|简介)$/i.test(k)
// source_kind 是机器判定会话文档的语义字段，但不值得占用默认属性行；
// 和来源身份、旧应用状态一起收进“更多属性”。
const HIDDEN_TECHNICAL_KEYS = new Set(['id', 'source_kind', 'source_key', 'updated_at'])
const sameFieldValue = (a: string, b: string): boolean =>
  a.trim().replace(/^["']|["']$/g, '') === b.trim().replace(/^["']|["']$/g, '')

function formatDateValue(value: string): string {
  const raw = value.trim()
  if (!raw) return raw
  const numeric = /^\d{10,13}$/.test(raw) ? Number(raw) : NaN
  const timestamp = Number.isFinite(numeric)
    ? numeric < 1e12
      ? numeric * 1000
      : numeric
    : Date.parse(raw)
  if (!Number.isFinite(timestamp)) return raw
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function displayKey(key: string): string {
  switch (key) {
    case 'source':
    case 'source_url':
      return '来源'
    case 'source_key':
      return '来源标识'
    case 'source_kind':
      return '来源类型'
    case 'platform':
      return '平台'
    case 'captured_at':
    case 'created_at':
      return '创建时间'
    case 'updated_at':
      return '更新时间'
    case 'id':
      return '记录标识'
    case 'title':
      return '标题'
    default:
      return key
  }
}

// 对齐 Obsidian「笔记属性」：点击 key 重命名、值行内编辑、tags 可增删 chip、
// hover 出行尾删除按钮、底部"添加属性"；无属性时同样露出"添加属性"入口
export default function FrontmatterPanel({ frontmatter, onChange }: Props): JSX.Element {
  const fields = useMemo(() => parseFrontmatter(frontmatter), [frontmatter])
  const models = useAppStore((s) => s.models)
  const openConversationInAiSidebar = useWorkbenchStore((s) => s.openConversationInAiSidebar)
  // 只有「属性名是 source 且链接确属某平台会话页」才给入口；
  // 链接被改写或指向非会话页面时 resolve 返回 null，图标不出现。
  const sourceTargets = useMemo(
    () =>
      fields.map((f) =>
        isSourceField(f.key) && URL_RE.test(f.value)
          ? resolveSourceConversation(f.value, models)
          : null
      ),
    [fields, models]
  )
  const [collapsed, setCollapsed] = useState(false)
  const [showTechnical, setShowTechnical] = useState(false)
  const [editingKeyIdx, setEditingKeyIdx] = useState<number | null>(null)
  const [keyDraft, setKeyDraft] = useState('')
  const [editingUrlIdx, setEditingUrlIdx] = useState<number | null>(null)
  const [urlDraft, setUrlDraft] = useState('')
  const skipUrlCommitRef = useRef(false)
  const [adding, setAdding] = useState(false)
  const [newKey, setNewKey] = useState('')
  // tags 输入框只放"正在追加的新 tag"草稿，已完成项留在 f.value 渲染成 chip
  const [tagDrafts, setTagDrafts] = useState<Record<number, string>>({})
  const addInputRef = useRef<HTMLInputElement>(null)
  const workspaceTags = useWorkbenchStore((s) => s.workspaceTags)
  const [activeTagInputIdx, setActiveTagInputIdx] = useState<number | null>(null)
  const [highlightedSuggestionIdx, setHighlightedSuggestionIdx] = useState<number>(-1)
  const [dismissDropdown, setDismissDropdown] = useState(false)
  const tagDropdownRef = useRef<HTMLDivElement>(null)
  const tagInputRefs = useRef<Record<number, HTMLInputElement | null>>({})

  useEffect(() => {
    const handleGlobalMouseDown = (e: MouseEvent): void => {
      if (
        tagDropdownRef.current &&
        !tagDropdownRef.current.contains(e.target as Node)
      ) {
        setDismissDropdown(true)
      }
    }
    document.addEventListener('mousedown', handleGlobalMouseDown)
    return () => document.removeEventListener('mousedown', handleGlobalMouseDown)
  }, [])

  // 当前活跃输入框过滤出的标签候选项
  const currentTagSuggestions = useMemo(() => {
    if (activeTagInputIdx === null || !fields[activeTagInputIdx]) return []
    const f = fields[activeTagInputIdx]
    const existing = new Set(parseTagsFromFrontmatterValue(f.value).map((t) => t.toLowerCase()))
    const draft = (tagDrafts[activeTagInputIdx] || '').replace(/^#+/, '').trim().toLowerCase()

    const pool = workspaceTags.filter((item) => !existing.has(item.tag.toLowerCase()))

    if (!draft) {
      return pool.slice(0, 8)
    }

    const prefixMatches: typeof pool = []
    const containsMatches: typeof pool = []

    for (const item of pool) {
      const lower = item.tag.toLowerCase()
      if (lower.startsWith(draft)) {
        prefixMatches.push(item)
      } else if (lower.includes(draft)) {
        containsMatches.push(item)
      }
    }

    prefixMatches.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    containsMatches.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))

    return [...prefixMatches, ...containsMatches].slice(0, 8)
  }, [activeTagInputIdx, fields, tagDrafts, workspaceTags])

  useEffect(() => {
    if (adding) addInputRef.current?.focus()
  }, [adding])

  // 旧文档可能同时有 source_url 和同值的 source_key。来源标识只是内部身份，
  // 和来源地址完全相同时不重复展示；“更多属性”展开后也保持同样的去重。
  const dedupedFields = useMemo(() => {
    const sourceUrls = fields
      .filter((field) => (isSourceField(field.key) || field.key === 'source_url') && URL_RE.test(field.value))
      .map((field) => field.value)
    return fields.filter((field) => {
      if (
        field.key === 'source_key' &&
        sourceUrls.some((url) => sameFieldValue(url, field.value))
      ) {
        return false
      }
      if (
        field.key === 'source_url' &&
        fields.some(
          (other) =>
            other.key === 'source' &&
            URL_RE.test(other.value) &&
            sameFieldValue(other.value, field.value)
        )
      ) {
        return false
      }
      return true
    })
  }, [fields])

  const visibleFields = useMemo(() => {
    const entries = dedupedFields.map((field) => ({ field, idx: fields.indexOf(field) }))
    if (showTechnical) return entries
    const hasSourceUrl = dedupedFields.some((field) => isSourceField(field.key) && URL_RE.test(field.value))
    return entries.filter(({ field }) => {
      if (field.key === 'source_key' && hasSourceUrl) return false
      if (field.key === 'title' && hasSourceUrl) return false
      return !HIDDEN_TECHNICAL_KEYS.has(field.key)
    })
  }, [dedupedFields, fields, showTechnical])
  const technicalFieldCount = useMemo(() => {
    const hasSourceUrl = dedupedFields.some((field) => isSourceField(field.key) && URL_RE.test(field.value))
    return dedupedFields.filter((field) => {
      if (field.key === 'source_key' && hasSourceUrl) return true
      if (field.key === 'title' && hasSourceUrl) return true
      return HIDDEN_TECHNICAL_KEYS.has(field.key)
    }).length
  }, [dedupedFields])

  // 切换文件或外部改动会换掉 frontmatter；收起行内编辑，避免索引落到新字段上
  useEffect(() => {
    setEditingUrlIdx(null)
    setEditingKeyIdx(null)
    setActiveTagInputIdx(null)
  }, [frontmatter])

  const icon = (f: Field): string => {
    if (isTagField(f.key)) return 'sell'
    if (isDateField(f.key)) return 'calendar_month'
    if (isSourceField(f.key) || /^(?:url|link|网址|链接)$/i.test(f.key) || URL_RE.test(f.value)) return 'link'
    if (isTitleField(f.key)) return 'title'
    if (isDescriptionField(f.key)) return 'description'
    return 'description'
  }

  const commitFields = (next: Field[]): void => {
    onChange(serializeFrontmatter(next))
  }

  const updateValue = (idx: number, value: string): void => {
    commitFields(fields.map((f, i) => (i === idx ? { ...f, value } : f)))
  }

  // 链接值默认是可编辑文本：点击进入行内输入，旁边的图标负责打开。
  const startUrlEdit = (idx: number, value: string): void => {
    skipUrlCommitRef.current = false
    setUrlDraft(value)
    setEditingUrlIdx(idx)
  }

  const commitUrlEdit = (): void => {
    if (skipUrlCommitRef.current) {
      skipUrlCommitRef.current = false
      return
    }
    const idx = editingUrlIdx
    setEditingUrlIdx(null)
    if (idx === null) return
    const next = urlDraft.trim()
    if (next !== fields[idx]?.value) updateValue(idx, next)
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

  const commitTagDraft = (idx: number, specificTag?: string): void => {
    const raw = (specificTag !== undefined ? specificTag : (tagDrafts[idx] || '')).trim()
    if (!raw) {
      setTagDrafts((d) => ({ ...d, [idx]: '' }))
      return
    }
    const f = fields[idx]
    const existingTags = parseTagsFromFrontmatterValue(f.value)
    const incomingTags = parseTagsFromFrontmatterValue(raw)
    const nextTags = [...existingTags]
    for (const t of incomingTags) {
      if (!nextTags.some((ext) => ext.toLowerCase() === t.toLowerCase())) {
        nextTags.push(t)
      }
    }
    updateValue(idx, nextTags.join(' '))
    setTagDrafts((d) => ({ ...d, [idx]: '' }))
  }

  const removeTag = (idx: number, tag: string): void => {
    const f = fields[idx]
    const rest = parseTagsFromFrontmatterValue(f.value).filter(
      (t) => t.toLowerCase() !== tag.toLowerCase()
    )
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
        <AppIcon name={collapsed ? 'chevron_right' : 'expand_more'} size={16} />
        笔记属性
        {hasFields && (
          <span className="ml-auto text-[11px] font-normal opacity-70">{visibleFields.length}</span>
        )}
      </button>

      {!collapsed && (
        <div className="pb-1">
          {hasFields && (
            <dl className="space-y-1">
              {visibleFields.map(({ field: f, idx }) => (
                <div
                  key={idx}
                  className="group flex items-center gap-3 min-h-[28px] rounded-md -mx-1 px-1 hover:bg-gray-200/50 dark:hover:bg-gray-700/40 transition-colors"
                >
                  {/* 左列：图标 + 点击可重命名的 key */}
                  <dt className="flex items-center gap-1.5 w-32 shrink-0 text-[13px] text-gray-500 dark:text-gray-400">
                    <AppIcon name={icon(f)} size={15} className="opacity-60" />
                    {editingKeyIdx === idx ? (
                      <input
                        autoFocus
                        value={keyDraft}
                        onChange={(e) => setKeyDraft(e.target.value)}
                        onBlur={() => commitKeyRename(idx)}
                        onKeyDown={(e) => {
                          if (e.nativeEvent.isComposing || e.key === 'Process' || e.keyCode === 229) return
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
                        {displayKey(f.key)}
                      </button>
                    )}
                  </dt>

                  {/* 右列：值编辑区 */}
                  <dd className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                    {isTagField(f.key) ? (
                      <>
                        {parseTagsFromFrontmatterValue(f.value).map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center gap-1 px-2 py-[2px] rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-300 text-[12.5px] leading-5 select-none"
                          >
                            {tag}
                            <button
                              type="button"
                              aria-label={`移除标签 ${tag}`}
                              onClick={() => removeTag(idx, tag)}
                              className="leading-none opacity-60 hover:!opacity-100 transition-opacity ml-0.5"
                            >
                              <AppIcon name="close" size={13} />
                            </button>
                          </span>
                        ))}
                        <div className="relative flex-1 min-w-[130px]">
                          <input
                            ref={(el) => {
                              tagInputRefs.current[idx] = el
                            }}
                            value={tagDrafts[idx] || ''}
                            onFocus={() => {
                              setActiveTagInputIdx(idx)
                              setDismissDropdown(false)
                              setHighlightedSuggestionIdx(0)
                            }}
                            onChange={(e) => {
                              setTagDrafts((d) => ({ ...d, [idx]: e.target.value }))
                              setActiveTagInputIdx(idx)
                              setDismissDropdown(false)
                              setHighlightedSuggestionIdx(0)
                            }}
                            onKeyDown={(e) => {
                              // 输入法（如中文拼音输入选词）状态下，不拦截 Enter / 空格
                              if (e.nativeEvent.isComposing || e.key === 'Process' || e.keyCode === 229) {
                                return
                              }

                              const showMenu =
                                activeTagInputIdx === idx &&
                                !dismissDropdown &&
                                currentTagSuggestions.length > 0

                              if (showMenu) {
                                if (e.key === 'ArrowDown') {
                                  e.preventDefault()
                                  setHighlightedSuggestionIdx((prev) =>
                                    prev < currentTagSuggestions.length - 1 ? prev + 1 : 0
                                  )
                                  return
                                }
                                if (e.key === 'ArrowUp') {
                                  e.preventDefault()
                                  setHighlightedSuggestionIdx((prev) =>
                                    prev > 0 ? prev - 1 : currentTagSuggestions.length - 1
                                  )
                                  return
                                }
                                if (e.key === 'Enter' || e.key === 'Tab') {
                                  if (
                                    highlightedSuggestionIdx >= 0 &&
                                    currentTagSuggestions[highlightedSuggestionIdx]
                                  ) {
                                    e.preventDefault()
                                    commitTagDraft(
                                      idx,
                                      currentTagSuggestions[highlightedSuggestionIdx].tag
                                    )
                                    setHighlightedSuggestionIdx(-1)
                                    return
                                  }
                                }
                                if (e.key === 'Escape') {
                                  e.preventDefault()
                                  setDismissDropdown(true)
                                  return
                                }
                              }

                              if (e.key === 'Enter' || e.key === ' ' || e.key === ',') {
                                e.preventDefault()
                                commitTagDraft(idx)
                                setHighlightedSuggestionIdx(-1)
                              }
                              // 空草稿时 Backspace 删最后一个 chip（对齐 Obsidian）
                              if (e.key === 'Backspace' && !(tagDrafts[idx] || '').length) {
                                const tags = parseTagsFromFrontmatterValue(f.value)
                                if (tags.length) removeTag(idx, tags[tags.length - 1])
                              }
                            }}
                            onBlur={() => {
                              setTimeout(() => {
                                commitTagDraft(idx)
                                if (activeTagInputIdx === idx) {
                                  setActiveTagInputIdx(null)
                                }
                              }, 150)
                            }}
                            placeholder={f.value ? '' : '添加标签 (输入关键词匹配已有标签)'}
                            className="w-full bg-transparent text-[13px] text-text-primary placeholder:text-gray-400/70 focus:outline-none"
                          />

                          {/* 标签自动补全下拉建议列表 */}
                          {activeTagInputIdx === idx &&
                            !dismissDropdown &&
                            (currentTagSuggestions.length > 0 ||
                              (tagDrafts[idx] && normalizeTag(tagDrafts[idx]))) && (
                              <div
                                ref={tagDropdownRef}
                                className="absolute left-0 top-full mt-1.5 z-50 min-w-[210px] max-w-[320px] max-h-60 overflow-y-auto rounded-lg shadow-xl border border-black/10 dark:border-white/10 bg-white dark:bg-gray-800 py-1 text-xs select-none"
                              >
                                {currentTagSuggestions.length > 0 && (
                                  <>
                                    <div className="px-2.5 py-1 text-[10.5px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                                      {(tagDrafts[idx] || '').trim() ? '匹配已有标签' : '推荐标签'}
                                    </div>
                                    {currentTagSuggestions.map((item, sIdx) => {
                                      const isHighlighted = sIdx === highlightedSuggestionIdx
                                      const query = (tagDrafts[idx] || '').replace(/^#+/, '').trim().toLowerCase()
                                      const tagLower = item.tag.toLowerCase()
                                      const matchPos = query ? tagLower.indexOf(query) : -1

                                      return (
                                        <div
                                          key={item.tag}
                                          onMouseEnter={() => setHighlightedSuggestionIdx(sIdx)}
                                          onMouseDown={(e) => {
                                            e.preventDefault()
                                            commitTagDraft(idx, item.tag)
                                            setHighlightedSuggestionIdx(-1)
                                            setDismissDropdown(true)
                                            tagInputRefs.current[idx]?.focus()
                                          }}
                                          className={`flex items-center justify-between px-2.5 py-1.5 cursor-pointer transition-colors ${
                                            isHighlighted
                                              ? 'bg-primary/10 dark:bg-primary/25 text-primary dark:text-blue-300 font-medium'
                                              : 'text-gray-700 dark:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5'
                                          }`}
                                        >
                                          <div className="flex items-center gap-1.5 truncate">
                                            <AppIcon name="sell" size={12} className="opacity-40 shrink-0 text-text-secondary" />
                                            {matchPos !== -1 ? (
                                              <span className="truncate">
                                                <span>{item.tag.slice(0, matchPos)}</span>
                                                <span className="font-semibold text-primary underline decoration-primary/40 underline-offset-2">
                                                  {item.tag.slice(matchPos, matchPos + query.length)}
                                                </span>
                                                <span>{item.tag.slice(matchPos + query.length)}</span>
                                              </span>
                                            ) : (
                                              <span className="truncate">{item.tag}</span>
                                            )}
                                          </div>
                                          <span className="ml-2 shrink-0 px-1.5 py-0.2 rounded-full text-[10px] bg-black/5 dark:bg-white/10 text-gray-500 dark:text-gray-400">
                                            {item.count}
                                          </span>
                                        </div>
                                      )
                                    })}
                                  </>
                                )}

                                {/* 若输入了未存在的全新标签，提示按回车/空格建立 */}
                                {Boolean((tagDrafts[idx] || '').trim()) &&
                                  !currentTagSuggestions.some(
                                    (s) =>
                                      s.tag.toLowerCase() ===
                                      normalizeTag(tagDrafts[idx] || '').toLowerCase()
                                  ) &&
                                  isValidTag(normalizeTag(tagDrafts[idx] || '')) && (
                                    <div
                                      onMouseDown={(e) => {
                                        e.preventDefault()
                                        commitTagDraft(idx)
                                        setHighlightedSuggestionIdx(-1)
                                        setDismissDropdown(true)
                                        tagInputRefs.current[idx]?.focus()
                                      }}
                                      className="border-t border-black/5 dark:border-white/5 mt-1 pt-1 px-2.5 py-1.5 text-gray-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer flex items-center justify-between"
                                    >
                                      <span className="truncate">
                                        新建标签{' '}
                                        <span className="font-semibold text-primary">
                                          {normalizeTag(tagDrafts[idx] || '')}
                                        </span>
                                      </span>
                                      <span className="text-[10px] opacity-60 ml-1">按空格/回车</span>
                                    </div>
                                  )}
                              </div>
                            )}
                        </div>
                      </>
                    ) : editingUrlIdx === idx ? (
                      <input
                        autoFocus
                        value={urlDraft}
                        onChange={(e) => setUrlDraft(e.target.value)}
                        onFocus={(e) => e.currentTarget.select()}
                        onBlur={commitUrlEdit}
                        onKeyDown={(e) => {
                          if (e.nativeEvent.isComposing || e.key === 'Process' || e.keyCode === 229) return
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            e.currentTarget.blur()
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault()
                            skipUrlCommitRef.current = true
                            setEditingUrlIdx(null)
                          }
                        }}
                        placeholder="空"
                        className="flex-1 min-w-[80px] bg-transparent text-[13px] text-text-primary placeholder:text-gray-400/70 focus:outline-none"
                      />
                    ) : isDateField(f.key) && formatDateValue(f.value) !== f.value ? (
                      <button
                        type="button"
                        title={f.value}
                        onClick={() => startUrlEdit(idx, f.value)}
                        className="min-w-0 flex-1 truncate text-left text-[13px] text-text-primary hover:text-primary"
                      >
                        {formatDateValue(f.value)}
                      </button>
                    ) : URL_RE.test(f.value) ? (
                      <span className="flex items-center gap-1 min-w-0 flex-1">
                        <a
                          href={f.value}
                          target="_blank"
                          rel="noreferrer"
                          title="点击编辑；Ctrl/Cmd+点击在浏览器打开"
                          onClick={(e) => {
                            // 普通点击进入编辑；带修饰键时放行，交给主窗口的
                            // setWindowOpenHandler → shell.openExternal 打开本地浏览器
                            if (e.ctrlKey || e.metaKey) return
                            e.preventDefault()
                            startUrlEdit(idx, f.value)
                          }}
                          className="min-w-0 truncate text-left text-[13px] text-primary hover:underline cursor-text"
                        >
                          {f.value}
                        </a>
                        {sourceTargets[idx] ? (
                          <button
                            type="button"
                            title="在侧边栏打开会话"
                            aria-label="在侧边栏打开会话"
                            onClick={() =>
                              openConversationInAiSidebar(
                                sourceTargets[idx]!.platformId,
                                sourceTargets[idx]!.url
                              )
                            }
                            className="shrink-0 text-gray-400 hover:text-primary transition-colors"
                          >
                            <AppIcon name="forum" size={15} />
                          </button>
                        ) : (
                          <a
                            href={f.value}
                            target="_blank"
                            rel="noreferrer"
                            title="在浏览器中打开"
                            aria-label="在浏览器中打开"
                            className="shrink-0 text-gray-400 hover:text-primary transition-colors"
                          >
                            <AppIcon name="open_in_new" size={15} />
                          </a>
                        )}
                      </span>
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
                    className="shrink-0 text-gray-400 opacity-0 group-hover:opacity-70 hover:!opacity-100 hover:text-red-500 transition-opacity"
                  >
                    <AppIcon name="delete" size={16} />
                  </button>
                </div>
              ))}
            </dl>
          )}

          {technicalFieldCount > 0 && (
            <button
              type="button"
              onClick={() => setShowTechnical((value) => !value)}
              className={`flex items-center gap-1 text-[12px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors ${
                hasFields ? 'mt-1.5' : 'py-1'
              }`}
            >
              <AppIcon name={showTechnical ? 'expand_less' : 'expand_more'} size={15} />
              {showTechnical ? '收起更多属性' : `更多属性 ${technicalFieldCount}`}
            </button>
          )}

          {/* 底部"添加属性"：有字段时追加行，无字段时新建整块 frontmatter */}
          {adding ? (
            <div className="flex items-center gap-1.5 mt-1.5 min-h-[28px]">
              <AppIcon name="add" size={15} className="text-gray-400" />
              <input
                ref={addInputRef}
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                onBlur={submitNewProperty}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.key === 'Process' || e.keyCode === 229) return
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
              <AppIcon name="add" size={15} />
              添加属性
            </button>
          )}
        </div>
      )}
    </div>
  )
}
