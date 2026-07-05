# 任务分配模式两段式发送 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 任务分配模式发送拆为"注入 → host 端 1000ms 延时 → 点发送"两段式 `executeJavaScript`，消除千问网页报错，复用多 AI 模式已验证的注入路径。

**Architecture:** 在 `src/shared/utils/webviewScripts.ts` 新增 `generateSendOnlyScript`（只找按钮并 click，不设值、不依赖 textarea）。`WebviewCard.sendMessage` 新增可选 `twoPhase` 参数，true 时先跑 `generateInsertTextScript`、host 端等 1000ms、再跑 `generateSendOnlyScript`；false 时走原 `generateSendMessageScript` 单脚本路径不变。`TaskModePanel.handleSend` 传 `twoPhase=true`。其他 `sendMessage` 调用方不传参，默认 false，零回归。

**Tech Stack:** TypeScript (strict), Electron 28 webview `executeJavaScript`, React 18 `useImperativeHandle`。

## Global Constraints

- 严格 TypeScript，禁止 `any` 静默错误；故意未使用的变量以 `_` 前缀标记。
- 包管理器：npm（禁止其他）。
- 项目无自动化测试运行器；验证 = `npm run lint` → `npm run build` → `npm run dev` 手动验证。
- IPC/桥接约束不适用本改动（`sendMessage` 是 React `useImperativeHandle` 句柄，非 IPC，无需同步 preload 契约）。
- 禁止擅自切分支；在当前分支 `main` 上工作。
- 不做无关重构；改动严格聚焦任务分配发送路径。

---

## File Structure

| 文件 | 责任 | 改动类型 |
|---|---|---|
| `src/shared/utils/webviewScripts.ts` | 注入脚本生成器集合 | 新增 `generateSendOnlyScript` 导出函数（约 1149 行后插入） |
| `src/renderer/src/components/WebviewCard.tsx` | webview 命令式句柄 | 1) 顶部新增 `TWO_PHASE_SEND_DELAY_MS` 常量；2) import 加 `generateSendOnlyScript`；3) `WebviewCardRef.sendMessage` 签名加 `twoPhase?`；4) `useImperativeHandle` 内 `sendMessage` 实现加 twoPhase 分支 |
| `src/renderer/src/components/modes/TaskModePanel.tsx` | 任务分配发送入口 | `handleSend` 第 68 行 `sendMessage(combined)` → `sendMessage(combined, true)` |

不动：`generateSendMessageScript`、`buildSimulateEnterKeyScript`、`buildTextareaInputScript`、`buildContentEditableInputScript`、`buildFindSendButtonScript`、`buildFindTextareaScript`、`selectors.ts`、`AutomationService.ts`、preload、main 进程、Session、总结链路。

---

### Task 1: 新增 `generateSendOnlyScript` 脚本生成器

**Files:**
- Modify: `src/shared/utils/webviewScripts.ts`（在 `generateInsertTextScript` 之后、`generateClearInputScript` 之前插入，约第 1149 行）

**Interfaces:**
- Consumes: `buildFindSendButtonScript(selectors: ModelSelector): string`（已存在于同文件 413 行）；`ModelSelector` 类型（含 `sendButton` 字段）。
- Produces: `generateSendOnlyScript(modelId: string, selectors: ModelSelector): string` — 返回一个自执行异步 IIFE 字符串，注入 webview 后查找发送按钮并 click，不设值、不依赖 textarea 变量。返回结构 `{ success: boolean; method?: string; error?: string }`。

- [ ] **Step 1: 在 `generateInsertTextScript` 函数闭合 `}` 之后插入新函数**

在 `src/shared/utils/webviewScripts.ts` 第 1149 行（`generateInsertTextScript` 的闭合 `}`）之后、`generateClearInputScript` 的 JSDoc 注释（第 1151 行 `/**`）之前，插入：

```ts
/**
 * 生成"仅点击发送按钮"的注入脚本（不重新设值）。
 * 用于任务分配两段式发送的第二段：第一段已用 generateInsertTextScript 注入文本，
 * 本段只查找发送按钮并点击。
 *
 * 设计决策：
 * - 不调用 buildFindTextareaScript：该函数找不到 textarea 时会
 *   `return { success:false }` 终止整个 IIFE，而第二段只需按钮，
 *   不应被 textarea 选择器未命中拖累。
 * - 不调用 buildSimulateEnterKeyScript：它含 Enter 回退分支且依赖
 *   textarea 变量；为避免扩散改动共享函数，改为内联"按钮存在即 click，
 *   否则失败"。
 * - clickDelay 与 buildSimulateEnterKeyScript 一致，保留
 *   doubao/qwen/deepseek 500ms、其他 50ms 的分平台策略。
 *
 * @param modelId 模型 ID
 * @param selectors 选择器配置
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

- [ ] **Step 2: lint 检查**

Run: `npm run lint`
Expected: 通过，无 `@typescript-eslint/no-explicit-any` 或未使用变量告警。若报 `generateSendOnlyScript` 未使用（因为尚未被 import），忽略本步告警——Task 2 会消费它；若 lint 因未使用导出报错，临时确认 lint 规则对导出函数不报 unused（导出函数默认不报）。

- [ ] **Step 3: build 验证（类型检查 + 打包）**

Run: `npm run build`
Expected: 通过，`out/` 产物生成，无类型错误。

- [ ] **Step 4: Commit**

```bash
git add src/shared/utils/webviewScripts.ts
git commit -m "feat(webview-scripts): add generateSendOnlyScript for two-phase send

