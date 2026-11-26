# MultiChat CLI 生图能力与结果落盘方案（PRD + 技术设计）

> Created: 2026-11-18 00:22 (Asia/Shanghai, UTC+08:00)

关联文档：[agent-cli-dev-plan.md](agent-cli-dev-plan.md)（CLI 任务链路总设计）、[../selectors/image-download-dom/README.md](../selectors/image-download-dom/README.md)（各平台生图下载 DOM 调研，已完成 8 平台适配）。

---

## 第一部分：产品需求（PRD）

### 1. 背景与问题陈述

MultiChat 的 Agent CLI（`multichat task submit/status/result`）已能让本地 Agent 驱动桌面应用的网页 AI 会话完成文本问答与深度研究，回复以 JSON 内嵌 `reply` 字段返回。当前存在两个缺口：

- **无法驱动生图**：应用 UI 已支持各平台"AI 生图"模式（`selectors.imageGeneration.steps`）与原生图片下载链路（`imageDownload.steps` + `will-download` 拦截落盘），但后台 Agent 任务链路完全没有接入，CLI 调用方拿不到图片产物。
- **结果不落盘**：任务完成后 `reply` 只存在于进程内存与 `agent-tasks/*.json` 持久化记录中，Agent 需要自行把 stdout JSON 里的 `reply` 写成本地文件才能被其他工具消费；图片等二进制产物更是无处安放。

**目标**：CLI 支持声明"这次任务要生成图片"，daemon 侧完成"开启生图模式 → 提交 prompt → 等图片稳定 → 触发平台原生下载 → 落盘到固定目录"；同时每次 `task submit` 的最终回复自动写成 TXT 文档，CLI 响应同时输出内容与文件路径。

### 2. 目标与非目标

**目标（一期）**

1. `multichat task submit` 新增 `--gen-image` 开关：直接以普通消息发送生图提示词（**不点平台"生图模式"入口**——入口 steps 在 headless 下不通用且多数平台凭 prompt 即可出图），生成完成后把图片保存到 `<artifact-dir>/image/`（默认 `<cwd>/.multichat`，便携版回退 `<app>/data/.multichat/image/`）。
2. 每次 `task submit` 任务的最终文本回复自动保存为 TXT 到 `<artifact-dir>/results/`（默认 `<cwd>/.multichat`），一任务一文件。
3. `task.status`/`task.result`/submit `--wait` 的完成响应中携带落盘产物路径（`replyFile`、`imageFiles`），Agent 可直接读取，无需再发请求。
4. `--text` 模式下终端打印正文与产物路径；`--json`（默认）在 `data` 中输出结构化路径。
5. `platforms` 能力列表暴露 `imageGeneration`/`imageDownload` 两个布尔标记，让 Agent 先探测再决定是否使用 `--gen-image`。
6. Skill（`.agents/skills/multichat-cli`）同步更新，教 Agent 使用新参数与产物路径。

**非目标（一期）**

- **生图任务的多次产出合批**：平台一次生图可能产出 1-4 张图变体，`imageDownload.steps` 点击"最新一张"的下载按钮；一期只抓最新一张（与 UI 单点下载一致）。多图合批依赖后续给 `imageDownload` 增加"全部下载"能力。
- **`extractImages` 兜底抓取**：`generateExtractImagesScript` 抓取 blob/canvas/data-url 的兜底路径在 UI 侧保留，一期后台不启用（拿到的是压缩图/截图质量差，且 PNG 大 payload 经 executeJavaScript 返回值传输成本高）。
- **生图任务的取消图片清理**：任务终态后已落盘的图片不随 `task cancel` 删除（落盘即产物）。
- **`exec`/`collect` 旧命令改造**：`multichat exec` 同步走 `AutomationService.executeCommand`，不支持生图；一期不动。
- **TXT 内容的 Markdown→纯文本转换**：一期 TXT 直接写 Markdown 原文（`.txt` 后缀，内容为 Markdown）。

### 3. 用户与使用场景

调用方为本地 Agent（Codex、Claude Code 等）与脚本。典型场景：

