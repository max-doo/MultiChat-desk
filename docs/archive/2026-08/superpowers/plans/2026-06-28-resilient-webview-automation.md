> Created: 2026-06-28 18:22 (+08:00)
> Revised: 2026-06-28 19:18 (+08:00) — 按评审意见修订：方案二改为最小增量兜底、收紧匹配；方案三补多平台 payload 适配/行缓冲/流完成判定/降级日志；Task 3 锚点精确化、commit 改为需用户确认。
> Revised: 2026-06-28 19:40 (+08:00) — 按"二级菜单/正则区分搜索"反馈重做方案二：匹配层升级为正则+单词边界+exclude（解决 Search/Research 误匹配），新增跨步菜单兜底（menuOpenerFallback，解决菜单未打开找不到按钮）；记录非 DOM 替代方案调研（网络改写/CDP 输入），经评估暂不采用。
> Revised: 2026-06-28 20:05 (+08:00) — 新增 Task 4：复用并强化自动保存为"事件驱动"——sniffer 推送 `__MM_REPLY_DONE__`（含从请求体提取的 prompt）→ store.recordSniffedTurn 落库；消除 pollPlatforms 的反复 DOM 爬取（二次爬取），并补齐单 webview 手动聊天盲区（续接同平台最近一条历史）。

# Resilient Webview Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 改造 MultiChat Desk 的 Webview 自动化引擎，解决 AI 平台频繁改版导致的 DOM 识别失效问题：通过**策略二（语义化定位 + 正则匹配 + 跨步菜单兜底）**增强"深度研究"开关的查找韧性（含解决二级菜单未打开找不到按钮、以及 Search/Research 文本误匹配）；通过**策略三（非 DOM 网络请求拦截与监听）**实现模型回复的高可靠抓取；通过**策略四（事件驱动自动保存）**复用并强化既有自动保存，消除回复的反复 DOM 爬取（二次爬取），并补齐单 webview 手动聊天不落库的盲区。

**Architecture:** 
1. **渲染层脚本增强（策略二）**：在 `src/renderer/src/utils/webviewScripts.ts` 的 `findElement` 核心函数中，(a) 把文本匹配从 `includes` 升级为"正则 + 单词边界 + exclude"的统一 `matchText`，解决英文 `Search`/`Research` 共享子串误匹配与中文"研究中心"等误命中；(b) 保留静态选择器失败后的全局语义元素兜底；(c) 新增**跨步菜单兜底** `findMenuOpener`——当"开菜单"步的元素找不到时，按 `aria-haspopup=menu`/加号/tools 语义找开菜单按钮，避免菜单未打开导致后续菜单项永远找不到。匹配配置由 `selectors.ts` 的 step schema 扩展（`regex`/`exclude`/`wordBoundary`/`caseSensitive`/`menuOpenerFallback`）驱动，向后兼容现有 `text`。
2. **非 DOM 响应拦截引擎（策略三）**：在 Webview 页面环境（main world）注入轻量级 `window.fetch` 与 `XMLHttpRequest` 流式响应监听器，解析多平台 SSE 增量（OpenAI/DeepSeek/Qwen `choices.delta`、ChatGPT `message.content.parts`、Claude `content_block_delta`），挂载至 `window.__mm_sniffed_reply` / `__mm_sniffed_reasoning`，并以 `__mm_sniffing` + 静默超时表达"流进行中/已完成"。注：`session.webRequest` 无法读取流式响应体，故选用 main-world patch（`executeJavaScript` 运行于页面 main world，已由 Electron 官方文档核实）。
3. **抓取链路双重保障**：在获取模型输出时，若 `__mm_sniffing` 为真则短暂等待流静默完成，再读取网络层拦截到的纯净回复；若无数据（含 SW/Worker 转发导致 patch 抓不到的情形，连续取空计数告警）则平滑降级至原有的 DOM 抓取逻辑。
4. **事件驱动自动保存（策略四，复用+强化）**：sniffer 在流完成时通过既有的 `__MM_LOG__:` 风格 console-message 通道推送 `__MM_REPLY_DONE__`（含从**请求体**提取的 user prompt + sniffed reply + reasoning）到渲染层；`appStore` 新增 `recordSniffedTurn(modelId, payload)`：若该平台属于当前活跃 monitor 的 turn，直接写入 `lastContent` 并置 `isComplete`（跳过该平台的 DOM 轮询），否则按 URL 判定续接同平台最近一条历史、落 per-webview turn（补齐手动聊天盲区）。`pollPlatforms` 降级为 sniffer 失效站点的兜底。**不新增 IPC**（console-message + store 内部完成）。

**Tech Stack:** TypeScript (strict), Electron 28, React 18, DOM API, RegExp, Proxy/Reflect API.

**已评估但暂不采用的替代方案**：见文末《附录：非 DOM 触发方式调研记录》（网络请求改写绕过 UI、CDP `Input.dispatch*` 真实输入、`sendInputEvent` 等）。经评估，网络改写需逆向各平台私有 API 字段且可能触及 TOS；CDP 输入需主进程 debugger attach + 新增 IPC 且仍依赖 DOM 定位、解决不了"菜单未打开"。本轮只做 DOM 强化（用户已选定），替代方案留档备查。

---

## Scope Check & Architecture Constraints

- **分层与规范**：遵循项目规则，新增或修改 IPC 必须同步 `src/main/ipcHandlers.ts`、`src/preload/index.ts`、`src/preload/index.d.ts`；验证流程严格遵循 `npm run lint` -> `npm run build` -> `npm run dev`。
- **DRY & 兼容性**：所有选择器配置仍统一维护在 `src/renderer/src/config/selectors.ts`，脚本注入统一在 `src/renderer/src/utils/webviewScripts.ts`。

---

### Task 1: 策略二 —— 正则匹配 + 语义化兜底 + 跨步菜单兜底

