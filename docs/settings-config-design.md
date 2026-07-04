> Created: 2026-07-04 11:36 (UTC+08)

# 设置页面配置项完善 —— 设计方案

## 0. 背景与范围

基于对 `SettingsDrawer.tsx` 的审核，本方案补齐缺失配置项并修正不合理项。

**明确排除（用户决策）：**
- ❌ 不做主题/样式切换
- ❌ 不把模型参数（temperature / topP / maxTokens / includeReasoning / contextRounds）放进设置页（保留在总结面板齿轮弹窗）
- ❌ 不强制给划词类快捷键填默认值——保持为空、默认关闭（已有悬浮工具条覆盖）

**本方案覆盖：**
1. 总结模式选择（`summarySource`）入口
2. 默认供应商 / 默认总结模型设置入口
3. 供应商校验三态反馈 + baseUrl 格式校验
4. API Key 安全存储提示
5. 模型同步前的供应商可用性校验
6. 供应商 enabled 与模型预览的一致性
7. 快捷键冲突检测
8. 导出文件夹"打开"按钮
9. 缓存导入项
10. 已添加模型改名

---

## 1. 总结模式选择入口

### 问题
`apiConfig.summarySource: 'api' | 'webview'` 默认 `'webview'`（`SummaryPanel.tsx:43`），目前只能从总结页顶部按钮切换，设置页无入口。新用户不知道有 API 模式，也不会去配置供应商。

### 设计
在「总结Agent配置」区块**最顶部**新增一行单选：

```
总结方式
  ○ 嵌入式页面（默认）  通过厂商网页直接总结，无需 API Key
  ○ API 调用            通过 OpenAI 兼容接口总结，需配置下方供应商
```

### 实现
- 文件：`SettingsDrawer.tsx`
- 读取 `apiConfig.summarySource`，缺省视为 `'webview'`（与 `SummaryPanel` 一致）
- 切换时：`setApiConfig({ ...apiConfig, summarySource: next })`
- 切到 `'api'` 时若 `providers` 为空，下方提示："未配置供应商，请先新增 API 供应商"（不阻断，仅提示）
- 不改动 `Layout.tsx` 顶部按钮，两处入口写同一字段，互相同步

### 风险
- 顶部按钮与设置页同时改 `apiConfig`，需确认 `setApiConfig` 的持久化路径已覆盖 `summarySource`（`appStore.ts:857-863` 的 `setApiConfig` 会持久化除 `agentPrompts` 外的全部字段，已覆盖）。✅ 无需额外处理

---

## 2. 默认供应商 / 默认总结模型

### 问题
`activeProviderId` 和 `lastSelectedAgentId` 只在总结面板隐式更新，多供应商/多模型场景下无法在设置页指定默认。

### 设计
- **供应商行**：在现有操作区（校验/编辑/删除）前加"设为默认"操作，当前默认者显示 ★ 标记
- **模型**：暂不加单独入口（模型列表在弹窗内，强加"设为默认"会让弹窗更重），改用提示文案引导

### 实现
- 供应商行：
  - 判断 `apiConfig.activeProviderId === provider.id` → 显示 ★（金色），title="当前默认"
  - 点击 ★ 或新增按钮"设为默认" → `setApiConfig({ ...apiConfig, activeProviderId: provider.id })`
  - 要求 `provider.enabled === true` 才能设为默认；disabled 的供应商设默认时先提示并自动 enable
- 模型：在"可用总结模型"卡片下方加一行小字："默认总结模型在总结面板内选择并自动记忆"

### 风险
- 设默认时强制 enable 会改变用户勾选状态，需确认弹窗（复用 `ConfirmModal`，type 新增 `'set-default'`）

---

## 3. 供应商校验三态反馈

### 问题
`handleValidateProvider`（`SettingsDrawer.tsx:613`）成功只点绿点，无文案；失败与未校验视觉无区分（都没绿点）。

### 设计
供应商行名称旁的状态点改为三态：

| 状态 | 视觉 | 触发 |
|---|---|---|
| 未校验 | 灰点 | 新增/编辑后、从未校验 |
| 校验通过 | 绿点（带光晕） | validateApi 成功 |
| 校验失败 | 红点 | validateApi 失败 |

并在红点 hover title 显示失败原因摘要。

### 实现
- `ApiProvider` 类型新增 `validatedStatus?: 'unknown' | 'valid' | 'invalid'` 与 `validatedError?: string`
  - 保留现有 `validated?: boolean` 不动，新增字段并存，避免历史数据迁移（读取时 `validated===true` → 视为 `'valid'`）
- `handleValidateProvider`：
  - 成功：`validatedStatus: 'valid'`，清空 `validatedError`
  - 失败：`validatedStatus: 'invalid'`，`validatedError: result.error`，并 `alert` 一次完整错误（保留现有行为）
