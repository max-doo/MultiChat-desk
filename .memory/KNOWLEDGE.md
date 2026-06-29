# Knowledge

Long-term reusable lessons, durable decisions, and recurring project gotchas.

Do not copy ordinary session history here. Promote only stable knowledge that is likely to help future agents across sessions.

## Candidates for AGENTS.md

- None yet.

Agents may suggest or promote a lesson into the `Known Gotchas` section of `AGENTS.md` when it recurs across tasks, is costly when missed, is not obvious from code structure, and can be written as one concrete operating rule. Otherwise, keep it in this file.

## Debugging Lessons

- **electron-builder 打包 Windows 失败：winCodeSign 符号链接解压需"开发者模式"或管理员**：`npm run build:win:*` 会下载 `winCodeSign-2.6.0.7z`，该包内含 macOS 符号链接（`darwin/10.12/lib/libcrypto.dylib`→`libcrypto.1.0.0.dylib`、`libssl.dylib`）。`7za.exe` 在 Windows 解压时需创建**真实符号链接**，要求 `SeCreateSymbolicLink` 权限（= 管理员，或开启 Windows 开发者模式）。两者皆无时，7za 返回 `exit status 2`（`errorOut=ERROR: Cannot create symbolic link : 客户端没有所需的特权`），electron-builder 视为致命、重试 3 次后整次打包失败。**根因修复**：开启 Windows 开发者模式（设置→更新和安全→开发者→开发者模式 ON；等价注册表 `HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock\AllowDevelopmentWithoutDevLicense=1`，DWord）。一次开启、版本无关、缓存清空也不怕——已用"清空 winCodeSign 缓存后从零重打"验证：解压出的 `libcrypto.dylib` 变为真 `SymbolicLink`，打包成功。**勿用 .cmd 包装 7za 吞 exit 2**：Node v24+ 因安全补丁 CVE-2024-27980，禁止 `execFile` 在 `shell:false` 下 spawn `.cmd`/`.bat`，会抛 `spawn EINVAL`；且 winCodeSign 解压由 `app-builder.exe`(Go) 调 7za（能跑 .cmd，故解压"成功"），而 NSIS 打包由 `builder-util.exec`(Node `execFile`) 调 7za（不能跑 .cmd → EINVAL），同一 .cmd 包装会出现"解压成功但打包 EINVAL"的迷惑假象。**缓存机制**：winCodeSign 版本号(2.6.0)硬编码在 `app-builder.exe`(Go 二进制)内、JS 读不到（`windowsCodeSign.js` 仅 `getBin("winCodeSign")` 不带版本）；缓存目录 `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0\` 存在时 `app-builder.exe` 跳过下载解压——故"缓存偶然已生成"时打包能蒙混成功，但缓存一清就复发，不是真修复。判别手法：`whoami /priv | Select-String SeCreateSymbolicLink` 为空 + 非管理员 + 注册表 `AllowDevelopmentWithoutDevLicense` 未设 → 必中此坑。

- **划词工具条读取选区用 UI Automation 替代 Ctrl+C 模拟复制**：跨进程读外部应用选中文本，Ctrl+C(`SendKeys "^c"`)有三宗罪——终端里是中断信号会杀进程、Word 里会抢掉其自带迷你工具条、复制的是"当前选区"分不清新旧（拖窗口时旧选区常驻也误弹）。改用 UIA 的 `TextPattern.GetSelection`（经 `AutomationElement.FocusedElement`）非侵入读取，不发任何按键。配合"鼠标按下时异步快照 selAtDown + 松手时读 selAtUp，二者相同则判为旧选区未变不弹"实现"拖拽+本次新选区"双条件触发。实现需常驻 PowerShell helper（行 JSON 协议）：①文本走 base64 传输——PS 5.1 的 `ConvertTo-Json -Compress` 不转义换行会断行，手工转义又难在 JS 模板字符串里写 PS 反引号（`` `r `` 与模板定界符冲突）；②顶部必须显式 `[Console]::OutputEncoding=[Console]::InputEncoding=$OutputEncoding=[System.Text.Encoding]::UTF8`，否则中文 Windows 默认 GBK 输出导致 CJK 乱码；③用 `[Console]::Out.WriteLine`+`Flush`（`Write-Host` 在 PS 5.1 不进 stdout 管道）；④stdin 关闭即 `exit`+Node 侧 `child.on('exit')` 懒重启，防僵尸。覆盖：Word/Windows Terminal/Chrome 可读；VS Code 编辑器(Monaco 画布)/记事本(老 Edit 控件)读不到→安全降级不弹，这些场景的 AI 划词由全局快捷键(Ctrl+C 路径)覆盖。参见上方「monio-napi 回调参数是数组」条目的判别手法。

