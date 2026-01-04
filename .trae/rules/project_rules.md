---
alwaysApply: true
---
# 项目规则

- 栈：Electron + React + TS(strict) + Tailwind + Zustand；构建：electron-vite / electron-builder
- 分层：main（窗口/Session/数据/IPC/总结）｜preload（桥接 API）｜renderer（UI/状态/选择器/脚本）
- 只改 `src/`，禁止手改 `out/`、`dist/`
- 原则：最小化；先检索（DRY）；保持 strict；不做无关重构
- 安全：不泄露 Key/Cookie/Token/用户内容；session 为 `persist:shared`，相关改动需评估全局影响
- IPC：main ↔ preload ↔ `src/preload/index.d.ts` 同步；返回 `{ success, data?, error? }`
- Webview：`src/renderer/src/config/selectors.ts` 与 `src/renderer/src/utils/webviewScripts.ts` 为唯一入口；多候选+可见性；避免脆弱 DOM
- 总结：`src/main/config/requestBodyConfig.ts` 与 `src/main/api/summaryApi.ts`；兼容 reasoning/thinking/`<thought>`；支持 `abortSummary`
- 命令：`npm run dev|build|build:win:all|build:win:nsis|build:win:portable|clean:store`
