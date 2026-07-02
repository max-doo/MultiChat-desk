> Created: 2026-07-02 20:27 (CST, UTC+8)

# messageContainer 选择器诊断面板设计

> **Status:** Draft — awaiting review
> **Relation:** 本设计是 `2026-06-28-auto-selector-discovery-design.md` 的轻量子集与即时验证器。那份是 Playwright CDP + 全量 DOM 探索 + 候选生成的深度管线（Phase 1/2 路线图）；本设计聚焦 `messageContainer` 一个字段，纯 Electron 内建、即时体检，复用那份确立的脱敏原则与选择器稳定性优先级表。

## 1. 问题陈述

`src/shared/config/selectors.ts`（version 13，14 平台）中每个平台的 `messageContainer: string[]` 是抓取 AI 回复正文的核心选择器。AI 平台频繁改版导致这些选择器持续失效，但当前没有快速手段判断**哪个平台、哪个候选**还活着，只能等用户反馈"抓不到内容"再被动排查，效率低。

**目标**：构建一个**仅开发态**的集中诊断面板，2 秒内报告每个平台每个 `messageContainer` 候选在真实页面上的命中情况，并给出脱敏的元素指纹，让失效选择器的修复从"猜测"变成"读表"。

## 2. 非目标

- 不自动生成 / 自动合并选择器（仍由人工审核，深度生成留给 auto-selector-discovery spec）
- 不覆盖 `textarea` / `sendButton` / `researchMode` 等其他字段（本设计仅 `messageContainer`）
- 不引入新生产依赖
- 不修改 `selectors.ts` 数据结构、不修改 `webviewScripts.ts` 生产匹配逻辑
- 不持久化诊断状态（开发态功能，不入 store 长期字段）
- 不进 production build（`import.meta.env.DEV` 门控）

## 3. 架构

纯渲染层方案，复用两个**已存在**的 seam：

1. **`useAppStore.webviewRefs.get(id)`**（`appStore.ts:276`）—— 集中面板按平台 id 取 webview ref，无需新建 ref 通道
2. **`webview.executeJavaScript(code)`**（`WebviewCard.tsx` 已有 ~10 处此模式）—— 在平台页内跑探针

不碰主进程 / preload / IPC 契约。

### 数据流

```
[顶栏 🔬 按钮] → 打开集中面板（SelectorDiagnosticsPanel）
  → 面板遍历 14 平台，从 store 取 webviewRefs.get(id)
  → 对平台 X：ref.probeMessageContainer()
     → WebviewCard.executeJavaScript(buildProbeScript(selectors.messageContainer))
     → 探针在 X 的真实页面内执行（复刻 safeQueryAll + isVisible）
     → 返回脱敏报告 JSON
  → 面板渲染候选表格 + 状态徽标
  → 失效的去 selectors.ts 改 → bump version → 重启 → 再点诊断确认
```

## 4. 组件拆分

### 4.1 单元 1 — 探针逻辑（纯函数）

新文件 `src/renderer/src/utils/selectorDiagnostics.ts`

- `buildProbeScript(selectors: string[]): string` —— 把候选选择器数组序列化成一段**在平台页内执行**的 JS 字符串。该脚本**复刻** `webviewScripts.ts` 的匹配逻辑：
  - `safeQueryAll(root, selector)`（来源 `webviewScripts.ts:1512`）：querySelectorAll + try/catch
  - shadow root 兜底（来源 `webviewScripts.ts:1524-1538`）：document 层无命中时遍历 shadowRoot
  - 去重（来源 `webviewScripts.ts:1545-1551`）：Set 去重
  - `isVisible(element)`（来源 `webviewScripts.ts:1553`）：isConnected + getClientRects + rect 宽高
  - **铁律**：探针的这四个函数实现必须与 `webviewScripts.ts` 同源（直接拷贝同一份实现，注释注明来源行号），否则"探针命中"≠"生产命中"，方法论失效。
