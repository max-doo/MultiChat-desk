> Created: 2026-07-05 15:27 (UTC+08:00)

# 任务分配模式发送拆为两段式注入 — 设计

## 1. 目标
消除任务分配模式下千问网页报错，复用多 AI 模式已验证的"先注入、再发送"两段式结构，由 host 端用固定 1000ms 延时隔开，给千问 React/Semi UI 受控状态机留出收敛窗口。

## 2. 根因
任务分配模式当前用 `generateSendMessageScript` 把"设值 → 强制派发 InputEvent/change → click 发送"塞进同一个 `executeJavaScript` 事务（`src/shared/utils/webviewScripts.ts:1028`）。其中 `webviewScripts.ts:1082-1090` 对 textarea 强制 `dispatchEvent(new InputEvent('input', { inputType: 'insertText' }))` 干扰了千问受控组件的输入法/composition 状态机，且注入与 click 之间无 host 端二次渲染窗口，导致千问在未收敛态被强制 click，网页自身报错。

多 AI 模式因分两步（`insertTextToAll` → 用户第二次点击 → `sendMessageToAll`）、注入后立即返回，无此问题。其注入用的是 `generateInsertTextScript`（`webviewScripts.ts:1111`），不含强制 InputEvent 段。

## 3. 范围与边界
- 改 `src/shared/utils/webviewScripts.ts`：新增 `generateSendOnlyScript`。
- 改 `src/renderer/src/components/WebviewCard.tsx`：`sendMessage` 句柄新增可选 `twoPhase` 参数，true 时走两段式；`WebviewCardHandle.sendMessage` 类型签名同步。
- 改 `src/renderer/src/components/modes/TaskModePanel.tsx:68`：调用 `sendMessage(combined, true)`。
- **不**改：`generateSendMessageScript`（保留给 `AutomationService.ts:142` 等主进程路径）、`buildSimulateEnterKeyScript`、`buildTextareaInputScript`、`buildContentEditableInputScript`、各平台注入分支、`selectors.ts`、Session、总结链路、历史记录、preload（`sendMessage` 是 React `useImperativeHandle` 句柄，非 IPC，无需同步 preload 契约）。
- **不**影响其他 `sendMessage` 调用方：`useWebviewSummary.ts:201/248/279`、`appStore.ts:1077`（`sendMessageToAll`）、`appStore.ts:1184` 均不传 `twoPhase`，默认 false，行为不变。

## 4. 详细设计

### 4.1 新增 `generateSendOnlyScript` — `src/shared/utils/webviewScripts.ts`
在 `generateInsertTextScript` 之后新增导出函数。只做"找发送按钮 → click"，不设值、不派发 InputEvent、不依赖 textarea：

```ts
/**
 * 生成"仅点击发送按钮"的注入脚本（不重新设值）。
 * 用于任务分配两段式发送的第二段：第一段已用 generateInsertTextScript 注入文本，
 * 本段只查找发送按钮并点击。
 * 注：放弃 Enter 回退——两段式下若注入成功，发送按钮应已存在且可点；
 * 若按钮找不到，直接返回失败。
 */
export function generateSendOnlyScript(
  modelId: string,
  selectors: ModelSelector
): string {
  const findButton = buildFindSendButtonScript(selectors)
  return `
    (async function() {
      try {
        ${findButton}
        if (!button) {
          return { success: false, error: '未找到发送按钮' };
        }
        button.focus();
        const clickDelay = (${JSON.stringify(modelId)} === 'doubao' || ${JSON.stringify(modelId)} === 'qwen' || ${JSON.stringify(modelId)} === 'deepseek') ? 500 : 50;
        await new Promise(resolve => setTimeout(resolve, clickDelay));
        button.click();
        await new Promise(resolve => setTimeout(resolve, 200));
        return { success: true, method: 'button' };
      } catch (error) {
        return { success: false, error: error.message };
      }
    })();
  `
}
```

设计决策：
- **不调用 `buildFindTextareaScript`**：该函数找不到 textarea 时会 `return { success:false }` 终止整个 IIFE（`webviewScripts.ts:74-76`），而第二段只需按钮，不应被 textarea 选择器未命中拖累。
- **不调用 `buildSimulateEnterKeyScript`**：它含 Enter 回退分支且依赖 `textarea` 变量；为避免扩散改动共享函数，改为内联"按钮存在即 click，否则失败"。
- `clickDelay` 与原 `buildSimulateEnterKeyScript:488` 完全一致，保留 doubao/qwen/deepseek 500ms、其他 50ms 的分平台策略。
- 收尾 `setTimeout(200)` 与原 `buildSimulateEnterKeyScript:493` 一致。

