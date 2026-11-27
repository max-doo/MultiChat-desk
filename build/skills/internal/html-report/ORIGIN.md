> Created: 2026-11-27 21:59 (Asia/Shanghai)

# html-report 来源记录

- **上游仓库**: https://github.com/max-doo/html-report.git
- **快照 commit**: `6a3bf9f`（"feat: initial release of html-report skill"，仓库唯一提交）
- **拷贝时间**: 2026-11-27
- **拷贝方式**: 完整拷贝，剔除 `README.md`（用户指示）、`.gitignore`、`.git/` 目录

## 许可状态：✅ 无风险（用户本人项目）

上游仓库**没有 LICENSE 文件**（2026-11-27 经 GitHub API 核实），但用户已于
2026-11-27 明确确认 max-doo/html-report 是其本人项目。著作权人分发自己的作品
不受限制，随包分发合规。若未来希望第三方也能复用该 skill，可考虑在上游仓库补
一个 MIT/Apache-2.0 LICENSE（非必需，仅影响外部复用便利性）。

## 本地化改动（与上游快照的差异）

1. 四个脚本补充 UTF-8 stdout 重配（中文 Windows GBK 控制台乱码修复），`scaffold.py`
   补 `import sys`。
2. SKILL.md 新增"第 0 步：运行时接线"——ensure-python 自举契约（本 skill 仅用
   标准库，不传 `--packages`）、pythonExe 绝对路径调用纪律、脚本绝对路径解析说明、
   Playwright 视觉审计的可选增强定位与成本警示。
3. 脚本使用说明的 `bash` 代码块标记改为 `powershell`（宿主默认 shell），并注明
   `python` 与 `scripts/` 前缀的替换约定。

## 已知上游局限（未改动，如实保留）

- `--visual-audit` 依赖 Playwright，未安装时自动跳过（脚本自身行为）。
- Google Fonts 是 scaffold 模板中唯一允许的外部资源（skill 自身规范如此），
  离线环境字体降级为系统字体，不影响打开。