- `handleSaveProvider`：编辑后若 key/baseUrl 变化 → `validatedStatus: 'unknown'`（对应现有"重置校验状态"逻辑，`SettingsDrawer.tsx:648-654`）
- 文件改动：`appStore.ts`（`ApiProvider` 接口）、`SettingsDrawer.tsx`（渲染与状态更新）

### 风险
- `ApiProvider` 接口扩展需同步 `src/preload/index.d.ts` 中涉及 `ApiProvider` 的类型（若有）。需检查 preload 契约是否显式声明了 `ApiProvider` 字段——若有需同步。

---

## 4. baseUrl 格式校验

### 问题
`ProviderEditorModal` 的 baseUrl 无格式校验，`summaryApi.ts:105` 只去尾斜杠；用户填 `openai.com/v1`（无协议）会拼出错误 URL。

### 设计
在 `ProviderEditorModal.handleSave` 保存前做前端校验：

- 必须以 `http://` 或 `https://` 开头，否则报错"Base URL 需以 http:// 或 https:// 开头"
- 自动 trim 尾部空格
- 不强制要求 `/v1` 结尾（不同供应商路径不同，如 OpenRouter 是 `/api/v1`，Gemini 是 `/v1beta`），仅在 placeholder/提示里给示例
- 校验失败时**不关闭弹窗**，在 baseUrl 输入框下方显示红字错误

### 实现
- 文件：`SettingsDrawer.tsx` 的 `ProviderEditorModal`
- 新增 `const [baseUrlError, setBaseUrlError] = useState('')`
- `handleSave` 开头加校验，失败 setBaseUrlError 并 return
- 输入框 onChange 时清空 error

### 风险
- 无后端改动，纯前端校验。不影响已存量配置（旧数据加载时不校验，仅在编辑保存时校验）

---

## 5. API Key 安全存储提示

### 问题
Key 明文存 `electron-store`，设置页无任何安全说明。

### 设计
在供应商编辑弹窗的 API Key 输入框下方加一行小字提示：
"Key 仅保存在本地配置文件，不会上传。导出缓存时将自动脱敏。"

### 实现
- 文件：`SettingsDrawer.tsx` 的 `ProviderEditorModal`
- 纯文案，无逻辑改动

### 风险
- 无

---

## 6. 模型同步前的供应商可用性校验

### 问题
`ModelEditorModal.handleSyncModels`（`SettingsDrawer.tsx:252`）只检查 apiKey 非空就允许同步，不检查 baseUrl 有效性、不检查 enabled。

### 设计
同步前增加校验链：
1. `provider.enabled === false` → 提示"该供应商未启用，无法同步"，阻断
2. baseUrl 格式校验（复用第 4 项的校验函数）
3. apiKey 非空（现有逻辑保留）
4. 校验失败给出具体原因，不进入同步

### 实现
- 文件：`SettingsDrawer.tsx` 的 `ModelEditorModal.handleSyncModels`
- 提取一个共享 `validateBaseUrl(url): string | null`（返回 null 表示通过，返回字符串表示错误信息），第 4、6 项共用

### 风险
- 无

---

## 7. 供应商 enabled 与模型预览一致性

### 问题
"可用总结模型"卡片（`SettingsDrawer.tsx:817-826`）用全部 `summaryModels`，未按 `provider.enabled` 过滤；disabled 供应商的模型仍显示，但总结面板选不出该供应商。

### 设计
模型预览按 `provider.enabled` 过滤：
- 预览只显示 `providers.find(p => p.id === m.providerId)?.enabled === true` 的模型
- 计数文案改为"可用总结模型 (已启用 X / 共 Y)"
- disabled 供应商的模型不删除（保留配置），只是不显示在预览

### 实现
- 文件：`SettingsDrawer.tsx` 渲染"可用总结模型"处
- 新增 `const enabledSummaryModels = summaryModels.filter(m => providers.find(p => p.id === m.providerId)?.enabled)`
- 预览用 `enabledSummaryModels`，计数显示双数字

### 风险
- 计数变化可能让用户误以为模型丢失，需在 hover/小字说明"未启用供应商的模型已隐藏"

---

## 8. 快捷键冲突检测

### 问题
`ShortcutRecorder` 录制时不检测重复，用户可把多个动作录成同一组合键。

### 设计
在 `handleShortcutChange`（`SettingsDrawer.tsx:465`）录制完成后检测冲突：
- 若新值非空且与其它 key 的值相同 → alert 提示"该快捷键已被 [xxx] 占用，请重新录制"
- **不自动覆盖**，让用户重录

### 实现
- 文件：`SettingsDrawer.tsx` 的 `handleShortcutChange`
- 录制成功后（val 非空时）遍历 `shortcuts` 找冲突，冲突则 alert 并**不写入**（即不调用 `shortcutSet`，也不更新 state）
- 注意：summon 有默认值，其余为空是允许的（用户决策），冲突检测只在两个非空值相同时触发