Second-phase script for task-assignment two-phase send: finds the send
button and clicks it without re-setting text or depending on textarea.
Reuses buildFindSendButtonScript and inlines click logic to avoid touching
the shared buildSimulateEnterKeyScript.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: `WebviewCard.sendMessage` 加 `twoPhase` 两段式分支

**Files:**
- Modify: `src/renderer/src/components/WebviewCard.tsx`
  - 顶部常量区（约第 17 行后，import 块之后、组件定义之前）
  - import 块第 7-15 行
  - `WebviewCardRef` 接口第 116 行
  - `useImperativeHandle` 内 `sendMessage` 实现第 479-516 行

**Interfaces:**
- Consumes: `generateInsertTextScript(message, modelId, selectors): string`（已 import 于第 9 行）、`generateSendOnlyScript(modelId, selectors): string`（Task 1 新增，需新 import）。
- Produces: `WebviewCardRef.sendMessage` 签名变为 `(message: string, twoPhase?: boolean) => Promise<{ success: boolean; error?: string }>`；`twoPhase=true` 时先注入、host 端等 1000ms、再点发送。`twoPhase` 默认 false，原单脚本路径不变。

- [ ] **Step 1: import 块加 `generateSendOnlyScript`**

在 `src/renderer/src/components/WebviewCard.tsx` 第 7-15 行的 import 块中，把：

```ts
import {
  generateSendMessageScript,
  generateInsertTextScript,
  generateClearInputScript,
```

改为（在 `generateInsertTextScript,` 之后插入一行）：

```ts
import {
  generateSendMessageScript,
  generateInsertTextScript,
  generateSendOnlyScript,
  generateClearInputScript,
```

- [ ] **Step 2: 顶部新增 `TWO_PHASE_SEND_DELAY_MS` 常量**

在 import 块全部结束后、`WebviewCard` 组件定义（`export const WebviewCard = forwardRef...` 或等价定义）之前，插入：

```ts
/** 任务分配两段式发送：注入后等待 host 端延时，再点发送按钮（给千问 React 收敛窗口） */
const TWO_PHASE_SEND_DELAY_MS = 1000
```

放置位置：与文件内其他模块级常量同一区域；若文件无既有模块级常量，放在 import 块后第一个空行处。先 Read 该区域确认插入点，避免插到组件函数体内部。

- [ ] **Step 3: `WebviewCardRef.sendMessage` 签名加 `twoPhase?`**

把第 116 行：

```ts
  sendMessage: (message: string) => Promise<{ success: boolean; error?: string }>
```

改为：

```ts
  sendMessage: (message: string, twoPhase?: boolean) => Promise<{ success: boolean; error?: string }>
```

- [ ] **Step 4: `useImperativeHandle` 内 `sendMessage` 实现加 twoPhase 分支**

把第 479-516 行的 `sendMessage` 实现：

```ts
      sendMessage: async (message: string): Promise<{ success: boolean; error?: string }> => {
        const webview = webviewRef.current
        if (!webview) {
          console.warn(`[${name}] sendMessage: webview ref 为空`)
          return { success: false, error: `Webview ref 为空` }
        }
        if (!isReady) {
          console.warn(`[${name}] sendMessage: webview 未就绪 (isReady: ${isReady}, isLoading: ${isLoading})`)
          return { success: false, error: `Webview 未就绪 (加载中: ${isLoading})` }
        }
        if (!selectors) {
          console.warn(`[${name}] sendMessage: 选择器配置不存在`)
          return { success: false, error: `选择器配置不存在` }
        }

        setSendStatus('sending')

        try {
          const code = generateSendMessageScript(message, id, selectors)
          const result = await webview.executeJavaScript(code)

          if (result.success) {
            setSendStatus('success')
            // 3秒后恢复状态
            setTimeout(() => setSendStatus('idle'), 3000)
            return { success: true }
          } else {
            setSendStatus('error')
            setTimeout(() => setSendStatus('idle'), 3000)
            return { success: false, error: result.error }
          }
        } catch (error) {
          console.error(`[${name}] sendMessage 异常:`, error)
          setSendStatus('error')
          setTimeout(() => setSendStatus('idle'), 3000)
          return { success: false, error: String(error) }
        }
      },
```

