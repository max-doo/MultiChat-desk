/**
 * 工作台标签 (Tags) 规范与工具函数
 * 对齐 Obsidian 标签命名、存储与检索规范：
 * 1. Frontmatter 存储不含 # 前缀；正文行内标签以 # 引导
 * 2. 标签支持多语言字母、数字（不能为纯数字）、下划线 _、短横线 -、层级斜杠 /
 * 3. 标签不支持空格与非法标点符号
 * 4. 检索支持 tag:#xxx、tag:xxx、#xxx 语法，且支持父子层级嵌套继承匹配（如 parent 命中 parent/child）
 */

export const TAG_FIELD_RE = /^(?:tags?|标签)$/i

export const isTagField = (key: string): boolean => TAG_FIELD_RE.test(key.trim())

/**
 * 规范化标签字符串：
 * - 剥离前缀的 '#'
 * - 去除首尾空白与首尾斜杠
 * - 清除内部非法字符（空格、逗号、引号、冒号等）
 * - 折叠多余连续斜杠
 */
export function normalizeTag(raw: string): string {
  if (!raw) return ''
  let cleaned = raw.trim()
  // 剥离开头的 # 号（Obsidian Frontmatter 标签不带 #）
  cleaned = cleaned.replace(/^#+/, '')
  // 剔除前后斜杠
  cleaned = cleaned.replace(/^\/+|\/+$/g, '')
  // 剔除单双引号
  cleaned = cleaned.replace(/^["']|["']$/g, '')
  // 剔除首尾空白
  cleaned = cleaned.trim()

  // 非法字符清洗：保留多语言 Unicode 字母、数字、下划线、短横线、层级斜杠
  // 将 #、逗号、冒号、空格等非法标点去除
  cleaned = cleaned.replace(/[^\p{L}\p{N}_\-/]+/gu, '')
  // 折叠连续斜杠
  cleaned = cleaned.replace(/\/+/g, '/')
  return cleaned
}

/**
 * 验证标签是否合法：
 * - 必须非空
 * - 必须包含至少一个非数字字符（纯数字如 1984 不被 Obsidian 视作标签）
 * - 必须仅包含字母（多语言 Unicode）、数字、下划线、短横线、层级斜杠
 */
export function isValidTag(tag: string): boolean {
  if (!tag) return false
  const trimmed = tag.trim().replace(/^#+/, '')
  if (!trimmed) return false
  // 不能以斜杠开头或结尾
  if (trimmed.startsWith('/') || trimmed.endsWith('/')) return false
  const normalized = normalizeTag(tag)
  if (!normalized) return false
  // 纯数字无效（对齐 Obsidian：纯数字如 1984 不视作标签）
  if (/^\p{N}+$/u.test(normalized)) return false
  // 仅允许合法字符集（支持多语言 Unicode 字母）
  return /^[\p{L}\p{N}_\-/]+$/u.test(normalized)
}

/**
 * 从 Frontmatter 字段值中解析标签列表
 * 支持格式：
 * - YAML 行内数组: `[react, "vue", '#test']`
 * - 逗号分隔: `react, vue, #test`
 * - 空格分隔: `react vue #test`
 * - 混合带引号与 #
 */
export function parseTagsFromFrontmatterValue(val: string): string[] {
  if (!val) return []
  let body = val.trim()
  if (body.startsWith('[') && body.endsWith(']')) {
    body = body.slice(1, -1)
  }

  // 按逗号或空白分割
  const rawItems = body.split(/[,\s]+/)
  const result: string[] = []
  const seen = new Set<string>()

  for (const item of rawItems) {
    const norm = normalizeTag(item)
    if (isValidTag(norm)) {
      const lower = norm.toLowerCase()
      if (!seen.has(lower)) {
        seen.add(lower)
        result.push(norm)
      }
    }
  }

  return result
}

/**
 * 判断候选标签是否匹配查询标签（对齐 Obsidian 层级标签继承逻辑）
 * 例如：
 * - 候选 `project/alpha` 匹配查询 `project`（父子层级）
 * - 候选 `project/alpha` 匹配查询 `project/alpha`（精确匹配）
 * - 候选 `project-alpha` 不匹配查询 `project`
 */
export function matchTag(candidateTag: string, queryTag: string): boolean {
  const c = normalizeTag(candidateTag).toLowerCase()
  const q = normalizeTag(queryTag).toLowerCase()
  if (!c || !q) return false
  if (c === q) return true
  // 层级子标签匹配
  if (c.startsWith(q + '/')) return true
  return false
}

export interface TagSearchQueryInfo {
  isTagQuery: boolean
  tagTerm: string
  rawQuery: string
}

/**
 * 解析用户输入的搜索字符串，判断是否包含标签检索意图
 * 支持语法：
 * 1. `tag:#vue` 或 `tag:vue` -> tagTerm = 'vue'
 * 2. `#vue` 或 `#project/ui` -> tagTerm = 'vue' / 'project/ui'
 */
export function parseTagSearchQuery(query: string): TagSearchQueryInfo {
  const trimmed = query.trim()
  if (!trimmed) {
    return { isTagQuery: false, tagTerm: '', rawQuery: query }
  }

  // 1. tag: 前缀
  if (/^tag:/i.test(trimmed)) {
    const rawTerm = trimmed.slice(4).trim()
    const norm = normalizeTag(rawTerm)
    return {
      isTagQuery: !!norm,
      tagTerm: norm,
      rawQuery: query
    }
  }

  // 2. # 开头且无空格的独立标签检索
  if (trimmed.startsWith('#') && !/\s/.test(trimmed)) {
    const norm = normalizeTag(trimmed)
    if (isValidTag(norm)) {
      return {
        isTagQuery: true,
        tagTerm: norm,
        rawQuery: query
      }
    }
  }

  return {
    isTagQuery: false,
    tagTerm: '',
    rawQuery: query
  }
}

/**
 * 从完整 Markdown 文本中提取 Frontmatter 中的标签及其所在行号 (1-indexed)
 */
export function extractFrontmatterTags(content: string): {
  tags: string[]
  lineMap: Map<string, number>
} {
  const tags: string[] = []
  const lineMap = new Map<string, number>()
  const fmMatch = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/)
  if (!fmMatch) return { tags, lineMap }

  const lines = content.split(/\r?\n/)
  let inFrontmatter = false
  let currentKeyIsTag = false
  const seen = new Set<string>()

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (i === 0 && line.trim() === '---') {
      inFrontmatter = true
      continue
    }
    if (inFrontmatter && line.trim() === '---') {
      break
    }
    if (!inFrontmatter) break

    // 检测 key:
    const kvMatch = line.match(/^([A-Za-z0-9_\-一-龥]+)\s*:\s*(.*)$/)
    if (kvMatch) {
      const key = kvMatch[1]
      const restValue = kvMatch[2] || ''
      if (isTagField(key)) {
        currentKeyIsTag = true
        // 可能是单行 tags: [a, b] 或 tags: a, b
        const parsed = parseTagsFromFrontmatterValue(restValue)
        for (const t of parsed) {
          const lower = t.toLowerCase()
          if (!seen.has(lower)) {
            seen.add(lower)
            tags.push(t)
            lineMap.set(lower, i + 1)
          }
        }
      } else {
        currentKeyIsTag = false
      }
      continue
    }

    // 检测多行列表 `- item`
    if (currentKeyIsTag) {
      const listMatch = line.match(/^\s*-\s+(.+)$/)
      if (listMatch) {
        const item = listMatch[1].trim()
        const norm = normalizeTag(item)
        if (isValidTag(norm)) {
          const lower = norm.toLowerCase()
          if (!seen.has(lower)) {
            seen.add(lower)
            tags.push(norm)
            lineMap.set(lower, i + 1)
          }
        }
      }
    }
  }

  return { tags, lineMap }
}

/**
 * 从 Markdown 正文中提取行内标签（避开代码块与标头）
 */
export function extractInlineTags(content: string): Array<{
  tag: string
  line: number
  rawMatch: string
}> {
  const results: Array<{ tag: string; line: number; rawMatch: string }> = []
  const lines = content.split(/\r?\n/)
  let inFencedCode = false
  let inFrontmatter = false

  // 行内标签正则：以 # 引导，后接字母/中文（多语言 Unicode），可包含层级 /，不可全为纯数字，不可紧随标点
  const INLINE_TAG_RE = /(?:^|[^\p{L}\p{N}#])#([\p{L}_][\p{L}\p{N}_\-/]*)/gu

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Frontmatter 跳过
    if (i === 0 && line.trim() === '---') {
      inFrontmatter = true
      continue
    }
    if (inFrontmatter) {
      if (line.trim() === '---') inFrontmatter = false
      continue
    }

    // 代码块跳过
    if (/^\s*(```|~~~)/.test(line)) {
      inFencedCode = !inFencedCode
      continue
    }
    if (inFencedCode) continue

    // Markdown 标题跳过 (如 `# 标题`，后跟空格)
    if (/^\s*#{1,6}\s+/.test(line)) continue

    let match: RegExpExecArray | null
    INLINE_TAG_RE.lastIndex = 0
    while ((match = INLINE_TAG_RE.exec(line)) !== null) {
      const candidate = match[1]
      const norm = normalizeTag(candidate)
      if (isValidTag(norm)) {
        results.push({
          tag: norm,
          line: i + 1,
          rawMatch: `#${norm}`
        })
      }
    }
  }

  return results
}