### 风险
- 已写入系统的旧冲突配置不会自动修复，仅在新录制时拦截。可在检测到现有冲突时给一次提示，但不强制改

---

## 9. 导出文件夹"打开"按钮

### 问题
`handleSelectDirectory` 只有"浏览"选目录，选中后无法直接打开验证。

### 设计
在"浏览"按钮旁加"打开"按钮：
- 当 `apiConfig.exportDirectory` 为空时禁用
- 点击调用系统资源管理器打开该目录

### 实现
- 新增 IPC：`open-path`（main 进程用 `shell.openPath`）
  - 文件：`src/main/ipcHandlers.ts`、`src/preload/index.ts`、`src/preload/index.d.ts`
  - 参考现有 `agent-prompts-open-folder`（`ipcHandlers.ts:693`）
  - 返回 `{ success, error? }`
- 渲染层：`SettingsDrawer.tsx` 加按钮，调用 `window.api.openPath(exportDirectory)`
- 失败（路径不存在）时 alert 提示

### 风险
- 新增 IPC 需端到端同步三层（main / preload / d.ts），符合架构约束

---

## 10. 缓存导入项

### 问题
有导出无导入，无法跨机器/重装恢复。

### 设计
在"导出缓存数据"按钮下方加"导入缓存数据"按钮：
- 点击 → 文件选择对话框（仅 .json）
- 读取后校验 `_meta.app === 'MultiChat'`，否则报错"非本应用缓存文件"
- **预览合并策略**（避免静默覆盖）：
  - 显示一个确认弹窗，列出将导入的键（displayMode / models / apiConfig / summaryModels / history / summaryHistory / geminiAccountUrl）
  - 标注哪些键会覆盖现有值
  - 用户确认后逐键 `store.set`
- **安全处理**：
  - 导入的 apiConfig 中若 apiKey 为 `<REDACTED>`，跳过该供应商的 apiKey 字段（保留本地现有 key），并在确认弹窗里标注"API Key 已脱敏，将保留本地现有 Key"
  - 导入前自动 `exportCache` 一次到临时目录作为备份（可选，防误操作）

### 实现
- 新增 IPC：`import-cache`
  - 文件：三层同步
  - main：`dialog.showOpenDialog` → `readFile` → 解析 → 返回 `{ success, data?: { keys, conflicts }, error? }`
  - 不在 main 直接写入，先返回预览数据；渲染层确认后再调 `store-set-batch`（新增）或逐键调现有 `storeSet`
- 渲染层：新增 `ImportCacheConfirmModal`（复用 `ConfirmModal` 风格但内容更丰富，或新建一个）
- 备份：导入前调一次 `exportCache`（已有），失败不阻断导入

### 风险
- ⚠️ 这是本方案中风险最高的一项：涉及覆盖用户现有配置/历史。
  - 缓解：强制预览 + 确认 + 自动备份
- history/summaryHistory 合并策略：建议**覆盖**（与导出语义对齐，导出是全量快照），但确认弹窗里明确标注"将覆盖现有历史记录"
- 若用户反馈风险过高，可降级为只导入 `apiConfig` + `summaryModels`（配置类，不碰历史），历史留作后续

---

## 11. 已添加模型改名

### 问题
`ModelEditorModal` 的模型列表卡片（`SettingsDrawer.tsx:355-386`）只有删除按钮，无法改显示名。同步来的模型 `name` 默认等于 `id`（`SettingsDrawer.tsx:268-272`），用户无法把它改成更友好的显示名（如 `gpt-4o` → `GPT-4o`）。

### 关键约束（已验证）
- `SummaryModel.id` 用于 **API 请求的 model 参数** 和**所有匹配逻辑**：`useTaskSplit.ts:27`、`useSummaryPanel.ts:258/511/554/823`、`favoriteModelIds`、`lastSelectedAgentId`、历史记录 `SummaryHistoryItem.selectedModels`
- `SummaryModel.name` **仅用于显示**：`SummaryPanel.tsx:592` 下拉显示文本、`SettingsDrawer.tsx:819` 预览标签
- **结论：改名只动 `name`，绝不动 `id`**。改名不影响 API 请求、不影响历史记录里已存的 selectedModels（那里存 id）、不影响上次选中记忆。

### 设计
在模型卡片删除按钮旁加"编辑"按钮（`edit` 图标，与供应商行风格一致，hover 显示）：
- 点击进入**行内编辑**模式：name 变成 input，id 保持只读展示
- input 聚焦自动选中全文本
- 保存：Enter 或失焦或点确认按钮
- 取消：Esc
- 空名保存被拦截（保留原值），可给 input 边框变红提示
- 不提供"重置为 id"按钮（用户可手动填 id）