**Files:**
- Modify: `c:/Project/MultiChat-desk/src/renderer/src/config/selectors.ts`（step schema 扩展 + 易误匹配条目改用 regex）
- Modify: `c:/Project/MultiChat-desk/src/renderer/src/utils/webviewScripts.ts`（`findElement` 匹配层升级 + 跨步菜单兜底）

- [ ] **Step 1: 扩展 `selectors.ts` 的 step schema（新增 regex/exclude/wordBoundary/caseSensitive/menuOpenerFallback，向后兼容 `text`）**

现状：`ModelSelector.researchMode.steps` / `cancelSteps` / `imageGeneration.steps` / `cancelSteps` 各有一份内联 step 类型（`selectors.ts:22-29`、`30-37`、`44-51`、`52-59`），字段仅 `selector/text/delay/exact/optional/countsAsSuccess`。匹配靠 `findElement` 的 `content.includes(t)`，**case-sensitive 但无单词边界**，无法稳定区分 `Search`/`Research`，也无法表达"排除项"。

为 DRY，先抽取共享类型，再复用于 4 处：

```typescript
// 新增：自动化步骤的共享类型（regex/exclude/wordBoundary/caseSensitive/menuOpenerFallback 为新增字段）
export interface AutomationStep {
  selector: string | string[]
  text?: string | string[]      // 旧：部分匹配文本，向后兼容
  regex?: string                // 新：正则模式，设定后优先于 text
  exclude?: string[]            // 新：正则数组，命中任一则排除该元素（用于区分 Search/Research）
  wordBoundary?: boolean        // 新：regex 为真时默认 true，自动加 \b 边界
  caseSensitive?: boolean       // 新：默认 false（匹配不区分大小写）
  delay?: number
  exact?: boolean
  optional?: boolean
  countsAsSuccess?: boolean
  menuOpenerFallback?: boolean  // 新：本步元素找不到时，按语义找"开菜单"按钮（解决二级菜单未打开）
}
```

将 4 处 `steps: Array<{...}>` / `cancelSteps: Array<{...}>` 的内联类型替换为 `steps: AutomationStep[]` / `cancelSteps: AutomationStep[]`。`researchMode.button`（遗留字段，`:39`）保留不动。

- [ ] **Step 2: 升级 `findElement` 匹配层为 `matchText`（正则 + 单词边界 + exclude）**

`findElement` 当前签名 `(selector, text, exact)`，被 3 处调用（`webviewScripts.ts:731/1085/1165`）以 `findElement(step.selector, step.text, step && step.exact === true)` 形式调用。改造为接收整个 step 对象，以便读取 `regex/exclude/wordBoundary/caseSensitive`：

调用点统一改为：
```typescript
element = findElement(step.selector, step.text, step);
```
（3 处都改：`:731`、`:1085`、`:1165`）

`findElement` 签名与匹配改为（`webviewScripts.ts:636` 起）：
```typescript
    function findElement(selector, text, opts) {
      // opts 兼容旧 boolean（exact）与新 step 对象
      const o = (opts && typeof opts === 'object') ? opts : { exact: !!opts };

      // 统一文本匹配：regex 优先，否则 text includes；先过 exclude
      function matchText(content, ariaLabel) {
        const flags = o.caseSensitive ? '' : 'i';
        const targets = o.regex
          ? [o.regex]
          : (text != null ? (Array.isArray(text) ? text : [text]) : []);
        const excludeList = o.exclude || [];
        // exclude 命中任一即否（区分 Search/Research 的关键）
        for (const ex of excludeList) {
          try { if (new RegExp(ex, flags).test(content) || new RegExp(ex, flags).test(ariaLabel)) return false; } catch (e) {}
        }
        for (let t of targets) {
          if (o.regex) {
            let pat = t;
            if (o.wordBoundary !== false) {          // 默认加单词边界
              if (!/^\^/.test(pat)) pat = '\\b(?:' + pat + ')';
              if (!/\$$/.test(pat)) pat = pat + '\\b';
            }
            try {
              const re = new RegExp(pat, flags);
              if (re.test(content) || re.test(ariaLabel)) return true;
            } catch (e) {}
          } else if (o.exact) {
            if (content === t || ariaLabel === t) return true;
          } else {
            const lc = (content || '').toLowerCase();
            const la = (ariaLabel || '').toLowerCase();
            const lt = String(t).toLowerCase();
            if (lc.includes(lt) || la.includes(lt)) return true;   // 向后兼容旧 text 行为
          }
        }
        return false;
      }
```

然后将**主分支**（`webviewScripts.ts:671-694`）里两段 `for (const t of textArray) { if (content.includes(t)) ... }` 与 aria-label 段，整体替换为：
```typescript
        const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('title') || '';
        if (matchText(content, ariaLabel)) {
          return normalizeClickable(el);
        }
```
（删去手写的 `textArray` 迭代与 `includes` 调用，统一走 `matchText`。）

> 关键：`text`-only 的旧 step（未设 regex）走 `includes` 分支，**行为与改造前一致**，不回归；只有显式设 `regex` 的 step 才走正则+单词边界。`exclude` 对所有 step 生效（空数组则无影响）。
> 为什么能区分 Search/Research：`\bsearch\b`（case-insensitive）不会命中 "Research"——"Research" 里 "search" 前是字母 `e`，无单词边界；同理 `\bresearch\b` 不会命中独立的 "Search"。

- [ ] **Step 3: 在 `findElement` 的 `return null` 前插入语义化兜底（单步内，菜单已打开时找菜单项）**

在 Step 2 已升级匹配层的基础上，本步追加**全局语义化元素兜底**：当静态选择器全部失效、且本步指定了文本/正则时，遍历全局交互类语义元素再用 `matchText` 匹配。用于"菜单已打开但菜单项的静态选择器改版"的场景。定位锚点（现有代码 `webviewScripts.ts:695-698`，`for (const sel of selectorList)` 循环结束、`return null` 之前）：