- 对每个候选返回：
  ```typescript
  interface CandidateReport {
    selector: string
    hitCount: number              // querySelectorAll 总命中数
    visibleHitCount: number       // 经 isVisible 过滤后的可见命中数
    firstHit: {
      tag: string                 // tagName 小写
      className: string | null    // el.className（已是空格分隔字符串）
      id: string | null
      dataTestid: string | null   // el.getAttribute('data-testid')
      visibleTextLen: number      // 该元素可见 innerText 长度（脱敏：仅长度，不含正文）
    } | null
    error?: string                // 非法选择器等异常
  }
  ```
- **严格脱敏**（与 auto-selector-discovery spec §4.4 / §5.4 一致）：
  - `firstHit` 只保留 `tagName` + `className` + `id` + `data-testid` + 可见正文**长度**
  - **不包含** `outerHTML` 原文、正文文本内容、其他属性值（避免泄露模型输出 / 用户输入 / token）
- `parseProbeResult(raw: unknown): ProbeReport` —— 反序列化 + 结构校验，异常兜底返回 `error: "结果解析失败"`

### 4.2 单元 2 — `WebviewCardRef` 新增方法

`src/renderer/src/components/WebviewCard.tsx`

- `WebviewCardRef` 接口（`:110`）新增：
  ```typescript
  probeMessageContainer: () => Promise<ProbeReport>
  ```
- `useImperativeHandle`（`:456`）内实现：
  ```typescript
  probeMessageContainer: async () => {
    const webview = webviewRef.current
    if (!webview) throw new Error('webview 未就绪')
    const selectorsList = selectors?.messageContainer ?? []
    const raw = await webview.executeJavaScript(buildProbeScript(selectorsList))
    return parseProbeResult(raw)
  }
  ```
- 沿用第 479 行等既有 `executeJavaScript` 模式，无新模式

### 4.3 单元 3 — 集中 Dev 面板

新文件 `src/renderer/src/components/SelectorDiagnosticsPanel.tsx`

- 抽屉形态（沿用 `SettingsDrawer` 模式），**仅 `import.meta.env.DEV` 下渲染**
- 顶部：标题 + "全部诊断"按钮（并发跑所有已加载平台）+ "说明"折叠区（嵌方法论文档要点）
- 主体：14 平台列表，每行：
  - 平台名 + logo
  - 状态徽标：
    - ✅ 全部命中（首位候选 visibleHitCount>0 且 visibleTextLen>0）
    - ⚠️ 部分命中空文本（有 visibleHitCount>0 但 visibleTextLen=0，即命中了空 / 占位元素）
    - ❌ 全失效（所有候选 visibleHitCount=0）
    - ⚫ 未加载（store 中无该 ref，平台不在当前窗口阵容）
    - ⏳ 诊断中
  - "诊断"按钮（未加载时禁用）
  - 展开后显示候选表格：选择器 → hitCount → visibleHitCount → visibleTextLen → firstHit 指纹（tag.className#id [data-testid]）
- className / data-testid 单元格可点击复制为新选择器候选

### 4.4 单元 4 — 面板入口

`src/renderer/src/components/Layout.tsx`

- `import.meta.env.DEV` 下在顶栏加"🔬 选择器诊断"按钮（挨着设置入口）
- `const [isDiagnosticsOpen, setDiagnosticsOpen] = useState(false)`（本地状态，不进 store）
- 挂载 `<SelectorDiagnosticsPanel open={isDiagnosticsOpen} onClose={...} />`

## 5. 错误处理

| 场景 | 处理 |
|---|---|
| 单个选择器非法 | `safeQueryAll` try/catch，该候选报 `error: "invalid selector"`，不拖垮整次探针 |
| ref 取不到（平台未加载） | 该行显示 ⚫，诊断按钮禁用 |
| `executeJavaScript` reject（页面未就绪 / 跨域） | 该行显示 ⚠️ + "页面未就绪，请先在该窗口触发一次 AI 回复后再诊断" |
| 探针返回结构异常 | `parseProbeResult` 兜底返回 `error: "结果解析失败"` |
| 平台页处于流式输出中 | 报告反映当前帧，visibleTextLen 会持续增长；建议流完再诊断 |

