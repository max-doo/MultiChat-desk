import { normalizeMindmapNewlines } from './mindmapEdits'

export const MINDMAPS_DIR = '.multichat/mindmaps'
export const MINDMAP_FILE_SUFFIX = '.mindmap.md'
export const MINDMAP_FILE_LIMIT = 500
export const MINDMAP_NODE_TEXT_LIMIT = 2000
export const MINDMAP_FILE_SIZE_LIMIT = 5 * 1024 * 1024

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/

const YAML_ESCAPABLE = /[:#[\]{},&*!|>'"%@`]|^[-?] | $|^ /

function yamlScalar(value: string): string {
  if (!value) return '""'
  if (YAML_ESCAPABLE.test(value) || /["\\]/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return value
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\(["\\])/g, '$1')
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'")
  }
  return trimmed
}

export interface MindmapFileFrontmatter { id?: string; source?: string; title?: string; updatedAt?: number }

export interface ParsedMindmapFile { frontmatter: MindmapFileFrontmatter; body: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isMindmapId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

export function parseMindmapFile(content: string): ParsedMindmapFile {
  const normalized = normalizeMindmapNewlines(content)
  const match = normalized.match(FRONTMATTER_RE)
  if (!match) return { frontmatter: {}, body: normalized }
  const body = normalized.slice(match[0].length)
  const frontmatter: MindmapFileFrontmatter = {}
  for (const line of match[1].split('\n')) {
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (!m) continue
    const key = m[1].toLowerCase()
    const value = unquoteYamlScalar(m[2])
    if (key === 'id') frontmatter.id = value
    else if (key === 'source') frontmatter.source = value
    else if (key === 'title') frontmatter.title = value
    else if (key === 'updatedat' && /^\d+$/.test(value)) frontmatter.updatedAt = Number(value)
  }
  return { frontmatter, body }
}

export interface MindmapFileFields {
  id: string
  source: string
  title: string
  /** 乐观并发控制用的版本戳；外部软件不认识这一行，会原样保留。 */
  updatedAt?: number
}

export function serializeMindmapFile(fields: MindmapFileFields, body: string): string {
  const head = [
    '---',
    `id: ${fields.id}`,
    `source: ${yamlScalar(fields.source)}`,
    `title: ${yamlScalar(fields.title)}`,
    ...(fields.updatedAt === undefined ? [] : [`updatedAt: ${fields.updatedAt}`]),
    '---',
    ''
  ].join('\n')
  return head + normalizeMindmapNewlines(body)
}

export function sanitizeMindmapFileName(name: string): string {
  let value = ''
  for (const ch of name) {
    const code = ch.charCodeAt(0)
    if (code < 32 || code === 127 || '\\/:*?"<>|'.includes(ch)) continue
    value += ch
  }
  value = value.trim()
  if (!value) value = 'mindmap'
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(value)) value = '_' + value
  return value.slice(0, 60)
}

export function hasIllegalContentCharacters(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) return true
  }
  return false
}
