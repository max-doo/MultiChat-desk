# Electron Windows 下无边框窗口拖拽坑点复盘与经验沉淀

## 1. 背景与问题现象

在 MultiChat Desk 的开发中，我们采用了 `titleBarStyle: 'hidden'` 配合 `titleBarOverlay` 来实现自定义顶部标题栏。
最初的尝试中，我们通过给整个标题栏的 CSS 赋予 `-webkit-app-region: drag` 来让其可被拖拽，同时给内部的控件赋予 `-webkit-app-region: no-drag` 来让它们保持可点击。

**引发的严重问题：**
- **点击穿透与拖拽失效：** 当顶部标题栏的 UI 布局变复杂（例如使用 Grid 布局 1fr auto 1fr，且大量穿插 `drag` 与 `no-drag` 元素）时，由于 Chromium 在 Windows 平台上的命中测试（Hit-Testing）与复杂的 DOM 层级产生冲突，原生拖拽行为发生大面积瘫痪。
- **窗口持续自动放大（致命 Bug）：** 当用户成功拖动窗口时，由于无边框窗口在 Windows 11 下自带系统级的隐形阴影/调整边框（大约每边 7px 左右），无论是在系统原生 `drag` 处理还是在手动调用 `win.setPosition()` 时，都会错误地将外层边框累加到网页内容尺寸中，导致拖拽时窗口像滚雪球一样不断变大。

## 2. 踩坑与迭代历程

### 尝试一：强行拆分 UI DOM 层级（失败）
试图通过“纯净的空 div”来充当拖拽区域，并将所有非拖拽控件包裹。
**结果：** 破坏了既有极其精细的 Grid 绝对居中布局，同时因为依然依赖原生 CSS `drag` 属性，窗口放大的底层 Bug 并未被消除。

### 尝试二：常规 IPC 拖拽结合 setPosition（失败）
在渲染层监听鼠标事件，通过主进程调用 `win.setPosition(x, y)` 来位移窗口。
**结果：** 依然触发了窗口放大的 Bug。这是因为 `setPosition()` 底层调用 Windows API 时，会读取当前带系统边框的完整尺寸并将其作为新的窗口基础尺寸，导致尺寸无限累加。

### 尝试三：普通 MouseEvent 结合 setContentBounds（缺陷）
在渲染层使用 `onMouseDown` 和 `mousemove`，配合主进程的 `win.setContentBounds()` 锁死内容尺寸。
**结果：** 解决了放大问题，但鼠标一旦移动过快离开渲染窗口范围，或者受浏览器内部事件冒泡影响，`mousemove` 会直接丢失，导致拖拽非常卡顿或直接失效。

## 3. 终极完美解法：纯逻辑接管 + 指针捕获 + 内容锁死

最终，我们在不改变任何一行现有前端 UI DOM 树的情况下，彻底治愈了该问题。

### 3.1 废弃有 Bug 的系统原生 CSS 拖拽
在全局样式（如 `index.css`）中，彻底删除了 `-webkit-app-region: drag` 属性，仅保留 `.drag-region` 和 `.no-drag` 作为 JavaScript 识别区域的 class 标记，剥夺 Chromium 触发外层变大 Bug 的能力。

### 3.2 渲染层：指针事件 (Pointer Events) 与全局捕获
不使用常规的 `mousedown`，而是使用 `onPointerDown`。
**关键技术点：`setPointerCapture`**
```tsx
const target = e.target as HTMLElement
if (target.closest('.no-drag')) return
if (target.closest('.drag-region') || target === e.currentTarget) {
  isDraggingRef.current = true
  // 核心：强制捕获鼠标指针，即使甩出窗口外也能持续收到 pointermove
  e.currentTarget.setPointerCapture(e.pointerId)
  window.api.windowDragStart()
}
```

### 3.3 主进程：极底层的 setContentBounds
放弃 `setPosition()` 和 `setBounds()`，转而使用 `getContentBounds()` 与 `setContentBounds()`。
这两个 API 唯一的作用是操作**实际网页内容区域**。
```typescript
// 记录初始的内容宽高
dragStartContentBounds = win.getContentBounds()

// 拖动时，死死锁住 width 和 height，只更新 x 和 y
win.setContentBounds({
    x: dragStartContentBounds.x + deltaX,
    y: dragStartContentBounds.y + deltaY,
    width: dragStartContentBounds.width,
    height: dragStartContentBounds.height
})
```

## 4. 总结与开发规约

1. **涉及复杂布局时，慎用原生 app-region**：只要顶部控件嵌套稍微复杂（尤其是带有 flex/grid 和多个交互按钮），Windows 下的 `-webkit-app-region: drag` 极易引发难以预料的系统级 Bug。
2. **警惕 setPosition 的黑盒行为**：在 Electron 的无边框窗口上修改位置，务必考虑系统隐藏边框。使用 `setContentBounds` 锁定内部尺寸是最安全的降级策略。
3. **前端全局拖拽必用 PointerCapture**：任何试图用 JS 模拟全局拖拽的功能，必须使用 `setPointerCapture` 防止快速拖动导致的指针丢失。
4. **敬畏既有 UI 布局**：在解决底层 Bug 时，除非万不得已，应避免去改动正常运作的、对齐精确的 UI DOM 树，而是要在事件监听层或者后端服务（主进程）寻找出路。