- **Windows 后台窗口抢焦与置顶闪烁**：在 Windows 平台下，当 Electron 后台窗口或隐藏窗口试图直接调用 `window.show()` / `window.focus()` 时，操作系统防抢焦点机制（SetForegroundWindow 限制）会阻止其置顶并引发任务栏或窗口边框闪烁。解决方案：通过临时开启 `win.setAlwaysOnTop(true)` 再调用 `win.focus()`，并在 50ms 后自动恢复 `setAlwaysOnTop(false)`（需注意保存并尊重用户原本的 isAlwaysOnTop 状态），即可实现稳定强行聚焦与置顶。

- 快捷窗口（quickWindow）是独立的 `BrowserWindow`，主窗口的 `did-attach-webview` 监听器不会自动继承给快捷窗口。任何新增窗口都必须单独为其 `webContents` 注册 `did-attach-webview` 事件，否则该窗口内 Webview 的脚本注入与链接拦截将完全失效，导致外部链接无法在系统浏览器中打开。修复方案：将注册逻辑提取为 `registerWebviewHandlers(webContents)` 公共函数，在所有宿主窗口中复用。

- Electron 快捷键自动复制选中文本（Windows）：
  1. **等待按键释放**：触发全局快捷键时先 `sleep(250)`，以防用户的物理手指仍按在 `Ctrl/Shift` 上导致模拟按键冲突（触发 `Ctrl+Shift+C`）。
  2. **轻量模拟脚本**：使用 VBScript 写入 `.vbs` 文件并使用 `execFile('cscript.exe', ['//NoLogo', path])` 异步执行。VBS 启动仅需 ~10ms 且完全隐藏，比 PowerShell 更快且绝不抢焦。
  3. **精确监测与兜底**：先 `clipboard.clear()` 再模拟按键，等待 150ms 写入缓冲后读取；若无新数据写入（说明用户未选中文本），将旧数据写回剪贴板还原，**但必须返回空字符串 `''`**，切勿将陈旧的旧剪贴板内容作为选中文本返回；且划词操作回调中必须拦截空文本，不唤起弹窗。

- **[关键陷阱] 全局快捷键 + SendKeys 焦点顺序**：在全局快捷键回调中必须先执行模拟复制动作，**最后**再执行 `qw.show() / qw.focus()` 唤起并聚焦 Electron 快捷窗口。若顺序相反，焦点会立即被 Electron 夺走，按键模拟将打在 Electron 自身，导致外部文本复制失效。

- Electron titlebar 拖拽（Windows）：`app-region:drag` CSS 方式会引发点击穿透和递归 resize 等 BUG；应使用 JS pointer capture + IPC `win.setContentBounds` 实现可靠的无边框窗口拖拽。

