# 启动时 Webview 空白问题评估报告

## 背景

冷启动应用后,主界面三个 webview 卡片头部状态显示为绿色"已启用",但卡片内容区完全空白(无加载动画、无错误提示)。按 `Ctrl+R` 或 `F5` 刷新主窗口后,各平台页面才正常加载渲染。

该问题在 dev (`npm run dev`) 与 production 构建中均观察到,Gemini / Grok / ChatGPT 三个 webview 同时受影响。

## 关键观察

| 状态 | 含义 |
|---|---|
| 卡片头部"已启用"绿点 | `dom-ready` 事件触发过(WebviewCard 把 `isLoading` 翻成 false 才会显示绿色) |
| 内容区空白(深灰背景) | 没有 loading 蒙层,没有 error 蒙层,纯卡片背景 |
| Ctrl+R 必定修复 | 刷新触发 `webContents.reload()`(`src/main/index.ts:117-124`),整个 React 树和所有 webview 重建 |

由此可定位:**问题不在 WebviewCard 本身的渲染或事件处理上,而在"冷启动一次"与"主窗口热重载"两种生命周期上下文的差异上**。

## 根因假设(按可能性降序)

### H1. 启动 URL 二次 `setState` 触发 `<webview>` `src` prop 中途变化 ⭐⭐⭐⭐

**证据**:

1. `src/renderer/src/App.tsx:35-72` 同时存在两个定时器:`setTimeout(init, 100)` 启动 store 初始化,`setTimeout(... setIsInitialized(true), 3000)` 作为 3 秒强制 fallback。
2. `src/renderer/src/store/appStore.ts:1143-1167` 中 `initializeStore()` 至少有两次会改 `models` 数组的 `setState`:第一次合并 storedModels,第二次单独覆盖 Gemini 的 URL(读取 `geminiAccountUrl`)。
3. 冷启动时 electron-store 首次从磁盘读 `config.json`,加上 `agentPromptsBootstrap` 写文件、watcher 起步,**有几率超过 3 秒**。
4. 若 3 秒 fallback 先于 `initializeStore()` 完成触发:WebviewCard 用默认 URL 挂载并启动加载,随后 `setState` 改写 URL,`<webview>` 的 `src` prop 中途变化。**Electron `<webview>` 标签对 `src` 属性中途变化的处理不可靠**——可能既不重新导航,又把内部状态搞乱,最终 `dom-ready` 仍然触发但页面渲染为空。

**Ctrl+R 为何修复**: store 已暖,`initializeStore()` 几十毫秒返回,先于 3 秒触发 → URL 一次到位,挂载后 `src` 不变 → 正常。

### H2. `geminiAccountUrl` 二次 `setState` 即便不超时也会触发 ⭐⭐⭐

`src/renderer/src/store/appStore.ts:1158-1168` 在加载完所有模型 URL 后,**单独**对 Gemini 的 URL 做了一次 `setState`。即便 H1 的 3 秒超时没触发,这两次 setState 仍然在 React 18 的批处理边界附近,有概率被打散到两次渲染。冷启动 Gemini 概率 100% 受影响,而热重载因为时序更稳定,常常能合并成一次。

### H3. `persist:shared` partition 冷启动竞态 ⭐⭐

`src/main/webviewManager.ts:286` 主窗口与三个 webview 共享 `persist:shared`。冷启动时 Session 对象首次创建,三个 webview 几乎同时挂载并读 cookie 数据库 / cache,Chromium 内部 partition first-touch 阶段未完成时发起的导航可能导航成功但渲染进程未正确接管。Ctrl+R 时主进程不重启,Session 已暖。

### H4. React.StrictMode 双重 effect 在 dev 下放大问题 ⭐⭐

`src/renderer/src/main.tsx:7` 启用了 `<React.StrictMode>`。React 18 在 dev 下故意 setup → cleanup → setup 一次,如果 `dom-ready` 落在 cleanup 与第二次 setup 之间,事件被错过——但当前症状是绿点亮起,说明事件最终被监听到了,所以这不是直接根因,但会放大其他根因的不稳定性。

