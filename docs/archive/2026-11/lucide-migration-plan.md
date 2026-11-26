> Created: 2026-11-20 14:05 (Asia/Shanghai)

# Material Symbols → Lucide 迁移开发方案

## 1. 背景与目标

当前 UI 图标使用 `material-symbols` 图标字体（outlined 变体），通过可变字体连字（ligature）渲染：`<span className="material-symbols-outlined">icon_name</span>`。

- 字体文件 `material-symbols-outlined.woff2` = **3.86 MB**，占 `out/renderer/assets` 约 **32.8%**。
- 目标：替换为 `lucide-react`（已装 `1.76.0`，~1600+ 图标，ESM + tree-shaking），按用到的图标按需打包（预计 ~60–100 KB），统一 stroke 风格。

## 2. 现状盘点（脚本实测）

| 维度 | 数量 | 说明 |
|---|---|---|
| 涉及源文件 | **51** | `src/renderer` 下含 `material-symbols-outlined` / icon 字符串 |
| 静态 span 用法 | 290 | `<span …>icon_name</span>` 字面量 |
| 动态 span 用法 | 49 | `{cond ? 'a' : 'b'}` 或 `{iconVar}` |
| object-map 用法 | 65 | `{ icon: 'xxx' }` / `iconName: 'xxx'` 配置对象 |
| 不重复图标名 | **147**（去误报后） | 映射表已覆盖 |
| 可变字体特性 | 3 | `'FILL' 1` ×2、`'wght' 500` ×1，Lucide 无对应 |
| 尺寸/布局 Tailwind class | ~299 | `text-*`/`shrink`/`rotate`/`animate` 挂在图标 span 上 |

**误报（非图标名，替换时必须跳过）**：`success / asc / desc / model / all / updated / light / debate / up / down / visibility(CSS)` —— 业务字段值或 CSS 关键字，混在 `icon:` 三元/变量里，不可按名字盲目替换。
> 注意：`draft` 在 `WorkbenchFileTree.tsx:95`、`WorkbenchEditor.tsx:212` 是**真图标**（已映射 `FileSignature`）；独立评审曾误判为误报，已更正。

## 3. 总体策略

**统一封装组件 + 分批替换**，新旧可共存，任一文件可独立回滚。

### 3.1 封装层 `src/renderer/src/components/icons/AppIcon.tsx`（已建）

- `APP_ICON_MAP`：`Record<materialName, LucideComponent>` **静态字面量映射**（非运行时名转换），保证 tree-shaking 只打进用到的图标，写错名字 TS 直接报错。
- `<AppIcon name size className style …>`：`size` 等价旧 `font-size`（默认 24），透传 `className`/`style`/`strokeWidth` 等 SVG props；`flexShrink:0` 默认。
- 未知名：渲染 `HelpCircle` 兜底 + dev 环境 `console.warn`，防止静默渲染错误图标。

### 3.2 为何不自动运行时转换名字

Material 连字名与 Lucide 导出名无一一对应（`call_split→Split`、`smart_toy→Bot`、`psychology→Brain`、`ios_share→Share`），强行字符串转换会使 tree-shaking 失效、TS 失去校验、错名静默兜底。显式映射表是一次性成本、长期收益。

## 4. 各类用法替换模式

### 4.1 静态 span（绝大多数）

```tsx
// 前
<span className="material-symbols-outlined text-xl shrink-0">settings</span>
// 后
<AppIcon name="settings" size={20} className="shrink-0" />
```

`text-xl`(20)/`text-2xl`(24)/`text-base`(16)/`text-[Nx]` → `size={N}`；其余布局类（`shrink-0`/`rotate`/`animate-spin`/margin）保留在 `className`。

### 4.2 动态三元

```tsx
// 前
<span className="material-symbols-outlined">{copied ? 'done' : 'content_copy'}</span>
// 后（二选一）
<AppIcon name={copied ? 'done' : 'content_copy'} size={16} />
{copied ? <AppIcon name="done" /> : <AppIcon name="content_copy" />}
```

### 4.3 object-map 配置对象

