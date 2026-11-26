# Webview 总结自适应传输设计

## 背景

当前 webview 总结模式通过 `sendMessage` 将完整提示词直接注入 AI 平台的输入框。当模型回答很长时，部分平台的输入框会出现粘贴截断或前端卡顿。本设计在保持现有简单流程的前提下，增加一个自适应分支：长文本自动切换为文件上传模式。

## 目标

- 短文本（< 8000 字符）：保持现有直接粘贴体验，零额外开销
- 长文本（>= 8000 字符）：自动将模型回答写入临时 markdown 文件，通过文件上传方式传递给 AI 平台
- 文件上传失败时自动降级回直接粘贴，不中断用户流程

## 非目标

- 不替换现有的直接粘贴流程，只在触发阈值时启用文件上传
- 不修改 API 总结模式的任何逻辑
- 不新增 UI 控件让用户手动选择传输方式

## 阈值策略

```
完整提示词长度 = systemPrompt + 所有模型回答 + 用户要求

if 长度 < 8000:
    策略 = 'direct'   // 直接粘贴
else:
    策略 = 'file'     // 文件上传
```

阈值 8000 为默认值，不可配置（减少配置负担；如后续有需求再考虑暴露到设置）。

## 数据流

### 直接粘贴模式（现有流程，无改动）

```
buildFullPrompt() ──► ref.sendMessage(prompt) ──► scheduleNextPoll()
```

### 文件上传模式（新增流程）

```
buildModelResponsesMarkdown() ──► writeTempMarkdown(content) ──► IPC main ──► fs.writeFile(tmpdir)
                                                                         │
                                                                         ▼
                                                              返回 { success, filePath }
                                                                         │
                                                                         ▼
                                                    ref.uploadFile({ filePath, fileName, mimeType, size })
                                                                         │
                                                                         ▼
                                                    ref.sendMessage(instructionText) ──► scheduleNextPoll()
```

## 临时 Markdown 文件格式

文件名：`multichat-summary-{timestamp}.md`

内容结构：

```markdown
# MultiChat 模型回答汇总

## 系统指令

<system_prompt>
{agentPrompt 内容}
</system_prompt>

## 模型回答

<model_output name="Gemini">
{Gemini 的回答内容}
</model_output>

<model_output name="Claude">
{Claude 的回答内容}
</model_output>

## 用户附加要求

<user_requirement>
{customPrompt 内容（如有）}
</user_requirement>
```

XML 标签隔离确保 AI 能清晰区分不同模型的回答，避免混淆。

## 发送指令

文件上传成功后，发送一条简洁指令：

```
请分析附件中各模型对该问题的回答，按照系统指令中的要求生成总结报告。
```

## 状态机

```typescript
type WebviewSummaryPhase =
  | 'idle'
  | 'loading-page'
  | 'uploading-file'   // 新增
  | 'sending'
  | 'streaming'
  | 'done'
  | 'aborted'
  | 'error'
```

## 改动文件清单

### 1. src/main/ipcHandlers.ts

新增 IPC handler `write-temp-markdown`：
- 接收参数：`{ content: string, fileName: string }`
- 行为：在 `os.tmpdir()` 下创建 `multichat-uploads-{random}` 目录，写入 `.md` 文件
- 返回：`{ success: boolean, filePath?: string, error?: string }`

### 2. src/preload/index.ts + src/preload/index.d.ts

暴露 `writeTempMarkdown` 到 `window.api`。

### 3. src/renderer/src/hooks/useWebviewSummary.ts（核心改动）

- 拆分 `buildPrompt` 逻辑：
  - `buildFullPrompt()`：现有逻辑，返回完整提示词字符串
  - `buildModelResponsesMarkdown()`：返回仅含模型回答的 markdown（用于文件内容）
  - `buildInstructionText()`：文件上传模式下发送的指令文本
- `startSummary()` 增加长度判断：
  - 计算 `buildFullPrompt().length`
  - 根据阈值选择分支
- 新增 `sendViaFileUpload(ref)` 辅助函数
- 错误处理：文件上传分支任意步骤失败时，降级到直接粘贴

### 4. src/renderer/src/components/SummaryPanel.tsx

在操作栏的"开始 Webview 总结"按钮旁，根据当前 phase 显示传输策略提示：
- `uploading-file` 阶段：显示 "正在上传文件..."
- 其他阶段：保持现有行为

## 错误处理

| 场景 | 处理 |
|------|------|
| 写入临时文件失败 | fallback 到直接粘贴，console.warn |
| uploadFile 返回失败 | fallback 到直接粘贴，UI 显示 "上传失败，已切换为直接输入" |
| 上传成功但发送指令失败 | 标记 phase='error'，显示具体错误 |
| 文件上传后平台不支持 .md | 此为平台限制，fallback 到直接粘贴 |

## 清理策略

临时文件写入 `os.tmpdir()` 下以 `multichat-` 为前缀的目录。应用启动时由主进程清理所有 `multichat-*` 临时目录（在 `index.ts` app ready 时执行）。单次总结流程不实时删除（简化逻辑，依赖启动清理）。

## 兼容性

- 所有改动仅影响 `summarySource === 'webview'` 的代码路径
- API 总结模式完全不受影响
- WebviewCard 的现有接口（`sendMessage`、`uploadFile`、`getLatestResponse`）无需修改签名