### H5. `did-attach-webview` 监听器注册时机 ⭐

`src/main/webviewManager.ts:313` 先 `mainWindow.loadURL(...)`,`319` 才 `mainWindow.webContents.on('did-attach-webview', ...)`。JS 单线程下监听一定先于真正的 webview 挂载触发,理论上无问题,但 dev HMR 重启时如果只 reload `webContents` 而不重建 `mainWindow`,监听器会丢——这能导致 webview 注入脚本/账号检测/弹窗管理整体失效,但不会导致页面空白,所以可能性最低。

## 诊断步骤(不动代码先确认)

1. **DevTools 看主进程 console**:启动后看是否有 `初始化超时,强制完成` 警告(指向 H1)、`[Main] did-attach-webview 触发, wcId:` 是否输出三次(排除 H5)。
2. **便携版 vs 安装版对比**:便携版数据目录通常磁盘 IO 更慢,若便携版复现率显著更高,指向 H1。
3. **临时禁用 StrictMode**(`src/renderer/src/main.tsx:6-9` 去掉 `<React.StrictMode>` 包裹),复现率变化:
   - 显著降低 → H4 是放大因素
   - 不变 → H4 不是主因
4. **临时把 `App.tsx` 100ms 启动延时改 1500ms,且去掉 3 秒 fallback**:若稳定加载,确认 H1。

## 修复方案(按优先级)

### P0 (低风险,先做)

#### F1. 等 `initializeStore` 真正完成再挂 MainPage

`src/renderer/src/App.tsx:64-72` 删除 3 秒强制 fallback,或仅在 init 抛错时才放行。理由:超时 fallback 在异常路径上其实更应该走 `setError(...)` 让用户看到错误界面,而不是用未初始化状态渲染主界面。

#### F2. 合并 Gemini 账号 URL 的 `setState`

`src/renderer/src/store/appStore.ts:1158-1168` 把 `geminiAccountUrl` 读取移到 `storedModels` 合并循环里,只调用一次 `setState({ models: ... })`。

### P1 (中等改动,根除 webview src 不可靠问题)

#### F3. WebviewCard 改用 `loadURL()` 主动导航

`src/renderer/src/components/WebviewCard.tsx:777-785`:
- `<webview src={...}>` 中的 `src` 改为静态 `about:blank`
- 在 `useEffect` 里等 `webviewRef.current` 就绪后,调用 `webview.loadURL(url)` 发起首次导航
- URL 后续变化通过 `loadURL` 编程式更新,避免依赖 `<webview>` 标签的 `src` 属性响应式行为

这步能彻底回避 Electron `<webview>` `src` 中途变化的所有未定义行为。

### P2 (诊断辅助,不阻塞修复)

#### F4. 增加启动诊断日志

在 `App.tsx` 和 `appStore.ts` 关键节点(init 开始、storeGet 完成、setState、isInitialized 翻转)加 `console.log` 带时间戳,后续若问题复发能直接定位时序。

## 风险与回归

| 修复 | 风险 | 验证方式 |
|---|---|---|
| F1 | 极低,只删 fallback | 模拟 store 异常,确认错误页正确显示 |
| F2 | 低,纯逻辑合并 | 切换 Google 账号后重启,确认 Gemini URL 持久化生效 |
| F3 | 中等,改了 webview 挂载流程 | 三平台首次加载 / 历史记录恢复 URL / 新对话 URL / 平台切换 4 个路径都验过 |

F3 需要在 `npm run dev` 下完整跑一遍 11 个平台的挂载流程,以及 `loadURL` / `swapModelInSlot` / `resetToInitial` / `loadURL`(从 HistoryDrawer)四条调用路径。

## 验收

- 冷启动后(包括清理 `%APPDATA%\MultiChat{,-dev}\config*.json` 之后的首启)三个默认 webview 必须直接加载出页面,不再需要 Ctrl+R
- 切换 Google 账号、从历史记录恢复对话、平台切换、新对话 4 条路径不回归
- `npm run lint` + `npm run build` 通过