- **Webview 富文本框提示词注入校验坑**：在向第三方 AI 平台富文本输入框（`contenteditable` / Slate / Lexical 等）注入带有换行符或多行格式的提示词（如 `总结以下内容:\n\n文本`）时，编辑器会自动将其格式化为 `<p>` 等 HTML 节点。若通过 `textarea.textContent` 读取当前值进行 `rawCurrent === rawExpected` 全等比对，由于 `textContent` 会丢失换行符，比对结果将永远为 `false`。这会导致前端重试轮询（如 15 次 500ms 重试）误判为注入失败并疯狂重复注入，干扰用户编辑和发送。解决方案：寻找输入框和执行插入成功后，直接返回 `{ success: true }` 立即终止前端轮询。

- **[已纠正] monio-napi 回调参数是数组，不是单个对象（也非嵌套对象）**：`monio-napi` 的 `startListen(callback)` 回调，d.ts 声明参数为单个 `EventJs`，但**运行时实际按 `EventJs[]` 数组批量派发**（NAPI-RS 侧用 `Vec<EventJs>` 调用 ThreadsafeFunction）。直接读 `event.eventType` / `event.mouse` 会得到 `undefined`，导致：探针条件 `type===5` 永不命中（看起来"没事件"）、`button=undefined`、`x/y=0`、`distance=NaN`。这正是"划词工具条永不触发"的真因。**正确修复**：`const events = Array.isArray(payload) ? payload : [payload]; for (const e of events) processEvent(e)`。`InputHook.onMouseXxx` 回调也出现过同样的 `button=undefined` 症状，疑似同样按数组派发（未单独验证，但"嵌套对象"的旧解释已被证伪，勿再沿用）。
  - **判别手法（关键）**：回调里 `console.log(JSON.stringify(event))`，若输出以方括号 `[{...}]` 开头即为数组。看到所有字段 `undefined` 时，**先怀疑载荷形状不匹配（数组/嵌套），用 `JSON.stringify` 看真身，再动手**——不要猜字段名、不要归咎于 OS 消息循环或库损坏。
  - **隔离测试的陷阱**：用纯 `node` 跑 `monio-napi` 做隔离诊断时，能收到库自家的 `HookEnabled`(eventType=0) 事件，但纯 node 无 Win32 消息泵，真实鼠标事件可能不触发；且隔离脚本本身若也犯了"未解包数组"的错，会得到"0 事件"的假象。故隔离测试的"0 事件"结论必须排除测试代码自身的形状 bug 后才可信。
  - **教训之上的教训**：前一个会话把未经验证的"嵌套对象"猜测当成稳定教训写进了本文件，直接误导后续 3 轮排查。**写入 KNOWLEDGE.md 的根因必须由运行时证据（`JSON.stringify` 真身）证实，未经证实的猜测只能留在 SESSION_LOG，不得升级为 KNOWLEDGE。**

- **划词悬浮工具条不可仅凭鼠标手势弹窗**：全局鼠标钩子（`monio-napi`）只能拿到坐标与按键，无法判断光标下是否为可文本选区。若"拖拽距离/时长命中 → 直接 `showToolbarAt`"，则拖窗口标题栏、拖滚动条、拖图片、在空白处拖动都会误弹工具条。**唯一可靠的跨进程选区信号是模拟 `Ctrl+C` 探测剪贴板**（复用 `getSelectedTextAsync(false)`，空则不弹）。代价：每次合格拖拽多发一次 Ctrl+C、约 150ms 延迟、瞬间触碰剪贴板（会还原）。同时必须保留 `isAppFocused()` 守卫（避免在本应用窗口内划词也弹）与收紧手势阈值（减少不必要的 Ctrl+C 探测）。相关：上方「monio-napi 回调参数是数组」条目。：在 Windows Chromium / Electron 应用中，由于中文输入法（如微软拼音、搜狗等）系统级占用 `Ctrl+Shift` 或 `Alt+Shift` 作为中英文/输入法切换热键，当用户在快捷键录制组件中按住 `Ctrl+Shift` 准备去敲击第三个主键（如 `S`）时，输入法会向 DOM 发送 `e.key = 'Process'` / `'Unidentified'` / `'Dead'` 或 `e.keyCode === 229` 的虚拟事件。若录制组件仅把 `['Control', 'Shift', 'Alt', 'Meta']` 认定为修饰键，会将 `Process` 误判为有效主键并立即触发提交，造成“刚按住 Ctrl+Shift 就强行终止并保存了 2 个键”的严重 BUG。**解决方案**：必须在 `onKeyDown` 中将 `Process`、`Unidentified`、`Dead` 以及 `keyCode === 229` 的事件一律识别为暂态修饰事件并进行过滤，确保最终提交的主键为真正有效的物理按键或功能键。

