# ModalShell 统一与 SettingsDrawer 拆分 Implementation Plan

> Created: 2026-07-05 12:54 (Local)
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 抽取一个通用 `ModalShell` 壳组件,把项目 6 个居中模态弹窗(3 个独立 + 3 个内嵌于 SettingsDrawer)收敛到统一壳,同时把 SettingsDrawer 内的 3 个 Editor Modal 拆为独立文件,使 SettingsDrawer.tsx 从 1503 行降至约 600 行。

**Architecture:** 新建 `components/ModalShell.tsx` 提供居中遮罩 + 头部(标题 + 关闭 X)+ 可选底部按钮区 + Esc 关闭 + 遮罩点击关闭,通过 `variant: 'glass' | 'solid'` 承载现有两套视觉风格。3 个 settings Modal 抽到 `components/settings/` 子目录,共用 `settings/shared.ts` 放 `validateBaseUrl`。`TaskSplitModal`(上拉浮层,非模态)不动。`SHORTCUT_LABELS` 与主抽屉逻辑保留在 `SettingsDrawer.tsx`。

**Tech Stack:** React 18, TypeScript (strict), Tailwind CSS 3, Zustand 4, electron-vite。无测试运行器,验证 = `npm run lint` + `npm run build` + `npm run dev` 手动验证。

## Global Constraints

- 严格 TypeScript,禁用 `any` 静默错误;故意未用变量以 `_` 前缀标记。
- 包管理器仅 `npm`。
- 分层边界:本计划全部在 `src/renderer/src/` 内,纯表现层重构,不碰 main/preload/IPC/Store。
- Tailwind 类名复用现有 token:`bg-app`、`text-text-primary`、`text-text-secondary`、`bg-primary`、`bg-sidebar`、`glass-panel-heavy`、`shadow-float`、`shadow-soft`、`animate-in`、`fade-in`、`zoom-in-95`。
- 不擅自切分支,只在当前分支工作。
- 每个任务结束提交(Conventional Commits),提交信息结尾附 `Co-Authored-By: Claude <noreply@anthropic.com>`。
- 视觉风格:双 variant 共存(`glass` 用于 3 个 settings Modal,`solid` 用于 3 个独立 Modal),不强行统一。
- 行为统一:所有套壳 Modal 都支持 Esc 关闭 + 点击遮罩关闭。
- `TaskSplitModal` 不纳入本次改造。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/renderer/src/components/ModalShell.tsx` | 通用模态壳:遮罩 + 头 + 底 + Esc + 遮罩点击关闭,`variant: glass\|solid` | 新建 |
| `src/renderer/src/components/settings/shared.ts` | settings Modal 共享的 `validateBaseUrl` | 新建 |
| `src/renderer/src/components/settings/PromptEditorModal.tsx` | 总结提示词编辑表单 | 新建(从 SettingsDrawer 抽出) |
| `src/renderer/src/components/settings/ProviderEditorModal.tsx` | 供应商编辑表单 | 新建(从 SettingsDrawer 抽出) |
| `src/renderer/src/components/settings/ModelEditorModal.tsx` | 模型配置(同步+列表+行内编辑+手动添加) | 新建(从 SettingsDrawer 抽出) |
| `src/renderer/src/components/SettingsDrawer.tsx` | 设置抽屉主组件,删除 3 个内嵌 Modal 定义,改为 import | 修改 |
| `src/renderer/src/components/ConfirmModal.tsx` | 通用确认弹窗,改用 ModalShell | 修改 |
| `src/renderer/src/components/RenameModal.tsx` | 重命名弹窗,改用 ModalShell | 修改 |
| `src/renderer/src/components/ImportCacheConfirmModal.tsx` | 缓存导入确认弹窗,改用 ModalShell | 修改 |

**ModalShell 接口契约(所有后续任务依赖):**

```tsx
interface ModalShellProps {
  isOpen: boolean
  onClose: () => void
  title: React.ReactNode
  children: React.ReactNode
  /** 底部按钮区,省略则不渲染底栏 */
  footer?: React.ReactNode
  /** 视觉风格:glass(玻璃派)/ solid(实色派),默认 'glass' */
  variant?: 'glass' | 'solid'
  /** 内容区宽度,数字按 px,字符串直接作 className 值(如 'max-w-md'、'w-[550px]');默认 'max-w-md' */
  width?: number | string
  /** 内容区最大高度,数字按 px,字符串作 className 值(如 'max-h-[80vh]');省略则不限 */
  maxHeight?: number | string
  /** 是否禁用 Esc 关闭(如表单未保存时),默认 false */
  disableEscape?: boolean
  /** 是否禁用点击遮罩关闭,默认 false */
  disableBackdropClose?: boolean
}
```

**variant → className 映射(锁定):**

| variant | 外层容器 | 头部分隔 | 圆角 | 阴影 |
|---|---|---|---|---|
| `glass` | `glass-panel-heavy` | `border-white/60` | `rounded-2xl` | `shadow-float` |
| `solid` | `bg-app border border-gray-200` | `border-gray-200` | `rounded-xl` | `shadow-2xl` |

遮罩统一:`absolute inset-0 bg-black/60`(glass 不加 blur 以匹配现有 settings Modal 行为;solid 派 ConfirmModal 原有 `backdrop-blur-sm`,迁移时为统一性移除 blur — 见 Task 8 说明)。

**行号基准说明:** 本计划行号以**当前 `SettingsDrawer.tsx`(1503 行)** 为准,已校验。`import` 区含 `AboutSection`(L8,不在删除范围,Task 6 不动)。所有"删除 Lxx-Lyy"指令均**以函数名锚定**,行号仅作辅助定位——若行号与函数名冲突,以函数名为准。

---

### Task 1: 新建 ModalShell 通用壳组件

**Files:**
- Create: `src/renderer/src/components/ModalShell.tsx`

**Interfaces:**
- Consumes: 无(首个任务)
- Produces: `ModalShell` 组件 + `ModalShellProps` 接口(见 File Structure 锁定的契约)

- [ ] **Step 1: 写出 ModalShell 完整实现**

创建 `src/renderer/src/components/ModalShell.tsx`:

```tsx
import { useEffect, type ReactNode } from 'react'