| 场景 | 命令 |
|---|---|
| 让 Gemini 生成配图并落盘 | `task submit --platform gemini --gen-image --query "为这段文字生成配图：..."` → 等待 → 读 `imageFiles[0]` |
| 批量海报/图标素材 | 同平台串行多次 submit，每次拿 `imageFiles` |
| 设计评审（带截图） | 已有 `--image` 附件 + `replyFile` 落盘供归档 |
| 深研报告落盘 | `--research` + `replyFile` 自动保存 |

### 4. 功能需求

#### FR-1 `--gen-image` 任务模式

`task submit` 新增 `--gen-image`（布尔）。语义："本任务旨在生成图片"。

- 校验：平台选择器须具备 `imageDownload.steps`（图片下载步骤序列），无则 `CAPABILITY_UNSUPPORTED`。`imageGeneration`（入口模式切换）仅作能力展示参考，不作为 `--gen-image` 门槛。
- 执行时序（复用现有 `execute` 状态机，在 `deep_research` 分支后插入）：
  1. `preparing`：页面就绪、基线采集——**不开启生图入口**（跳过 `generateEnableImageGenerationScript`）。
  2. `sending`/`generating`：以普通消息发送 prompt → 轮询回复稳定；生图任务 poll 额外把"图片元素已挂载（`imageDownload.steps[0].selector` 命中）"作为完成信号——纯图回复无 markdown 文本时 `text` 恒空，原本会卡死 generating。
  3. **下载子阶段**（`phase` 仍为 `generating`，内部子状态）：轮询结束后、finalize 前执行"触发下载"：
     - 注入 `generateClickDownloadButtonsScript(selectors)` → 返回 `clicked`。
     - `clicked=1` 后主进程等待 `will-download` 事件落盘，30s 超时。
     - 若平台 `imageDownload` 配置存在但点击未命中（`clicked=0`），任务**不失败**：记录 `imageError` 进结果，仍 `done`（文本回复已拿到）。
- 产物：`imageFiles: string[]`（绝对路径列表，0-N 个）。

#### FR-2 回复 TXT 落盘

- 目录：`<artifact-dir>/results/`；`artifactDir` 由 CLI `--artifact-dir`（默认 `process.cwd()/.multichat`）经 daemon 透传，未传时回退 `<数据目录>/.multichat/`。
- 文件名：`{taskId}.txt`（taskId 为 UUID，天然防碰撞；内容为 `task.reply` 原文，UTF-8）。
- 时机：`persist()` 中 JSON 记录写完后追加写 TXT；TXT 写失败不阻断任务（warn 日志，`replyFile` 为空）。
- `AgentTaskResult` 与 `AgentTaskView`（done 态）新增 `replyFile?: string`。

#### FR-3 图片落盘

- 目录：`<artifact-dir>/image/`（默认 `<cwd>/.multichat/image`）。
- 文件名：`{platform}-{taskId[:8]}-{seq}.{ext}`（`seq` 为 will-download 序号，从 1 起；`ext` 从 `item.getFilename()`/`getURL()` 推断，缺省 `png`）。
- 机制：复用 `ipcHandlers.ts` 现有 `will-download` 拦截框架（`nativeCtxByWcId`/`nativeDoneByWcId`/`ensureWillDownloadListener`），但做**结构性改造**（见技术设计 §3.2）：把"活动上下文"从只服务 UI 批量下载升级为同时支持 Agent 任务下载的注册机制，落盘目录改为 `.multichat/image/`（Agent 任务不需要弹目录对话框）。
- `AgentTaskResult` 与 `AgentTaskView`（done 态）新增 `imageFiles?: string[]`、`imageError?: string`。

#### FR-4 响应契约

`task.submit --wait` 与 `task.status <id> --wait` 返回的 done 态视图：

```json
{
  "success": true,
  "data": {
    "taskId": "…",
    "platform": "gemini",
    "phase": "done",
    "reply": "已生成配图…",
    "conversationUrl": "https://gemini.google.com/app/…",
    "replyFile": "C:/…/.multichat/results/{taskId}.txt",
    "imageFiles": ["C:/…/.multichat/image/gemini-ab12cd34-1.png"],
    "imageError": null
  }
}
```

`task.result` 相同结构。`--text` 模式：正文打印到 stdout 后追加一行 `saved: <replyFile>`；有图时追加 `image: <path>` 每图一行。Agent 使用 `--json`（默认），路径在 `data.replyFile`/`data.imageFiles`。