## 6. 测试（遵循项目规则，无测试运行器）

`npm run lint` → `npm run build` → `npm run dev` 手动：

1. dev 下顶栏出现 🔬 按钮；`npm run build` 产物中**不**出现该按钮（验证 DEV 门控）
2. 打开 ChatGPT 卡片，发一条 prompt，等回复流完
3. 打开面板 → 点 ChatGPT 诊断 → 表格列出真实回复元素，首位候选 visibleHitCount>0 且 visibleTextLen>0，状态 ✅
4. 报告里 firstHit **无** outerHTML 原文 / **无** 回复正文文本，仅长度（验证脱敏）
5. 未加载平台显示 ⚫ 且诊断按钮禁用
6. 故意把某平台 messageContainer 改成非法选择器 → 诊断该候选报 error，整次探针不崩

## 7. 方法论文档

新增 `docs/选择器维护方法论.md`，固化可复用闭环：

1. 开 dev，打开平台 X，发一条一次性 prompt，等回复流完
2. 点 🔬 → 读表
3. 若首位候选 visibleHitCount>0 但 visibleTextLen=0 → 命中了空 / 占位元素，重排或删除
4. 若全部候选 visibleHitCount=0 → 用 firstHit 指纹或手动 DevTools 检查近邻，撰写新选择器；**优先稳定信号**（`data-testid` > `aria-label` > `role` > 语义类名片段 > 结构），避开哈希类名（参考 auto-selector-discovery spec §4.3）
5. 粘进 `selectors.ts`，bump `version`，重启，再点诊断确认 visibleTextLen>0
6. 每平台重复。探针让第 2 步变 2 秒检查

并把"探针逻辑必须与 webviewScripts.ts 同源"作为第一条铁律写入。

## 8. 示范（1–2 个平台）

建完后，在 `npm run dev` 对 **ChatGPT** + **Kimi**（一海外一国内）走通闭环，抓面板输出；**若其中一个确实失效，当场修掉**作为完整示例。

## 9. 改动文件清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/renderer/src/utils/selectorDiagnostics.ts` | 新增 | 探针构建/解析（纯函数） |
| `src/renderer/src/components/SelectorDiagnosticsPanel.tsx` | 新增 | 集中 Dev 面板 |
| `src/renderer/src/components/WebviewCard.tsx` | 小改 | `WebviewCardRef` 加 `probeMessageContainer` |
| `src/renderer/src/components/Layout.tsx` | 小改 | 顶栏 dev 入口 + 抽屉挂载 |
| `docs/选择器维护方法论.md` | 新增 | 方法论文档 |

**不改动**：`src/shared/config/selectors.ts`（数据，示范修复时才动）、`src/shared/utils/webviewScripts.ts`（生产逻辑，仅作探针同源参考）、主进程、preload、IPC。

## 10. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 探针逻辑与生产逻辑漂移 | 诊断结果不可信 | 铁律：四个函数同源拷贝 + 注释行号；后续 webviewScripts.ts 改动需同步探针 |
| DEV 门控遗漏导致进生产包 | 用户看到诊断按钮 | `import.meta.env.DEV` 门控 + build 产物抽查（测试步骤 1） |
| 脱敏不彻底泄露回复内容 | 违反 AGENTS.md 安全约束 | 严格脱敏：仅元数据 + 长度，不含正文 / outerHTML |
| 流式输出中诊断 | visibleTextLen 不稳定 | 文档提示流完再诊断；非错误 |

## 11. 成功标准

- [ ] dev 下 2 秒内得到单平台诊断报告
- [ ] 报告严格脱敏，无正文 / outerHTML 泄露
- [ ] 探针四函数与 `webviewScripts.ts` 同源（注释行号可追溯）
- [ ] production build 不含诊断入口
- [ ] ChatGPT + Kimi 示范走通，失效者当场修复
- [ ] 方法论文档落盘
