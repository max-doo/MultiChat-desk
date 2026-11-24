const runtimeSecrets = new Set<string>()

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
