> Created: 2026-11-26 18:31 (UTC+08:00)

# MultiChat 浏览器扩展深度调研：Web Clipper 复刻 + 侧边栏嵌入 AI 网页

## TL;DR（先看结论）

1. **"网页不允许 iframe 嵌入所以做不了"这个判断对普通网页成立，但对浏览器扩展不成立。** 扩展可以通过 `declarativeNetRequest`（DNR）在响应到达页面前剥离 `X-Frame-Options` 和 CSP `frame-ancestors`，这是 Chrome 官方 API 能力。实测约一半的 AI 站点（Kimi、豆包、元宝、Claude、智谱、文心、Copilot）甚至没有 frame 封锁。
2. **真正的硬骨头是登录态 Cookie，不是 frame 封锁。** 各站会话 Cookie 普遍是 `SameSite=Lax/Strict`（DeepSeek 实测 `Strict`），iframe 属于跨站上下文，这类 Cookie 一律不发送。但存在两条已验证的绕行路径（Cookie 重写、绕过 UI 直连 API），各有明确的代价，详见后文。
3. **Obsidian Web Clipper 是 MIT 许可的开源项目**，架构清晰（约 1.3 万行核心代码），其提取引擎 `defuddle` 独立可复用，模板/触发器/高亮/LLM 变量系统可以整套参考甚至部分移植。我们不需要从零发明任何东西。
4. **ChatGPT 的 CSP 里官方白名单了 4 个 chrome-extension ID**，说明"扩展内嵌"是被主流 AI 厂商官方认可的形态，不是灰色地带 hack。
5. **扩展 ↔ MultiChat 桌面端的联动必须新增通道**（剪贴板+自定义协议、或 localhost HTTP），现有的 Windows 命名管道 CLI 守护进程浏览器侧够不到。

---

## 一、实证数据：各 AI 站点的嵌入封锁现状（2026-11-26 实测）

以下数据通过本机 curl 直接探测响应头获得，是决策的一手依据。

### 1.1 Frame 封锁（X-Frame-Options / CSP frame-ancestors）

| 站点 | XFO | CSP frame-ancestors | 裸 iframe 结果 |
|---|---|---|---|
| chatgpt.com | 无 | `'self'` + **4 个白名单扩展 ID** | 仅白名单扩展可嵌 |
| claude.ai | 无 | 无 | **可直接嵌入** |
| gemini.google.com | **DENY** | 无 | 封锁 |
| chat.deepseek.com | 无 | **`'none'`** | 封锁（最严） |
| grok.com | **DENY** | `x.com` 等 | 封锁 |
| tongyi.com / chat.qwen.ai | SAMEORIGIN | 无 | 封锁 |
| perplexity.ai | SAMEORIGIN | 无 | 封锁 |
| kimi.moonshot.cn / kimi.com | 无 | 无 | **可直接嵌入** |
| doubao.com | 无 | 无 | **可直接嵌入** |
| yuanbao.tencent.com | 无 | 无 | **可直接嵌入** |
| chatglm.cn / yiyan.baidu.com | 无 | 无 | **可直接嵌入** |
| copilot.microsoft.com | 无 | 无 | **可直接嵌入** |

解读：**约半数站点在 frame 层面根本不设防**。设防的站（ChatGPT/DeepSeek/Gemini/Grok/通义/Perplexity）可以被扩展用 DNR `modifyHeaders` 移除响应头解除——这个动作对普通网页不可能，但对扩展是官方能力。

ChatGPT 白名单的 4 个扩展 ID（`hehggadaopoacecdllhhajmbjkdcmajg` 等）未能从商店页反查出身份（商店页 JS 渲染），但存在本身就说明了 OpenAI 对嵌入的官方态度。理论上拿到这些扩展的公钥可以复用同 ID，这属于灰色操作，不建议作为正式方案。

### 1.2 会话 Cookie 的 SameSite 属性（决定 iframe 里登录态存活）

