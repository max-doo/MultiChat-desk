import type { CliIntegrationStatus } from '../../../shared/types/cli'

/**
 * 生成 Agent 集成指引文本（供"复制指引"按钮写入剪贴板）。
 * Skill 需用户手动复制到自己的 Agent skills 目录，应用不代写用户目录。
 */
export function buildCliGuideText(status: CliIntegrationStatus): string {
  const cmd = status.onPath ? 'multichat' : (status.cliCmdPath ?? 'multichat')
  const lines: string[] = [
    'MultiChat 命令行工具使用指引',
    '',
    '1. 保持 MultiChat 运行，在终端执行以下命令验证连接：',
    `   ${cmd} daemon status`,
    ''
  ]
  if (status.skillDir) {
    lines.push(
      '2. 让 AI Agent（Devin / Claude Code 等）也能调用，把配套 Skill 复制到 Agent 的 skills 目录：',
      `   源目录：${status.skillDir}`,
      '   目标：项目内 .devin/skills/multichat-cli（单项目生效）',
      '        或 ~/.devin/skills/multichat-cli（全部项目生效）',
      ''
    )
  }
  lines.push(
    `${status.skillDir ? '3' : '2'}. 之后即可在任意目录中执行，例如：`,
    `   ${cmd} task submit --platform gemini --query "你的问题" --wait 300 --json`,
    '',
    '更多命令：daemon status / platforms / task status|result|cancel|list'
  )
  return lines.join('\n')
}
