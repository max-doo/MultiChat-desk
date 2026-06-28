> Created: 2026-06-28 15:04 (+08:00)

# Webview 初始加载诊断

## 目标

解决 webview 初始加载耗时或失败时，页面只显示空白、无任何错误提示的问题。为 `WebviewCard` 组件增加加载超时检测、错误分类诊断和针对性恢复操作。

## 范围

- **仅覆盖初始加载**：`webview.loadURL()` 首次加载到 `dom-ready` 之间的生命周期
- 不包括运行时崩溃、页面内导航失败、SummaryPanel 加载流程

## 方案

纯渲染层方案（方案 A）：所有逻辑在 `WebviewCard.tsx` 内闭环，利用 Electron 的 `did-fail-load` 错误码 + `navigator.onLine` 做错误分类，用 `setTimeout` 做超时检测。零 IPC 改动。

---

## 设计

### 1. 错误分类体系

基于 Electron `did-fail-load` 的 `errorCode`，将错误归为 4 个用户可理解的类别：

| 类别 | 触发条件 | 图标 | 提示文案 | 操作按钮 |
|---|---|---|---|---|
| **无网络** | `errorCode === -106` 或 `navigator.onLine === false` | `wifi_off` | "网络连接已断开，请检查网络后重试" | 重试 |
| **DNS 解析失败** | `errorCode === -105` / `-137` | `dns` | "无法解析域名，请检查地址是否正确" | 修改地址 / 重试 |
| **连接超时** | `errorCode === -118` 或 30s 超时计时器触发 | `hourglass_empty` | "页面加载超时，请检查网络或稍后重试" | 重试 |
| **连接失败** | `-2`/`-6`/`-101`/`-102`/`-104` 等其余错误码 | `cloud_off` | "无法连接到 {hostname}（错误码: {code}）" | 重试 |

- `errorCode === -3`（用户主动取消）保持现有行为，静默忽略
- 错误码映射表以常量形式定义在 `WebviewCard.tsx` 顶部

### 2. 超时机制

新增 `loadTimeoutRef` 计时器，与现有 `isLoading` / `loadError` 状态协作：

```
did-start-loading  →  isLoading=true, 启动 30s 定时器, 清除旧错误
       │
       ├─ dom-ready 触发（正常） → 清除定时器, isLoading=false, isReady=true
       │
       ├─ did-fail-load 触发   → 清除定时器, isLoading=false, 设置 loadError
       │
       └─ 30s 定时器触发（超时） → 清除定时器, isLoading=false,
                                   loadError = { type: 'timeout', ... }
                                   webview.stop() 停止继续加载
```

- 定时器在 `did-start-loading` 时创建，在 `dom-ready` / `did-fail-load` / 组件卸载时清除
- 超时后调用 `webview.stop()` 释放资源
- 仅对 `isFirstLoad`（首次加载）启用超时，后续页面内导航不触发
- `resetToInitial()` 中的 `loadURL` 算首次加载，复用同一超时逻辑

### 3. Loading 状态增强

- 在 spinner 下方增加动态计时："已等待 {N}s..."
- N >= 15 时，文案变为 "页面加载较慢，请耐心等待..."
- N >= 25 时，额外显示取消按钮（调用 `webview.stop()` 并手动触发超时错误展示）

### 4. 错误覆盖层 UI

通用结构（所有错误类型共用）：

```
┌─────────────────────────────────┐
│                                 │
│         🔴 图标 (48px)          │
│                                 │
│      主提示文案 (14px)           │
│    辅助诊断信息 (12px, 灰色)      │
│                                 │
│   [主操作按钮]  [次操作按钮]      │
│                                 │
└─────────────────────────────────┘
```

各类型差异：

| 类型 | 主按钮 | 次按钮 |
|---|---|---|
| 无网络 | `🔄 重试` | — |
| DNS 失败 | `🔗 修改地址` → 聚焦地址栏 | `🔄 重试` |
| 超时 | `🔄 重试` | — |
| 连接失败 | `🔄 重试` | — |

视觉：
- 覆盖层背景 `bg-app/80` 半透明
- 错误卡片 `bg-surface` 圆角 + 阴影，居中
- 错误码以等宽小字显示在辅助信息中

---

## 实现要点

1. **改动范围**：仅 `src/renderer/src/components/WebviewCard.tsx`
2. **新增常量**：`ERROR_CATEGORY_MAP`（错误码→类别映射）、`LOAD_TIMEOUT_MS = 30_000`
3. **新增 ref**：`loadTimeoutRef`、`elapsedSecondsRef`（计时器 interval）
4. **新增状态**：`elapsedSeconds`（用于动态计时显示）
5. **修改逻辑**：`handleLoadStart`、`handleDomReady`、`handleLoadFail`、`useEffect` cleanup
6. **新增函数**：`classifyError(errorCode, hostname)` → `{ category, icon, title, subtitle, actions }`
7. **修改 JSX**：替换现有 loading overlay 和 error overlay 为按类别渲染的新版本

## 验证

- `npm run lint` → `npm run build` → `npm run dev` 桌面验证
- 验证场景：
  1. 正常加载（spinner 出现 → 消失，无超时）
  2. 断网加载（显示无网络覆盖层）
  3. 错误的 URL（显示 DNS 覆盖层）
  4. 加载超过 30s（显示超时覆盖层）
  5. 加载 15s+ 时文案变化
  6. 加载 25s+ 时出现取消按钮
  7. 点击重试后正常恢复