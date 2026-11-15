# Session Log

## 2026-11-14

### 19:11 | agent

- done: 新增 assets/dock-icon.png（图稿 82% + 透明边距），dev Dock 图标与打包 icns 改用它，修复 Dock 图标偏大的问题
- added:
  - `assets/dock-icon.png`
- modified:
  - `src/main/webviewManager.ts`
  - `build/generate-mac-assets.sh`
- lesson: macOS Dock 图标显大通常不是尺寸问题而是图稿没有留边距：Apple 图标规范图稿约占画布 82%；sips 无合成能力，可用 Swift/AppKit NSImage 生成带透明边距的 PNG

### 19:09 | agent

- done: macOS 红绿灯定位改为 titleBarStyle:'hidden'+trafficLightPosition(12,20) 垂直居中 52px 标题栏；dev 模式 Dock 图标替换为应用图标
- modified:
  - `src/main/webviewManager.ts`
  - `src/renderer/src/assets/index.css`
  - `src/renderer/src/components/Layout.tsx`
- lesson: trafficLightPosition 仅对 titleBarStyle:'hidden' 生效（hiddenInset 强制内嵌位）；其坐标是 OS 点单位，红绿灯圆心≈设定值+6.5，无头测试机截屏坐标≠OS 坐标需按实际像素对齐

### 18:44 | Devin

- done: 修复 macOS 托盘图标渲染为黑色剪影的问题（去掉 template 标记并缩放到 22px 显示彩色 logo）；mac 版 header 将 设置/历史/笔记 三个入口移到右侧
- modified:
  - `src/main/webviewManager.ts`
  - `src/renderer/src/components/Layout.tsx`
- lesson: macOS tray template image 只保留 alpha 剪影：要显示彩色应用图标不能调 setTemplateImage；tray icon 建议 resize 到 ~22px

### 18:34 | Devin

- done: 修复 macOS 托盘创建崩溃：setTemplateImage 误调在 Tray 上（Tray 无此方法），改为对 nativeImage 调用；验证 npm run dev 无 unhandled rejection，Cmd+Shift+Space 可唤出/收起快捷弹窗
- context: macOS arm64, electron-vite dev; npm install 可能跳过 Electron 二进制下载需 node node_modules/electron/install.js; 本机 python 为 3.9，session_log.py 需 python3.12
- modified:
  - `src/main/webviewManager.ts`
- lesson: Electron Tray 没有 setTemplateImage 方法，模板图标应调用 nativeImage.setTemplateImage(true)；assets/ 下无 tray-iconTemplate.png 时回退 logo.png