#### FR-5 平台能力探测

`platforms` 返回项新增：

- `imageGeneration: boolean` — `selectors.imageGeneration?.steps?.length > 0`
- `imageDownload: boolean` — `selectors.imageDownload?.steps?.length > 0`

Agent 据此筛选 `--gen-image` 可用平台（当前已适配 imageDownload 的为 chatgpt / yiyan / gemini / grok / qwen / doubao / yuanbao 共 7 个；chatglm 与 kimi 有 imageGeneration 但无 imageDownload）。

### 5. 错误与边界

| 场景 | 行为 |
|---|---|
| `--gen-image` 平台未适配 | `CAPABILITY_UNSUPPORTED`，submit 即失败（不排队） |
| `--gen-image --research` 同传 | `INVALID_PARAMS`（互斥） |
| 生图模式开启步骤失败 | `PAGE_NOT_READY`（开启失败即失败，不继续发送） |
| 回复已稳定但图片点击未命中 | `done` + `imageError`（文本仍可用，不升级失败） |
| `will-download` 30s 超时未触发 | `done` + `imageError='下载超时未触发'` |
| 任务被 cancel 时已落盘图片 | 保留，`imageFiles` 照常返回 |
| `--gen-image` 与 `--image` 同传 | 允许（先上传参考图再生图，合法场景） |

---

## 第二部分：技术设计

### 1. 总体改动面

| 层 | 文件 | 改动 |
|---|---|---|
| 契约 | `src/shared/types/agentTask.ts` | `AgentTaskSubmitRequest.genImage?: boolean`；`AgentTask`/`AgentTaskView`/`AgentTaskResult`/`PersistedAgentTaskRecord` 增 `replyFile?`/`imageFiles?`/`imageError?`/`genImage?`；`AgentPlatformCapability` 增 `imageGeneration`/`imageDownload` |
| daemon | `src/main/daemon/ipcServer.ts` | `buildSubmitRequest` 透传 `genImage` |
| 主进程-下载（新） | `src/main/services/ImageDownloadService.ts` | **新文件**：抽出 `nativeCtxByWcId`/`nativeDoneByWcId`/`ensureWillDownloadListener`/`finalizeIfDone`/`finalizeForce` 纯主进程实现；`ipcHandlers.ts` 与 `AgentTaskService` 共同依赖，杜绝 services→ipcHandlers 反向 import |
| 主进程-任务 | `src/main/services/AgentTaskService.ts` | init 记 `dataPath` 并派生 `imageDir`/`resultsDir`；execute 中生图开启 + 图片就绪探针 + 下载子阶段；persist 写 TXT（先 TXT 后 JSON record） |
| 主进程-IPC | `src/main/ipcHandlers.ts` | `image:download-via-native:*` 两个 handler 改为薄壳调用 `ImageDownloadService`；`NativeDownloadResult` 增 `savedPaths: string[]`；`ensureWillDownloadListener` 逻辑迁入 service |
| 主进程-自动化 | `src/main/services/AutomationService.ts` | 复用 `generateEnableImageGenerationScript`/`generateClickDownloadButtonsScript` 无新代码 |
| CLI | `src/cli/commands.ts` | `submit` 增 `--gen-image`、`--artifact-dir`（默认 `process.cwd()/.multichat`）；`--text` 输出在 done 分支追加落盘路径行（写到 **stderr**，不污染 stdout 正文管道） |
| Skill | `.agents/skills/multichat-cli/SKILL.md` + `scripts/run_task.*` | 新参数文档与示例 |

### 2. 数据目录布局

```
<getDataPath()>/                     # %APPDATA%/multichat(-dev) 或 <app>/data
  daemon.token
  cli.json
  agent-tasks/{taskId}.json          # 现有：任务持久化
  .multichat/
    image/                           # FR-3：生图产物
      gemini-ab12cd34-1.png
    results/                         # FR-2：回复 TXT
      {taskId}.txt
```

### 3. 关键设计

#### 3.1 `--gen-image` 执行流（AgentTaskService.execute 内插入）