- **Clash Verge TUN 模式白屏与 Cloudflare Turnstile 验证拦截的修复**：
  1. **QUIC 协议丢包致白屏**：Chromium 默认开启 HTTP/3 (QUIC, UDP 443)。在 Clash Verge 打开 TUN 虚拟网卡模式时，UDP 443 转发极易丢包或握手超时，导致 Webview 页面加载假死或显示空白。必须在 `app.whenReady()` 前通过 `app.commandLine.appendSwitch('disable-quic')` 全局禁用 QUIC 强制走 TCP。
  2. **Cloudflare 真人验证拦截**：Turnstile 脚本会探测 Blink 自动化探针（如 `navigator.webdriver`）。需通过 `app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled')` 消除探针，并在 Session 拦截中用正则 `/\s*Electron\/[0-9.]+/g` 干净移除 User-Agent 中的 Electron 标识。
  3. **Webview 异常容错与超时**：不可仅对首次加载配置超时，需对每次 `did-start-loading` 均开启 30s 超时；同时需捕获 `errorCode === -3` 中断并监听 `render-process-gone` / `crashed`，避免网卡切路由或进程崩溃时无提示白屏。

## Stable Decisions

- 快捷操作快捷键（Ctrl+Shift+S/E/T/Q）的提示词注入流程：先通过 VBScript 模拟 `Ctrl+C` 自动复制选中文本，读取成功后，再展示并聚焦快捷窗口，最后发送 `quick:inject-prompt` IPC 完成一键总结。

- quickWindow 初始配置 `alwaysOnTop: false, skipTaskbar: false`，让用户通过 pin 按钮自行决定是否置顶。`skipTaskbar: true` 会导致窗口被其他窗口遮挡后无法通过任务栏找回，用户体验差。isPinned 状态由前端 toggle 按钮驱动，通过 `quick:get-always-on-top` / `quick:set-always-on-top` IPC 控制。

- **Headless BrowserWindow 后台限流**：通过 `new BrowserWindow({ show: false, ... })` 创建的隐藏 Daemon 会话窗口，Chromium 默认开启 `backgroundThrottling: true`，会将后台 tab 的 `setTimeout/setInterval` 降频至 ≤1Hz。必须在 `webPreferences` 中显式设置 `backgroundThrottling: false`，否则 `AutomationService` 注入的轮询脚本会严重超时。

- **Named Pipe Server 异步事件循环竞态**：Node `net.Socket` 的 `'data'` 事件回调在 `async` 函数中，当 `await handleRequest(...)` 暂停时，后续到达的数据包仍会同步触发新的 `'data'` 事件，修改共享的 `buffer` 变量，造成 lines 跳行或乱序。**正确模式**：在同步的 `'data'` 回调中仅做行分割，将完整行推入 per-socket `requestQueue: string[]`，然后用 `processQueue(socket)` 串行消费（加一个 `processing` flag 防止重入）。

- **CLI `--json` 模式 stdout/stderr 分离**：在 `--json` 模式下，凡是连接失败、解析错误等错误信息都必须走 `process.stderr.write(...)`，而不是 `console.log`（会写 stdout）。只有最终成功的结构化数据才输出到 `stdout`，这样外部脚本才能安全地管道解析 stdout。
