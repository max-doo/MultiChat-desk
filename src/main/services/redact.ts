const runtimeSecrets = new Set<string>()

const SECRET_VALUE_PATTERN = /(?:sk-[A-Za-z0-9_-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{4,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----)/g

/** Keep enough of the value to correlate entries across output without exposing the secret. */
function maskValue(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= 8) return '[redacted]'
  return `${trimmed.slice(0, 4)}…[redacted]…${trimmed.slice(-4)}`
}

/**
 * Redact secrets from shell/tool output before they reach the model or the
 * transcript. Covers `NAME=value` / `NAME: value` / `NAME  value` (Format-
 * Table) rows whose name IS or ENDS WITH a secret keyword (key, token,
 * secret, password, passwd, credential, private, auth), plus common token
 * shapes (sk-*, JWTs, GitHub/AWS/Slack tokens, PEM headers) that slip
 * through when the variable name is innocuous. Keeps the first/last few
 * characters so repeated occurrences remain distinguishable in output.
 */
export function redactShellOutput(text: string): string {
  if (!text) return text
  // Key-value rows: `NAME = value`, `NAME: value`, `NAME=value`, `NAME  value`
  // (Format-Table). The name must end with a secret keyword — `key`, `token`,
  // `secret`, `password`, `passwd`, `credential`, `private`, `auth` — so
  // ordinary env vars (PATH, HOME, APPDATA) stay readable. The name is
  // captured on a keyword boundary so `key`/`password` alone also match.
  const kv = text.replace(
    /(^|[\s;|{(]|[ \t]{2,})([A-Za-z_][A-Za-z0-9_.-]*?)([ \t]*[=:][ \t]*|[ \t]{2,})("?)([^\s"';,})]+)\4/gim,
    (match, prefix: string, name: string, sep: string, quote: string, value: string) => {
      // `name` ends with a secret keyword (case-insensitive), or is exactly
      // one of them. Monkey-see-monkey-do names like `monkey` or `keywords`
      // still hit — the value patterns below catch obvious non-secrets.
      if (!/(?:key|token|secret|password|passwd|credential|private|auth)$/i.test(name)) {
        return match
      }
      return `${prefix}${name}${sep}${quote}${maskValue(value)}${quote}`
    }
  )
  // Known token shapes that slip through when the variable name is innocuous.
  return kv.replace(SECRET_VALUE_PATTERN, (match) => maskValue(match))
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