### 实现
- 文件：`SettingsDrawer.tsx` 的 `ModelEditorModal`
- 卡片组件内新增 `const [editingId, setEditingId] = useState<string | null>(null)` 和 `const [editName, setEditName] = useState('')`
  - 注意：`editingId` 需带上 `providerId` 区分，用 `${providerId}-${id}` 作 key 避免不同供应商同名模型冲突
- 进入编辑：`setEditingId(key); setEditName(model.name)`
- 保存：在 `modelList` 里 map 替换对应项的 `name`（trim 后非空才替换），`setModelList` 更新
- 取消：`setEditingId(null)`
- 列表已有 `key={`${model.providerId}-${model.id}``}`（`SettingsDrawer.tsx:362`），复用此 key
- 最终保存走现有 `handleSave`（`SettingsDrawer.tsx:316`）→ `onSave(modelList)` → `setSummaryModels`，与现有删除/添加路径一致

### 渲染结构（编辑态）
```
[edit input（name）] [供应商标签]      [✓确认] [✗取消]
[id 只读展示]
```
非编辑态：
```
[name 文本]  [供应商标签]              [edit] [delete]
[id 只读展示]
```

### 风险
- 行内编辑状态在切换 `selectedProviderId`（供应商下拉）时需清空，否则切回来 input 残留。在 `useEffect` 监听 `selectedProviderId` 变化时 `setEditingId(null)`
- 改名后未点"保存配置"就关弹窗会丢失——与现有手动添加/删除行为一致（都是改 `modelList` 本地态，靠底部"保存配置"落盘），不引入新问题
- 不涉及 IPC / store 接口改动，纯前端

---

## 实现顺序与文件清单

按风险从低到高、依赖关系排序：

| 步骤 | 项 | 改动文件 | 风险 |
|---|---|---|---|
| 1 | baseUrl 格式校验（提取共享函数） | SettingsDrawer.tsx | 低 |
| 2 | API Key 安全提示 | SettingsDrawer.tsx | 低 |
| 3 | 模型同步前校验（依赖步骤1） | SettingsDrawer.tsx | 低 |
| 4 | 供应商校验三态 | appStore.ts, SettingsDrawer.tsx, (preload?) | 中 |
| 5 | 模型预览按 enabled 过滤 | SettingsDrawer.tsx | 低 |
| 6 | 默认供应商设置 | SettingsDrawer.tsx | 中 |
| 7 | 总结模式选择入口 | SettingsDrawer.tsx | 低 |
| 8 | 快捷键冲突检测 | SettingsDrawer.tsx | 低 |
| 9 | 导出文件夹"打开"按钮 | ipcHandlers.ts, preload/index.ts, preload/index.d.ts, SettingsDrawer.tsx | 中（新 IPC） |
| 10 | 缓存导入 | 同上 + 新增预览弹窗 | 高 |
| 11 | 已添加模型改名 | SettingsDrawer.tsx | 低 |

**预计总改动文件：**
- `src/renderer/src/components/SettingsDrawer.tsx`（核心）
- `src/renderer/src/store/appStore.ts`（`ApiProvider` 接口扩展）
- `src/main/ipcHandlers.ts`（`open-path`、`import-cache`）
- `src/preload/index.ts` + `src/preload/index.d.ts`（IPC 契约同步）
- 可能新增：`src/renderer/src/components/ImportCacheConfirmModal.tsx`

---

## 验证计划

遵循项目约束 `npm run lint` → `npm run build` → `npm run dev` 手动验证：

1. **lint + build**：类型检查通过（`ApiProvider` 扩展、新 IPC 契约端到端同步）
2. **dev 手动验证清单：**
   - [ ] 切换总结模式 api/webview，设置页与总结页顶部按钮同步
   - [ ] 设默认供应商，disabled 供应商设默认时弹出 enable 确认
   - [ ] 供应商校验：未校验灰点 → 成功绿点 → 改 key 后回灰点 → 失败红点
   - [ ] baseUrl 填 `openai.com/v1`（无协议）保存被拦截
   - [ ] disabled 供应商下点"自动同步"被拦截
   - [ ] 模型预览只显示 enabled 供应商的模型
   - [ ] 两个快捷键录成相同值时被拦截
   - [ ] 导出文件夹"打开"按钮能在资源管理器打开
   - [ ] 导入缓存：预览弹窗显示键列表，确认后合并，REDACTED key 保留本地
   - [ ] 模型改名：行内编辑 name，Enter/失焦保存，Esc 取消，空名拦截；改名后总结面板下拉显示新名，但历史记录里旧对话的模型仍正常（因 selectedModels 存 id）

## 不在本方案范围
- 主题/样式切换（已排除）
- 模型参数移入设置页（已排除）
- 快捷键默认值填充（已排除，保持空+默认关闭）
