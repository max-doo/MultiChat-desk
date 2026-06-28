# Knowledge

Long-term reusable lessons, durable decisions, and recurring project gotchas.

Do not copy ordinary session history here. Promote only stable knowledge that is likely to help future agents across sessions.

## Candidates for AGENTS.md

- None yet.

Agents may suggest or promote a lesson into the `Known Gotchas` section of `AGENTS.md` when it recurs across tasks, is costly when missed, is not obvious from code structure, and can be written as one concrete operating rule. Otherwise, keep it in this file.

## Debugging Lessons

- **Windows 后台窗口抢焦与置顶闪烁**：在 Windows 平台下，当 Electron 后台窗口或隐藏窗口试图直接调用 `window.show()` / `window.focus()` 时，操作系统防抢焦点机制（SetForegroundWindow 限制）会阻止其置顶并引发任务栏或窗口边框闪烁。解决方案：通过临时开启 `win.setAlwaysOnTop(true)` 再调用 `win.focus()`，并在 50ms 后自动恢复 `setAlwaysOnTop(false)`（需注意保存并尊重用户原本的 isAlwaysOnTop 状态），即可实现稳定强行聚焦与置顶。

- 快捷窗口（quickWindow）是独立的 `BrowserWindow`，主窗口的 `did-attach-webview` 监听器不会自动继承给快捷窗口。任何新增窗口都必须单独为其 `webContents` 注册 `did-attach-webview` 事件，否则该窗口内 Webview 的脚本注入与链接拦截将完全失效，导致外部链接无法在系统浏览器中打开。修复方案：将注册逻辑提取为 `registerWebviewHandlers(webContents)` 公共函数，在所有宿主窗口中复用。

- Electron 快捷键自动复制选中文本（Windows）：
  1. **等待按键释放**：触发全局快捷键时先 `sleep(250)`，以防用户的物理手指仍按在 `Ctrl/Shift` 上导致模拟按键冲突（触发 `Ctrl+Shift+C`）。
  2. **轻量模拟脚本**：使用 VBScript 写入 `.vbs` 文件并使用 `execFile('cscript.exe', ['//NoLogo', path])` 异步执行。VBS 启动仅需 ~10ms 且完全隐藏，比 PowerShell 更快且绝不抢焦。
  3. **精确监测与兜底**：先 `clipboard.clear()` 再模拟按键，等待 150ms 写入缓冲后读取；若无新数据写入（说明用户未选中文本），将旧数据写回剪贴板还原，**但必须返回空字符串 `''`**，切勿将陈旧的旧剪贴板内容作为选中文本返回；且划词操作回调中必须拦截空文本，不唤起弹窗。

- **[关键陷阱] 全局快捷键 + SendKeys 焦点顺序**：在全局快捷键回调中必须先执行模拟复制动作，**最后**再执行 `qw.show() / qw.focus()` 唤起并聚焦 Electron 快捷窗口。若顺序相反，焦点会立即被 Electron 夺走，按键模拟将打在 Electron 自身，导致外部文本复制失效。

- Electron titlebar 拖拽（Windows）：`app-region:drag` CSS 方式会引发点击穿透和递归 resize 等 BUG；应使用 JS pointer capture + IPC `win.setContentBounds` 实现可靠的无边框窗口拖拽。

- **Webview 富文本框提示词注入校验坑**：在向第三方 AI 平台富文本输入框（`contenteditable` / Slate / Lexical 等）注入带有换行符或多行格式的提示词（如 `总结以下内容:\n\n文本`）时，编辑器会自动将其格式化为 `<p>` 等 HTML 节点。若通过 `textarea.textContent` 读取当前值进行 `rawCurrent === rawExpected` 全等比对，由于 `textContent` 会丢失换行符，比对结果将永远为 `false`。这会导致前端重试轮询（如 15 次 500ms 重试）误判为注入失败并疯狂重复注入，干扰用户编辑和发送。解决方案：寻找输入框和执行插入成功后，直接返回 `{ success: true }` 立即终止前端轮询。

## Stable Decisions

- 快捷操作快捷键（Ctrl+Shift+S/E/T/Q）的提示词注入流程：先通过 VBScript 模拟 `Ctrl+C` 自动复制选中文本，读取成功后，再展示并聚焦快捷窗口，最后发送 `quick:inject-prompt` IPC 完成一键总结。

- quickWindow 初始配置 `alwaysOnTop: false, skipTaskbar: false`，让用户通过 pin 按钮自行决定是否置顶。`skipTaskbar: true` 会导致窗口被其他窗口遮挡后无法通过任务栏找回，用户体验差。isPinned 状态由前端 toggle 按钮驱动，通过 `quick:get-always-on-top` / `quick:set-always-on-top` IPC 控制。
