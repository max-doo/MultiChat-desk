# Knowledge

Long-term reusable lessons, durable decisions, and recurring project gotchas.

Do not copy ordinary session history here. Promote only stable knowledge that is likely to help future agents across sessions.

## Candidates for AGENTS.md

- None yet.

Agents may suggest or promote a lesson into the `Known Gotchas` section of `AGENTS.md` when it recurs across tasks, is costly when missed, is not obvious from code structure, and can be written as one concrete operating rule. Otherwise, keep it in this file.

## Debugging Lessons

- 快捷窗口（quickWindow）是独立的 `BrowserWindow`，主窗口的 `did-attach-webview` 监听器不会自动继承给快捷窗口。任何新增窗口都必须单独为其 `webContents` 注册 `did-attach-webview` 事件，否则该窗口内 Webview 的脚本注入与链接拦截将完全失效，导致外部链接无法在系统浏览器中打开。修复方案：将注册逻辑提取为 `registerWebviewHandlers(webContents)` 公共函数，在所有宿主窗口中复用。

- Electron 快捷键自动复制选中文本（Windows）：用 `execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])` 模拟 `Ctrl+C`，比 `exec` 字符串更安全（无引号转义问题）；先 `clipboard.clear()` 再模拟按键，可以可靠判断是否真有内容被复制；等待 150ms 后读取，兜底降级到原有剪贴板内容。

- **[关键陷阱] 全局快捷键 + SendKeys 焦点顺序**：在全局快捷键回调中若先 `win.show() / win.focus()` 再模拟 `Ctrl+C`，焦点已从用户原始窗口转移到 Electron，SendKeys 会把按键发给 Electron 自身而非目标应用，导致复制失败。正确顺序：**先** `execFileSync SendKeys` + 读剪贴板，**再** show/focus 快捷窗口。同时使用 `execFileSync` + `Atomics.wait` 实现同步阻塞等待，确保剪贴板读取在 show/focus 之前完成。

- Electron titlebar 拖拽（Windows）：`app-region:drag` CSS 方式会引发点击穿透和递归 resize 等 BUG；应使用 JS pointer capture + IPC `win.setContentBounds` 实现可靠的无边框窗口拖拽。

## Stable Decisions

- 快捷操作快捷键（Ctrl+Shift+S/E/T/Q）的提示词注入流程：先展示快捷窗口，后台自动复制选中文本（PowerShell SendKeys），完成后发送 `quick:inject-prompt` IPC；不读旧剪贴板而是先清空再检测，以区分"有选中文本"和"无选中文本"两种情况。

- quickWindow 初始配置 `alwaysOnTop: false, skipTaskbar: false`，让用户通过 pin 按钮自行决定是否置顶。`skipTaskbar: true` 会导致窗口被其他窗口遮挡后无法通过任务栏找回，用户体验差。isPinned 状态由前端 toggle 按钮驱动，通过 `quick:get-always-on-top` / `quick:set-always-on-top` IPC 控制。