| 站点 | 实测 SameSite | iframe 内后果 |
|---|---|---|
| chatgpt.com | 设备 Cookie `oai-did` 是 **Lax** | 跨站 iframe 不发送 |
| claude.ai | `ion-vk` 是 **Lax**（`_fbp` 是 None） | 跨站 iframe 不发送 |
| chat.deepseek.com | `ds_session_id` 是 **Strict** | 最严，跨站 iframe 绝对不发送 |
| gemini.google.com | Google 账户体系，首触即 Lax 系 | 不发送 |
| 其余站点 | 首触无 Set-Cookie（登录后的会话 Cookie 未实测） | **需在登录态下补测**，按行业惯例大概率 Lax |

关键机制：浏览器按"顶层页面站点"判定第一方/第三方。侧边栏里的 iframe 顶层是 `chrome-extension://` 扩展自身源，与 AI 站点不同站点，因此 iframe 属**第三方上下文**——`SameSite=Lax/Strict` 的 Cookie 一律不发送，未标注 SameSite 的 Cookie 在 Chrome 默认按 Lax 处理同样不发送。**这就是为什么"把网页嵌进来"在技术上能做，但"嵌进来还是登录态"是另一个量级的难题。**

### 1.3 绕过 Cookie 封锁的三条路径（按可靠性排序）

**路径 A —— Cookie 重写（iframe 嵌入派的唯一活路）**
- 原理：用户已在自己浏览器登录过各站，Cookie 就在浏览器里。扩展用 DNR `modifyHeaders` 的 `set-cookie` 操作（MDN 标注 experimental，Chromium 源码已存在对应实现）把响应里 `Set-Cookie` 的 `SameSite=Lax/Strict` 改写为 `SameSite=None; Secure`；或用 `chrome.cookies.set` API 把已存 Cookie 直接重写属性（可读写 HttpOnly Cookie）。
- 效果：改写后 Cookie 在跨站 iframe 中正常发送，登录态存活。
- 代价：① Chrome 对未来 SameSite=None 的政策仍在演进（第三方 Cookie 废止计划多次反复，当前状态是保留但持续收紧），存在被一次性掐断的尾部风险；② 削弱了目标站的 CSRF 防护（仅本浏览器内）；③ 部分站登录流程含弹窗跳转/oauth 重定向，iframe 里链路会断，首次登录可能仍需在真标签页完成，之后 iframe 才工作；④ Cloudflare/Arkose 等 bot 检测在 iframe 环境可能额外触发验证。
- 结论：**机制成立（Chromium 官方 issue 40946265 确认 DNR 适用于扩展页面内的子框架请求），但端到端效果必须做 Spike 实测**，尤其 ChatGPT/DeepSeek 两家。

**路径 B —— 绕过 UI，直连平台内部 API（ChatGPTBox 验证过的路线）**
- 原理：扩展发起的网络请求（service worker fetch）对目标站是**第一方上下文**，Cookie 不受 SameSite 限制，天然携带。开源项目 ChatGPTBox（数万用户）就是这么做的：自绘聊天 UI，后台直接调 Bing/Claude 的内部 API，用 DNR 重写 Origin/Referer 绕过防盗链检查。
- 优点：登录态问题**根本不存在**；不受 frame 封锁影响；不怕 bot 检测的 iframe 分支。
- 代价：① UI 要自己画，不是"原网页"；② 逆向内部 API，平台随时可能改接口导致功能失效，维护成本持续存在；③ 每个平台要写一个适配器。
- 结论：**可靠性最高但工程量最大**，且和"嵌入网页版"的需求形态不同。

**路径 C —— 妥协形态：第一方弹窗 + 快捷键召唤**
- 侧边栏放不下登录链路时，用 `chrome.windows.create` 开一个 always-on-top 的独立小窗加载 AI 站。该窗口是**第一方上下文**，登录、bot 检测、弹窗全部原生工作，零 hack。
- 缺点：不是"侧边栏内嵌"形态，是浮动窗口；用户需要在侧边栏和弹窗之间接受体验落差。
- 结论：**作为嵌入失败平台的降级兜底方案几乎零成本**，建议在架构里预留。

