> Created: 2026-07-11 13:24 (+08:00)

# macOS 适配与验证期发布计划

## 决策摘要

本阶段的交付目标是官网直发的 macOS DMG，而不是 Mac App Store 版本。优先完成两项核心能力：

1. 主窗口顶部栏适配 macOS 原生 traffic lights 与可靠拖动；
2. 系统级“选中文本快捷工具条”适配 macOS。

产品仍处验证期，暂不购买 Developer ID、不做代码签名和 Apple notarization。该决定可以降低早期成本，但不能让未签名应用获得“普通双击即可打开”的体验：Gatekeeper 会要求用户明确确认。发行说明和首次启动引导必须如实说明这一点，不能承诺绕过或静默规避 macOS 安全机制。

官方依据：Electron 说明，面向用户分发的 macOS 应用应完成签名与公证；未签名应用需要用户进行额外手工步骤才能运行。[Electron Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)

## 一、顶部窗口栏适配

### 目标 UI

- macOS 顶栏高度为 52px；不展示产品 Logo 与产品名称。
- 左侧预留 86px 系统安全区，仅供红、黄、绿 traffic lights 使用。
- 安全区之后依次为“多 AI / 任务分配 / 辩论”模式分段控件。
- 中央位置保留窗口布局切换；在总结页改为“API / Webview”来源切换。
- 右侧仅保留历史与设置；不新增无实际状态源的状态点，也不自绘关闭、最小化、缩放按钮。
- 窗口宽度小于 980px 时隐藏次要文字；小于 760px 时将布局切换收入菜单。

### 实施步骤

1. 修改 `src/main/webviewManager.ts`：主窗口按平台配置。
   - macOS 使用 `titleBarStyle: 'hiddenInset'`，保留原生控制按钮；不使用 Windows 风格 `titleBarOverlay`。
   - Windows/Linux 保留当前窗口策略，避免无关回归。
   - 将当前无条件的 `use-angle=gl` 调整为 Windows 专用；该开关原本用于 Windows Webview 黑屏问题。
2. 修改 `src/renderer/src/components/Layout.tsx`：移除 Logo 与产品名，并根据平台添加 `mac-titlebar` 类。
3. 修改 `src/renderer/src/assets/index.css`：为 macOS 顶栏设置 52px 高度、86px 左侧安全区和断点样式。
4. macOS 使用 `-webkit-app-region: drag` 标注顶栏留白；所有按钮、分段控件、菜单和抽屉入口使用 `no-drag`。
5. 修改 `src/main/ipcHandlers.ts`、`src/preload/index.ts`、`src/preload/index.d.ts`：仅 Windows/Linux 保留现有 `window-drag-*` IPC；macOS 不再用鼠标事件手动移动窗口。

### 验收标准

- traffic lights 不遮挡任何控件，且红色关闭按钮保持项目既有“隐藏到托盘/后台”的行为。
- 顶栏留白可拖动，所有交互控件均不会触发拖动。
- Retina、多显示器、全屏、最小窗口尺寸与窄窗口断点均无重叠或溢出。
- Windows 现有无边框窗口和拖动行为回归通过。

Electron 对 macOS 无边框窗口与拖动区域存在平台差异，实施时以对应版本 API 文档和实机结果为准。[Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)

## 二、macOS 系统级快捷工具条

### 技术方案

现有方案由 `monio-napi` 全局钩子、Windows UI Automation 和 PowerShell 组成，不能在 macOS 复用。macOS 采用：

- 全局鼠标事件：验证 `monio-napi` 的 Darwin x64/arm64 原生包，确认其在 macOS 监听鼠标事件的权限要求；
- 选中文本读取：新增 macOS 原生模块，使用 Accessibility API 的当前焦点元素与 `kAXSelectedTextAttribute`；
- UI：继续复用 Electron 的透明、置顶且不抢焦点工具条窗口；
- 权限：显式处理“辅助功能”和实际验证后确认的“输入监控”权限。