```tsx
// 前：const items = [{ icon: 'chat' }, { icon: 'psychology' }]  渲染 <span>{item.icon}</span>
// 后（推荐）：配置不动，渲染点换成 AppIcon
<AppIcon name={item.icon} size={18} />
```

保留 `icon:'chat'` 字符串、只在渲染点换 `<AppIcon>`，diff 面最小；若要强类型再把字段改为 `LucideComponent`。

> **替换锚点**：真正的替换点是**渲染处那个 `material-symbols-outlined` span**，不是 `icon:'xxx'` 定义行。对 `getNodeIcon(node).icon` 这类"返回值带 icon 字符串、在另一处渲染"的间接模式（`FileTree.tsx:645` `<span>{getNodeIcon().icon}</span>`），只改渲染处；`getNodeIcon` 返回的 `color` 是 Tailwind 文本色类，迁到 `<AppIcon className={color}>` 即可。

### 4.4 可变字体特性（3 处，Lucide 无 fill/wght 变体）

| 位置 | 现状 | 方案 |
|---|---|---|
| `DiagnosticsPage.tsx:155` pinned | `'FILL' 1` | 换图标（`pin`↔`pin_off`）或 `fill="currentColor"` |
| `DiagnosticsPage.tsx:607` | `'wght' 500` | `strokeWidth={2.5}`（默认 2） |
| `QuickPage.tsx` | `'FILL' 1` | 同 pinned 思路 |

### 4.5 CSS 选择器（13 条）

`.material-symbols-outlined` 选择器用于字号/颜色（`index.css:742`、`notesWorkspace.css` 多处）。Lucide 输出 `<svg>`，改为 `svg` 选择器或加 `.app-icon` 类。**注意：所有用 `font-size` 控尺寸的 CSS 规则（含 `font-size:16px !important`，`notesWorkspace.css:152/193`）迁后会整体失效**，必须逐条改成 `width/height` 几何尺寸，或删掉改走 `size` prop。

### 4.6 基线与 stroke 校准

- `AppIcon` 已固化 `verticalAlign:'middle'`（抵消 svg 与相邻文字的基线偏移）与默认 `strokeWidth=2.2`（Lucide 线稿比 Material 填充字形偏细，同 24px 视觉偏小，全局上调校准）。
- 输出 `data-icon={name}`，供 `verify_workbench_previews.py` 断言与测试定位。

### 4.6 必须跳过的误报

`icon:`/`iconName:` 值含业务 token（`success/asc/desc/all/updated/light`…）与 CSS `visibility`——替换工具须按"该字符串确实作为 material 图标被渲染"判定，而非纯文本匹配。

## 5. 分批执行计划（每批独立可回滚）

| 批次 | 范围 | 文件数 | 验证 |
|---|---|---|---|
| B0 | 基础设施：`AppIcon` + `main.tsx` 暂留 import | 1 | tsc/lint ✅ 已完成 |
| B1 | 顶部栏/弹窗：`Layout`/`ControlBar`/`WebviewCard`/`CustomContextMenu`/`ConfirmModal` 等 | ~12 | dev 目检 |
| B2 | 页面级：`NotesPage`/`SummaryPage`/`MainPage`/`QuickPage`/`DiagnosticsPage` | ~5 | 页面巡检 |
| B3 | workbench 编辑器：`WorkbenchToolbar`/`FileTree`/`*Plugin`/`ImagePreview`/`DocxCard` | ~20 | 编辑器巡检 |
| B4 | 面板/剩余组件 + CSS 选择器迁移 | ~14 + css | 全量巡检 |
| B5 | 收尾：删 `material-symbols` 依赖、移除 `main.tsx` import、`verify_workbench_previews.py` 断言改 svg | 3 | build + 体积核对 |

> B1→B4 保留 `main.tsx` 的 `material-symbols` import，未替换处仍用字体渲染，过渡期不破版；B5 才移除。

## 6. 风险登记与"会不会出 bug"