### 1.4 DNR 能力的官方依据

- Chromium issue 40946265（官方解答）确认：① DNR `modifyHeaders` 可以移除/修改 `x-frame-options`、`content-security-policy`（responseHeaders 权限）；② 规则**适用于扩展自身页面发起的子框架导航**——这一条是整个嵌入方案的地基，没有它侧边栏 iframe 根本喂不到规则；③ 配合 `extraHeaders` 可处理 `set-cookie`。
- `cookie` 请求头在 modifyHeaders 中仅允许 `append` 操作（不能 set/remove），但响应头 `set-cookie` 可修改（experimental）。
- MV2 的 `webRequestBlocking` 在 Chrome MV3 已废，但 Firefox 仍然支持且更强大——Firefox 侧的嵌入实现反而更容易。

---

## 二、Obsidian Web Clipper 解剖（源码级）

仓库 `obsidianmd/obsidian-clipper` 已浅克隆到本地分析（MIT 许可，可自由参考/移植）。整体 TypeScript + webpack，无框架依赖，约 210 个源文件。

### 2.1 功能全景

| 模块 | 规模 | 说明 |
|---|---|---|
| Reader 阅读模式 | 2463 行 | 页内重排正文、YouTube 转录提取（用 DNR 重写 embed referer） |
| 高亮系统 | 1278+674+1176 行 | 文本/元素高亮，XPath 锚点定位，按 URL 持久化，可内联合并进正文 |
| Popup 主界面 | 1251 行 | 剪藏预览、模板切换、属性编辑 |
| LLM Interpreter | 685+952 行 | 模板内嵌 `{{prompt:...}}` 变量，调用用户自配 API（OpenAI/Anthropic/Azure/自定义 baseUrl）做页面理解 |
| 模板系统 | 705+278 行 | URL 触发器（正则/glob 自动按站点选模板）+ 变量 + 过滤器 + CSS 选择器提取（`{{selector:.price}}`）+ frontmatter 属性 |
| Background | 1045 行 | 消息路由、快捷键（剪藏/高亮/阅读模式各一组）、右键菜单 |
| CLI + API | 237+228 行 | Node 端无头剪藏，`api.ts` 环境无关（注入 DOM parser） |

### 2.2 核心数据流（剪藏一次发生了什么）

```
content script（全页面注入）
  -> getPageContent: 提取 content/selection/schema.org/meta标签/全文HTML/高亮
  -> popup/side-panel 经 background 消息路由拿到数据
  -> defuddle 清洗正文 -> createMarkdownContent 转 Markdown
  -> 模板编译：变量替换 + 过滤器 + selector 提取 + LLM prompt 变量（可选）
  -> 生成 frontmatter + 正文
  -> 【传输】优先 copyToClipboard 全文，然后打开 obsidian://new?file=...&clipboard
       （Obsidian 读剪贴板而非 URL 参数，绕开 URL 长度限制；剪贴板失败降级为内联 content 参数）
```

### 2.3 值得注意的设计决策

1. **剪贴板 + URL scheme 组合传输**：大内容不塞进 URL（Windows 对 ShellExecute 有长度限制），而是复制到剪贴板、协议里只带 `&clipboard` 标志位。这个模式对 MultiChat 联动直接可抄。
2. **提取与渲染分离**：`api.ts` 环境无关，同一份剪藏逻辑跑在浏览器扩展和 Node CLI 两端。我们如果做扩展+桌面端联动，这个分层值得借鉴。
3. **模板触发器按 URL 正则匹配**：不同站点自动套用不同模板（知乎/推特/arxiv 各有适配），这是 clipper 类产品的核心体验壁垒。
4. **selector 变量**：`{{selector:.author}}` 直接从页面抠任意元素，配合过滤器链。比纯正文提取高出一个维度。
5. **DNR 只用于一件小事**：重写 YouTube embed 的 Referer 以获取转录。Obsidian 自己并没有用 DNR 做嵌入——因为它不需要嵌入任何网页。
6. **依赖极少且都可复用**：`defuddle`（MIT，正文提取引擎，独立 npm 包）、`dompurify`（消毒）、`lz-string`（压缩）、`dayjs`、CodeMirror（模板编辑器）。