```
preparing:
  …基线/就绪检查…
  // --gen-image 不开启平台"生图模式"入口；prompt 本身驱动出图
sending:   现有（generateSendMessageScript）
generating: poll 至稳定；genImage 时把 imageDownload.steps[0] 探针命中也计入完成信号
image-ready 探针 (genImage only):
  // poll 的 stableThreshold 只保证文本稳定；图片 DOM 常晚 5-10s 挂载。
  // 轮询 generateExtractImagesScript 直到 images.length>0（上限 30s），
  // 否则 clicked 脚本必然 miss 进 imageError。
  const hasImage = await waitForLatestImage(wc, selectors, signal, 30_000)
  if (!hasImage) { task.imageError = '生成超时未检测到图片'; skip download }
downloading (genImage only, hasImage=true):
  const clicked = await exec(wc, generateClickDownloadButtonsScript(selectors))
  if (clicked?.clicked) {
    // 一次 --gen-image 恒最多落 1 张（与 UI 单点下载一致，clicked=1 → 1 个 will-download）
    const res = await ImageDownloadService.awaitAgentImageDownload(wc.id, 30_000)
    task.imageFiles = res.savedPaths        // 0 或 1 个绝对路径
    if (res.failed || !res.savedPaths.length) task.imageError = res.errors.join('; ') || '下载未触发'
  } else {
    task.imageError = '下载按钮未命中'
  }
done: persist 写 TXT + JSON（replyFile/imageFiles 入记录）
   finally (genImage only): best-effort 调 generateDisableImageGenerationScript 还原 UI 状态，失败不阻断
```

`awaitImageDownload` 不走渲染层 IPC（Agent 任务无渲染端），由 `ImageDownloadService` 暴露纯函数 API；`AgentTaskService` 直接 import 调用（service→service 平级依赖，无倒挂）。

#### 3.2 `will-download` 拦截框架改造

现状：`ipcHandlers.ts` 内 `nativeCtxByWcId: Map<wcId, ctx>` 只服务 UI 批量下载（`image:download-via-native:prepare` 由渲染层触发，ctx.dir 来自 `dialog.showOpenDialog`）。

改造：抽出全部 will-download 框架到 **`src/main/services/ImageDownloadService.ts`**（无 `ipcMain`/`dialog` 依赖，可独立测试），`ipcHandlers.ts` 的 `image:download-via-native:*` 两 handler 变成薄壳。

`ImageDownloadService` 暴露：

```ts
// ImageDownloadService.ts
export function ensureWillDownloadListener(): void  // 幂等

// UI 批量下载沿用：dir 来自 dialog，文件名 {modelId}-{ts}-{seq}
export function registerBatchContext(wcId, opts: { modelId; dir; ts; expectedFromClick }): void
export async function waitBatchResult(wcIds: number[]): Promise<NativeDownloadResult[]>

// Agent 任务专用：dir 固定 .multichat/image，文件名 {platform}-{taskId[:8]}-{seq}
export function registerAgentImageDownload(
  wcId: number,
  opts: { platform: string; taskId: string; dir: string; expectedFromClick: number }
): void
export async function awaitAgentImageDownload(
  wcId: number,
  timeoutMs: number
): Promise<{ savedPaths: string[]; failed: number; errors: string[] }>
```

- `ctx` 内部统一记录 `savedPaths: string[]`（`item.setSavePath` 时同步收集绝对路径）；`NativeDownloadResult` 增 `savedPaths`，UI handler 返回值兼容（`perModel` 仍只汇总计数，不破坏现有渲染层契约）。
- `registerAgentImageDownload` 与 `registerBatchContext` 共用 `nativeCtxByWcId`/`finalizeIfDone`，差别仅是 `dir` 来源与文件名前缀；同 wcId 残留 ctx 建前清理逻辑沿用。
- `awaitAgentImageDownload` 复用 `nativeDoneByWcId` 暂存区语义：等 done → 返回 `savedPaths`。

#### 3.3 TXT 落盘（persist 内追加）