改为：

```ts
      sendMessage: async (
        message: string,
        twoPhase = false
      ): Promise<{ success: boolean; error?: string }> => {
        const webview = webviewRef.current
        if (!webview) {
          console.warn(`[${name}] sendMessage: webview ref 为空`)
          return { success: false, error: `Webview ref 为空` }
        }
        if (!isReady) {
          console.warn(`[${name}] sendMessage: webview 未就绪 (isReady: ${isReady}, isLoading: ${isLoading})`)
          return { success: false, error: `Webview 未就绪 (加载中: ${isLoading})` }
        }
        if (!selectors) {
          console.warn(`[${name}] sendMessage: 选择器配置不存在`)
          return { success: false, error: `选择器配置不存在` }
        }

        setSendStatus('sending')

        try {
          if (twoPhase) {
            // 两段式：先注入（复用 multi_ai 已验证路径），host 端等 1000ms 给千问 React 收敛，再点发送
            const insertCode = generateInsertTextScript(message, id, selectors)
            const insertResult = await webview.executeJavaScript(insertCode)
            if (!insertResult?.success) {
              setSendStatus('error')
              setTimeout(() => setSendStatus('idle'), 3000)
              return { success: false, error: insertResult?.error || '注入失败' }
            }
            await new Promise((resolve) => setTimeout(resolve, TWO_PHASE_SEND_DELAY_MS))
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

          // 原单脚本路径（multi_ai / summary 等调用方默认走此）
          const code = generateSendMessageScript(message, id, selectors)
          const result = await webview.executeJavaScript(code)

          if (result.success) {
            setSendStatus('success')
            // 3秒后恢复状态
            setTimeout(() => setSendStatus('idle'), 3000)
            return { success: true }
          } else {
            setSendStatus('error')
            setTimeout(() => setSendStatus('idle'), 3000)
            return { success: false, error: result.error }
          }
        } catch (error) {
          console.error(`[${name}] sendMessage 异常:`, error)
          setSendStatus('error')
          setTimeout(() => setSendStatus('idle'), 3000)
          return { success: false, error: String(error) }
        }
      },
```

要点：
- 守卫（webview/isReady/selectors）不变，两段式与单脚本共享。
- 第一段注入失败立即返回，不进入第二段。
- 1000ms 延时在 host 端（React 层），不在 webview 脚本内。
- `setSendStatus` 状态机（sending → success/error → idle 3s）与原路径一致。
- 单脚本路径（`twoPhase=false`）逐字保留原逻辑。

- [ ] **Step 5: lint 检查**

Run: `npm run lint`
Expected: 通过，无告警。

- [ ] **Step 6: build 验证**

Run: `npm run build`
Expected: 通过，无类型错误。`generateSendOnlyScript` 已被消费，无 unused 告警。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/WebviewCard.tsx
git commit -m "feat(webview-card): add twoPhase send path in sendMessage

When twoPhase=true, sendMessage runs generateInsertTextScript, waits
1000ms host-side for Qwen React to settle, then runs generateSendOnlyScript.
Default false preserves the existing single-script path for multi-AI and
summary callers.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: `TaskModePanel.handleSend` 启用两段式

**Files:**
- Modify: `src/renderer/src/components/modes/TaskModePanel.tsx`（第 68 行）

**Interfaces:**
- Consumes: `WebviewCardRef.sendMessage(message, twoPhase?)`（Task 2 产出）。
- Produces: 任务分配模式发送走两段式，千问网页不再报错。

- [ ] **Step 1: 把 `sendMessage(combined)` 改为 `sendMessage(combined, true)`**

把 `src/renderer/src/components/modes/TaskModePanel.tsx` 第 68 行：

```ts
        const r = await ref.sendMessage(combined)
```

改为：

```ts
        const r = await ref.sendMessage(combined, true)
```

不动其他行：`for...of + await` 顺序循环不变，插槽间仍逐个发；okCount/failCount 统计不变；通知逻辑不变。

- [ ] **Step 2: lint 检查**

Run: `npm run lint`
Expected: 通过。

- [ ] **Step 3: build 验证**

Run: `npm run build`
Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/modes/TaskModePanel.tsx
git commit -m "feat(task-mode): enable two-phase send for task assignment

Pass twoPhase=true to sendMessage so task-assignment mode uses the
insert -> 1000ms -> send-only path, fixing Qwen page errors caused by
the single-script inject+send transaction.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 手动验证（dev 环境）

**Files:** 无代码改动；仅在 `npm run dev` 中触发验证。

**Interfaces:** N/A

- [ ] **Step 1: 启动 dev**

