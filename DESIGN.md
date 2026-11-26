---
name: MultiChat Desk
description: Electron 多模型 LLM 工作台的视觉设计系统——Operate 模式桌面工具，密度高、信息层级清晰、玻璃拟态与实色卡片并存
colors:
  primary: "#3b82f6"
  app-bg: "#fcfdff"
  sidebar: "rgba(255, 255, 255, 0.8)"
  text-primary: "#1f2937"
  text-secondary: "#6b7280"
  diffuse-yellow: "#FFF5D6"
  diffuse-pink: "#FFC8DA"
  diffuse-blue-light: "#D2E8FF"
  diffuse-blue: "#3b82f6"
typography:
  tiny:
    fontSize: "10px"
    lineHeight: "14px"
    note: "角标/计数 badge，最小层级"
  caption:
    fontSize: "11px"
    lineHeight: "16px"
    note: "说明性小字、路径、提示"
  label:
    fontSize: "12px"
    lineHeight: "16px"
    note: "表单标签、次要操作、tab"
  body:
    fontSize: "14px"
    lineHeight: "21px"
    note: "正文基准（与 SettingsDrawer text-sm 一致）"
  body-lg:
    fontSize: "16px"
    lineHeight: "24px"
    note: "编辑器/大正文"
  title:
    fontSize: "19px"
    lineHeight: "28px"
    fontWeight: 600
    note: "弹窗/区块标题（专用）"
  title-lg:
    fontSize: "24px"
    lineHeight: "32px"
    fontWeight: 700
    note: "页面级标题（仅 WorkbenchTitleBar 文档大标题）"
rounded:
  sm: "0.25rem"
  md: "0.375rem"
  lg: "0.5rem"
  xl: "0.75rem"
  2xl: "1rem"
  full: "9999px"
zIndex:
  dropdown: "30"
  popover: "50"
  modal: "100"
components:
  modal-solid:
    backgroundColor: "{colors.app-bg}"
    border: "1px solid #e5e7eb"
    rounded: "{rounded.xl}"
    shadow: "shadow-2xl"
    note: "实色卡片弹窗（ConfirmModal / RenameModal / HtmlEditLeaveDialog）"
  modal-glass:
    backgroundColor: "rgba(255, 255, 255, 0.85)"
    backdropFilter: "blur(8px) saturate(145%)"
    border: "1px solid rgba(255, 255, 255, 0.84)"
    rounded: "{rounded.2xl}"
    note: "仿液态玻璃弹窗（liquid-glass-modal，默认所有 Modal 使用，无视觉遮罩）"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.lg}"
    height: "36px"
    padding: "0 16px"
    typography: "body"
    note: "主操作按钮，h-9 text-body font-medium"
  button-secondary:
    backgroundColor: "{colors.sidebar}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.lg}"
    height: "36px"
    padding: "0 16px"
    typography: "body"
    border: "1px solid #e5e7eb"
  button-danger:
    backgroundColor: "#dc2626"
    textColor: "#ffffff"
    rounded: "{rounded.lg}"
    height: "36px"
    padding: "0 16px"
    typography: "body"
---

## Overview

MultiChat Desk 是一个 Electron 多模型聊天工作台，UI 属于 **Operate** 模式——用户在此完成任务（多平台发送、总结、工作台编辑），信息密度高，一致性优先于表现力。视觉语言是"仿液态玻璃 + 轻玻璃拟态"的协同体系：主区域与导航沿用 `glass-panel`/`glass-panel-heavy` 营造层级，弹窗、下拉菜单与局部浮层采用 `liquid-glass-modal`/`liquid-glass-menu`（8px 轻模糊 + 高可读微透渐变 + 亮边内高光，支持明暗双色），兼顾性能与可读性。整体调性冷静、专业、略带柔和，避免纯黑纯白的高对比。

设计系统的 token 在 `tailwind.config.js` 的 `theme.extend` 中定义，本文件是唯一的规范文档。新增 UI 时先查 token 表，**禁止新增 `text-[Npx]`、`z-[N]`、`size={非档位}` 任意值**；发现旧散值按迁移规则顺手收敛，不做全局替换。

## Colors

| Token | 值 | 用途 |
|---|---|---|
| `primary` | `#3b82f6` | 主操作、选中态、强调色（Tailwind `primary`） |
| `app-bg` | `#fcfdff` | 应用主背景（微蓝白） |
| `sidebar` | `rgba(255,255,255,0.8)` | 侧边栏玻璃底 |
| `text-primary` | `#1f2937` | 主文字 |
| `text-secondary` | `#6b7280` | 次要文字 |
| `diffuse-*` | `#FFF5D6` / `#FFC8DA` / `#D2E8FF` / `#3b82f6` | Gemini 渐变背景 4 色 |