```ts
// persist(task) 正确顺序：先算 replyFile（写 TXT）→ 再构造 record 一次性写 JSON
private async persist(task: TaskEntry): Promise<void> {
  if (!this.persistDir) return
  let replyFile: string | undefined
  if (task.phase === 'done' && task.reply && this.resultsDir) {
    try {
      const file = join(this.resultsDir, `${task.id}.txt`)
      await mkdir(this.resultsDir, { recursive: true })
      await writeFile(file, task.reply, 'utf8')
      replyFile = file
    } catch { /* 只缺字段，不失败 */ }
  }
  const record: PersistedAgentTaskRecord = {
    /* …现有字段… */
    ...(replyFile ? { replyFile } : {}),
    ...(task.imageFiles?.length ? { imageFiles: task.imageFiles } : {}),
    ...(task.imageError ? { imageError: task.imageError } : {}),
    ...(task.genImage ? { genImage: true } : {})
  }
  /* 写 record JSON 同现状 */
}
```

### 4. CLI 参数与输出

- `task submit --gen-image`：布尔标志；与 `--research` 互斥（CLI 侧先报 `INVALID_PARAMS`，daemon 侧再兜底校验）。
- `--text` 模式：stdout 保持 reply 正文纯净（现有 `handleTaskViewResponse`/`task.result` 的 done 分支行为不变）；**路径行写 stderr**（`saved: <replyFile>`、每图 `image: <path>`），避免污染下游管道对 stdout 的逐行消费。
- `--json` 默认，`data` 字段直出契约（FR-4）——Agent 走 JSON 通道，stdout 本就是结构化数据，`replyFile`/`imageFiles` 与 `reply` 并列无歧义。
- `platforms` `--text` 打印行同步加 `imageGen=`/`imageDl=` 两列。

### 5. 持久化记录扩展

`PersistedAgentTaskRecord` 增 `replyFile?: string`、`imageFiles?: string[]`、`imageError?: string`、`genImage?: boolean`，**全部 optional，version 保持 1**，老记录缺新字段向后兼容（读取时已 optional 处理）。

### 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| `will-download` 事件与任务完成时序竞态（点击早于 ctx 建立） | 先 `registerAgentImageDownload` 建 ctx，再注入点击脚本（与 UI prepare→click→wait 同构） |
| 生图任务稳定判定过早（图片未渲染完文本已稳定） | **新增 image-ready 探针**（§3.1）：poll 结束后轮询 `generateExtractImagesScript` 至 `images.length>0`，上限 30s；探针超时则跳过下载、记 `imageError`，不进 clicked |
| `.multichat` 目录权限/磁盘满 | 写文件失败只记 `imageError`/`replyFile` 缺省，不升级任务失败 |
| 同 wcId 并发下载串扰 | per-platform FIFO 已保证同 session 串行；`registerAgentImageDownload` 建 ctx 前清 stale（沿用现有防御逻辑） |

### 7. Skill 更新要点

- `platforms` 输出新列说明。
- 新增"生成图片"配方：`task submit --platform <p> --gen-image --query "…"` → status wait → 读 `data.imageFiles[0]`。
- 说明 `replyFile`/`imageFiles` 语义、`.multichat/` 目录位置、`--text` 与 `--json` 差异。
- `run_task.sh`/`run_task.ps1` 增 `-GenImage`/`--gen-image` 透传。

### 8. 验证计划

1. `npm run lint` + `npx tsc --noEmit -p tsconfig.node.json --composite false` + `npx tsc --noEmit -p tsconfig.web.json --composite false`。
2. `npm run build`，然后 `npm run dev` 起应用。
3. `node out/cli/index.js platforms` 确认新布尔列。
4. 挑 `gemini`（`imageDownload` 已适配、`busySignal=adapted`）跑 `task submit --platform gemini --gen-image --query "生成一只猫" --wait 600 --json`：
   - 验证 `.multichat/image/gemini-*.png` 存在且可打开。
   - 验证 `.multichat/results/{taskId}.txt` 存在、内容为 reply。
   - 验证 `--json` 输出 `imageFiles`/`replyFile`。
5. 反例：`--platform claude --gen-image` → `CAPABILITY_UNSUPPORTED`；`--gen-image --research` → `INVALID_PARAMS`。
6. `--text` 模式目视确认 stdout 只有 reply 正文、stderr 有 `saved:`/`image:` 行。
7. 回归：普通 `task submit`（不带 --gen-image）仍写 TXT、不碰 image 目录。

