> Created: 2026-06-27 17:26 (+08:00)

# Google 登录环境异常修复与双防线凭证导入方案 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建双道防线彻底解决 Google 账号在 Webview 中登录提示环境异常的问题，并在设置抽屉中提供自动化与手动兼容的凭证导入入口。

**Architecture:** 第一道防线通过在主进程对 `persist:shared` 共享 Session 统一剥离 User-Agent 中的 `Electron/xx.x.x` 特征进行静默防护；第二道防线在设置抽屉 (`SettingsDrawer`) 暴露交互入口，经由规范的 IPC 桥接 (`import-cookie-json` 与 `sync-browser-cookies`) 向主进程共享 Session 写入本地浏览器凭证。

**Tech Stack:** TypeScript, Electron (Session & IPC API), React 18, Tailwind CSS

---

## Task 1: 第一道防线 - 主进程全局 User-Agent 伪装

通过重写共享 Session 的 User-Agent，自动移除 `Electron/...` 字段，伪装为标准 Chrome 浏览器，解决 Webview 直接登录 Google 时的基础环境拦截。

**Files:**
- Modify: `src/main/webviewManager.ts`

- [ ] **Step 1: 在 webviewManager 中找到 Webview 和 Session 初始化逻辑并添加 User-Agent 优化处理**

在 `src/main/webviewManager.ts` 文件中，新增一个用于剥离 User-Agent 中 Electron 标识的工具函数，并在初始化或窗口创建时对 `persist:shared` session 施加伪装：

```typescript
// 在 src/main/webviewManager.ts 中添加或修改以下逻辑
import { session } from 'electron'

/**
 * 为共享 Session 设置伪装 User-Agent，移除 Electron 特征，避免 Google OAuth 环境检测异常
 */
export function setupSharedSessionUserAgent(): void {
    const sharedSession = session.fromPartition('persist:shared')
    const currentUA = sharedSession.getUserAgent()
    // 移除 Electron/xx.x.x 标识，伪装成标准 Chrome
    const cleanUA = currentUA.replace(/Electron\/[0-9.]+\s/, '')
    sharedSession.setUserAgent(cleanUA)
}
```

- [ ] **Step 2: 并在主窗口加载前调用该函数**

在 `createMainWindow` 或适当的初始化时机调用 `setupSharedSessionUserAgent()`：

```typescript
export function createMainWindow(): void {
    setupSharedSessionUserAgent()
    // ... 原有的窗口创建逻辑保持不变
```

- [ ] **Step 3: 运行 ESLint 检查并验证编译**

Run: `npm run lint`
Expected: 无 ESLint 错误或警告。

---

## Task 2: 第二道防线 - IPC 契约同步与 Cookie 写入处理

建立渲染进程与主进程之间的安全通信管道，支持批量写入 Cookie JSON 以及触发本地浏览器 Cookie 同步。

**Files:**
- Modify: `src/main/ipcHandlers.ts`
- Modify: `src/preload/index.d.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: 在主进程 IPC 处理程序中注册凭证写入通道**

在 `src/main/ipcHandlers.ts` 注册 `import-cookie-json` 接口处理函数，将 JSON 数据安全注入至 `persist:shared` Session：

```typescript
import { ipcMain, session } from 'electron'

interface CookieItem {
    name: string
    value: string
    domain: string
    path?: string
    secure?: boolean
    httpOnly?: boolean
    expirationDate?: number
}

export function registerIpcHandlers(): void {
    // ... 原有 IPC 保持不变

    // 导入 Cookie JSON 接口
    ipcMain.handle('import-cookie-json', async (_event, cookies: CookieItem[]) => {
        try {
            if (!Array.isArray(cookies) || cookies.length === 0) {
                return { success: false, error: '提供的 Cookie 列表为空或格式不正确' }
            }
            const sharedSession = session.fromPartition('persist:shared')
            let count = 0
            for (const item of cookies) {
                if (!item.name || !item.value || !item.domain) continue
                // 自动补齐 https 协议 URL 用于写入
                const protocol = item.secure === false ? 'http://' : 'https://'
                const domainClean = item.domain.startsWith('.') ? item.domain.slice(1) : item.domain
                const url = `${protocol}${domainClean}${item.path || '/'}`
                await sharedSession.cookies.set({
                    url,
                    name: item.name,
                    value: item.value,
                    domain: item.domain,
                    path: item.path || '/',
                    secure: item.secure !== false,
                    httpOnly: item.httpOnly || false,
                    expirationDate: item.expirationDate
                })
                count++
            }
            return { success: true, data: { count } }
        } catch (error) {
            console.error('[IPC import-cookie-json] 导入失败:', error)
            return { success: false, error: error instanceof Error ? error.message : String(error) }
        }
    })
}
```

- [ ] **Step 2: 同步 Preload 接口定义文件**

修改 `src/preload/index.d.ts`，声明新增的 API 类型：

```typescript
export interface CookieItem {
    name: string
    value: string
    domain: string
    path?: string
    secure?: boolean
    httpOnly?: boolean
    expirationDate?: number
}

export interface IpcResponse<T = any> {
    success: boolean
    data?: T
    error?: string
}

