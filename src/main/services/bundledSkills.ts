import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

/**
 * 随包 skill 根目录解析。
 *
 * 打包版：安装目录 resources/skill/（electron-builder extraResources 把仓库
 * .agents/skills 整目录拷到这里）。dev 版：仓库内 .agents/skills。
 * 目录不存在（构建缺漏或 dev 首次 clone）时返回 null，调用方应跳过而非报错——
 * skill 是增强能力，缺失不应阻断会话创建。
 */
export function getBundledSkillsRoot(): string | null {
  const candidate = app.isPackaged
    ? join(process.resourcesPath, 'skill')
    : join(app.getAppPath(), '.agents', 'skills')
  return existsSync(candidate) ? candidate : null
}
