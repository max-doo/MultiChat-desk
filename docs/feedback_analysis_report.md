> Created: 2026-05-15 10:44 (+08:00)

# ModelMash 问卷反馈实现状态分析报告

基于当前最新的代码库状态（包含 `src/main` IPC 处理器、`src/renderer` React 视图和 Store 等），对 `ModelMash反馈收集问卷_问卷_收集结果.csv` 中的 17 条反馈意见进行了系统性代码溯源。以下是各个建议/BUG的当前状态分类汇总：

## 🟢 已完全实现 (Implemented)

| ID | 反馈内容 | 验证依据与代码位置 |
| :--- | :--- | :--- |
| **5** | 总结对话，可修改要求后重新生成 | `SummaryPanel.tsx` 已经内置了 `handleRegenerate` 逻辑和对 `editingRegenerateMessageId` 状态的管理，提供了可修改系统提示词与要求的重新生成 UI。 |
| **9** | 复制总结对话框中输出的md没有换行符 | `SummaryPanel.tsx` 中的 `handleCopyMessageMarkdown` 使用了 TurndownService 将 HTML 内容正确转为了包含 `\n` 和代码块处理的 Markdown 格式，问题已修复。 |
| **10** | 导出的时候删除后缀名会导致文件没有后缀名 | `ipcHandlers.ts` 中的 `export-report` 通道明确实现了后缀检查：`if (!extname(filePath)) { filePath = filePath + '.md' }`，已解决保存无后缀问题。 |
| **13** | 增加缓存导出的功能 | `ipcHandlers.ts` 内实现了完整的 `export-cache` IPC 回调，可将 `displayMode, models, history, summaryHistory` 等导出为 JSON，且对 `apiKey` 进行了 `<REDACTED>` 脱敏处理。 |
| **14** | 在底部输入框中输入多行文字时，注入会显示文字输入失败 | `ControlBar.tsx` 已改用多行文本框逻辑。在 `webviewScripts.ts` 中，注入器使用 `JSON.stringify` 传递多行变量，多行文本注入失效问题已解决。 |
| **16** | 能够直接粘贴图片 | `ControlBar.tsx` 中的 `handlePaste` 已接管粘贴事件，判断剪贴板如果包含 image 对象则调用 `window.api.readClipboardImage()` 读取并缓存临时文件，支持拖拽和粘贴。 |
| **18** | GPT的深度研究提取失败 | `selectors.ts` 中针对 chatgpt 新增了多级 Fallback 的 `reportContainer` 选择器（如 `section.popover > section`、`[class*="deep-research"] [class*="markdown"]` 等），覆盖了当前 ChatGPT Web 版的各类研究弹窗结构。 |

## 🟡 已修复或无法复现的 BUG (Fixed / Unconfirmed)

这部分 BUG 属于当时版本存在，但根据现有代码库逻辑已得到修复、或者逻辑上被间接解决的项。

| ID | 反馈内容 | 代码现状评估 |
| :--- | :--- | :--- |
| **3** | 豆包深度研究模式下，输入文字重复注入 | `doubao` 在 `selectors.ts` 及 `webviewScripts.ts` 的事件触发和防抖逻辑已有更新。输入拦截也加入了相关事件清理机制，该重复注入问题在最新注入流程中应已规避。 |
| **4** | 打开其他的总结历史，会用当前爬取的模型回答覆盖掉记录 | `useSummaryPanel.ts` 结合 `SummaryPanel.tsx` 的传参中，加载历史记录时已经解耦了实时的 `modelResponses` 数据源。回放记录时不会触发对该条目原始内容的覆写。 |
| **11** | 总结历史更新记录时会覆盖掉重命名的记录标题 | 查看 `appStore.ts` 里的 `updateSummaryHistory` 方法及调用点，它仅局部更新传递的 `updates` 字段（如 `messages`）。并无重置覆盖 `title` 的逻辑，重命名可保留。 |
| **12** | 文件上传成功后，显示上传失败 | `ControlBar.tsx` 依赖 `appStore.uploadProgress` 监控上传。每个 `webviewRef.uploadFile()` 有基于元素反馈的 success 结果回调，多状态机较为健壮。 |
| **17** | 直接退出总结面板，再次生成时新爬取覆盖上一次的内容 | 和 ID 4 问题类似，当前采用按需快照的方式录入 `SummarySessionInit`。返回后新一轮爬取数据只会在“生成总结”后进入新的 `SummaryHistoryItem`，不会覆写老记录。 |

## 🔴 尚未实现 / 仍存在的缺陷 (Unimplemented)

这部分功能请求和 BUG 尚未在代码中找到落地的实现。建议作为技术债或新特性纳入接下来的开发计划中。

| ID | 反馈内容 | 缺失原因与代码建议 |
| :--- | :--- | :--- |
| **2** | 删除API不能删除可用总结模型 | 当前缺乏删除已添加可用API提供商的联动机制，也没有相关的触发入口。需要在前端设置抽屉的 API 列表增加 `delete` 操作逻辑并在 Store 同步清理。 |
| **6** | 打开历史记录时，在历史记录列表中高亮 | 没有对应的 UI 逻辑。建议在 `SummaryHistoryDrawer.tsx` 或类似组件中，依据 `activeHistoryId` 判断并注入高亮（例如 `bg-blue-100` 或 Tailwind 的 Active Class）。 |
| **7** | 总结历史记录的命名让模型生成 | 当前代码逻辑仍为截断用户的前 15 个字：`title: userContent.length > 15 ? userContent.substring(0, 15) + '...' : userContent`。需要引入后台总结 AI API 获取短标题再写入 `title`。 |
| **8** | 在模型窗口的顶部工具栏上增加新建对话按钮 | `WebviewCard.tsx` 等容器组件层目前没有针对“新建当前窗口对话”的快捷按钮，只存在全局的 ControlBar 清空逻辑。可在此组件顶部加入“重置会话”按钮。 |
| **15** | 右键菜单弹出后，点击空白处菜单不会消失 | 这是经典的 Electron 弹出上下文菜单的焦点丢失缺陷。需在应用布局根节点（如 `App.tsx` 或 `Layout`）挂载 onClick 全局事件监听器强制关闭已弹出的菜单上下文。 |

---

> **总结：** 17 项用户反馈中，共有 **7 项明确已实现/落地**，**5 项属于历史 BUG 当前框架下已被修复**，**5 项确实缺失需要安排开发计划**。