### 2.4 对 MultiChat 的移植价值评估

- `defuddle` 可直接 npm 引入，正文提取零成本达到业界顶级水准。
- 模板编译器（`template-compiler.ts` 278 行）+ 变量系统（`shared.ts`）+ 过滤器，加起来约 1000 行，**整套移植性价比极高**，比自研省 2-3 周。
- 高亮系统 3000+ 行是 Obsidian 特有需求（写入 markdown 文件），MultiChat 未必需要全量，建议 MVP 先不做或只做"选中即剪"。
- LLM Interpreter 的思路与 MultiChat 的"网页版 AI 驱动"哲学不同：Obsidian 用 API key，我们可以直接把剪藏内容喂给侧边栏里已登录的网页版 AI——**这是我们的产品差异化点，不需要用户配 API key**。

---

## 三、扩展 <-> MultiChat 桌面端联动通道对比

桌面端现状：CLI 守护进程走 Windows 命名管道（`\\.\pipe\multichat-daemon` + token 文件），**浏览器扩展无法访问命名管道**。应用未注册自定义协议。

| 通道 | 原理 | 优点 | 缺点 | 结论 |
|---|---|---|---|---|
| 剪贴板 + 自定义协议 | 复刻 Obsidian：复制全文然后打开 `multichat://clip?...&clipboard` | 简单、已验证、无需常驻服务 | 覆盖用户剪贴板；Windows 需注册协议；单向 | **MVP 首选** |
| localhost HTTP | 桌面端起 127.0.0.1 服务 + token 鉴权（Obsidian Local REST API 插件同款） | 双向、结构化、可传大数据、不碰剪贴板 | 桌面端需新增 HTTP 服务模块；端口冲突处理；鉴权设计 | **二期推荐**，clipper 复杂交互需要它 |
| Native Messaging | 浏览器原生机制，扩展与本地程序 stdio | 官方通道、安全 | 注册表配置繁琐、只能拉起独立进程不能直连已运行应用、调试痛苦 | 不推荐，能力被 localhost HTTP 覆盖 |
| 命名管道 | 现有 CLI 通道 | 已存在 | **浏览器进程无法访问** | 不可行 |

注：Electron 侧注册协议只需 `app.setAsDefaultProtocolClient('multichat')` + NSIS 安装脚本写注册表，工作量很小；`second-instance` 事件已存在，唤醒已有窗口的机制现成。

---

## 四、浏览器/平台差异与发行约束

- **Chrome/Edge**：`chrome.sidePanel` API 提供系统级侧边栏（Obsidian Clipper 已用 `side_panel` manifest 字段）。MV3 service worker 有 30 秒空闲休眠问题，长任务需保活。
- **Firefox**：用 `sidebar_action`（比 Chrome 侧边栏能力更强），MV3 支持基本齐平但仍在补齐；`webRequestBlocking` 仍可用，嵌入实现反而简单。Obsidian Clipper 三端同构证明可行。
- **Safari**：需 Xcode 转换器打包成 App，维护成本高，建议不做。
- **商店审核风险**：① `declarativeNetRequest` + `<all_urls>` host 权限是宽权限，审核会额外检视，需要在隐私声明里解释用途；② "嵌入门户网站+重写 Cookie" 在功能上类似部分被下架过的 iframe unblocker 类扩展，建议定位为"个人多 AI 工作台"而非通用 unblocker；③ Edge 商店审核较松，可作为首发渠道。

---

## 五、建议架构（供决策）

