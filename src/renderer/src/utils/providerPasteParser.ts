import type { AgentGatewayApiType } from '../types/agent'

export interface ParsedGatewayConfig {
  baseUrl?: string
  apiKey?: string
  api?: AgentGatewayApiType
  suggestedName?: string
  suggestedId?: string
  sampleModel?: string
  sourceType: 'curl' | 'env' | 'url'
}

const PLACEHOLDER_KEY_RE =
  /^\$|^%\w+%$|^<.*>$|^\{\{.*\}\}$|^\[.*\]$|your[_-]?|api[_-]?key|replace[_-]?me|x{6,}|\.\.\.|…/i

function stripQuotes(raw: string): string {
  const s = raw.trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).trim()
  }
  return s
}

function suggestNameAndIdFromUrl(baseUrl: string): { name?: string; id?: string } {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    const clean = host.replace(/^(?:api|llm|ai|gateway|proxy)\./, '')
    const root = clean.split('.')[0] || clean
    const id = root.replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 28)
    const name = root.charAt(0).toUpperCase() + root.slice(1)
    return { name, id }
  } catch {
    return {}
  }
}

function normalizeEndpointUrl(rawUrl: string): { baseUrl: string; api?: AgentGatewayApiType } {
  const trimmed = rawUrl.trim().replace(/[?#].*$/, '').replace(/\/+$/, '')
  const suffixMap: Array<[RegExp, AgentGatewayApiType, boolean]> = [
    [/\/v1\/messages$/i, 'anthropic-messages', true],
    [/\/messages$/i, 'anthropic-messages', false],
    [/\/v1\/responses$/i, 'openai-responses', false],
    [/\/responses$/i, 'openai-responses', false],
    [/\/v1\/chat\/completions$/i, 'openai-completions', false],
    [/\/chat\/completions$/i, 'openai-completions', false]
  ]
  for (const [pattern, api, stripV1] of suffixMap) {
    if (pattern.test(trimmed)) {
      if (stripV1) {
        return { baseUrl: trimmed.replace(/\/v1\/messages$/i, ''), api }
      }
      if (api === 'anthropic-messages') {
        return { baseUrl: trimmed.replace(/\/messages$/i, '').replace(/\/v1$/i, ''), api }
      }
      return {
        baseUrl: trimmed.replace(/\/(?:chat\/completions|responses)$/i, ''),
        api
      }
    }
  }
  return { baseUrl: trimmed }
}

/**
 * Parse a pasted `curl` command, `export KEY=VALUE` / `.env` block, or bare URL
 * into gateway configuration fields (inspired by Magpie's pasteread.js).
 */
export function parsePastedGatewayConfig(rawText: string): ParsedGatewayConfig | null {
  const text = rawText.trim()
  if (!text) return null

  // 1. Curl command
  if (/^curl(?:\.exe)?(?=\s)/i.test(text)) {
    const collapsed = text.replace(/(?:\\|\^|`)[ \t]*\r?\n/g, ' ')
    const tokens: string[] = []
    let current = ''
    let inSingle = false
    let inDouble = false
    for (let i = 0; i < collapsed.length; i++) {
      const ch = collapsed[i]
      if (ch === "'" && !inDouble) {
        inSingle = !inSingle
        continue
      }
      if (ch === '"' && !inSingle) {
        inDouble = !inDouble
        continue
      }
      if (/\s/.test(ch) && !inSingle && !inDouble) {
        if (current) {
          tokens.push(current)
          current = ''
        }
        continue
      }
      if (ch === '\\' && inDouble && /["\\$`]/.test(collapsed[i + 1] ?? '')) {
        i++
        current += collapsed[i] ?? ''
        continue
      }
      current += ch
    }
    if (current) tokens.push(current)

    let rawUrl = ''
    let apiKey = ''
    let sampleModel = ''
    for (let i = 1; i < tokens.length; i++) {
      const tok = tokens[i]
      if (tok === '-H' || tok === '--header') {
        const header = tokens[++i] ?? ''
        const m = /^\s*(authorization|x-api-key|api-key)\s*:\s*(.+)$/i.exec(header)
        if (m) {
          const val = m[1].toLowerCase() === 'authorization' ? m[2].replace(/^bearer\s+/i, '').trim() : m[2].trim()
          if (val && !PLACEHOLDER_KEY_RE.test(val)) apiKey = val
        }
      } else if (tok === '--url') {
        rawUrl = tokens[++i] ?? ''
      } else if (/^(-d|--data(-raw|-binary|-ascii)?|--json)$/.test(tok)) {
        const body = tokens[++i] ?? ''
        try {
          const parsed = JSON.parse(body.replace(/\\"/g, '"')) as { model?: unknown }
          if (typeof parsed?.model === 'string') sampleModel = parsed.model.trim()
        } catch {
          // ignore non-JSON body
        }
      } else if (!tok.startsWith('-') && /^https?:\/\//i.test(tok) && !rawUrl) {
        rawUrl = tok
      }
    }

    if (!rawUrl && !apiKey) return null
    const normalized = rawUrl ? normalizeEndpointUrl(rawUrl) : undefined
    const suggested = normalized?.baseUrl ? suggestNameAndIdFromUrl(normalized.baseUrl) : {}
    return {
      baseUrl: normalized?.baseUrl,
      apiKey: apiKey || undefined,
      api: normalized?.api,
      sampleModel: sampleModel || undefined,
      suggestedName: suggested.name,
      suggestedId: suggested.id,
      sourceType: 'curl'
    }
  }

  // 2. Environment variables (`export OPENAI_BASE_URL=...`, `ANTHROPIC_AUTH_TOKEN=...`, PowerShell `$env:...`)
  const envUrlMatch =
    /(?:^|\n)\s*(?:export\s+|set\s+|\$env:)?(?:OPENAI|ANTHROPIC|DEEPSEEK|API|BASE)[A-Z0-9_]*?(?:BASE_URL|API_BASE|ENDPOINT|URL)\s*=\s*([^\r\n#;]+)/im.exec(
      text
    )
  const envKeyMatch =
    /(?:^|\n)\s*(?:export\s+|set\s+|\$env:)?[A-Z0-9_]*?(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN|TOKEN)\s*=\s*([^\r\n#;]+)/im.exec(
      text
    )
  if (envUrlMatch || envKeyMatch) {
    const rawUrl = envUrlMatch ? stripQuotes(envUrlMatch[1]) : ''
    const rawKey = envKeyMatch ? stripQuotes(envKeyMatch[1]) : ''
    const isAnthropicEnv = /ANTHROPIC_/i.test(text)
    const normalized = rawUrl && /^https?:\/\//i.test(rawUrl) ? normalizeEndpointUrl(rawUrl) : undefined
    const api: AgentGatewayApiType | undefined =
      normalized?.api ?? (isAnthropicEnv ? 'anthropic-messages' : undefined)
    const suggested = normalized?.baseUrl ? suggestNameAndIdFromUrl(normalized.baseUrl) : {}
    return {
      baseUrl: normalized?.baseUrl,
      apiKey: rawKey && !PLACEHOLDER_KEY_RE.test(rawKey) ? rawKey : undefined,
      api,
      suggestedName: suggested.name,
      suggestedId: suggested.id,
      sourceType: 'env'
    }
  }

  // 3. Bare URL pasted directly
  if (/^https?:\/\/\S+$/i.test(text)) {
    const normalized = normalizeEndpointUrl(text)
    const suggested = suggestNameAndIdFromUrl(normalized.baseUrl)
    return {
      baseUrl: normalized.baseUrl,
      api: normalized.api,
      suggestedName: suggested.name,
      suggestedId: suggested.id,
      sourceType: 'url'
    }
  }

  return null
}