```typescript
        }
      }
      
       return null;
    }
```

改为：

```typescript
        }
      }

      // 策略二降级：静态选择器全部失效且指定了目标文本时，遍历全局交互类语义元素
      // 仅在兜底段生效，不影响上方静态选择器分支的既有行为
      if (text || (o && o.regex)) {
        const semanticSelectors = 'button, [role="button"], [role="radio"], [role="switch"], [role="checkbox"], [role="menuitem"], [role="menuitemradio"], [role="tab"], label, input[type="checkbox"], input[type="radio"]';
        let semanticElements = [];
        try {
          semanticElements = document.querySelectorAll(semanticSelectors);
        } catch (e) {}

        for (const el of semanticElements) {
          // 可见性判定与上方分支保持一致
          if (el.getBoundingClientRect().width === 0 && el.offsetParent === null) {
            continue;
          }
          const content = (el.innerText || el.textContent || '').trim();
          const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('title') || '';
          // 复用 Step 2 的 matchText：regex/exclude/wordBoundary 全部生效，统一区分 Search/Research
          if (matchText(content, ariaLabel)) {
            return normalizeClickable(el);
          }
        }
      }

       return null;
    }
```

> 说明：本步兜底 (1) 仅在静态选择器失效时启用，不影响主分支；(2) 移除了 `div[class*="button"], div[class*="btn"]` 这类易误命中的宽泛类名选择器；(3) 匹配统一走 Step 2 的 `matchText`，享受 regex/exclude/wordBoundary；(4) `normalizeClickable`、`simulateClick` 不动。

- [ ] **Step 4: 跨步菜单兜底 `findMenuOpener`（解决二级菜单未打开）**

**问题**：ChatGPT（`selectors.ts:115`）、Gemini（`:311`）等平台的 deep research 入口藏在二级菜单/抽屉里，step1 先点"开菜单"按钮、step2 才能在菜单里找菜单项。当 step1 的开菜单按钮改版后菜单根本不打开，step2 的单步兜底再强也找不到一个尚未挂载的元素。本步在步骤循环层加**跨步兜底**：step1 找不到时按语义找任何"开菜单"按钮并点击，让 step2 有东西可找。

在 `buildDeepResearchHelperFunctions` 的 helper 区（`findElement`/`simulateClick` 同级）新增 `findMenuOpener`：

```typescript
    function findMenuOpener() {
      // 语义找开菜单按钮：aria-haspopup=menu 优先，其次 aria-label/文本命中开菜单语义
      const openerRegex = /\+|plus|more|tools?|menu|菜单|更多|工具|附加|添加/i;
      const all = document.querySelectorAll('[aria-haspopup="menu"], [aria-haspopup="true"], button, [role="button"]');
      const candidates = [];
      for (const el of all) {
        if (el.getBoundingClientRect().width === 0 && el.offsetParent === null) continue;
        const aria = el.getAttribute('aria-label') || el.getAttribute('title') || '';
        const txt = (el.innerText || el.textContent || '').trim();
        const hasMenu = /^(menu|true)$/i.test(el.getAttribute('aria-haspopup') || '');
        const score = (hasMenu ? 2 : 0) + (openerRegex.test(aria) ? 2 : 0) + (openerRegex.test(txt) ? 1 : 0);
        if (score > 0) candidates.push({ el, score, top: el.getBoundingClientRect().top });
      }
      if (!candidates.length) return null;
      // 得分最高者优先；同分取更靠近底部（composer 区）者
      candidates.sort((a, b) => b.score - a.score || (b.top - a.top));
      return normalizeClickable(candidates[0].el);
    }
```

在 `buildDeepResearchStepsScript`（`webviewScripts.ts:719+`）的步骤循环里，retry 结束、失败返回之前（`webviewScripts.ts:738` `if (!element) {` 之内、`optional` 判断之前）插入：

```typescript
         if (!element && step && step.menuOpenerFallback) {
           element = findMenuOpener();
         }
```

即把现有：
```typescript
         if (!element) {
           if (step && step.optional) {
             continue;
           }
           return { success: false, error: '步骤执行失败: 未找到元素 ' + step.selector };
         }
```
改为：
```typescript
         if (!element) {
           if (step && step.menuOpenerFallback) {
             element = findMenuOpener();
           }
         }
         if (!element) {
           if (step && step.optional) {
             continue;
           }
           return { success: false, error: '步骤执行失败: 未找到元素 ' + step.selector };
         }
```

> 注：`findMenuOpener` 只在 step 显式声明 `menuOpenerFallback: true` 时触发（见 Step 5 给 ChatGPT/Gemini 的开菜单步打标），避免误伤单步直达型平台。

- [ ] **Step 5: 更新 `selectors.ts` 易误匹配条目（regex + exclude + menuOpenerFallback 标记）**

(1) 给"开菜单"步打 `menuOpenerFallback: true`，让 Step 4 兜底生效：

```typescript
// ChatGPT researchMode.steps[0]（selectors.ts:115）
{ selector: '[data-testid="composer-plus-btn"], #composer-plus-btn, button.composer-btn', delay: 1000, menuOpenerFallback: true },
// Gemini researchMode.steps[0]（selectors.ts:311）与 imageGeneration.steps[0]（:320）
{ selector: 'button.toolbox-drawer-button', delay: 500, menuOpenerFallback: true },
```

(2) 用 `regex` + `exclude` 区分 Search/Research，避免英文 `search` 误命中 `Research`：

```typescript
// ChatGPT researchMode.steps[1]（selectors.ts:116）
{ selector: 'div[role="menuitemradio"]', regex: 'Deep\\s*Research', exclude: ['\\bSearch\\b', '搜索'], delay: 500 },
// Perplexity researchMode（selectors.ts:159）窄屏按钮：研究 vs 搜索
{ selector: 'button.border.rounded-lg.h-8:not([aria-haspopup])', regex: '研究', exclude: ['搜索', '\\bSearch\\b'], delay: 300, optional: true },
// Perplexity cancelSteps（selectors.ts:167）窄屏按钮：切回搜索，排除研究
{ selector: 'button.border.rounded-lg.h-8:not([aria-haspopup])', regex: '搜索|\\bSearch\\b', exclude: ['研究', '\\bResearch\\b'], delay: 300, optional: true },
```

