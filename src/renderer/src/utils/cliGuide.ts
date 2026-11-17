/**
 * 生成给 AI Agent 的 Skill 安装命令文本（供"复制安装命令"按钮写入剪贴板）。
 * Skill 由用户的 Agent 自行复制到项目或全局 skills 目录，应用不代写用户目录。
 */
export function buildSkillInstallCommand(skillDir: string): string {
  return [
    `请安装 MultiChat 的 Agent Skill：将 "${skillDir}" 整个目录复制到当前项目的 .agents/skills/ 下（保持目录名 multichat-cli；客户端有专属 skills 目录时按其约定放置）。如需对所有项目生效，改为复制到 ~/.agents/skills/ 下。`,
    '该 Skill 通过 multichat CLI 驱动 MultiChat 桌面应用，需保持应用运行。'
  ].join('\n')
}