Apple 的 AXUIElement API 用于辅助功能客户端访问系统 UI 元素；`kAXSelectedTextAttribute` 表示文本控件的当前选中文本。[AXUIElement](https://developer.apple.com/documentation/applicationservices/axuielement) [kAXSelectedTextAttribute](https://developer.apple.com/documentation/applicationservices/kaxselectedtextattribute)

### 实施步骤

1. 新增平台抽象，例如 `src/main/platform/selectionReader.ts`，定义：权限状态、请求授权、启动/停止监听、读取选区、失败原因。
2. 保留 `src/main/uiaSelectionHelper.ts` 作为 Windows 实现；禁止 macOS 调用 PowerShell 或 Windows UIA。
3. 新增 macOS 原生模块及其构建流程。模块在 Electron 主进程中提供：
   - `getAccessibilityPermissionStatus()`；
   - 用户触发后的授权请求；
   - `readFocusedSelectedText()`；
   - 不含原始文本的错误/角色/应用标识结果。
4. 修改 `src/main/inputHookManager.ts`，让它只依赖平台抽象；保留现有手势阈值、工具条定位与并发保护。
5. 修改 `src/main/ipcHandlers.ts`、`src/preload/index.ts`、`src/preload/index.d.ts` 与设置页：展示权限状态、启用开关、失败说明和“前往系统设置”操作。
6. 工具条默认关闭，或仅在用户阅读说明并主动启用后请求权限；未授权时不启动监听、不循环报错。
7. 处理坐标转换：在 Retina、异缩放双屏和上下排列显示器上校准原生鼠标坐标到 Electron `screen` 逻辑坐标。
8. 对密码框、受保护输入、无 Accessibility 信息的应用返回“当前应用不支持读取选区”，不使用静默 Ctrl/Cmd+C 模拟作为默认后备路径。

### 验收标准

- 在 TextEdit、Safari/Chrome、VS Code、Word 上分别记录读取结果。
- 有权限且目标应用支持时，选中后工具条出现在正确屏幕和位置。
- 点击工具条不丢失原应用焦点；问答/总结/翻译/搜索不改写剪贴板，只有“复制”改写剪贴板。
- 权限拒绝、权限中途撤销、无选区、受保护文本均不会崩溃、泄露文本到日志或误触发。
- x64 与 arm64 均能加载原生模块。

## 三、验证期的未签名发布策略

### 可执行但不承诺“无感启动”

未签名 `.app` 仍可在 macOS 上运行，但从网络下载的应用通常带 quarantine 标记，首次双击会被 Gatekeeper 阻止。面向普通用户的官方操作流程应写入 DMG 内的 `README` 和下载页：

1. 将 `MultiChat.app` 拖到“应用程序”；
2. 在 Finder 中按住 Control 点击应用，选择“打开”；
3. 在系统确认对话框中再次选择“打开”；
4. 若系统仍拦截，先尝试打开一次，再到“系统设置 → 隐私与安全性”中选择“仍要打开”。

仅向技术用户提供命令行备用方案：

```bash
xattr -dr com.apple.quarantine /Applications/MultiChat.app
```

该命令必须附带风险说明：它只移除本机隔离属性，不验证应用来源；用户只能对从官方渠道下载、且已核对校验和的文件执行。不得在安装脚本中自动执行该命令，也不得指导用户关闭 Gatekeeper。

### 无签名阶段的补偿措施

- 每个 Release 发布 DMG 的 SHA-256，并在官网/GitHub Release 页面展示；用户可使用 `shasum -a 256 <文件>` 核对。
- 在干净 Intel Mac 和 Apple Silicon Mac 的标准用户账户中实测上述 Finder 打开流程；不能只在开发机运行。
- DMG 内放置简洁、中文的 `首次打开说明.md`，包括官方下载地址、校验和、首次运行步骤、权限说明和隐私说明。
- 不提供自动更新功能，也不提示用户从非官方来源下载“补丁”。当前代码中并没有实际的自动更新模块，应在文档中如实说明。
- 记录 build commit、Node/npm/Electron 版本、x64/arm64 构建日志与人工验证结果，确保可追溯。

### 无签名阶段仍必须完成的构建修复

- `package-lock.json` 和两种 macOS 架构的原生依赖必须在干净 macOS 环境中验证，防止 `monio-napi-darwin-*` 缺失导致主进程启动崩溃。
- 将原生 `.node` 及新增 macOS 原生模块列入 `asarUnpack`，并在 `afterPack` 检查产物架构。
- 添加 `.icns` 应用图标和单色 macOS template tray icon。
- 修复 `build/multichat-cli.sh` 与 `extraFiles` 的包内路径不匹配；若 CLI 暂不作为验证期能力交付，则明确从 macOS 发行包中排除。
- 将 `/tmp/multichat-daemon.sock` 改为每用户受限位置或加入随机令牌鉴权，避免本机其他进程调用已登录的自动化会话。
- 启用并验证 ASAR 完整性作为可选加固项。Electron 在 macOS 支持该能力。[Electron ASAR Integrity](https://www.electronjs.org/docs/latest/tutorial/asar-integrity)

## 四、正式签名的升级条件

满足任一条件时，进入签名、公证阶段：开始收费、出现持续外部用户、需要降低安装咨询成本、需要系统通知/自动更新、或需要企业分发。

升级时使用 Developer ID Application 签名、Apple notarization 和 staple；这是 macOS 直发应用的标准发布路径。届时重新审查 entitlements，移除非必要调试权限，并在签名后重新测试原生工具条和原生模块。Electron 也指出，macOS 通知功能需要已签名应用才能可靠运行。[Electron Notifications](https://www.electronjs.org/docs/latest/tutorial/notifications)

## 五、发布前检查表

- [ ] `npm run lint` 无 error。
- [ ] `npm run build` 通过。
- [ ] Intel 与 Apple Silicon 的干净环境均完成 `npm ci`、`npm run build:mac`、安装和启动。
- [ ] 顶部栏、拖动、traffic lights、托盘、快捷窗口、Webview 登录/共享 Session 回归通过。
- [ ] 工具条权限、选区读取、坐标、多显示器和失败降级完成手工验证。
- [ ] 无签名 Finder 打开流程在两种架构设备上验证通过。
- [ ] Release SHA-256、首次打开说明、权限说明、已知限制和验证记录完整。
- [ ] 若保留 CLI，包内路径、PATH 暴露方式与 daemon 安全性均通过验证。