> 规则：凡是目标标签是另一模式标签的子串（`Search`/`Research`、`研究`/`搜索`），一律改 `regex` + 对立词 `exclude`，并依赖 `matchText` 默认单词边界。其余无冲突的 step 保持原 `text` 不动，向后兼容。

- [ ] **Step 6: 运行类型检查与代码检查**

运行命令验证修改无语法和类型错误：
```bash
npm run lint
```
预期输出：无 ESLint 错误或警告。

---

### Task 2: 策略三 —— 非 DOM 网络请求流式响应拦截脚本注入

为避免 DOM 频繁改变导致爬取回复失败，在页面环境注入轻量级 `fetch` 和 `XMLHttpRequest` 拦截脚本，解析大模型流式输出的 SSE (Server-Sent Events) 数据，将实时回复缓存至 `window.__mm_sniffed_reply`。

**Files:**
- Modify: `c:/Project/MultiChat-desk/src/renderer/src/utils/webviewScripts.ts`

- [ ] **Step 1: 创建网络请求拦截脚本生成器**

在 `src/renderer/src/utils/webviewScripts.ts` 底部添加 `getNetworkSnifferScript` 函数导出。相比初版，本修订修正 4 项缺陷：(a) payload 适配扩展到 ChatGPT（`message.content.parts`）与 Claude（`content_block_delta` 事件流）；(b) XHR 分支补行缓冲，避免半行被 `JSON.parse` 吞掉；(c) 增加"流完成"判定（静默 1200ms 视为完成）与 `__mm_sniffing` 状态，供 `getLatestResponse` 判断是否可读；(d) reset 时机修正——仅在新一轮目标 POST 触发且读到首个 chunk 时清空旧值，并在 sniffed 长期为空时打日志便于排查。

```typescript
/**
 * 生成非 DOM 网络请求流式响应拦截脚本 (策略三)
 * 拦截页面内 fetch 和 XHR 接收到的 SSE 回复数据，挂载至 window.__mm_sniffed_reply
 *
 * 暴露的页面全局状态：
 * - window.__mm_sniffed_reply: 已捕获的正文文本（累积）
 * - window.__mm_sniffed_reasoning: 已捕获的推理文本（累积）
 * - window.__mm_sniffing: boolean，true 表示流进行中；false 表示已静默完成
 * - window.__mm_sniff_seq: number，每开始一轮新流自增，用于 getLatestResponse 判断新旧
 */
export function getNetworkSnifferScript(): string {
  return `
    (function() {
      if (window.__mm_sniffer_installed) return;
      window.__mm_sniffer_installed = true;
      window.__mm_sniffed_reply = '';
      window.__mm_sniffed_reasoning = '';
      window.__mm_sniffing = false;
      window.__mm_sniff_seq = 0;
      window.__mm_sniff_miss_count = 0; // getLatestResponse 取空计数，用于降级诊断

      // 常见大模型 API 的关键特征词
      const apiPatterns = ['/completion', '/conversation', '/chat', '/generate', '/respond'];

      function isTargetUrl(url) {
        if (!url) return false;
        const str = url.toString().toLowerCase();
        return apiPatterns.some(p => str.includes(p));
      }

      // 兼容多平台增量 payload：OpenAI/DeepSeek/Qwen(choices.delta)、ChatGPT(message.content.parts)、Claude(content_block_delta)
      function extractTextFromPayload(json) {
        if (!json || typeof json !== 'object') return { text: '', reasoning: '' };
        // OpenAI 风格：choices[0].delta.{content,reasoning_content}
        if (json.choices && json.choices[0]) {
          const delta = json.choices[0].delta || json.choices[0].message;
          if (delta) {
            return {
              text: typeof delta.content === 'string' ? delta.content : '',
              reasoning: typeof delta.reasoning_content === 'string' ? delta.reasoning_content : ''
            };
          }
        }
        // ChatGPT 内部流：message.content.parts 数组，增量 v 字段
        if (json.message && json.message && json.message.content) {
          const parts = json.message.content.parts;
          if (Array.isArray(parts)) {
            const last = parts[parts.length - 1];
            if (last && typeof last === 'object' && typeof last.v === 'string') return { text: last.v, reasoning: '' };
            if (typeof last === 'string') return { text: last, reasoning: '' };
          }
        }
        // Claude 事件流：delta.text / delta.thinking
        if (json.delta && typeof json.delta === 'object') {
          if (typeof json.delta.text === 'string') return { text: json.delta.text, reasoning: '' };
          if (typeof json.delta.thinking === 'string') return { text: '', reasoning: json.delta.thinking };
          if (typeof json.delta.completion === 'string') return { text: json.delta.completion, reasoning: '' };
        }
        // 通用兜底
        if (typeof json.text === 'string') return { text: json.text, reasoning: '' };
        if (typeof json.content === 'string') return { text: json.content, reasoning: '' };
        return { text: '', reasoning: '' };
      }

      let silenceTimer = null;
      function markActivity() {
        window.__mm_sniffing = true;
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(function() { window.__mm_sniffing = false; }, 1200);
      }

      // 将已缓冲的完整行交给 processSseLine；返回剩余不完整行供下次拼接
      let pendingLine = '';
      function consumeLines(chunk, processor) {
        pendingLine += chunk;
        const lines = pendingLine.split('\\n');
        pendingLine = lines.pop() || '';
        for (const line of lines) processor(line);
      }

      function processSseLine(line) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) return;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === '[DONE]') { markActivity(); return; }
        try {
          const parsed = JSON.parse(dataStr);
          const r = extractTextFromPayload(parsed);
          if (r.text || r.reasoning) {
            if (r.text) window.__mm_sniffed_reply += r.text;
            if (r.reasoning) window.__mm_sniffed_reasoning += r.reasoning;
            markActivity();
          }
        } catch (e) {}
      }

      function resetForNewStream() {
        window.__mm_sniffed_reply = '';
        window.__mm_sniffed_reasoning = '';
        pendingLine = '';
        window.__mm_sniff_seq++;
        window.__mm_sniffing = true;
        if (silenceTimer) clearTimeout(silenceTimer);
      }

      // 拦截 fetch
      const originalFetch = window.fetch;
      window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        const url = args[0] instanceof Request ? args[0].url : args[0];
        const method = (args[1] && args[1].method) ? String(args[1].method).toUpperCase() : 'GET';

        if (isTargetUrl(url) && method === 'POST' && response.body) {
          resetForNewStream();
          const clone = response.clone();
          const reader = clone.body.getReader();
          const decoder = new TextDecoder();
          let localPending = '';

          (async () => {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const text = decoder.decode(value, { stream: true });
                const lines = (localPending + text).split('\\n');
                localPending = lines.pop() || '';
                for (const line of lines) processSseLine(line);
              }
              if (localPending) processSseLine(localPending);
            } catch (err) {}
          })();
        }
        return response;
      };

      // 拦截 XMLHttpRequest（带行缓冲）
      const originalXhrOpen = XMLHttpRequest.prototype.open;
      const originalXhrSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this.__mm_url = url;
        this.__mm_method = method;
        return originalXhrOpen.apply(this, [method, url, ...rest]);
      };
      XMLHttpRequest.prototype.send = function(...args) {
        if (this.__mm_method && this.__mm_method.toUpperCase() === 'POST' && isTargetUrl(this.__mm_url)) {
          resetForNewStream();
          let lastSeenIndex = 0;
          let xhrPending = '';
          this.addEventListener('progress', () => {
            try {
              const text = this.responseText || '';
              const newText = text.substring(lastSeenIndex);
              lastSeenIndex = text.length;
              const lines = (xhrPending + newText).split('\\n');
              xhrPending = lines.pop() || '';
              for (const line of lines) processSseLine(line);
            } catch (e) {}
          });
          this.addEventListener('loadend', () => {
            try {
              if (xhrPending) processSseLine(xhrPending);
              xhrPending = '';
            } catch (e) {}
          });
        }
        return originalXhrSend.apply(this, args);
      };
    })();
  `
}
```

