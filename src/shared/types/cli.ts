/**
 * 命令行工具（multichat）集成状态
 * 供主进程组装、渲染层设置卡片与首启引导卡片消费
 */
export interface CliIntegrationStatus {
  /** 是否支持自动 PATH 管理（当前仅 Windows 安装版/便携版） */
  supported: boolean
  /** 运行平台（win32/darwin/linux），渲染层据此区分 PATH 能力与引导条件 */
  platform: string
  /** 是否为打包产物（dev 模式下为 false，引导卡片不展示） */
  isPackaged: boolean
  /** cli 目录是否已在用户 PATH 中 */
  onPath: boolean
  /** 首启 Agent 集成提示是否已被用户关闭 */
  hintDismissed: boolean
  /** multichat shim 所在目录（安装版为 $INSTDIR\cli） */
  cliDir: string | null
  /** multichat 入口文件完整路径 */
  cliCmdPath: string | null
  /** 随包分发的 Agent Skill 目录（resources/skill/multichat-cli 或仓库 .agents/skills） */
  skillDir: string | null
}