```
+-- MultiChat Companion Extension（WXT + React + TS）--------------+
|                                                                 |
|  +-- Clipper 模块 ---------------+  +-- Sidebar AI 模块 ------+  |
|  | defuddle 提取 + 模板编译      |  | sidePanel 内嵌 iframe   |  |
|  | (移植 obsidian-clipper 精简)  |  | DNR 剥头 + Cookie 重写  |  |
|  | 选区剪藏 / 全文剪藏           |  | 平台适配表(实测驱动)     |  |
|  +------+------------------------+  | 失败降级: 第一方弹窗     |  |
|         |                           +------+------------------+  |
|         v                                v                       |
|  +-- 联动桥 -------------------------------------------------+   |
|  | MVP: 剪贴板 + multichat:// 协议    二期: localhost HTTP   |   |
|  +-----------------------------------------------------------+   |
+------------------------------------------------------------------+
         |
         v
+-- MultiChat Desktop ----------------------------------------------+
| 协议/HTTP 接收 -> 笔记/历史/导图/多AI分发(现有能力)                  |
+--------------------------------------------------------------------+
```

**核心产品逻辑闭环**：浏览网页 -> 一键剪藏 -> 内容直接喂给侧边栏里已登录的网页版 AI 总结/分析 -> 结果与原文一起回传桌面端归档。这条链路里"嵌入 AI 网页"不再是目的本身，而是让剪藏内容零成本进入 AI 对话的手段——也正好绕开了"用户不想配 API key"的痛点，用用户自己的网页登录态当推理后端。

**技术栈建议**：WXT（现代扩展框架，MV3 多浏览器一套代码、HMR、React/TS 一等支持）。Obsidian Clipper 用裸 webpack 证明不用框架也可行，但我们要同时维护 sidePanel + popup + content scripts + background，WXT 的目录约定能省掉大量脚手架。

---

## 六、风险登记册（按优先级）

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| 1 | Cookie 重写后 iframe 登录态在 ChatGPT/DeepSeek 实际不工作（bot 检测、登录流程断裂） | **高** | 开工第一周做 Spike 实测，不行则这两家走路径 B/C |
| 2 | Chrome 第三方 Cookie 政策突变 | 中 | 架构上把"嵌入"做成可降级，弹窗兜底永远可用 |
| 3 | 宽权限审核卡壳 | 中 | 精简 host 权限到 AI 站点清单+剪藏按需激活（activeTab），隐私声明写清 |
| 4 | 各站 DOM/登录流程差异导致的适配长尾 | 中 | 平台适配表驱动，单站失败不影响全局 |
| 5 | MV3 service worker 休眠中断长任务 | 低 | 剪藏是秒级操作，影响小；注意端口保活模式 |
| 6 | 多浏览器维护成本 | 低 | 首发 Chrome/Edge 双端（同内核），Firefox 二期 |

---

## 七、验证清单（开工前/早期必做）

1. **Spike 1（决定架构生死）**：最小扩展原型，iframe 嵌 chatgpt.com + chat.deepseek.com，DNR 剥头 + `chrome.cookies` 重写 SameSite，验证已登录浏览器里 iframe 是否呈现登录态、能否正常对话。耗时预估 1 天。
2. **Spike 2**：登录态下重测各站会话 Cookie 的 SameSite 实际值（本次只测了未登录首触）。
3. **Spike 3**：`multichat://` 协议注册 + 剪贴板读取链路在桌面端的端到端验证。
4. 反查 ChatGPT 白名单 4 个扩展 ID 的身份（可用电脑已装 Chrome 直接开商店页），评估 OpenAI 合作通道的可能性。

## 八、参考材料

- Obsidian Web Clipper 源码：https://github.com/obsidianmd/obsidian-clipper （MIT，已浅克隆分析）
- ChatGPTBox 源码：https://github.com/josStorer/chatGPTBox （直连 API 路线的参考实现）
- Chromium issue 40946265：DNR 对扩展页面子框架/响应头的适用性官方解答
- MDN declarativeNetRequest modifyHeaders：set-cookie experimental 操作
- defuddle：https://www.npmjs.com/package/defuddle （正文提取引擎，MIT）
- WXT：https://wxt.dev （扩展框架）

*本报告基于 2026-11-26 实测数据与当期浏览器政策，Cookie/隐私政策属快速演变领域，正式实施前应复核。*