> 说明：
> - **Service Worker / Worker 限制**：若平台经 Service Worker 转发 API，main-world 的 `window.fetch` patch 无法拦截 SW 内的 fetch，sniffer 会静默为空——此时 `getLatestResponse` 会降级到 DOM 抓取（见 Task 3），不致命但策略失效。Task 3 已加"连续取空计数 + 日志"便于发现此类站点。
> - **Claude 事件流**：Claude 的 SSE 含 `event:` 与 `data:` 双行，`processSseLine` 只识别 `data:` 行；`content_block_delta` 的 `data:` 载荷是 `{delta:{text}}`，已由 `extractTextFromPayload` 的 `json.delta` 分支覆盖。其余 `event:` 行被忽略，不影响正文累积。

- [ ] **Step 2: 运行代码静态检查**

运行命令：
```bash
npm run lint
```
预期输出：通过检查，无代码规范报错。

---

### Task 3: 渲染层 WebviewCard 接入网络拦截与抓取双重保障

在 Webview 初始化加载完成后注入网络拦截脚本；在抓取回复时，优先读取网络拦截到的 `window.__mm_sniffed_reply`，若为空则自动降级到原有的 DOM 抓取。

**Files:**
- Modify: `c:/Project/MultiChat-desk/src/renderer/src/components/WebviewCard.tsx`

- [ ] **Step 1: 在 Webview 注入网络监听脚本**

在 `WebviewCard.tsx` 顶部的导入部分加入 `getNetworkSnifferScript`：
```diff
- import { generateEnableDeepResearchScript, generateDisableDeepResearchScript } from '../utils/webviewScripts'
+ import { generateEnableDeepResearchScript, generateDisableDeepResearchScript, getNetworkSnifferScript } from '../utils/webviewScripts'
```

注入锚点：在 `handleDidFinishLoad`（`WebviewCard.tsx:293-295`）内追加注入。`did-finish-load` 在每次整页加载（含刷新）后触发，可保证刷新后 `window` 重建时重新打补丁；SPA 软导航不重建 `window`，补丁持续生效，无需重注。`__mm_sniffer_installed` 守卫防重复安装。

```typescript
      const handleDidFinishLoad = (): void => {
        syncNavigationState()
        try {
          webviewRef.current?.executeJavaScript(getNetworkSnifferScript())
        } catch (e) {
          console.error(`[${name}] 注入网络监听脚本失败:`, e)
        }
      }
```

- [ ] **Step 2: 改造回复提取逻辑（优先网络，降级 DOM）**

精确锚点：`getLatestResponse`（`WebviewCard.tsx:615-642`）。在 Gemini canvas 尝试之后、`generateGetLatestResponseScript(selectors)` 调用（`WebviewCard.tsx:636`）之前，插入网络缓存读取。**关键**：sniffed 数据可能正在流式中（`__mm_sniffing === true`），需短暂等待流静默完成后再读，避免返回不完整回复；连续取空则计数并打日志，便于发现 SW 转发等抓不到的站点，然后降级 DOM。

将 `WebviewCard.tsx:635-637` 处：

```typescript
          // 普通模式：使用 HTML 转 Markdown
          const code = generateGetLatestResponseScript(selectors)
          return await webview.executeJavaScript(code)
```

改为：