### 4.2 `WebviewCard.sendMessage` 两段式 — `src/renderer/src/components/WebviewCard.tsx`
顶部新增常量：
```ts
/** 任务分配两段式发送：注入后等待 host 端延时，再点发送按钮（给千问 React 收敛窗口） */
const TWO_PHASE_SEND_DELAY_MS = 1000
```

`WebviewCardHandle`（`WebviewCard.tsx:116`）签名：
```ts
sendMessage: (message: string, twoPhase?: boolean) => Promise<{ success: boolean; error?: string }>
```

`useImperativeHandle` 内 `sendMessage`（`WebviewCard.tsx:479`）实现：
```ts
sendMessage: async (message: string, twoPhase = false): Promise<{ success: boolean; error?: string }> => {
  // ... 现有的 webview / isReady / selectors 守卫不变
  setSendStatus('sending')
  try {
    if (twoPhase) {
      const insertCode = generateInsertTextScript(message, id, selectors)
      const insertResult = await webview.executeJavaScript(insertCode)
      if (!insertResult?.success) {
        setSendStatus('error')
        setTimeout(() => setSendStatus('idle'), 3000)
        return { success: false, error: insertResult?.error || '注入失败' }
      }
      await new Promise(r => setTimeout(r, TWO_PHASE_SEND_DELAY_MS))
      const sendCode = generateSendOnlyScript(id, selectors)
      const result = await webview.executeJavaScript(sendCode)
      if (result.success) {
        setSendStatus('success')
        setTimeout(() => setSendStatus('idle'), 3000)
        return { success: true }
      }
      setSendStatus('error')
      setTimeout(() => setSendStatus('idle'), 3000)
      return { success: false, error: result.error }
    }
    // 原 single-phase 路径不变
    const code = generateSendMessageScript(message, id, selectors)
    const result = await webview.executeJavaScript(code)
    // ... 原返回逻辑
  } catch (error) {
    // ... 原异常处理
  }
}
```

要点：
- 第一段注入失败立即返回，不进入第二段。
- 1000ms 延时在 host 端（React 层），不在 webview 脚本内——这是与原方案的关键差异，给千问网页二次渲染的稳定窗口。
- `setSendStatus` 状态机与原路径一致（sending → success/error → idle 3s）。

### 4.3 `TaskModePanel.handleSend` — `src/renderer/src/components/modes/TaskModePanel.tsx:68`
```ts
const r = await ref.sendMessage(combined, true)
```
顺序 `for...of + await` 不变，插槽间仍逐个发。

## 5. 风险与缓解
- **1000ms 偏长**：任务分配多槽总时长增加约 (槽数-1)×1s。缓解：值抽常量 `TWO_PHASE_SEND_DELAY_MS`，后续按反馈调；只对任务分配生效。
- **放弃 Enter 回退**：若某平台注入后发送按钮未启用/未渲染，第二段会失败。缓解：`buildFindSendButtonScript` 已含可见性判断与多候选选择器；任务分配注入成功后按钮应已存在。若实测某平台需 Enter 回退，再单独评估。
- **千问实测若仍报错**：可能根因不止"注入+发送同事务"。缓解：spec 标注，先按当前实现验证；若仍报错，下一步排查是否需移除 `generateInsertTextScript` 对千问 textarea 的 blur/focus 周期（`buildTextareaInputScript:399`）。
- **回归面**：`twoPhase` 默认 false，`useWebviewSummary`、`sendMessageToAll`、`appStore:1184` 等调用方零改动。

## 6. 验证
`npm run lint` → `npm run build` → `npm run dev` 手动验证：
1. 任务分配模式：多子任务分到不同槽（含千问槽），点"一键发送"，确认千问网页不报错、消息正常发出、其余平台正常。
2. 多 AI 模式回归：两步发送仍正常，注入与发送行为无变化。
3. 千问单槽连续发送 2~3 次，确认无累积报错。
4. lint/build 通过。

## 7. 完成标准
- 行为落到 renderer 层（WebviewCard / TaskModePanel），shared/utils 提供新脚本生成器。
- 任务分配发送在 dev 中实际触发验证千问不报错。
- 无牵动无关文件；`twoPhase` 默认 false 保证其他路径零回归。