**约束**：深色模式通过 `dark:` 前缀散写（47 个文件），目前没有统一 dark 色板——新增 `dark:` 时参照邻近组件的 `dark:bg-gray-800`/`dark:border-white/10` 惯例，不引入新色值。

## Typography

8 档语义字号（`tailwind.config.js` `fontSize` token)，对齐 Windows Fluent 档级，适配桌面工具密度：

| Token | px/lh | 用途 |
|---|---|---|
| `text-tiny` | 10/14 | 角标、计数 badge（如 "NEW"、"3"） |
| `text-caption` | 11/16 | 说明性小字、路径、辅助提示 |
| `text-label` | 12/16 | 表单标签、次要操作按钮、tab 标签 |
| `text-body` | 14/21 | **正文基准**（与已认可的 SettingsDrawer 一致） |
| `text-body-lg` | 16/24 | 编辑器/大正文 |
| `text-title` | 19/28 semibold | 弹窗/区块标题（专用） |
| `text-title-lg` | 24/32 bold | 页面级标题（设置页等） |
| `text-title-xl` | 32/40 bold | 文档大标题（仅 WorkbenchTitleBar，与 Markdown h1 的 2em 视觉同档） |

**旧值迁移**:`text-xs`→`label`（表单语境）或 `caption`（说明文字）、`text-sm`→`body`、`text-base`→`body-lg`、`text-[10px]`→`tiny`、`text-[11px]`→`caption`、`text-[13px]`→`body`、`text-[18-20px]/xl`→`title`。

**字体族**：正文 `"Google Sans Flex", "Google Sans", "Noto Sans SC", "Helvetica Neue", sans-serif`（全局 `body` 唯一来源）；代码/编辑器用等宽（`JetBrains Mono`/`Menlo`/`Consolas`)——`WorkbenchSourceEditor`、`MindmapMarkdownEditor`、Lexical 代码块各自声明是有意的，不要合并。

**图标尺寸 `size`**:12 / 14 / 15 / 16 / **19** / 20 / 24。`19` 是文件树/列表行内图标（WorkbenchFileTree、VaultPopover）的认可档，**不要**向 20 收敛；`13/17` 就近归 12/16。AppIcon 的 `size` prop 是唯一尺寸来源，不要再加 `text-[Npx]` 冗余类。

## Layout