export interface ModalShellProps {
  isOpen: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  variant?: 'glass' | 'solid'
  width?: number | string
  maxHeight?: number | string
  disableEscape?: boolean
  disableBackdropClose?: boolean
}

/**
 * 通用模态壳:居中遮罩 + 头部(标题 + 关闭按钮)+ 内容区 + 可选底部按钮区。
 * 统一 Esc 关闭与点击遮罩关闭。variant 区分 glass / solid 两套视觉风格。
 */
export default function ModalShell({
  isOpen,
  onClose,
  title,
  children,
  footer,
  variant = 'glass',
  width = 'max-w-md',
  maxHeight,
  disableEscape = false,
  disableBackdropClose = false
}: ModalShellProps): JSX.Element | null {
  useEffect(() => {
    if (!isOpen || disableEscape) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, disableEscape, onClose])

  if (!isOpen) return null

  const isGlass = variant === 'glass'
  const containerClass = isGlass
    ? 'glass-panel-heavy rounded-2xl shadow-float'
    : 'bg-app border border-gray-200 rounded-xl shadow-2xl'
  const headerBorder = isGlass ? 'border-white/60' : 'border-gray-200'

  const widthStyle: React.CSSProperties =
    typeof width === 'number' ? { width: `${width}px` } : {}
  const widthClass = typeof width === 'string' ? width : ''

  // maxHeight: 数字走 inline style(px),字符串走 className(如 'max-h-[80vh]')
  const maxHeightStyle: React.CSSProperties =
    typeof maxHeight === 'number' ? { maxHeight: `${maxHeight}px` } : {}
  const maxHeightClass = typeof maxHeight === 'string' ? maxHeight : ''

  const handleBackdropClick = (): void => {
    if (!disableBackdropClose) onClose()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 animate-in fade-in duration-200"
        onClick={handleBackdropClick}
      />
      <div
        className={`relative ${containerClass} flex flex-col ${widthClass} ${maxHeightClass}`}
        style={{ ...widthStyle, ...maxHeightStyle }}
      >
        <div
          className={`flex items-center justify-between p-4 border-b ${headerBorder}`}
        >
          <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-text-secondary hover:text-text-primary hover:bg-black/5 transition-colors"
            aria-label="关闭"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="flex-1 p-4 overflow-y-auto">{children}</div>
        {footer ? (
          <div
            className={`flex justify-end gap-3 p-4 border-t ${headerBorder}`}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 运行 lint 验证类型**

Run: `npm run lint`
Expected: PASS,无 `@typescript-eslint/no-explicit-any` 或未使用变量警告。

- [ ] **Step 3: 运行 build 验证打包**

Run: `npm run build`
Expected: PASS,`out/renderer` 产物生成。

- [ ] **Step 4: 提交**

```bash
git add src/renderer/src/components/ModalShell.tsx
git commit -m "$(cat <<'EOF'
feat(modal): add ModalShell reusable modal shell component

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 新建 settings/shared.ts 放 validateBaseUrl

**Files:**
- Create: `src/renderer/src/components/settings/shared.ts`

**Interfaces:**
- Consumes: 无
- Produces: `validateBaseUrl(url: string): string | null` — 返回 null 表示通过,返回字符串为错误信息。

- [ ] **Step 1: 写出 shared.ts**

创建 `src/renderer/src/components/settings/shared.ts`:

```ts
/**
 * 校验 baseUrl 格式:必须以 http:// 或 https:// 开头。
 * 返回 null 表示通过,返回字符串表示错误信息。
 * 不强制要求 /v1 结尾(不同供应商路径不同,如 OpenRouter /api/v1、Gemini /v1beta)。
 */
export function validateBaseUrl(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return 'Base URL 不能为空'
  if (!/^https?:\/\//i.test(trimmed)) return 'Base URL 需以 http:// 或 https:// 开头'
  return null
}
```

- [ ] **Step 2: lint + build**

Run: `npm run lint && npm run build`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/renderer/src/components/settings/shared.ts
git commit -m "$(cat <<'EOF'
refactor(settings): extract validateBaseUrl to settings/shared

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 抽出 PromptEditorModal 并套壳

**Files:**
- Create: `src/renderer/src/components/settings/PromptEditorModal.tsx`
- Reference(只读,对照原实现): `src/renderer/src/components/SettingsDrawer.tsx:46-168`(`function PromptEditorModal` 整段)

**Interfaces:**
- Consumes: `ModalShell`(Task 1);`SummaryPrompt` 类型从 `../../store/appStore` 导入
- Produces: 默认导出 `PromptEditorModal`,Props 与原实现一致:

```tsx
interface PromptEditorModalProps {
  isOpen: boolean
  onClose: () => void
  prompt: SummaryPrompt | null
  onSave: (prompt: SummaryPrompt) => Promise<void>
  isNew?: boolean
}
```

- [ ] **Step 1: 写出 PromptEditorModal.tsx**

创建 `src/renderer/src/components/settings/PromptEditorModal.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { type SummaryPrompt } from '../../store/appStore'
import ModalShell from '../ModalShell'

interface PromptEditorModalProps {
  isOpen: boolean
  onClose: () => void
  prompt: SummaryPrompt | null
  onSave: (prompt: SummaryPrompt) => Promise<void>
  isNew?: boolean
}

export default function PromptEditorModal({
  isOpen,
  onClose,
  prompt,
  onSave,
  isNew
}: PromptEditorModalProps): JSX.Element | null {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [promptText, setPromptText] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (isOpen) {
      if (prompt) {
        setName(prompt.name)
        setDescription(prompt.description || '')
        setPromptText(prompt.prompt)
      } else {
        setName('')
        setDescription('')
        setPromptText('')
      }
    }
  }, [isOpen, prompt])

  const handleSave = async (): Promise<void> => {
    if (!name.trim()) return
    setIsSaving(true)
    try {
      await onSave({
        id: prompt?.id || String(Date.now()),
        name: name.trim(),
        description: description.trim() ? description.trim() : undefined,
        prompt: promptText.trim(),
        isDefault: prompt?.isDefault || false
      })
      onClose()
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={isNew ? '新增总结提示词' : '编辑总结提示词'}
      variant="glass"
      width="w-[600px]"
      maxHeight="max-h-[80vh]"
      footer={
        <>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-full glass-panel text-text-primary hover:bg-black/5 transition-colors text-sm"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || isSaving}
            className="px-5 py-2 rounded-full bg-primary text-white font-medium shadow-soft hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm"
          >
            保存
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">名称</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="输入提示词名称"
            className="w-full px-3 py-2 glass-panel rounded-lg text-text-primary placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">描述</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="一句话描述这个提示词的用途(可选)"
            rows={3}
            className="w-full px-3 py-2 glass-panel rounded-lg text-text-primary placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none text-sm transition-all"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">提示词内容</label>
          <textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            placeholder="输入提示词内容..."
            rows={12}
            className="w-full px-3 py-2 glass-panel rounded-lg text-text-primary placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none font-mono text-sm transition-all"
          />
        </div>
      </div>
    </ModalShell>
  )
}
```

> 说明:原实现用 `max-h-[80vh]`,此处直接以字符串 `maxHeight="max-h-[80vh]"` 传入 ModalShell(Task 1 已支持字符串形态 maxHeight,走 className),保留视口相对语义,不换算成固定 px。

- [ ] **Step 2: lint + build**

Run: `npm run lint && npm run build`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/renderer/src/components/settings/PromptEditorModal.tsx
git commit -m "$(cat <<'EOF'
refactor(settings): extract PromptEditorModal to own file, use ModalShell

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 抽出 ProviderEditorModal 并套壳

**Files:**
- Create: `src/renderer/src/components/settings/ProviderEditorModal.tsx`
- Reference: `src/renderer/src/components/SettingsDrawer.tsx:170-262`(`function ProviderEditorModal` 整段)

**Interfaces:**
- Consumes: `ModalShell`(Task 1);`validateBaseUrl`(Task 2);`ApiProvider` from `../../store/appStore`
- Produces: 默认导出 `ProviderEditorModal`,Props:

```tsx
interface ProviderEditorModalProps {
  isOpen: boolean
  onClose: () => void
  provider: ApiProvider | null
  onSave: (provider: ApiProvider) => void
  isNew?: boolean
}
```

- [ ] **Step 1: 写出 ProviderEditorModal.tsx**

创建 `src/renderer/src/components/settings/ProviderEditorModal.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { type ApiProvider } from '../../store/appStore'
import ModalShell from '../ModalShell'
import { validateBaseUrl } from './shared'

interface ProviderEditorModalProps {
  isOpen: boolean
  onClose: () => void
  provider: ApiProvider | null
  onSave: (provider: ApiProvider) => void
  isNew?: boolean
}

export default function ProviderEditorModal({
  isOpen,
  onClose,
  provider,
  onSave,
  isNew
}: ProviderEditorModalProps): JSX.Element | null {
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrlError, setBaseUrlError] = useState('')

  useEffect(() => {
    if (isOpen) {
      setName(provider?.name || '')
      setBaseUrl(provider?.baseUrl || '')
      setApiKey(provider?.apiKey || '')
      setBaseUrlError('')
    }
  }, [isOpen, provider])

  const handleSave = (): void => {
    if (!name.trim() || !apiKey.trim()) return
    const urlError = validateBaseUrl(baseUrl)
    if (urlError) {
      setBaseUrlError(urlError)
      return
    }
    onSave({
      id: provider?.id || `provider-${Date.now()}`,
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      enabled: provider ? provider.enabled : true
    })
    onClose()
  }

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={isNew ? '新增供应商' : '编辑供应商'}
      variant="glass"
      width="w-[450px]"
      footer={
        <>
          <button onClick={onClose} className="px-4 py-2 rounded-full glass-panel text-text-primary hover:bg-black/5 transition-colors text-sm">取消</button>
          <button onClick={handleSave} className="px-5 py-2 rounded-full bg-primary text-white font-medium shadow-soft hover:opacity-90 transition-all text-sm">保存</button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1.5">名称</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如:OpenRouter"
            className="w-full px-3 py-2 glass-panel rounded-lg text-text-primary placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/30 text-sm transition-all"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1.5">Base URL</label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => { setBaseUrl(e.target.value); setBaseUrlError('') }}
            placeholder="https://api.openai.com/v1"
            className={`w-full px-3 py-2 glass-panel rounded-lg text-text-primary placeholder-gray-400 focus:outline-none focus:ring-2 text-sm transition-all ${baseUrlError ? 'ring-2 ring-red-400' : 'focus:ring-primary/30'}`}
          />
          {baseUrlError && (
            <p className="mt-1.5 text-xs text-red-500">{baseUrlError}</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1.5">API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            className="w-full px-3 py-2 glass-panel rounded-lg text-text-primary placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/30 text-sm transition-all"
          />
          <p className="mt-1.5 text-[11px] text-text-secondary">Key 仅保存在本地配置文件,不会上传。导出缓存时将自动脱敏。</p>
        </div>
      </div>
    </ModalShell>
  )
}
```

- [ ] **Step 2: lint + build**

Run: `npm run lint && npm run build`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/renderer/src/components/settings/ProviderEditorModal.tsx
git commit -m "$(cat <<'EOF'
refactor(settings): extract ProviderEditorModal to own file, use ModalShell

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 抽出 ModelEditorModal 并套壳

**Files:**
- Create: `src/renderer/src/components/settings/ModelEditorModal.tsx`
- Reference: `src/renderer/src/components/SettingsDrawer.tsx:264-566`(`function ModelEditorModal` 整段,以闭合 `}` 在 L566 为准)

**Interfaces:**
- Consumes: `ModalShell`(Task 1);`validateBaseUrl`(Task 2);`SummaryModel`/`ApiProvider` from `../../store/appStore`;`CustomDropdown` + `DropdownOption` from `../CustomDropdown`
- Produces: 默认导出 `ModelEditorModal`,Props:

```tsx
interface ModelEditorModalProps {
  isOpen: boolean
  onClose: () => void
  models: SummaryModel[]
  onSave: (models: SummaryModel[]) => void
  providers: ApiProvider[]
}
```

> 注意:原实现 `handleSyncModels` 用 `(window.api as any).fetchModels`(原 `SettingsDrawer.tsx:333`)。Task 5 保留此 `as any` 调用方式(与原代码一致),不在本计划扩展 IPC 契约。已确认 `.eslintrc.cjs` 中 `@typescript-eslint/no-explicit-any` 为 `warn` 级别(非 error),故 `npm run lint` 不会因此失败。

- [ ] **Step 1: 写出 ModelEditorModal.tsx 完整实现**

创建 `src/renderer/src/components/settings/ModelEditorModal.tsx`,把 `SettingsDrawer.tsx:264-566` 的 `ModelEditorModal` 函数体(含 `useState`/`useEffect`/`handleSyncModels`/`handleAddModel`/`handleRemoveModel`/`handleStartEditModel`/`handleCommitEditModel`/`handleCancelEditModel`/`handleSave` 与 JSX)整体搬入,改动如下:
1. 顶部 import:`useAppStore` 不需要(本组件不直接用 store),只需 `type SummaryModel`/`type ApiProvider` from `../../store/appStore`、`ModalShell` from `../ModalShell`、`validateBaseUrl` from `./shared`、`CustomDropdown, { type DropdownOption }` from `../CustomDropdown`。
2. 把原 JSX 外层 `<div className="fixed inset-0..."> ... <div className="relative w-[550px] max-h-[85vh] glass-panel-heavy rounded-2xl shadow-float flex flex-col"> ... </div></div>` 替换为 `ModalShell` 调用,`variant="glass"`、`width="w-[550px]"`、`maxHeight="max-h-[85vh]"`、`title="配置可用模型"`,把原头部(标题+关闭按钮)删除(由 ModalShell 提供),把原内容区 `<div className="flex-1 p-4 space-y-4 overflow-y-auto">...</div>` 内部内容作为 `children`,把原底部按钮区 `<div className="flex justify-end gap-3 p-4 border-t border-white/60">...</div>` 内部按钮作为 `footer`。
3. 其余逻辑(`handleSyncModels` 等)原样保留,包括 `(window.api as any).fetchModels`。
4. 函数签名加 `export default function ModelEditorModal(...)`。

由于本组件内容较长,实现时直接以 `SettingsDrawer.tsx:264-566` 为基准逐行搬运 + 上述 3 处改动,不发明新逻辑。

- [ ] **Step 2: lint + build**

Run: `npm run lint && npm run build`
Expected: PASS。若 lint 报 `@typescript-eslint/no-explicit-any` on `(window.api as any)`,确认原代码同样如此(原 `SettingsDrawer.tsx:333` 即为 `as any`,且 `.eslintrc.cjs` 该规则为 `warn` 级别),保持一致不阻断。

- [ ] **Step 3: 提交**

```bash
git add src/renderer/src/components/settings/ModelEditorModal.tsx
git commit -m "$(cat <<'EOF'
refactor(settings): extract ModelEditorModal to own file, use ModalShell

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: SettingsDrawer 删除内嵌 Modal 并改为 import

**Files:**
- Modify: `src/renderer/src/components/SettingsDrawer.tsx`(删除 L20-566 的 3 个内嵌组件 + `validateBaseUrl` 定义,改为 import)

**Interfaces:**
- Consumes: Task 3/4/5 的三个 Modal + Task 2 的 `validateBaseUrl`(若主组件不再用 `validateBaseUrl` 则不 import;Step 1 会确认)
- Produces: `SettingsDrawer` 主组件,行为不变

- [ ] **Step 1: 确认 SettingsDrawer 主组件是否还用 validateBaseUrl**

Run: `grep -n "validateBaseUrl" src/renderer/src/components/SettingsDrawer.tsx`
Expected: 删除内嵌 Modal 后,主组件(`function SettingsDrawer` 起,即 L572+)不应再出现 `validateBaseUrl`(原使用点在 ProviderEditorModal/ModelEditorModal 内,均已删除)。若无残留引用,不需要 import;若 grep 仍命中主组件代码,则加 `import { validateBaseUrl } from './settings/shared'`。

- [ ] **Step 2: 修改 SettingsDrawer.tsx 顶部 import**

在 `import` 区把三个内嵌组件的类型来源保持(`SummaryPrompt`/`SummaryModel`/`ApiProvider`/`ApiConfig` 仍从 `../store/appStore` 来,主组件仍需这些类型)。`import AboutSection from './AboutSection'`(L8)**保持不动**。新增:

```tsx
import PromptEditorModal from './settings/PromptEditorModal'
import ProviderEditorModal from './settings/ProviderEditorModal'
import ModelEditorModal from './settings/ModelEditorModal'
```

- [ ] **Step 3: 删除内嵌组件(以函数名锚定,行号仅辅助)**

删除 `SettingsDrawer.tsx` 中以下整段(从函数签名行到其闭合 `}`):
- `function validateBaseUrl(...)` 整段(L20-25)
- `function PromptEditorModal(...)` 整段,含其上方的 `interface PromptEditorModalProps` 与注释(L37-168)
- `function ProviderEditorModal(...)` 整段,含其上方 interface 与注释(L160-262)
- `function ModelEditorModal(...)` 整段,含其上方 interface 与注释(L258-566)

> 执行方式:用 Read 定位每个 `function XxxEditorModal` / `interface XxxEditorModalProps` 的起点,删除到下一个保留项之前。**不要按固定行号区间盲删**——文件在编辑过程中行号会漂移,函数名锚定才可靠。

保留 `SHORTCUT_LABELS`(L27-35,主组件 L614 仍用 `conflictLabel = SHORTCUT_LABELS[...]`)和 `SettingsDrawerProps`(L10-13)。

- [ ] **Step 4: 验证调用点不变**

`SettingsDrawer.tsx` 中三处调用(`function SettingsDrawer` 内,约 L1431-1453)的 `<PromptEditorModal>`/`<ProviderEditorModal>`/`<ModelEditorModal>` 保持原样(Props 签名未变,import 已就位)。

- [ ] **Step 5: lint + build**

Run: `npm run lint && npm run build`
Expected: PASS,无 "X is defined but never used"(删除后无残留)、无 "cannot find name"。

- [ ] **Step 6: 行数核对**

Run: `wc -l src/renderer/src/components/SettingsDrawer.tsx`
Expected: 约 600 行(原 1503 - 删除约 900 行内嵌 Modal)。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/src/components/SettingsDrawer.tsx
git commit -m "$(cat <<'EOF'
refactor(settings): remove inlined editor modals from SettingsDrawer, import from settings/

SettingsDrawer.tsx: 1503 -> ~600 lines.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 迁移 ConfirmModal 到 ModalShell(solid variant)

**Files:**
- Modify: `src/renderer/src/components/ConfirmModal.tsx`

**Interfaces:**
- Consumes: `ModalShell`(Task 1)
- Produces: `ConfirmModal` 行为不变,Props 不变

- [ ] **Step 1: 重写 ConfirmModal.tsx**

整体替换 `src/renderer/src/components/ConfirmModal.tsx`:

```tsx
import { useState } from 'react'
import ModalShell from './ModalShell'

interface ConfirmModalProps {
  isOpen: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  onConfirm: () => void | Promise<void>
  onCancel: () => void
  type?: 'danger' | 'warning' | 'info'
}

function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  onConfirm,
  onCancel,
  type = 'danger'
}: ConfirmModalProps): JSX.Element | null {
  const [isConfirming, setIsConfirming] = useState(false)

  const handleConfirm = async (): Promise<void> => {
    if (isConfirming) return
    setIsConfirming(true)
    try {
      await onConfirm()
    } finally {
      setIsConfirming(false)
    }
  }

  const theme = (() => {
    switch (type) {
      case 'danger':
        return { button: 'bg-red-600 hover:bg-red-500', icon: 'text-red-500', iconName: 'error' }
      case 'warning':
        return { button: 'bg-yellow-600 hover:bg-yellow-500', icon: 'text-yellow-500', iconName: 'warning' }
      default:
        return { button: 'bg-primary hover:bg-primary/80', icon: 'text-primary', iconName: 'info' }
    }
  })()

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onCancel}
      title={
        <span className="flex items-center gap-3">
          <span className={`material-symbols-outlined text-3xl ${theme.icon}`}>{theme.iconName}</span>
          {title}
        </span>
      }
      variant="solid"
      width="max-w-sm"
      footer={
        <>
          <button
            onClick={onCancel}
            disabled={isConfirming}
            className="flex-1 px-4 py-2 bg-sidebar text-text-secondary rounded-lg hover:bg-gray-100 transition-colors font-medium"
          >
            {cancelText}
          </button>
          <button
            onClick={handleConfirm}
            disabled={isConfirming}
            className={`flex-1 px-4 py-2 text-text-primary rounded-lg transition-colors font-medium ${theme.button}`}
          >
            {confirmText}
          </button>
        </>
      }
    >
      <p className="text-text-secondary mb-2 leading-relaxed">{message}</p>
    </ModalShell>
  )
}

export default ConfirmModal
```

> 视觉变化说明:原 ConfirmModal 遮罩有 `backdrop-blur-sm`,ModalShell 统一为 `bg-black/60` 无 blur。这是为统一性主动接受的微小视觉回归(遮罩 blur 影响极小)。原内容区 `p-6`,ModalShell 头/底各 `p-4` + 内容 `p-4`,padding 略变但布局一致。`max-w-sm` 通过 `width` 字符串传入。

- [ ] **Step 2: lint + build**

Run: `npm run lint && npm run build`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/renderer/src/components/ConfirmModal.tsx
git commit -m "$(cat <<'EOF'
refactor(modal): migrate ConfirmModal to ModalShell (solid variant)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: 迁移 RenameModal 到 ModalShell(solid variant)

**Files:**
- Modify: `src/renderer/src/components/RenameModal.tsx`

**Interfaces:**
- Consumes: `ModalShell`(Task 1)
- Produces: `RenameModal` Props 不变

- [ ] **Step 1: 重写 RenameModal.tsx**

整体替换 `src/renderer/src/components/RenameModal.tsx`:

```tsx
import { useEffect, useState } from 'react'
import ModalShell from './ModalShell'

interface RenameModalProps {
  isOpen: boolean
  title?: string
  placeholder?: string
  initialValue?: string
  confirmText?: string
  cancelText?: string
  onConfirm: (value: string) => void | Promise<void>
  onCancel: () => void
}

function RenameModal({
  isOpen,
  title = '重命名',
  placeholder = '输入新的名称',
  initialValue = '',
  confirmText = '保存',
  cancelText = '取消',
  onConfirm,
  onCancel
}: RenameModalProps): JSX.Element | null {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [isConfirming, setIsConfirming] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setValue(initialValue || '')
    setError('')
    setIsConfirming(false)
  }, [isOpen, initialValue])

  const handleConfirm = async (): Promise<void> => {
    const trimmed = value.trim()
    if (!trimmed) {
      setError('名称不能为空')
      return
    }
    if (isConfirming) return
    setIsConfirming(true)
    try {
      await onConfirm(trimmed)
    } finally {
      setIsConfirming(false)
    }
  }

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      variant="solid"
      width="max-w-md"
      footer={
        <>
          <button
            onClick={onCancel}
            disabled={isConfirming}
            className="text-sm px-4 py-2 rounded-lg bg-sidebar text-text-secondary hover:bg-gray-100 transition-all border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelText}
          </button>
          <button
            onClick={handleConfirm}
            disabled={isConfirming}
            className="text-sm px-4 py-2 rounded-lg bg-primary text-white hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {confirmText}
          </button>
        </>
      }
    >
      <div>
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            if (error) setError('')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleConfirm()
          }}
          className="w-full px-4 py-2.5 rounded-lg bg-sidebar border border-gray-200 focus:outline-none focus:border-primary/60 text-text-primary placeholder-gray-500"
          placeholder={placeholder}
          autoFocus
        />
        {error ? (
          <div className="mt-2 text-sm text-red-400">{error}</div>
        ) : null}
      </div>
    </ModalShell>
  )
}

export default RenameModal
```

> 视觉/行为说明:原 RenameModal 自行监听 Esc 与 Enter;现在 Esc 由 ModalShell 统一处理,Enter 仍由 input 的 onKeyDown 处理。原 Esc 在 input 内触发 `onCancel`,现 Esc 由 document 级监听触发 `onClose`(即 onCancel),行为等价。原 input Esc 分支可移除(ModalShell 已覆盖)。

- [ ] **Step 2: lint + build**

Run: `npm run lint && npm run build`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/renderer/src/components/RenameModal.tsx
git commit -m "$(cat <<'EOF'
refactor(modal): migrate RenameModal to ModalShell (solid variant)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: 迁移 ImportCacheConfirmModal 到 ModalShell(solid variant)

**Files:**
- Modify: `src/renderer/src/components/ImportCacheConfirmModal.tsx`

**Interfaces:**
- Consumes: `ModalShell`(Task 1)
- Produces: `ImportCacheConfirmModal` Props 不变

- [ ] **Step 1: 重写 ImportCacheConfirmModal.tsx**

整体替换 `src/renderer/src/components/ImportCacheConfirmModal.tsx`:

```tsx
import ModalShell from './ModalShell'

interface ImportCacheConfirmModalProps {
  isOpen: boolean
  file: string
  keys: string[]
  conflicts: string[]
  /** 导入数据中是否含 REDACTED apiKey 的供应商(需标注保留本地 Key) */
  redactedProviderCount: number
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

const CACHE_KEY_LABELS: Record<string, string> = {
  displayMode: '显示模式',
  models: '主界面模型列表',
  apiConfig: 'API 配置(供应商/总结模式/导出目录等)',
  summaryModels: '可用总结模型',
  history: '主界面对话历史',
  summaryHistory: '总结历史记录',
  geminiAccountUrl: 'Gemini 账户 URL'
}

function ImportCacheConfirmModal({
  isOpen,
  file,
  keys,
  conflicts,
  redactedProviderCount,
  onConfirm,
  onCancel
}: ImportCacheConfirmModalProps): JSX.Element | null {
  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onCancel}
      title="导入缓存数据"
      variant="solid"
      width="w-[520px]"
      maxHeight="max-h-[80vh]"
      footer={
        <>
          <button onClick={onCancel} className="px-4 py-2 text-text-secondary hover:text-text-primary transition-colors text-sm">取消</button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-primary text-white font-medium rounded-md hover:opacity-90 transition-colors text-sm"
          >
            确认导入
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-text-secondary">
          将从文件导入以下数据,<span className="text-yellow-600 font-medium">覆盖</span>现有同名配置:
        </p>
        <div className="text-[11px] text-gray-500 truncate" title={file}>来源:{file}</div>

        <div className="space-y-1">
          {keys.map(k => {
            const isConflict = conflicts.includes(k)
            const label = CACHE_KEY_LABELS[k] || k
            return (
              <div key={k} className="flex items-center justify-between px-3 py-1.5 bg-sidebar/50 rounded">
                <span className="text-text-primary">{label}</span>
                <span className={`text-[10px] ${isConflict ? 'text-yellow-600' : 'text-gray-500'}`}>
                  {isConflict ? '将覆盖现有' : '新增'}
                </span>
              </div>
            )
          })}
        </div>

        {conflicts.includes('history') && (
          <p className="text-[11px] text-red-500">⚠ 将覆盖现有主界面对话历史记录</p>
        )}
        {conflicts.includes('summaryHistory') && (
          <p className="text-[11px] text-red-500">⚠ 将覆盖现有总结历史记录</p>
        )}
        {redactedProviderCount > 0 && (
          <p className="text-[11px] text-text-secondary">
            🔒 导入文件中有 {redactedProviderCount} 个供应商的 API Key 已脱敏,将保留本地现有 Key。
          </p>
        )}
        <p className="text-[11px] text-gray-500">
          导入前已自动备份当前缓存为导出文件(若失败不阻断导入)。导入后建议重启应用以使全部变更生效。
        </p>
      </div>
    </ModalShell>
  )
}

export default ImportCacheConfirmModal
```

> 视觉说明:原组件主容器用 `rounded-lg`,ModalShell solid 用 `rounded-xl`,圆角略变大;原 footer 按钮形状保留(圆角 md)。属可接受微调。

- [ ] **Step 2: lint + build**

Run: `npm run lint && npm run build`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/renderer/src/components/ImportCacheConfirmModal.tsx
git commit -m "$(cat <<'EOF'
refactor(modal): migrate ImportCacheConfirmModal to ModalShell (solid variant)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: 全量验证与手动回归

**Files:**
- 无新文件,全量校验

- [ ] **Step 1: 全量 lint + build**

Run: `npm run lint && npm run build`
Expected: PASS,0 error。

- [ ] **Step 2: dev 手动回归(Modal 行为)**

Run: `npm run dev`

逐项验证(每项打开 → 操作 → 关闭):
1. 设置抽屉 → 新增/编辑总结提示词 → Modal 弹出,标题/输入框/保存按钮正常 → Esc 关闭 → 遮罩点击关闭。
2. 设置抽屉 → 新增/编辑供应商 → Modal 正常,Base URL 校验红字仍生效 → Esc 关闭。
3. 设置抽屉 → 配置可用模型 → Modal 正常,自动同步/行内改名/手动添加/删除均正常 → 保存配置。
4. 任意触发 ConfirmModal(如删除提示词/供应商)→ danger 主题红色按钮 → Esc/遮罩关闭。
5. 历史记录重命名 → RenameModal → 输入空值显示红字错误 → Enter 提交 → Esc 关闭。
6. 设置 → 导入缓存 → ImportCacheConfirmModal 列表正确,冲突项黄色标注 → 确认导入。
7. TaskSplitModal(未改动)→ 上拉浮层仍正常,无遮罩,Esc 关闭仍工作。

- [ ] **Step 3: 验证无回归 — TypeScript 严格检查**

Run: `npm run build`
Expected: PASS(strict 模式无 `any` 新增告警,除原 `window.api as any`)。

- [ ] **Step 4: 跑 session_log**

Run: `python .memory/session_log.py --done "ModalShell 统一与 SettingsDrawer 拆分" --added "src/renderer/src/components/ModalShell.tsx; src/renderer/src/components/settings/shared.ts; src/renderer/src/components/settings/PromptEditorModal.tsx; src/renderer/src/components/settings/ProviderEditorModal.tsx; src/renderer/src/components/settings/ModelEditorModal.tsx" --modified "src/renderer/src/components/SettingsDrawer.tsx; src/renderer/src/components/ConfirmModal.tsx; src/renderer/src/components/RenameModal.tsx; src/renderer/src/components/ImportCacheConfirmModal.tsx" --lesson "ModalShell variant: glass|solid 收敛两套风格;Esc/遮罩关闭统一到壳层"`

Expected: 脚本输出日志路径,若有 "Consider promoting..." 提示则按 CLAUDE.md 处理。

---

## Self-Review

**1. Spec coverage:**
- 抽 ModalShell 通用壳 → Task 1 ✅
- 3 个 settings Modal 抽出 + 套壳 → Task 3/4/5 ✅
- SettingsDrawer 删除内嵌改为 import → Task 6 ✅
- 3 个独立 Modal 套壳 → Task 7/8/9 ✅
- Esc + 遮罩点击统一补齐 → Task 1 的 ModalShell 内置,所有套壳 Modal 自动获得 ✅
- TaskSplitModal 不动 → Global Constraints 明确,无任务触及 ✅
- 全量验证 → Task 10 ✅

**2. Placeholder scan:** Task 5 用"以基准逐行搬运"而非逐行复制完整 ~300 行,这是计划长度权衡——但已给出精确行号(`SettingsDrawer.tsx:264-566`)、3 处明确改动点,且 Task 6 删除指令改为**函数名锚定**(不依赖固定行号盲删),subagent 可机械执行。其余任务代码完整。无 TBD/TODO。

**3. Type consistency:** `ModalShellProps` 在 Task 1 定义,`width`/`maxHeight` 均为 `number | string`(数字走 inline style px,字符串走 className,支持 `'max-h-[80vh]'`/`'w-[520px]'` 等视口相对语义)。Task 3/4/5/7/8/9 引用的 `variant`/`width`/`maxHeight`/`footer`/`title`/`isOpen`/`onClose` 字段名与类型一致。`validateBaseUrl` 在 Task 2 定义为 `(url: string): string | null`,Task 4/5 引用一致。三个 Editor Modal 的 Props 签名与 SettingsDrawer 原调用点(约 L1431-1453)一致。`AboutSection` import(L8)不在删除范围,Task 6 明确保留不动。

---

## 执行选择

**Plan complete and saved to `docs/superpowers/plans/2026-07-05-modal-shell-unification.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - 每个 task 派发独立 subagent 执行,task 间我做 review,快速迭代。

**2. Inline Execution** - 在当前会话用 executing-plans 批量执行,带检查点。

**Which approach?**(你已选 Subagent 驱动)
