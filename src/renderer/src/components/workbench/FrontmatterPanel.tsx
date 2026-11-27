import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { AppIcon } from '../icons/AppIcon'
import ConfirmModal from '../ConfirmModal'
import { useAppStore } from '../../store/appStore'
import { useWorkbenchStore } from '../../store/workbenchStore'
import { resolveSourceConversation } from '../../utils/noteSourceConversation'
import {
  isTagField,
  parseTagsFromFrontmatterValue,
  normalizeTag,
  isValidTag
} from '../../../../shared/utils/workbenchTags'
import {
  getFrontmatterOwnership,
  resolveFrontmatterDocumentKind
} from '../../../../shared/utils/frontmatterPolicy'
import { sameSourceUrl } from '../../../../shared/utils/conversationFrontmatter'

interface Props {
  frontmatter: string | null
  filePath?: string | null
  /** 面板把编辑后的完整 frontmatter 块（含 --- 分隔线）回传；null 表示整块删除 */
  onChange: (nextFrontmatter: string | null) => void
  /** frontmatter 相对 Git Index 是否有改动；true 时左侧显示修改色条 */
  gitModified?: boolean
}

interface Field {
  key: string
  value: string
  /** 该字段在 YAML 中是列表（- 多行 / [a,b] 单行）；写回时按多行列表输出 */
  isList: boolean
  /** 字段在 frontmatter 内部行数组中的起始行（含） */
  start: number
  /** 字段在 frontmatter 内部行数组中的结束行（含） */
  end: number
  /** 含嵌套结构；面板只读展示，避免破坏原始 YAML */
  complex: boolean
}

interface ParsedFrontmatter {
  fields: Field[]
  lines: string[]
  newline: string
}

interface FieldEntry {
  field: Field
  idx: number
}

const URL_RE = /^https?:\/\//i
const LIST_ITEM_RE = /^\s*-\s+(.+)$/
const KEY_RE = /^[A-Za-z0-9_\-一-龥]+$/

const EMPTY_FRONTMATTER: ParsedFrontmatter = { fields: [], lines: [], newline: '\n' }

/**
 * 极简 YAML 解析：顶层 key + 标量/单行 [a,b]/- 多行列表，覆盖笔记场景够用。
 * 同时记录字段原始行区间，编辑时只替换该区间，注释和未知行不会丢。
 */