export interface Api {
    // ... 现有 API 保持不变
    importCookieJson: (cookies: CookieItem[]) => Promise<IpcResponse<{ count: number }>>
}
```

- [ ] **Step 3: 同步 Preload 桥接实现**

修改 `src/preload/index.ts`，暴露安全调用能力：

```typescript
import { contextBridge, ipcRenderer } from 'electron'

const api = {
    // ... 现有 API 保持不变
    importCookieJson: (cookies: any[]) => ipcRenderer.invoke('import-cookie-json', cookies)
}

contextBridge.exposeInMainWorld('api', api)
```

- [ ] **Step 4: 运行构建类型检查**

Run: `npm run build`
Expected: 所有模块类型检查通过，打包生成 main/preload/renderer 产物无报错。

---

## Task 3: 第二道防线 - 设置抽屉 (SettingsDrawer) UI 改造

将第二道防线的交互入口置于设置抽屉中，提供一键快捷操作提示与 Cookie JSON 导入输入框。

**Files:**
- Modify: `src/renderer/src/components/SettingsDrawer.tsx`

- [ ] **Step 1: 在 SettingsDrawer 中增加状态与处理逻辑**

在 `SettingsDrawer.tsx` 内部新增用于导入 Cookie JSON 的输入状态和解析调用逻辑：

```tsx
// 在 SettingsDrawer 组件内部添加状态
const [cookieJsonText, setCookieJsonText] = useState('')
const [importStatus, setImportStatus] = useState<{ type: 'idle' | 'loading' | 'success' | 'error'; msg?: string }>({ type: 'idle' })

const handleImportCookies = async (): Promise<void> => {
    if (!cookieJsonText.trim()) {
        setImportStatus({ type: 'error', msg: '请先粘贴 Cookie JSON 数据' })
        return
    }
    setImportStatus({ type: 'loading', msg: '正在导入中...' })
    try {
        const parsed = JSON.parse(cookieJsonText)
        const res = await window.api.importCookieJson(Array.isArray(parsed) ? parsed : [parsed])
        if (res.success && res.data) {
            setImportStatus({ type: 'success', msg: `成功导入 ${res.data.count} 条 Cookie 授权凭证！请刷新 Webview 生效。` })
            setCookieJsonText('')
        } else {
            setImportStatus({ type: 'error', msg: res.error || '写入 Cookie 失败' })
        }
    } catch (e) {
        setImportStatus({ type: 'error', msg: 'JSON 格式解析错误，请确保使用浏览器插件完整导出 JSON 格式' })
    }
}
```

- [ ] **Step 2: 在抽屉面板渲染中加入“登录状态与授权防线”区域**

在设置面板列表的适当区域（如常规设置区域或底端安全卡片区）插入入口 UI：

```tsx
{/* 登录状态与授权凭证管理卡片 */}
<div className="p-4 bg-sidebar border border-gray-200 rounded-lg space-y-3">
    <div className="flex items-center gap-2 text-text-primary font-medium">
        <span className="material-symbols-outlined text-primary">security</span>
        <span>登录状态与授权防护（防拦截方案）</span>
    </div>
    <p className="text-xs text-text-secondary leading-relaxed">
        系统已默认开启第一道防线（环境特征优化）。如遇 Google 账号报“环境异常”无法登录，可通过导入外部浏览器 Cookie 完成免密快速登录。
    </p>
    
    <div className="space-y-2 pt-1">
        <label className="block text-xs font-medium text-text-secondary">
            粘贴 Cookie JSON 数据（可借助 EditThisCookie 等插件导出）：
        </label>
        <textarea
            value={cookieJsonText}
            onChange={(e) => setCookieJsonText(e.target.value)}
            placeholder='[{"domain": ".chatgpt.com", "name": "__Secure-1PSID", "value": "..."}]'
            rows={3}
            className="w-full px-3 py-2 bg-app border border-gray-200 rounded text-xs font-mono text-text-secondary placeholder-gray-400 focus:outline-none focus:border-primary/50 resize-none"
        />
        <div className="flex items-center justify-between pt-1">
            <span className={`text-xs ${importStatus.type === 'error' ? 'text-red-500' : importStatus.type === 'success' ? 'text-green-600' : 'text-text-secondary'}`}>
                {importStatus.msg}
            </span>
            <button
                onClick={handleImportCookies}
                disabled={importStatus.type === 'loading'}
                className="px-3 py-1.5 bg-primary text-white rounded text-xs hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-1"
            >
                <span className="material-symbols-outlined text-sm">login</span>
                一键导入登录凭证
            </button>
        </div>
    </div>
</div>
```

- [ ] **Step 3: 运行 ESLint 与打包验证**

Run: `npm run lint && npm run build`
Expected: ESLint 零警告零报错，全量打包通过。

---

## Task 4: 端到端整体育体验证

确保两道防线链路完整无语法错误，并在开发环境下模拟真实使用流程。

- [ ] **Step 1: 启动开发服务器进行手动功能验证**

Run: `npm run dev`
Expected: 
1. Electron 应用正常打开。
2. 打开顶部/侧边设置按钮，弹出的【设置抽屉】中展示“登录状态与授权防护（防拦截方案）”卡片。
3. 输入测试 JSON 数组 `[{"domain": ".google.com", "name": "test_cookie", "value": "123"}]`，点击【一键导入登录凭证】。
4. 界面正确显示“成功导入 1 条 Cookie 授权凭证！”。