```typescript
          // 优先：读取网络层拦截到的纯净回复（策略三）
          try {
            const sniffState = await webview.executeJavaScript(`
              (function(){
                return { sniffing: !!window.__mm_sniffing, seq: window.__mm_sniff_seq || 0 };
              })()
            `)
            if (sniffState && sniffState.sniffing) {
              const deadline = Date.now() + 1500
              while (Date.now() < deadline) {
                await new Promise(r => setTimeout(r, 150))
                const still = await webview.executeJavaScript('!!window.__mm_sniffing')
                if (!still) break
              }
            }
            const sniffedReply = await webview.executeJavaScript('(window.__mm_sniffed_reply || "") + ""')
            if (typeof sniffedReply === 'string' && sniffedReply.trim().length > 0) {
              return sniffedReply.trim()
            }
            // 取空计数：连续多次取空说明该站点可能经 SW/Worker 转发，patch 抓不到
            await webview.executeJavaScript('window.__mm_sniff_miss_count = (window.__mm_sniff_miss_count||0) + 1')
            const missCount = await webview.executeJavaScript('window.__mm_sniff_miss_count || 0')
            if (missCount >= 3) {
              console.warn(`[${name}] 网络拦截连续 ${missCount} 次为空，疑似 SW/Worker 转发，降级 DOM 抓取`)
            }
          } catch (e) {
            console.warn(`[${name}] 读取网络缓存失败，降级 DOM:`, e)
          }

          // 降级：执行原有的 DOM 刮取逻辑
          const code = generateGetLatestResponseScript(selectors)
          return await webview.executeJavaScript(code)
```

> 说明：相比初版，本修订 (1) 锁定插入锚点为 Gemini canvas 之后、`generateGetLatestResponseScript` 之前；(2) 读取前等待流静默完成，避免半截回复；(3) 取空计数 + 日志，暴露 SW 转发等静默失效场景；(4) 任何异常都平滑降级 DOM，不影响既有流程。

- [ ] **Step 3: 构建与全流程端到端验证**

按照项目规则，执行构建和启动命令验证：
```bash
npm run build
npm run dev
```
**测试步骤（手动验证依据项目规则）：**
1. 启动应用桌面窗口后，打开任意模型（如 ChatGPT / DeepSeek / 千问）。
2. 在输入框输入触发深度研究的问题并尝试点击深度研究开关，验证：(a) 静态选择器失效时单步语义兜底能找到菜单项；(b) ChatGPT/Gemini 的开菜单按钮改版时 `menuOpenerFallback` 跨步兜底能打开二级菜单；(c) 英文界面下 Research/Search 不误匹配（Perplexity 切换研究/搜索模式互不误触）。
3. 发送对话后，观察回复抓取是否完整准确，验证策略三网络监听成功捕获流式输出内容；对 ChatGPT/Claude 重点验证 payload 适配是否命中（若控制台出现"连续 3 次为空"告警，说明该站点走 SW，策略三不生效，应依赖 DOM 抓取并记录到 SESSION_LOG）。

---

### Task 4: 策略四 —— 事件驱动自动保存（复用+强化，消除二次爬取 + 补手动聊天盲区）

**背景**：现有自动保存只在 `sendMessageToAll` 路径触发（`appStore.ts:739` → `startMonitoring:1087` → `pollPlatforms:1143` 每 3s 调 `getLatestResponse()` DOM 爬取直到稳定 → `saveCurrentTurn:1197`）。两处痛点：(1) `getLatestResponse` 被 `pollPlatforms`/`getAllResponses`/`useWebviewSummary` 反复调用 = 二次（多次）爬取；(2) 单 webview 手动聊天不走 `sendMessageToAll` → 不落库。sniffer 已具备回复+流完成信号+请求体（含用户 prompt），可作事件驱动保存源。

**Files:**
- Modify: `c:/Project/MultiChat-desk/src/renderer/src/utils/webviewScripts.ts`（扩展 Task 2 的 `getNetworkSnifferScript`：请求体提 prompt + 完成事件推送）
- Modify: `c:/Project/MultiChat-desk/src/renderer/src/components/WebviewCard.tsx`（`handleConsoleMessage` 识别 `__MM_REPLY_DONE__` → `recordSniffedTurn`）
- Modify: `c:/Project/MultiChat-desk/src/renderer/src/store/appStore.ts`（新增 `recordSniffedTurn` + `pollPlatforms` 兜底确认）

- [ ] **Step 1: 扩展 sniffer —— 请求体提取 prompt + 流完成推送 `__MM_REPLY_DONE__`**

在 Task 2 的 `getNetworkSnifferScript` 基础上增量扩展（不改 Task 2 已有响应解析逻辑）：

(a) 新增全局 `window.__mm_sniffed_prompt = '';`（与 `__mm_sniff_miss_count` 同处）。

(b) 新增请求体 prompt 提取器（兼容 OpenAI/DeepSeek/Qwen/Claude/ChatGPT 的 `messages` 数组 + 兜底字段）：
```typescript
      function extractPromptFromBody(body) {
        if (!body) return '';
        try {
          const json = (typeof body === 'string') ? JSON.parse(body) : body;
          if (json && Array.isArray(json.messages)) {
            for (let i = json.messages.length - 1; i >= 0; i--) {
              const m = json.messages[i];
              if (m && (m.role === 'user' || m.role === 'human')) {
                const c = m.content;
                if (typeof c === 'string') return c;
                if (Array.isArray(c)) {
                  for (let j = c.length - 1; j >= 0; j--) {
                    if (c[j] && typeof c[j].text === 'string') return c[j].text;
                    if (typeof c[j] === 'string') return c[j];
                  }
                }
              }
            }
          }
          if (typeof json.prompt === 'string') return json.prompt;
          if (typeof json.question === 'string') return json.question;
        } catch (e) {}
        return '';
      }
```

