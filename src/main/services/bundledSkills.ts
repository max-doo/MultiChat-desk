import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

/**
 * 随包 skill 根目录解析。
 *
 * 打包版：安装目录 resources/skill/（electron-builder extraResources 把仓库
 * build/skills 整目录拷到这里）下的 internal/ 子目录。dev 版：仓库内
 * build/skills/internal。
 * 注意：仓库内 skill 源故意放在 build/skills 而非 .agents/skills——后者是
 * agent 生态的自动扫描约定目录（pi 内核会扫描 cwd 祖先的 .agents/skills，
 * 其他宿主 agent 也遵循同一惯例），放那里会污染本仓库的开发上下文。
 * internal 分层的原因：resources/skill/multichat-cli 是给外部 agent 的
 * skill（与侧边 Agent 内部能力重叠，不应对其可见），而内核扫描是递归的，
 * 唯一可靠的隔离是把它放在扫描根之外——internal/ 就是侧边 Agent 的扫描根。
 * 目录不存在（构建缺漏或 dev 首次 clone）时返回 null，调用方应跳过而非报错——
 * skill 是增强能力，缺失不应阻断会话创建。
 */
export function getBundledSkillsRoot(): string | null {
  const candidate = app.isPackaged
    ? join(process.resourcesPath, 'skill', 'internal')
    : join(app.getAppPath(), 'build', 'skills', 'internal')
  return existsSync(candidate) ? candidate : null
}
