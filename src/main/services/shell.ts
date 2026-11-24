export type ShellToolName = 'powershell' | 'bash'

/** Pick the single shell tool exposed to the model for this platform. */
export function shellToolForPlatform(platform: NodeJS.Platform = process.platform): ShellToolName {
  return platform === 'win32' ? 'powershell' : 'bash'
}

/** The platform counterpart that must be excluded so the model only sees one shell tool. */
export function excludedShellTools(platform: NodeJS.Platform = process.platform): ShellToolName[] {
  return [shellToolForPlatform(platform) === 'powershell' ? 'bash' : 'powershell']
}

/**
 * Fresh execution facts for the model, independent of saved prompts and history.
 * Tells the model which shell syntax to emit (PowerShell vs bash) instead of
 * teaching it how to use a shell — models on Windows otherwise produce POSIX
 * commands that hit native tools and fail. `resolveExecutable` should return
 * the real resolved path from `getPowerShellConfig()` / `getShellConfig()`.
 */
export function shellEnvironmentPrompt(
  cwd: string,
  tools: readonly string[],
  resolveExecutable?: () => string
): string {
  const platform = process.platform
  const os = platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux' : platform
  const shellTool = shellToolForPlatform(platform)
  const executable = tools.includes(shellTool) ? resolveExecutable?.() : undefined
  return (
    `<environment>\nOperating system: ${os} (${platform}).\nWorking directory: ${cwd}.\n` +
    `Path style: ${platform === 'win32' ? 'Windows' : 'POSIX'}.\n` +
    (tools.includes(shellTool)
      ? `Command tool: ${shellTool}.` +
        (executable ? ` Executable: ${executable}.` : '') +
        ` Use command syntax supported by ${executable || shellTool}.\n`
      : 'No command tool is available in this turn.\n') +
    '</environment>'
  )
}