(c) `resetForNewStream` 改为接收 body 并写入 prompt；fetch/XHR 调用处传入 body：
```typescript
      function resetForNewStream(body) {
        window.__mm_sniffed_reply = '';
        window.__mm_sniffed_reasoning = '';
        window.__mm_sniffed_prompt = extractPromptFromBody(body);
        pendingLine = '';
        window.__mm_sniff_seq++;
        window.__mm_sniffing = true;
        if (silenceTimer) clearTimeout(silenceTimer);
      }
      // fetch 内：resetForNewStream(args[1] && args[1].body);
      // XHR send 内：resetForNewStream(args[0]);
```

(d) 新增完成事件推送（同一 seq 只推一次，空流不推）；在 silenceTimer 回调与 `[DONE]` 处触发：
```typescript
      let doneEmittedForSeq = -1;
      function emitDone() {
        if (doneEmittedForSeq === window.__mm_sniff_seq) return;
        if (!window.__mm_sniffed_reply) return;
        doneEmittedForSeq = window.__mm_sniff_seq;
        try {
          console.log('__MM_REPLY_DONE__:' + JSON.stringify({
            seq: window.__mm_sniff_seq,
            prompt: window.__mm_sniffed_prompt,
            reply: window.__mm_sniffed_reply,
            reasoning: window.__mm_sniffed_reasoning
          }));
        } catch (e) {}
      }
      // markActivity 的 silenceTimer 回调改为：
      //   silenceTimer = setTimeout(function(){ window.__mm_sniffing = false; emitDone(); }, 1200);
      // processSseLine 的 [DONE] 分支改为：markActivity(); emitDone();
```

> 复用既有 `__MM_LOG__:` 风格的 console-message 推送通道（`WebviewCard.tsx:264`），**不新增 IPC**。请求体解析失败时 `prompt=''`，落库时记为 `(手动对话)`，不影响功能——比"网络改写触发 deep research"低风险（只读不改、仅本地记录用户自己的对话）。

- [ ] **Step 2: `WebviewCard.handleConsoleMessage` 接收完成事件**

在 `handleConsoleMessage`（`WebviewCard.tsx:263`）的 `__MM_LOG__:` 分支之后、`event.level >= 2` 分支之前插入：
```typescript
        if (event.message.startsWith('__MM_REPLY_DONE__:')) {
          try {
            const payload = JSON.parse(event.message.substring('__MM_REPLY_DONE__:'.length))
            useAppStore.getState().recordSniffedTurn(id, payload)
          } catch (e) {
            console.error(`[${name}] 解析回复完成事件失败:`, e)
          }
          return
        }
```
并把该 effect 依赖数组（`WebviewCard.tsx:318`）从 `[enabled, name, selectors]` 改为 `[enabled, name, id, selectors]`（handler 现用到 `id`）。`useAppStore` 已在 `WebviewCard.tsx:5` 导入。

- [ ] **Step 3: `appStore` 新增 `recordSniffedTurn`**

接口（`AppState`，`startMonitoring` 签名附近 `appStore.ts:264`）：
```typescript
  recordSniffedTurn: (modelId: string, payload: { seq: number; prompt: string; reply: string; reasoning?: string }) => void
```

实现（`stopMonitoring` 之后、`pollPlatforms` 之前插入）：
```typescript
  recordSniffedTurn: (modelId, payload) => {
    const { monitor, history, updateHistory, addHistory, webviewRefs } = get()
    const reply = (payload?.reply || '').trim()
    if (!reply) return

    // 路径 A：活跃 monitor 且该平台属于当前 turn → 直接落库并标记完成（跳过该平台后续 DOM 轮询）
    if (monitor.isMonitoring && monitor.currentTurn && monitor.currentTurn.platforms[modelId]) {
      const state = monitor.currentTurn.platforms[modelId]
      state.lastContent = reply
      state.isComplete = true
      get().saveCurrentTurn()                       // 复用既有保存
      const allDone = Object.values(monitor.currentTurn.platforms).every(s => s.isComplete)
      if (allDone) get().stopMonitoring()
      return
    }

    // 路径 B：手动聊天（无活跃 monitor）→ 续接同平台最近一条单平台同 URL 历史，否则新建
    const ref = webviewRefs.get(modelId)
    const url = ref?.getCurrentUrl() || ''
    const norm = normalizeUrl(url)
    const recent = history.find(h =>
      Array.isArray(h.models) && h.models.length === 1 && h.models[0] === modelId &&
      h.urls && normalizeUrl(h.urls[modelId]) === norm && norm !== ''
    )
    const turn: ConversationTurn = {
      turnId: `${recent ? recent.id : Date.now().toString()}-${Date.now()}`,
      userMessage: (payload?.prompt || '').trim() || '(手动对话)',
      timestamp: Date.now(),
      responses: { [modelId]: reply },
    }
    if (recent) {
      updateHistory(recent.id, { turns: [...recent.turns, turn], updatedAt: Date.now() })
    } else {
      addHistory({
        id: Date.now().toString(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        models: [modelId],
        turns: [turn],
        urls: { [modelId]: url },
      } as HistoryItem)
    }
  },
```

> `normalizeUrl` 为模块级 helper（`shouldStartNewConversation` 内已用，`appStore.ts:479`）；`addHistory`/`updateHistory`/`saveCurrentTurn` 均为既有 store action。`shouldStartNewConversation` 因比较"全部 key 集合"会把单平台手动聊天与多平台统一发送历史判为不同对话，故手动聊天天然形成独立的单平台线程、并按 URL 续接——符合"续接同平台最近一条"。

- [ ] **Step 4: `pollPlatforms` 降级为兜底（确认共存，无破坏性改动）**

