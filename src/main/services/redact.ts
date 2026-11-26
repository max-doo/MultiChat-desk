const runtimeSecrets = new Set<string>()

const SECRET_VALUE_PATTERN = /(?:sk-[A-Za-z0-9_-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{4,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----)/g

const SECRET_WORD_BOUNDARY_RX =
  /(?:^|[_.-])(?:key|token|secret|password|passwd|credential|private|auth)$/i
const SECRET_CAMEL_BOUNDARY_RX =
  /[a-z0-9](?:Key|Token|Secret|Password|Passwd|Credential|Private|Auth)$/

const NON_SECRET_LITERAL_RX =
  /^(?:true|false|null|none|undefined|nil|nan|\*+|\[redacted\])$/i

function maskValue(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= 8) return '[redacted]'
  return `${trimmed.slice(0, 4)}…[redacted]…${trimmed.slice(-4)}`
}

function shouldMaskEntry(name: string, value: string): boolean {
  if (!SECRET_WORD_BOUNDARY_RX.test(name) && !SECRET_CAMEL_BOUNDARY_RX.test(name)) return false
  if (NON_SECRET_LITERAL_RX.test(value.trim())) return false
  return true
}

/**
 * Redact secrets from shell/tool output before they reach the model or the
 * transcript. Covers `NAME=value` / `NAME: value` / line-start `NAME  value`
 * (Format-Table) rows whose name IS or ENDS WITH a secret keyword on a word /
 * camelCase boundary (key, token, secret, password, passwd, credential, private,
 * auth), plus common token shapes (sk-*, JWTs, GitHub/AWS/Slack tokens, PEM
 * headers) that slip through when the variable name is innocuous. Keeps the
 * first/last few characters so repeated occurrences remain distinguishable.
 */
export function redactShellOutput(text: string): string {
  if (!text) return text
  // Redact Bearer tokens first so `auth: Bearer <tok>` doesn't mask only the word `Bearer`.
  const withBearerRedacted = text.replace(
    /\b(Bearer[ \t]+)(?!\[redacted\])([^\s"';,})]+)/gi,
    (_m, prefix: string, tok: string) => `${prefix}${maskValue(tok)}`
  )
  // Key-value assignments (`NAME = value`, `NAME: value`, `NAME=value`, JSON `"apiKey": "val"`),
  // supporting single-quoted, double-quoted (with spaces), and unquoted tokens,
  // while excluding comparison/arrow operators (`==`, `===`, `=>`, `:=`).
  const kv = withBearerRedacted.replace(
    /(^|[\s;|{(,])("?)([A-Za-z_][A-Za-z0-9_.-]*?)\2([ \t]*(?:=(?!=|>)|:(?!=))[ \t]*)(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s"';,})]+))/gm,
    (
      match,
      prefix: string,
      keyQuote: string,
      name: string,
      sep: string,
      dqVal: string | undefined,
      sqVal: string | undefined,
      bareVal: string | undefined
    ) => {
      const value = dqVal ?? sqVal ?? bareVal ?? ''
      if (!shouldMaskEntry(name, value)) return match
      const valQuote = dqVal !== undefined ? '"' : sqVal !== undefined ? "'" : ''
      return `${prefix}${keyQuote}${name}${keyQuote}${sep}${valQuote}${maskValue(value)}${valQuote}`
    }
  )
  // Line-start two-column table rows (`Get-ChildItem Env:` / Format-Table).
  const tableRows = kv.replace(
    /^([A-Za-z_][A-Za-z0-9_.-]*?)([ \t]{2,})(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s"';,})]+))/gm,
    (
      match,
      name: string,
      sep: string,
      dqVal: string | undefined,
      sqVal: string | undefined,
      bareVal: string | undefined
    ) => {
      const value = dqVal ?? sqVal ?? bareVal ?? ''
      if (!shouldMaskEntry(name, value)) return match
      const valQuote = dqVal !== undefined ? '"' : sqVal !== undefined ? "'" : ''
      return `${name}${sep}${valQuote}${maskValue(value)}${valQuote}`
    }
  )
  // Known token shapes that slip through when the variable name is innocuous.
  return tableRows.replace(SECRET_VALUE_PATTERN, (match) => maskValue(match))
}

export function redactCredential(secret: string | undefined): void {
  if (!secret) return
  if (secret.length < 4) return
  runtimeSecrets.add(secret)
}

export function safeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  let redacted = text
  for (const secret of runtimeSecrets) {
    if (redacted.includes(secret)) redacted = redacted.split(secret).join('[redacted]')
  }
  return redacted.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
}