Run: `npm run dev`
Expected: Electron 桌面窗口打开，无控制台报错。

- [ ] **Step 2: 任务分配模式千问发送验证**

在应用中切到任务分配模式，配置至少一个千问（qwen）槽位 + 1~2 个其他平台槽位，输入主任务并拆分，点"一键发送"。
Expected:
- 千问网页**不报错**（无 toast 报错、控制台无 React state warning）。
- 千问消息正常发出。
- 其他平台槽位正常发送。
- 注意发送节奏：每个千问槽位注入后约 1s 才点发送（1000ms host 延时 + 500ms clickDelay），属预期。

- [ ] **Step 3: 千问单槽连续发送验证**

任务分配模式下，仅千问一个槽，连续发起 2~3 次主任务（每次拆分后发送，发送后清空再发）。
Expected: 无累积报错，每次均正常发送。

- [ ] **Step 4: 多 AI 模式回归验证**

切到多 AI 模式，两步发送（第一次点注入、第二次点发送）到任意平台。
Expected: 行为与改动前一致——注入正常、发送正常、无新增报错。此步确认 `twoPhase` 默认 false 未影响其他路径。

- [ ] **Step 5: 若千问仍报错——执行 spec §5 缓解项**

若 Step 2 千问仍报错，记录报错现象（toast 文案 / 控制台报错 / 按钮点不动），按 spec §5 缓解项排查：下一步评估是否需移除 `generateInsertTextScript` 对千问 textarea 的 blur/focus 周期（`buildTextareaInputScript` 第 399 行）或给 `generateSendOnlyScript` 加按钮可见性重试。把现象记入 SESSION_LOG。

- [ ] **Step 6: 记录 session log**

Run（PowerShell）:
```bash
python .memory/session_log.py --done "任务分配模式发送拆为两段式注入（注入→1000ms→点发送），消除千问网页报错" --modified "src/shared/utils/webviewScripts.ts, src/renderer/src/components/WebviewCard.tsx, src/renderer/src/components/modes/TaskModePanel.tsx" --added "docs/superpowers/specs/2026-07-05-task-assignment-two-phase-send-design.md, docs/superpowers/plans/2026-07-05-task-assignment-two-phase-send.md"
```
Expected: SESSION_LOG 追加一条；若输出 "Consider promoting stable lessons..." 提示，按规则把 lessons 追加到 `.memory/KNOWLEDGE.md` 并把对应 `- lesson:` 改为 `- lesson(promoted):`。

---

## Self-Review 结果

**1. Spec coverage:**
- §3.1 `generateSendOnlyScript` → Task 1 ✓
- §3.2 `WebviewCard.sendMessage` 两段式 + `TWO_PHASE_SEND_DELAY_MS` + `WebviewCardRef` 签名 → Task 2 ✓
- §3.3 `TaskModePanel.handleSend` 传 twoPhase → Task 3 ✓
- §4.1 设计决策（不调 buildFindTextareaScript、不调 buildSimulateEnterKeyScript、clickDelay 一致、收尾 200ms）→ Task 1 代码内联体现 ✓
- §4.2 host 端 1000ms、第一段失败立即返回、状态机一致、单脚本路径逐字保留 → Task 2 代码内联体现 ✓
- §5 风险缓解（千问仍报错的下一步）→ Task 4 Step 5 ✓
- §6 验证（任务分配千问、多 AI 回归、连续发送、lint/build）→ Task 4 + 各 Task 末尾 lint/build ✓
- 不影响 preload、AutomationService、其他 sendMessage 调用方 → Global Constraints + Task 2 注释 ✓

**2. Placeholder scan:** 无 TBD/TODO/"add error handling"/"similar to Task N"。每步含完整代码或确切命令。

**3. Type consistency:**
- `generateSendOnlyScript(modelId: string, selectors: ModelSelector)` — Task 1 定义，Task 2 调用 `generateSendOnlyScript(id, selectors)`，签名一致 ✓
- `WebviewCardRef.sendMessage: (message: string, twoPhase?: boolean) => Promise<{ success: boolean; error?: string }>` — Task 2 定义，Task 3 调用 `ref.sendMessage(combined, true)`，签名一致 ✓
- 返回结构 `{ success: boolean; error?: string }` / `{ success: boolean; method?: string; error?: string }` — Task 1 返回 method 但 Task 2 只读 `result.success`/`result.error`，多出的 `method` 字段不影响消费 ✓
- spec 写的是 `WebviewCardHandle`，实际代码是 `WebviewCardRef`（WebviewCard.tsx:115）——本计划用代码事实 `WebviewCardRef`，已在 File Structure 与 Task 2 标注。spec 与代码冲突处以代码为准（AGENTS.md 规则）。

无遗漏、无占位符、类型一致。计划可执行。