---

## 附：实现与验证记录（2026-11-18）

**已落地**：`task submit --gen-image`、`platforms` 新增 `imageGeneration`/`imageDownload` 列、回复 TXT 落盘 `.multichat/results/{platform}-{taskId[:8]}.txt`、图片落盘 `.multichat/image/`、`replyFile`/`imageFiles`/`imageError` 入 `AgentTaskView`/`AgentTaskResult`/持久化记录、`--text` 模式 stderr 输出 `saved:`/`image:`、`will-download` 框架抽为 `src/main/services/ImageDownloadService.ts`（UI 批量下载与 Agent 任务共用）、SKILL 与 `run_task.*` 脚本同步。

**验证结果（2026-11-18 dev 实测，"prompt 直发"模式）**：

`--gen-image` 简化为"发送生图 prompt + `generateExtractImagesScript` 探针 + `imageDownload` 点下载"（不再调平台"生图模式"入口）后，7 个 `imageDownload` 适配平台实测：

| 平台 | 结果 | 产物 |
|---|---|---|
| chatgpt | ✅ done | `image/chatgpt-*.png`（1.5MB） |
| gemini | ✅ done | `image/gemini-*.jpg`（2.0MB） |
| doubao | ✅ done | `image/doubao-*.png`（4.5MB） |
| yuanbao | ✅ done | `image/yuanbao-*.jpeg`（2.2MB） |
| grok | ✅ done | `image/grok-*.jpg`（253KB） |
| qwen | ✅ done | `image/qwen-*.png` × 4（28KB–388KB，click 路径超时后回退 extract→downloadURL 兜底直存） |
| yiyan | done + `imageError='生成超时未检测到图片'` | 未登录态仅回文本反问，平台侧未出图（非框架 bug） |

其余验证：
- `platforms`：`imageGeneration`/`imageDownload` 布尔列正确透出。
- 参数校验：`--gen-image --research` → `INVALID_PARAMS`；平台无 `imageDownload` → `CAPABILITY_UNSUPPORTED`。
- 回复 TXT：`results/{platform}-{taskId[:8]}.txt` 落盘正确（含 `--artifact-dir` 覆盖）。
- **空回复 TXT 修复**：`replyChars=0`（qwen 纯图回复）早期不写 TXT；改为 `phase==='done'` 即落盘，哪怕 reply 为空也保留占位文件，Agent 可读。
- **click 失败兜底**：`generateClickDownloadButtonsScript` 未命中（如 qwen `imageItem-*` class 改版后 hover 不到容器）时，回退 `generateExtractImagesScript` 拿 `src` 列表，主进程按 `data:`/`blob:`/`http(s):` 分别 Buffer 写文件或 `webContents.downloadURL` 落盘；同一次任务多图变体（qwen 4 张）全部保存。
- `--text`：stdout 保持 reply 纯净，`saved:`/`image:` 走 stderr。
- 契约字段：`replyFile`/`imageFiles`/`imageError` 在 `task.status`/`task.result`/`submit --wait` 均透出。
- `npm run lint` 0 errors；`npm run build` 通过；定向 `tsc` 干净。

**实现说明**：`--gen-image` 不再调用 `generateEnableImageGenerationScript`/`generateDisableImageGenerationScript`——多数平台凭 prompt 直接出图，入口 steps 在 headless 下反而是主要失败源。图片探针统一用 `generateExtractImagesScript`（抓 `messageContainer` 内 img/canvas/a[download]/blob），poll 把"图片已挂载 + !busy"计入完成信号，解决纯图回复 `replyChars=0` 永卡 generating 的问题。

**遗留事项**：`yiyan` 需登录态才触发真实生图（未登录回文本反问"要不要试试"），非框架问题；`kimi`/`chatglm`/`perplexity`/`arena`/`deepseek`/`claude` 无 `imageDownload` 配置，不支持 `--gen-image`（`CAPABILITY_UNSUPPORTED`）。qwen `sendButton`/verifySubmission 此前在 dev 实测中出现过 `SEND_FAILED`，本次复测（同会话、同 headless 窗口）已恢复正常——疑似平台侧偶发 DOM/会话状态，未做适配层修改。