| 风险 | 等级 | 说明与对策 |
|---|---|---|
| 名字误报/漏报 | 中 | `icon:` 混业务 token；脚本只出建议，逐文件按 `rg` 行号人工确认；dev `console.warn` 兜底 |
| fill/wght 退化 | 低 | 仅 3 处，逐点处理（§4.4） |
| 尺寸偏差 | 中 | 字体 `font-size`≈图标盒高，Lucide `size` 控 svg 宽高；换算需目检，细线 stroke 小尺寸可能偏细 |
| object-map 类型漂移 | 低 | 推荐渲染点换 AppIcon、配置不动 |
| CSS 选择器失效 | 低 | 13 条，B4 统一改 `svg` 选择器 |
| 共享/主进程误用 | 低 | 已确认 `material-symbols` 仅 renderer 用 |
| verify 断言 | 中 | `verify_workbench_previews.py` 现断言 `inner_text()=='description'` 等，依赖字体连字文本；迁 SVG 后无 inner_text，**改断言 `svg[data-icon=description]`**（AppIcon 已输出 `data-icon`），保住"用对图标"的原意图 |
| 体积反向 | 极低 | 若误 `import *`，build 后 `index-*.js` 增量可发现 |

**能否无 bug 批量替换？** 纯字符串正则**不能**（误报 + 动态 + object-map + CSS 四类边界）。可行的是：**脚本生成逐文件 diff 建议 → 人工分批 apply + dev 目检**，而非一键全改。

## 7. 验收清单

- `npm run lint` 0 新增告警
- `npx tsc --noEmit -p tsconfig.web.json`（AppIcon/改动文件无新错；既有 Map 迭代错误不在本次范围）
- `npm run dev` 逐页面目检：渲染、尺寸、颜色、hover/禁用、旋转/loading；**硬性检查 stroke 可读性**（Lucide 线稿在 16–20px 小尺寸可能偏细，必要时再调 `strokeWidth`）与行内文字基线对齐
- B5 后 `npm run build`：不再产出 3.86MB woff2，`index-*.js` 增量 ≤ ~150KB
- `verify_workbench_previews.py` 断言更新并通过
- `rg material-symbols-outlined src` 0 命中（除 `docs/`、迁移说明）

## 8. 回滚

每批独立 commit；`material-symbols` 依赖与 `main.tsx` import 在 B5 前始终保留，任一批次 `git revert` 即恢复。B5 单独成 commit，便于整体回退。

## 9. 附录：映射语义审核结论（独立 worker，2026-11-20）

148 条映射经独立评审按"图形语义"逐条核对（material 名描述图形，lucide 组件须画同一物）。已修正：

| 修正 | material → lucide | 理由 |
|---|---|---|
| P0 | `rocket_launch → Rocket`（原 Zap） | 火箭而非闪电 |
| P0 | `build → Wrench`（原 Settings2） | 扳手而非齿轮 |
| P0 | `edit_square → SquarePen`（原 PencilLine） | 方框内笔 |
| P0 | `folder_managed → FolderCog`（原 Folder） | 带齿轮文件夹 |
| P0 | `folder_special → FolderBookmark`（原 FolderPlus） | 特殊收藏 |
| P0 | `filter_none → SquareStack`（原 Copy） | 叠层方块（窗口还原） |
| P0 | `ios_share → SquareArrowOutUpRight`（原 Share） | iOS 分享图形 |
| P0 | `select_all → SquareDashed`（原 SquareCheck） | 虚线全选框 |
| P1 | `biotech → Microscope`（原 FlaskConical） | 与 science 区分 |
| P1 | `summarize → TextQuote`（原 ListChecks） | 摘要横线文本 |
| P1 | `bedtime → MoonStar`（原 Moon） | 与 dark_mode 区分 |

保留的有意合并：`arrow_drop_down/keyboard_arrow_down/expand_more → ChevronDown`、`delete/delete_outline/delete_sweep → Trash2`、`check/done → Check`、`sync/refresh → RefreshCw`、`broken_image/image_not_supported → ImageOff`、`keyboard_arrow_right/chevron_right → ChevronRight` 等，Material 原图本就同形，合并合理。