function parseFrontmatter(fm: string | null): ParsedFrontmatter {
  if (!fm) return EMPTY_FRONTMATTER
  const newline = fm.includes('\r\n') ? '\r\n' : '\n'
  const block = fm.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
  if (!block) return EMPTY_FRONTMATTER
  let lines = block[1].split(/\r?\n/)
  if (lines.length === 1 && !lines[0]) lines = []
  const fields: Field[] = []
  let current: Field | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const kv = line.match(/^([A-Za-z0-9_\-一-龥]+)\s*:\s*(.*)$/)
    if (kv) {
      current = {
        key: kv[1],
        value: (kv[2] || '').trim(),
        isList: isTagField(kv[1]),
        start: i,
        end: i,
        complex: false
      }
      fields.push(current)
      continue
    }
    if (!current) continue
    if (LIST_ITEM_RE.test(line)) {
      current.isList = true
      current.end = i
      continue
    }
    // 缩进内容（嵌套值、缩进注释）跟随当前字段，但不参与结构化编辑。
    if (/^\s+\S/.test(line)) {
      if (!/^\s*#/.test(line)) current.complex = true
      current.end = i
      continue
    }
    current = null
  }

  for (const f of fields) {
    if (f.complex) {
      f.value = ''
      continue
    }
    const inline = f.value
    if (f.isList) {
      const items: string[] = []
      for (let i = f.start + 1; i <= f.end; i++) {
        const match = lines[i].match(LIST_ITEM_RE)
        if (match) items.push(match[1].trim().replace(/^["']|["']$/g, ''))
      }
      if (items.length) {
        // 来源列表按行保存，URL 里的标点不能被拼成一行再切开。
        f.value = isTagField(f.key)
          ? parseTagsFromFrontmatterValue(items.join(' ')).join(' ')
          : isSourcesField(f.key)
            ? items.join('\n')
            : items.join(' ')
        continue
      }
    }
    if (inline.startsWith('[') && inline.endsWith(']')) {
      f.isList = true
      const items = inline
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
      f.value = isSourcesField(f.key) ? items.join('\n') : items.join(' ')
      continue
    }
    if (isTagField(f.key)) {
      f.isList = true
      f.value = parseTagsFromFrontmatterValue(inline).join(' ')
      continue
    }
    f.value = inline.replace(/^["']|["']$/g, '')
  }
  return { fields, lines, newline }
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

function fieldLines(key: string, value: string, isList: boolean): string[] {
  if (isSourcesField(key)) {
    const items = value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
    if (!items.length) return [`${key}:`]
    return [`${key}:`, ...items.map((item) => `  - ${yamlScalar(item)}`)]
  }
  if (isList) {
    const items = isTagField(key)
      ? parseTagsFromFrontmatterValue(value)
      : value
          .split(/\s+/)
          .map((s) => s.trim())
          .filter(Boolean)
    if (!items.length) return [`${key}:`]
    return [`${key}:`, ...items.map((item) => `  - ${yamlScalar(item)}`)]
  }
  return [`${key}: ${yamlScalar(value)}`]
}

interface Edit {
  start: number
  end: number
  /** null 表示删除该字段；否则替换为该行组 */
  lines: string[] | null
}

function formatBlock(lines: string[], newline: string): string | null {
  if (!lines.length) return null
  return `---${newline}${lines.join(newline)}${newline}---${newline}`
}

// 只替换被编辑字段的行区间，其余行（含注释、未知字段）逐字保留
function applyEdits(parsed: ParsedFrontmatter, edits: Edit[]): string | null {
  const lines = [...parsed.lines]
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    lines.splice(edit.start, edit.end - edit.start + 1, ...(edit.lines ?? []))
  }
  return formatBlock(lines, parsed.newline)
}

function appendField(
  parsed: ParsedFrontmatter,
  key: string,
  value: string,
  isList: boolean
): string | null {
  return formatBlock([...parsed.lines, ...fieldLines(key, value, isList)], parsed.newline)
}

const isDateField = (k: string): boolean => /date|time|created|updated|captured|日期|时间/i.test(k)
const isSourceField = (k: string): boolean => /^(?:source|source_?url|source_?link|来源)$/i.test(k)
/** 普通文档的附加来源列表：第一来源仍在 source，后续来源按行累积在这里。 */
const isSourcesField = (k: string): boolean => /^sources$/i.test(k.trim())
const isTitleField = (k: string): boolean => /^(?:title|name|标题|名称)$/i.test(k)
const isDescriptionField = (k: string): boolean => /^(?:description|summary|desc|描述|摘要|简介)$/i.test(k)
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
export default function FrontmatterPanel({ frontmatter, filePath, onChange, gitModified }: Props): JSX.Element {
  const parsed = useMemo(() => parseFrontmatter(frontmatter), [frontmatter])
  const fields = parsed.fields
  const ownership = useMemo(
    () => getFrontmatterOwnership(resolveFrontmatterDocumentKind(frontmatter, filePath)),
    [frontmatter, filePath]
  )
  const roleOf = ownership.roleOf
  const models = useAppStore((s) => s.models)
  const openConversationInAiSidebar = useWorkbenchStore((s) => s.openConversationInAiSidebar)
  // 来源链接是否可打开会话由链接本身决定，与文档类型无关。普通文档
  // 即使不再绑定会话，只要 source 仍指向已配置平台的会话页，就保留
  // “在侧边栏打开会话”的快捷入口；导图的 source 指向来源文档，不参与。
  const sourceTargets = useMemo(
    () =>
      fields.map((f) =>
        ownership.kind !== 'mindmap' && isSourceField(f.key) && URL_RE.test(f.value)
          ? resolveSourceConversation(f.value, models)
          : null
      ),
    [fields, models, ownership.kind]
  )
  // 折叠态放在 store：出链/反链属于笔记属性，需跟随同一折叠联动显隐
  const collapsed = useWorkbenchStore((s) => s.frontmatterPanelCollapsed)
  // 会话系统字段默认锁定；解锁只影响当前文件，切换文件后恢复锁定。
  const [systemUnlocked, setSystemUnlocked] = useState(false)
  const [convertConfirmOpen, setConvertConfirmOpen] = useState(false)
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

  const entries: FieldEntry[] = useMemo(
    () => fields.map((field, idx) => ({ field, idx })),
    [fields]
  )

  // 旧文档可能同时有 source_url 和同值的 source_key。来源标识只是内部身份，
  // 和来源地址完全相同时不重复展示；“更多属性”展开后也保持同样的去重。
  const dedupedEntries = useMemo(() => {
    const sourceUrls = entries
      .filter(({ field }) => {
        const key = field.key.toLowerCase()
        return (key === 'source' || key === 'source_url') && URL_RE.test(field.value)
      })
      .map(({ field }) => field.value)
    return entries.filter(({ field }) => {
      const key = field.key.toLowerCase()
      // 应用认识的类型值由顶部类型行统一表达；用户自己写的其他 source_kind
      // 仍按普通属性展示，不能被界面静默隐藏。
      if (
        ownership.kind !== 'mindmap' &&
        key === 'source_kind' &&
        /^(?:conversation|plain)$/i.test(field.value.trim())
      ) {
        return false
      }
      // 同值的来源别名只保留一行；转成普通文档后也不该出现两份相同地址。
      if (ownership.kind !== 'mindmap' && key === 'source_key') {
        return !sourceUrls.some((url) => sameFieldValue(url, field.value))
      }
      if (ownership.kind !== 'mindmap' && key === 'source_url') {
        return !entries.some(
          ({ field: other }) =>
            other.key.toLowerCase() === 'source' &&
            URL_RE.test(other.value) &&
            sameFieldValue(other.value, field.value)
        )
      }
      return true
    })
  }, [entries, roleOf, ownership.kind])

  // sources 的归属仍是用户字段（写回保护、改名规则都不变），但显示上归入
  // 来源分组，和主来源放在一起。
  const sourceEntries = dedupedEntries.filter(
    ({ field }) => roleOf(field.key) === 'source' || isSourcesField(field.key)
  )
  const userEntries = dedupedEntries.filter(
    ({ field }) => roleOf(field.key) === 'user' && !isSourcesField(field.key)
  )
  const identityEntries = dedupedEntries.filter(({ field }) => roleOf(field.key) === 'identity')
  const technicalFieldCount = identityEntries.length
  const visibleFieldOrder: FieldEntry[] = [
    ...sourceEntries,
    ...userEntries,
    ...(showTechnical ? identityEntries : [])
  ]

  // 切换文件或外部改动会换掉 frontmatter；收起行内编辑，避免索引落到新字段上
  useEffect(() => {
    setEditingUrlIdx(null)
    setEditingKeyIdx(null)
    setActiveTagInputIdx(null)
  }, [frontmatter])

  useEffect(() => {
    setSystemUnlocked(false)
    setConvertConfirmOpen(false)
  }, [filePath])

  const icon = (f: Field): string => {
    if (isTagField(f.key)) return 'sell'
    if (isDateField(f.key)) return 'calendar_month'
    if (isSourceField(f.key) || isSourcesField(f.key) || /^(?:url|link|网址|链接)$/i.test(f.key) || URL_RE.test(f.value)) return 'link'
    if (isTitleField(f.key)) return 'title'
    if (isDescriptionField(f.key)) return 'description'
    return 'description'
  }

  const commitEdits = (edits: Edit[]): void => {
    onChange(applyEdits(parsed, edits))
  }

  const updateValue = (idx: number, value: string): void => {
    const f = fields[idx]
    if (!f || f.complex) return
    const edits: Edit[] = [
      { start: f.start, end: f.end, lines: fieldLines(f.key, value, f.isList) }
    ]
    // 只改用户明确编辑的那一行；来源身份、平台、采集时间都保持原样，
    // 由用户在解锁态下自行调整，不做隐式清理。
    commitEdits(edits)
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
    const f = fields[idx]
    if (!f || !k || k === f.key) return
    if (roleOf(f.key) !== 'user') return
    if (!KEY_RE.test(k)) return
    // 与已有 key 或保留键冲突时放弃改名，避免静默吞掉另一字段
    if (ownership.isReserved(k)) return
    if (fields.some((other, i) => i !== idx && other.key.toLowerCase() === k.toLowerCase())) return
    const colon = parsed.lines[f.start].indexOf(':')
    if (colon < 0) return
    commitEdits([
      { start: f.start, end: f.start, lines: [`${k}${parsed.lines[f.start].slice(colon)}`] }
    ])
  }

  const removeField = (idx: number): void => {
    const f = fields[idx]
    if (!f) return
    const role = roleOf(f.key)
    const allowed =
      role === 'user' || (ownership.kind === 'conversation' && systemUnlocked)
    if (!allowed) return
    const edits: Edit[] = [{ start: f.start, end: f.end, lines: null }]
    // 同一来源地址可能同时存在于 source / source_url / source_key（旧格式），
    // 面板只展示其中一行；删除时清掉同址别名，否则保存会从另一个别名把
    // source 补回来，用户会看到“删不掉”。不同地址的第二来源不在这里误删。
    if (
      /^(?:source|source_url|source_key)$/i.test(f.key) &&
      URL_RE.test(f.value)
    ) {
      for (const other of fields) {
        if (other === f) continue
        const otherKey = other.key.toLowerCase()
        if (
          (otherKey === 'source' ||
            otherKey === 'source_url' ||
            (otherKey === 'source_key' && URL_RE.test(other.value))) &&
          sameSourceUrl(other.value, f.value)
        ) {
          edits.push({ start: other.start, end: other.end, lines: null })
        }
      }
    }
    commitEdits(edits)
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
    if (!k || !KEY_RE.test(k) || ownership.isReserved(k)) return
    if (fields.some((f) => f.key.toLowerCase() === k.toLowerCase())) return
    onChange(appendField(parsed, k, '', isTagField(k)))
  }

  const hasVisibleFields = visibleFieldOrder.length > 0
  const typeField = fields.find((field) => field.key.toLowerCase() === 'source_kind')
  const isConversationDoc = ownership.kind === 'conversation'
  // 类型行只属于会话文档。普通文档里的 source_kind: plain 是内部防回退
  // 标记，不是用户属性，不进入属性面板。
  // 只允许会话文档解除归属。普通文档没有可信的会话身份，反向翻转类型
  // 会制造无法打开原文、也无法稳定去重的“假会话文档”。
  const canConvertToPlain = isConversationDoc && systemUnlocked

  const convertToPlainDocument = (): void => {
    setConvertConfirmOpen(false)
    if (!canConvertToPlain || !typeField) return
    // 只改变文档类型，不顺手删除来源、平台或创建时间：转换后它们都成为
    // 普通属性，用户可以自行决定保留还是删除。
    const next = applyEdits(parsed, [
      { start: typeField.start, end: typeField.end, lines: ['source_kind: plain'] }
    ])
    setSystemUnlocked(false)
    onChange(next)
  }

  return (
    <div
      className={`mb-4 relative ${gitModified ? 'pl-2 border-l-[3px] border-sky-400' : ''}`}
      data-frontmatter-panel="true"
    >
      <div className="w-full flex items-center gap-1.5 px-0 pt-0 pb-1.5 text-label font-medium text-gray-400 dark:text-gray-500">
        <button
          type="button"
          onClick={() => useWorkbenchStore.setState({ frontmatterPanelCollapsed: !collapsed })}
          className="flex flex-1 min-w-0 items-center gap-1.5 text-left hover:text-gray-500 dark:hover:text-gray-400 transition-colors select-none"
        >
          <AppIcon name={collapsed ? 'chevron_right' : 'expand_more'} size={16} />
          笔记属性
          {hasVisibleFields && (
            <span className="ml-auto text-caption font-normal opacity-70">
              {visibleFieldOrder.length}
            </span>
          )}
        </button>
        {!collapsed && isConversationDoc && (
          <button
            type="button"
            title={`${systemUnlocked ? '锁定' : '解锁'}系统属性`}
            aria-label={`${systemUnlocked ? '锁定' : '解锁'}系统属性`}
            aria-pressed={systemUnlocked}
            onClick={() => setSystemUnlocked((value) => !value)}
            className={`shrink-0 transition-colors ${
              systemUnlocked
                ? 'text-primary'
                : 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'
            }`}
          >
            <AppIcon name={systemUnlocked ? 'lock_open' : 'lock'} size={14} />
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="pb-1">
          {isConversationDoc && (
            <div className="group flex items-center gap-3 min-h-[28px] rounded-md -mx-1 px-1">
              <div className="flex items-center gap-1.5 w-32 shrink-0 text-body text-gray-500 dark:text-gray-400">
                <AppIcon name="article" size={15} className="opacity-60" />
                文档类型
              </div>
              <div className="flex-1 min-w-0 flex items-center gap-2">
                <span className="text-body text-text-primary">
                  会话
                </span>
              </div>
              {canConvertToPlain && (
                <button
                  type="button"
                  onClick={() => setConvertConfirmOpen(true)}
                  className="shrink-0 text-label text-gray-400 hover:text-text-primary dark:text-gray-500 dark:hover:text-gray-200 transition-colors"
                >
                  转为普通文档
                </button>
              )}
            </div>
          )}
          {hasVisibleFields && (
            <dl className="space-y-1">
              {visibleFieldOrder.map(({ field: f, idx }, order) => {
                const role = roleOf(f.key)
                const previousRole =
                  order > 0 ? roleOf(visibleFieldOrder[order - 1].field.key) : null
                // 复杂结构只禁止改值；改名只替换 key 行、删除只移除整段，
                // 都不会破坏嵌套内容。
                const canEditKey = role === 'user'
                const canRemove =
                  role === 'user' || (ownership.kind === 'conversation' && systemUnlocked)
                // 来源类字段解锁后可改；身份缓存和旧版应用状态只允许删除，
                // 避免用户把内部标识改成无法解释的值。导图的 source 指向
                // 来源文档，改值会断开绑定，只能整体重建。
                const canEditValue =
                  !f.complex &&
                  (role === 'user' ||
                    (ownership.kind === 'conversation' &&
                      systemUnlocked &&
                      role === 'source'))
                return (
                  <Fragment key={idx}>
                    {role === 'user' && previousRole === 'source' && (
                      <div className="my-1.5 border-t border-black/5 dark:border-white/5" />
                    )}
                    {role === 'identity' && previousRole !== 'identity' && (
                      <div className="my-1.5 border-t border-black/5 dark:border-white/5" />
                    )}
                    <div
                      className={`group flex items-center gap-3 min-h-[28px] rounded-md -mx-1 px-1 hover:bg-gray-200/50 dark:hover:bg-gray-700/40 transition-colors ${
                        role === 'identity' ? 'opacity-75' : ''
                      }`}
                    >
                  <dt className="flex items-center gap-1.5 w-32 shrink-0 text-body text-gray-500 dark:text-gray-400">
                    <AppIcon name={icon(f)} size={15} className="opacity-60" />
                    {editingKeyIdx === idx && canEditKey ? (
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
                        className="w-full min-w-0 bg-white dark:bg-gray-800 border border-primary/50 rounded px-1 py-0 text-label text-text-primary focus:outline-none focus:border-primary"
                      />
                    ) : canEditKey ? (
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
                    ) : (
                      <span className="truncate">{displayKey(f.key)}</span>
                    )}
                  </dt>

                  <dd className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                    {isTagField(f.key) && !f.complex ? (
                      <>
                        {parseTagsFromFrontmatterValue(f.value).map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center gap-1 px-2 py-[2px] rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-300 text-label leading-5 select-none"
                          >
                            {tag}
                            <button
                              type="button"
                              aria-label={`移除标签 ${tag}`}
                              onClick={() => removeTag(idx, tag)}
                              className="leading-none opacity-60 hover:!opacity-100 transition-opacity ml-0.5"
                            >
                              <AppIcon name="close" size={12} />
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
                            className="w-full bg-transparent text-body text-text-primary placeholder:text-gray-400/70 focus:outline-none"
                          />

                          {activeTagInputIdx === idx &&
                            !dismissDropdown &&
                            (currentTagSuggestions.length > 0 ||
                              (tagDrafts[idx] && normalizeTag(tagDrafts[idx]))) && (
                              <div
                                ref={tagDropdownRef}
                                className="absolute left-0 top-full mt-1.5 z-popover min-w-[210px] max-w-[320px] max-h-60 overflow-y-auto rounded-lg shadow-xl border border-black/10 dark:border-white/10 bg-white dark:bg-gray-800 py-1 text-label select-none context-menu-animate"
                              >
                                {currentTagSuggestions.length > 0 && (
                                  <>
                                    <div className="px-2.5 py-1 text-tiny font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
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
                                          <span className="ml-2 shrink-0 px-1.5 py-0.5 rounded-full text-tiny bg-black/5 dark:bg-white/10 text-gray-500 dark:text-gray-400">
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
                                      <span className="text-tiny opacity-60 ml-1">按空格/回车</span>
                                    </div>
                                  )}
                              </div>
                            )}
                        </div>
                      </>
                    ) : editingUrlIdx === idx && canEditValue ? (
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
                        className="flex-1 min-w-[80px] bg-transparent text-body text-text-primary placeholder:text-gray-400/70 focus:outline-none"
                      />
                    ) : isDateField(f.key) && formatDateValue(f.value) !== f.value ? (
                      <button
                        type="button"
                        title={f.value}
                        onClick={() => {
                          if (canEditValue) startUrlEdit(idx, f.value)
                        }}
                        className={`min-w-0 flex-1 truncate text-left text-body text-text-primary ${
                          canEditValue ? 'hover:text-primary' : 'cursor-default'
                        }`}
                      >
                        {formatDateValue(f.value)}
                      </button>
                    ) : isSourcesField(f.key) && !f.complex ? (
                      <span className="flex flex-col gap-1 min-w-0 flex-1">
                        {f.value
                          .split(/\r?\n/)
                          .filter(Boolean)
                          .map((item, itemIdx) => {
                            const target = resolveSourceConversation(item, models)
                            const rest = f.value
                              .split(/\r?\n/)
                              .filter((value) => value && value !== item)
                            return (
                              <span
                                key={`${item}-${itemIdx}`}
                                className="flex items-center gap-1 min-w-0"
                              >
                                <a
                                  href={item}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={item}
                                  className="min-w-0 truncate text-body text-primary hover:underline"
                                >
                                  {item}
                                </a>
                                {target && (
                                  <button
                                    type="button"
                                    title="在侧边栏打开会话"
                                    aria-label="在侧边栏打开会话"
                                    onClick={() =>
                                      openConversationInAiSidebar(target.platformId, target.url)
                                    }
                                    className="shrink-0 text-gray-400 hover:text-primary transition-colors"
                                  >
                                    <AppIcon name="forum" size={14} />
                                  </button>
                                )}
                                {canEditValue && (
                                  <button
                                    type="button"
                                    aria-label={`移除来源 ${item}`}
                                    title="移除来源"
                                    onClick={() => {
                                      // 删空时整段移除，避免留下一个空的 sources 属性。
                                      if (rest.length) updateValue(idx, rest.join('\n'))
                                      else commitEdits([{ start: f.start, end: f.end, lines: null }])
                                    }}
                                    className="shrink-0 text-gray-400 hover:text-red-500 transition-colors"
                                  >
                                    <AppIcon name="close" size={12} />
                                  </button>
                                )}
                              </span>
                            )
                          })}
                      </span>
                    ) : URL_RE.test(f.value) ? (
                      <span className="flex items-center gap-1 min-w-0 flex-1">
                        <a
                          href={f.value}
                          target="_blank"
                          rel="noreferrer"
                          title={
                            canEditValue
                              ? '点击编辑；Ctrl/Cmd+点击在浏览器打开'
                              : 'Ctrl/Cmd+点击在浏览器打开'
                          }
                          onClick={(e) => {
                            // 普通点击进入编辑；带修饰键时放行，交给主窗口的
                            // setWindowOpenHandler → shell.openExternal 打开本地浏览器
                            if (e.ctrlKey || e.metaKey) return
                            e.preventDefault()
                            if (canEditValue) startUrlEdit(idx, f.value)
                          }}
                          className={`min-w-0 truncate text-left text-body text-primary ${
                            canEditValue ? 'hover:underline cursor-text' : 'cursor-default'
                          }`}
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
                    ) : role === 'identity' && !f.complex ? (
                      <span
                        className="min-w-0 flex-1 truncate text-body text-text-secondary"
                        title={f.value || undefined}
                      >
                        {f.value || '—'}
                      </span>
                    ) : canEditValue ? (
                      <input
                        value={f.value}
                        onChange={(e) => updateValue(idx, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                        }}
                        onBlur={() => setEditingUrlIdx(null)}
                        placeholder="空"
                        className="flex-1 min-w-[80px] bg-transparent text-body text-text-primary placeholder:text-gray-400/70 focus:outline-none"
                      />
                    ) : (
                      <span
                        className="min-w-0 flex-1 truncate text-body text-text-primary"
                        title={f.complex ? '嵌套结构，请在源码模式编辑' : undefined}
                      >
                        {f.complex ? '嵌套结构' : f.value || '—'}
                      </span>
                    )}
                  </dd>

                  {canRemove && (
                    <button
                      type="button"
                      aria-label={`删除属性 ${f.key}`}
                      onClick={() => removeField(idx)}
                      className={`shrink-0 text-gray-400 hover:text-red-500 transition-opacity ${
                        systemUnlocked && role !== 'user'
                          ? 'opacity-60 hover:!opacity-100'
                          : 'opacity-0 group-hover:opacity-70 hover:!opacity-100'
                      }`}
                    >
                      <AppIcon name="delete" size={16} />
                    </button>
                  )}
                    </div>
                  </Fragment>
                )
              })}
            </dl>
          )}

          {technicalFieldCount > 0 && (
            <button
              type="button"
              onClick={() => setShowTechnical((value) => !value)}
              className={`flex items-center gap-1 text-label text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors ${
                hasVisibleFields ? 'mt-1.5' : 'py-1'
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
                className="flex-1 bg-white dark:bg-gray-800 border border-primary/50 rounded px-2 py-0.5 text-label text-text-primary focus:outline-none focus:border-primary"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className={`flex items-center gap-1 text-label text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors ${
                hasVisibleFields ? 'mt-1.5' : 'py-1'
              }`}
            >
              <AppIcon name="add" size={15} />
              添加属性
            </button>
          )}
        </div>
      )}

      {convertConfirmOpen && (
        <ConfirmModal
          isOpen
          title="转为普通文档"
          message="转换后将解除与该会话的关联，原文标注不再绑定此文档。来源、平台和创建时间会保留为普通属性，来源链接仍可快捷打开会话。"
          confirmText="转为普通文档"
          cancelText="取消"
          type="warning"
          onConfirm={convertToPlainDocument}
          onCancel={() => setConvertConfirmOpen(false)}
        />
      )}
    </div>
  )
}
