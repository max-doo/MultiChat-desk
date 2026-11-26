# WebContentsView 幽灵窗口及截图渲染问题排查总结

## 1. 问题描述

在多窗口、多会话的高频切换与长期挂机（包括电脑睡眠唤醒）场景下，我们观察到以下问题：
1. **睡眠唤醒后原生视图挂起**：电脑睡眠唤醒后，WebContentsView 原生视图尺寸和位置丢失，引发排版错乱。
2. **幽灵窗口残留与菜单遮挡**：当从 3 窗口切换到 2 窗口时，已经隐藏的第 3 个窗口的 WebContentsView 原生图层未被正确移除，导致出现叠加在其他窗口背后，或者遮挡在 React 下拉菜单前方的“幽灵窗口”。
3. **截图障眼法功能突变**：由于对 `ResizeObserver` 逻辑和截屏逻辑进行了调整，截图（Screenshot Illusion）尺寸被不正确地拉伸，导致用户在点击下拉菜单（触发截图遮罩）的瞬间，界面发生明显的视觉放大“突变”。

---

## 2. 问题排查与方案尝试

### 尝试方案一：通过 rAF 和 ResizeObserver 强制隐藏（修复残留与遮挡）

**思路**：幽灵窗口之所以残留，是因为 `display: none`（或者 `width: 0`）触发时，底层的 `hideWebviewView` 没有被即刻调用，受到 `requestAnimationFrame`（rAF）在后台挂起的节流影响。
**改动**：在 `WebviewCard.tsx` 的 `ResizeObserver` 中增加针对 0 宽高的短路检测。一旦宽高为 0，跳过 rAF 节流，立即执行 `requestUpdateBounds(true)` 强同步调用主进程的 `hideWebviewView`。
**结果**：
- **失败原因**：虽然能够同步发送卸载请求，但在诸如切换窗口模式这类带 CSS `transition` 的动画过程中，容器宽度是渐变到 0 的。更致命的是，即使主进程在触发 `width: 0` 时调用了 `win.contentView.removeChildView(view)`，Electron 在某些 GPU 加速或睡眠状态下的原生渲染树可能未能正确擦除这一图层（即内部状态已是 `visible: false`，但画面仍然滞留），从而导致幽灵窗口仍残留在屏幕上。这直接导致幽灵窗口仍然会遮挡 React 渲染出的下拉菜单。

### 尝试方案二：监听系统唤醒并强制刷新（修复睡眠错乱）

**思路**：系统睡眠唤醒后，原生窗口管理器与 Electron 内部状态脱节。
**改动**：在 `main/index.ts` 引入 `powerMonitor.on('resume')`，在唤醒时通过 IPC 向前端广播 `system-resume`。前端 `App.tsx` 接收到后派发 `window.dispatchEvent(new Event('resize'))`，强制所有的 `WebviewCard` 重新将自己的准确尺寸同步给原生进程。
**结果**：
- 这一步逻辑上是正确的，且能让可见窗口重新对齐，但如果此时依然存在“幽灵窗口”（未被成功移除的原生层），这依然解决不了幽灵窗口覆盖的问题。

### 尝试方案三：调整 capturePage 的传入尺寸（导致回归：图片放大突变）

**思路**：修复了 ResizeObserver 后，发现截图有突变。当时怀疑是因为捕获了过大或过小的区域。
**改动**：尝试去掉传给 `captureWebviewPage` 的局部裁剪尺寸，并移除了由后端进行的 `image.resize`，试图交由前端的 `background-size: 100% 100%` 自动拉伸。
**结果**：
- **失败原因**：由于 `WebviewCard` 带有 `topToolbarHeight`（如 38px）的垂直方向溢出裁切限制，其实际的 `WebContentsView` 可能会比前端的 CSS 容器稍微矮一些。
- 当主进程使用 `capturePage()` 捕获这个较矮的图像后，传给前端被强行用 `100% 100%` 填满一个完整高度的容器，导致图像发生**纵向拉伸放大**，产生了视觉突变（用户反馈：“现在截图的尺寸比实际的大”）。
- 此前旧版本（带 `bounds.width / height` 参数并进行了精确 resize 的逻辑）能正确避免此现象。

---

## 3. 根本原因及最终回滚决定

综上发现，我们尝试在现有 `WebContentsView` + `capturePage` 障眼法架构上进行不断缝补，但这引发了更多边缘冲突：
1. **`removeChildView` 不稳定**：在复杂动画或睡眠唤醒期间，单靠 `removeChildView` 无法保证 100% 清除屏幕原生残留。理论上必须在隐藏时叠加一层防御：`view.setBounds({ x: -1000, y: -1000, width: 0, height: 0 })`，将视图丢出屏幕外。
2. **障眼法的本质缺陷**：为了解决 Webview 覆盖 DOM（下拉菜单）的问题，采用每次点击都截图覆盖的“障眼法”，不仅受到 200ms IPC 延迟影响（这 200ms 内菜单依然会被遮挡），而且需要时刻处理 DIP 像素与 Physical 像素在高分屏缩放、以及溢出裁剪时的精确数学计算，代码极为脆弱。

**当前结论**：
鉴于上述修改引发了更严重的视觉回归（截图放大突变），且仍未能彻底解决菜单遮挡延迟等核心痛点，我们遵照您的指示，**已将此次所有相关代码完全回滚至修改前状态**。

建议后续可以重新评估此架构，不再依赖“即时截图覆盖”机制来解决原生视图遮挡 DOM 菜单的问题，而是考虑使用 Electron 原生的 `Menu` 替代 DOM 下拉菜单，或从根本上优化多窗口在 `WebContentsView` 模式下的层级设计。