- **间距不做 token**：沿用 Tailwind 刻度。高频组合 `gap-2`(160)、`px-3`(134)、`py-2`(84)、`px-4`(76)、`py-1.5`(90)。新 UI 先尝试 `gap-2` + `px-3 py-2` 这组中位密度，不够再调。
- **层级 `z-*`** 3 档：`dropdown` 30、`popover` 50、`modal` 100。toast/常驻浮层用 `popover`，确认/排序等模态一律 `modal`；需要压在 modal 之上的浮层（右键菜单、tooltip）是特例，可写 `z-[110+]` 但需在代码注释说明。
- **弹窗最大宽度** `size=sm/md/lg` 对应 `max-w-sm/md/lg`(24/28/32rem);`Modal` 的 `maxHeight` 默认 `85vh`。
- **工作台布局**：左侧栏宽度 `leftPaneWidth`(store 管理），底部弹出层 `WorkbenchFooterPopover` 宽度跟随侧栏；不要让工作区内的弹窗超出侧栏宽度逻辑。

## Elevation & Depth

阴影已有隐式分层，不 token 化，沿用现有类：

| 层级 | 类 | 场景 |
|---|---|---|
| 控件内阴影 | `shadow-sm` | 输入框、小按钮 |
| 卡片/下拉 | `shadow-md`/`shadow-lg` | 下拉菜单、浮卡 |
| 模态/弹窗 | `shadow-xl`/`shadow-2xl` | 实色 modal |
| 品牌浮层 | `shadow-soft`/`shadow-float` | 玻璃面板、主按钮 hover、玻璃 modal |

`glass-panel`(blur 20px/border white/0.8）与 `glass-panel-heavy`(blur 24px/border white/0.9）用于常驻面板；`liquid-glass-menu` 与 `liquid-glass-modal`（blur 8px + saturate 145% + 高可读微透渐变 + inset 亮边高光，含 `.dark` 适配）专用于下拉菜单、右键菜单、局部浮层与模态弹窗本体。

## Shapes

圆角全部用 Tailwind 原生刻度，不做 token:

| 类 | 值 | 场景 |
|---|---|---|
| `rounded-lg` | 8px | 输入框、小按钮、列表项 |
| `rounded-xl` | 12px | 实色卡片、popover |
| `rounded-2xl` | 16px | 玻璃拟态 modal |
| `rounded-full` | 9999px | 圆形按钮、badge、底部"完成"类 pill 按钮 |

**弹窗圆角规则**:`solid` 变体用 `rounded-xl`,`glass` 变体用 `rounded-2xl`——这两种是仅有的合法弹窗圆角。

## Components

### Modal(`src/renderer/src/components/ui/Modal.tsx`)

唯一模态入口。所有"确认/表单/排序"类弹窗必须用 `Modal`，不要新写 `fixed inset-0 z-[100]`。

```tsx
<Modal open={isOpen} onClose={onCancel} size="lg" variant="glass">
  <ModalHeader title="标题" subtitle="副标题" icon="swap_vert" onClose={onClose} />
  <div className="flex-1 overflow-y-auto p-4">{/* 内容 */}</div>
  <ModalFooter className="justify-end">{/* 按钮 */}</ModalFooter>
</Modal>
```

- `variant="glass"`（默认）：仿液态玻璃（`liquid-glass-modal` + `rounded-2xl`，8px 轻模糊 + 方向性渐变微透底 + 玻璃高光边与内发光，明暗双色），用于所有通用弹窗
- `variant="solid"`：实色卡片（`bg-app` + `border-gray-200` + `rounded-xl` + `shadow-2xl`），仅需完全不透明底色时显式指定
- `backdrop`：默认 `'none'`（透明全屏事件拦截层，无视觉遮罩）；如需轻微压暗可显式传 `'dim'`（`bg-black/25`）。禁用全屏 `backdrop-blur` 与遮罩淡入动画，仅保留面板 `modal-zoom-in` 入场动画
- `closeOnBackdrop`/`closeOnEscape` 默认 `true`；有 `busy` 状态的对话框传 `false`
- `ModalFooter` 默认 `justify-end`，需要左右分布传 `className="justify-between"`

**不要走 Modal 的场景**：右键菜单、`WorkbenchFooterPopover`（底部锚定弹出层）、tooltip、`CliAgentHint`/`NoteCaptureModal` 这类定制浮层——它们各自有定位/层级逻辑，用对应语义 `z-*` 即可。

### Button（无原子组件，样式约定）

暂未抽 `Button` 组件，沿用类组合约定：

- **主按钮**:`h-9 rounded-lg bg-primary px-4 text-body font-medium text-white hover:opacity-90`
- **次按钮**:`h-9 rounded-lg border border-gray-200 bg-sidebar px-4 text-body text-text-secondary hover:bg-gray-100 dark:border-white/10`
- **图标按钮**:`h-8 w-8 flex items-center justify-center rounded-full text-text-secondary hover:bg-black/5 hover:text-text-primary`（配 `size={20}`)
- **危险按钮**:`bg-red-600/rose-600 hover:opacity-90`

### Badge / 状态标签

`rounded-full` + `text-tiny font-semibold` + 彩色 `bg-{color}-100 text-{color}-700`（如 `bg-amber-100 text-amber-700` 警告、`bg-red-50 text-red-500` NEW 角标）。

### 输入框

`h-9 w-full rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 font-mono text-body text-text-primary focus:border-primary focus:bg-white focus:outline-none dark:border-slate-700/80 dark:bg-slate-800/50`

## Do's and Don'ts

**Do**
- 用 `text-*` token 而不是 `text-[Npx]`；写注释类小字优先 `text-caption` 而不是 `text-[10px]`（后者仅用于真正的角标 badge)
- AppIcon 尺寸只用 `size` prop，删掉 `text-[Npx]` 冗余类
- 弹窗统一走 `ui/Modal`，选 `solid` 或 `glass` 变体
- 图标尺寸就近归入档位（19 是文件树合法档，勿"优化"成 20)

**Don't**
- 新增 `text-[Npx]`、`z-[N]`、`size={13/17}` 这类任意值
- 给非角标小字用 `text-tiny`(10px)——那是 badge 专用，说明文字用 `caption`(11px）起
- 在 `Modal` 外包自定义遮罩/层级/动画
- 给弹窗用 `rounded-lg` 以外的实色变体圆角（`solid` 必须 `xl`,`glass` 必须 `2xl`)
- 全局替换 `text-xs/sm` 为 token——渐进迁移，改到哪个文件收哪个
- 在 `size` prop 旁再加 `text-[Npx]`/`text-title` 等图标尺寸冗余类
