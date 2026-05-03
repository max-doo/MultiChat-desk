# 待办事项

<!--此文件用于跟踪已完成的工作和会话之间的待处理任务。每天工作结束后更新。-->

## 进行中

- [-] 无

## 已完成

### 2026-05-03

- [x] 修复 #1: 删除 API 供应商时同步移除其下的总结模型 (`SettingsDrawer.tsx`)
- [x] 修复 #3: 恢复历史记录后保持保护状态，防止 reportData 覆盖历史模型回复 (`SummaryPage.tsx`)
- [x] 修复 #9: 导出文件时若用户删除后缀名自动补回 .md (`ipcHandlers.ts`)
- [x] 修复 #10: 更新历史记录时保留用户重命名的标题 (`useSummaryPanel.ts`)
- [x] 修复 #11: 文件上传成功后不再因 DOM 未检测到文件名而误报失败 (`WebviewCard.tsx`)
- [x] 修复 #13: 多行文本注入时因 trim() 导致首尾换行被误报为输入失败 (`webviewScripts.ts`)
- [x] 修复 #16: 首次生成总结时快照 modelResponses，避免新对话输出覆盖历史总结 (`useSummaryPanel.ts`)
- [x] 修复 #17: 为 ChatGPT 添加 reportContainer 选择器，修复 Deep Research 输出无法提取 (`selectors.ts`)
- [x] 新增 #4: 总结重新生成时支持修改用户要求后再生成 (`useSummaryPanel.ts`, `SummaryPanel.tsx`)
- [x] 新增 #5: 历史记录列表中高亮当前打开的历史项 (`HistoryDrawer.tsx`, `SummaryHistoryDrawer.tsx`)
- [x] 新增 #6: 首次总结成功后异步调用 AI 生成历史记录标题 (`useSummaryPanel.ts`)
- [x] 新增 #7: Webview 顶部工具栏增加新建对话按钮 (`WebviewCard.tsx`)
- [x] 新增 #12: 设置面板增加缓存数据导出功能，API Key 自动脱敏 (`ipcHandlers.ts`, `SettingsDrawer.tsx`)
- [x] 新增 #15: 支持从剪贴板直接粘贴图片并上传到各模型 (`ControlBar.tsx`, `ipcHandlers.ts`)
- [x] 补齐 macOS 打包配置：新增 `mac`/`dmg` 配置、entitlements、`.icns` 图标 (`electron-builder.yml`, `package.json`)
- [x] 新增：ControlBar 增加 AI 生图一键切换按钮，支持 9 个平台，复用 DeepResearch 注入脚本架构 (`selectors.ts`, `webviewScripts.ts`, `WebviewCard.tsx`, `appStore.ts`, `ControlBar.tsx`)

## 待处理

- [ ] AI 生图 DOM 适配：`selectors.ts` 中各平台 `imageGeneration` 选择器基于推测，需在 `npm run dev` 中逐一打开各平台 webview 验证实际 DOM 结构并修正（chatgpt/gemini/grok/qwen/kimi/doubao/yuanbao/chatglm/yiyan）
- [ ] arena.ai DOM 适配：在 `npm run dev` 中打开 arena webview，验证输入框/发送按钮/消息容器选择器是否匹配实际 DOM 结构并修正 (`selectors.ts`)
- [ ] Webview 总结自适应传输：在 `npm run dev` 中手动验证短文本直接粘贴和长文本文件上传两种模式
- [ ] macOS 打包：在 macOS 系统上运行 `npm run build:mac` 验证 DMG 产物
- [ ] macOS 打包：配置 Apple Developer ID 签名与公证（Notarization），正式分发必需
- [ ] Electron OTA 自动更新：实施计划见 `docs/superpowers/plans/2026-05-04-electron-ota.md`，设计见 `docs/superpowers/specs/2026-05-04-electron-ota-design.md`（NSIS 安装版 + GitHub Releases + Settings Drawer 内交互，便携版/macOS 优雅降级）
- [ ] 启动 Webview 空白问题（需 Ctrl+R 才能加载）：评估报告见 `docs/superpowers/specs/2026-05-04-webview-blank-on-startup-analysis.md`
  - [ ] 诊断 #D1：DevTools 观察启动是否触发 `初始化超时,强制完成` 警告 + `did-attach-webview` 输出次数（确认根因 H1/H5）
  - [ ] 诊断 #D2：临时禁用 `<React.StrictMode>` (`src/renderer/src/main.tsx:6-9`) 看复现率变化（确认根因 H4 是否为放大因素）
  - [ ] 修复 #F1（P0）：去掉 `App.tsx:64-72` 的 3 秒强制 `setIsInitialized(true)` fallback，改为 init 异常时走错误页
  - [ ] 修复 #F2（P0）：`appStore.ts:1158-1168` 合并 `geminiAccountUrl` 与 `storedModels` 的 `setState`，避免 Gemini URL 二次更新
  - [ ] 修复 #F3（P1）：`WebviewCard.tsx:777-785` 改用 `loadURL()` 主动导航替代 `<webview src={...}>`，规避 Electron `<webview>` `src` prop 中途变化的不可靠行为；需回归 11 个平台挂载 / `swapModelInSlot` / `resetToInitial` / 历史记录恢复 4 条路径

- [ ] 总结页面 Webview 模式下的的总结对话保存还存在以下问题。正确的链路是：主页面对话结束 -> 点击总结按钮 -> 爬取模型输出结果-> 点击总结 -> 监控webview窗口中的输出（类似于主界面）-> 保存爬取到的结果+对话url，不同的总结session之间保持数据的隔离
    - bug：在webview模式下总结历史记录没有记录对话的url，直记录了爬取到的内容
    - bug：总结对话后再返回主界面开启新的对话，不能成功爬取回答内容，总结页面显示的模型回答结果还是上次的。

- [ ] 项目新增需求：
    - 用快捷键直接召唤出一个小弹窗，然后这个小弹窗就是一个webview窗口，直接复用现在主界面中的窗口组件，方便用户直接在桌面快捷地使用各种原生的AI网页应用
    - 开发一个光标选中之后悬浮的toolbar功能，类似于桌面板的豆包，上面有总结、润色、翻译等快捷操作，点击后打开弹窗，自动将选中的文字注入到webview窗口的输入框当中，拼接提示词之后，自动发送，执行这些操作。同时，这个工具栏中也有一个快捷键能够直接召唤出弹窗
    - 在关闭主页面之后常驻系统托盘，点击托盘可以打开主页面
    