`pollPlatforms`（`appStore.ts:1143`）已有 `if (!state || state.isComplete) continue`（`:1160`）——sniffer 经路径 A 标记 `isComplete` 的平台会被自动跳过，**无需改逻辑**。本步仅：
1. 确认 sniffer 命中站点：poller 在 sniffer 推送 done 后短期内即见 `isComplete` 而停止 DOM 爬取（且 `getLatestResponse` 经 Task 3 已优先读 sniffed），二次爬取被消除。
2. 确认 sniffer 失效站点（SW/Worker 转发）：sniffer 不推送 done，poller 继续按既有 DOM 稳定性判定兜底——功能不退化。
3. 防重复保存：路径 A 与 poller 都调 `saveCurrentTurn`，但 `isComplete` 后 poller 跳过该平台、`saveCurrentTurn` 写入相同 `lastContent`，幂等无冲突。

如需进一步减少 sniffer 命中站点的残余轮询，可在 `pollPlatforms` 的 `getLatestResponse()` 前加：若该平台 `__mm_sniff_seq>0` 且最近一次 done 的 seq 已记录，则直接 skip（可选优化，非必需）。

- [ ] **Step 5: 构建与端到端验证**

```bash
npm run lint
npm run build
npm run dev
```
**手动验证（依据项目规则）：**
1. 统一发送：走 `sendMessageToAll`，确认回复落库且控制台不再出现反复 DOM 爬取（sniffer 推送 `__MM_REPLY_DONE__`，poller 提前停止）。
2. 手动聊天：在单个 webview 内直接在平台 UI 输入并发送（不经统一发送），确认该轮对话自动落库、user prompt 来自请求体、续接到同平台同 URL 的历史条目。
3. SW 站点兜底：对 sniffer 抓不到的站点（控制台"连续 3 次为空"告警），确认 poller 仍按 DOM 稳定性判定落库，不丢回复。
4. 多轮续接：同一 webview 连续手动聊天两次（URL 不变），确认两条 turn 续接到同一条历史；切换对话（URL 变）后确认新建条目。

- [ ] **Step 6: 提交改动（需用户确认后再执行）**

> 项目规则：commit 仅当用户要求时进行；且应在 Task 1–4 全部完成后执行。

```bash
git add src/renderer/src/config/selectors.ts src/renderer/src/utils/webviewScripts.ts src/renderer/src/components/WebviewCard.tsx src/renderer/src/store/appStore.ts
git commit -m "feat(webview): 正则匹配+语义化兜底+跨步菜单兜底+非DOM网络抓取+事件驱动自动保存"
```

---

## 验证与后置追踪 (Verification & Follow-up)

- **验证命令**：`npm run lint && npm run build` 确保无编译和类型错误。
- **经验沉淀**：任务完成后，依据项目规则运行 `python .memory/session_log.py --done "实现Webview强韧性自动化改造" --modified src/renderer/src/config/selectors.ts src/renderer/src/utils/webviewScripts.ts src/renderer/src/components/WebviewCard.tsx src/renderer/src/store/appStore.ts` 记录日志。

---

## 附录：非 DOM 触发方式调研记录（已评估，本轮暂不采用）

> 调研目的：回答"自动化触发 webview 某个功能是否只能靠 DOM"。结论：**不是**。下表按对改版韧性排序，记录各替代方案与本轮决策。核验来源：Electron 官方文档（`webContents.executeJavaScript` / `debugger` / `webContents.sendInputEvent`）+ CDP 通用知识（context7 本 session 配额异常不可用，改用官方文档）。

| 方案 | 机制 | 对菜单改版韧性 | isTrusted | 代价/限制 | 本轮决策 |
|---|---|---|---|---|---|
| **A. 网络请求改写** | 在策略三的 fetch patch 里拦截**出站**对话请求，改写 body 注入 deep-research 标志字段，根本不点菜单 | ★★★★★ 完全绕过 UI | 不涉及 | 各平台字段名/取值不一且会变；部分后端校验前端状态；WS 流不经过 fetch 则抓不到；属逆向私有 API、需评估 TOS | 暂不采用（用户选定 DOM 强化） |
| **B. CDP `Input.dispatchMouseEvent/Key`** | 主进程 `webContents.debugger.attach` + CDP Input 域在像素坐标真实点击 | ★★ 仍需先 DOM 定位元素坐标，开菜单按钮改版时同样找不到 | true（Playwright/Puppeteer 即用此机制；Electron 官方文档未显式声明） | 不需窗口聚焦，适合后台多 webview 并发；但要新增主进程 IPC；DevTools 打开会踢掉 debugger | 暂不采用（用户选定；列为后续 isTrusted 失败案例的升级选项） |
| **C. `webContents.sendInputEvent`** | Electron 28 原生输入注入 API（未弃用） | ★★ 同上 | 文档未保证，行为不定 | **需窗口聚焦**——MultiChat 多 webview 并行发送时只有聚焦的那个生效，不适合本场景 | 不采用 |
| **D. JS `el.click()`/`dispatchEvent`**（现状） | DOM 查询 + 合成事件 | ★ 最脆 | false | 现状；多数 React 组件能接受，但 `isTrusted` 鉴权的组件失效 | **本轮保留并强化**（策略二） |
| **E. 键盘快捷键 / URL 深链** | 平台快捷键或 `?mode=` 深链 | 因平台而异 | true | deep research 普遍无快捷键；深链极少支持 | 不采用 |

**结论与触发条件**：本轮按用户决策只做 DOM 强化（方案 D 的强化版）。若未来出现 (1) 某平台菜单结构反复改版、DOM 路线维护成本过高，或 (2) 遇到 `isTrusted` 鉴权导致 `el.click()` 失效的组件——再分别评估方案 A（网络改写，需先逆向该平台请求字段并评估 TOS）与方案 B（CDP 真实输入，需新增主进程 debugger IPC）。两条路径的接入点已在本方案中预留：方案 A 复用策略三的 `getNetworkSnifferScript` 中的 fetch patch（只需增加出站 body 改写分支）；方案 B 复用 `WebviewCard` 已有的 `getWebContentsId()`（`WebviewCard.tsx:457`）即可在主进程 attach debugger。
