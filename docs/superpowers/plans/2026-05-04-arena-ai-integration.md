# Arena.ai Webview 平台接入 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 arena.ai 作为第 12 个 Webview 聊天平台接入 MultiChat。

**Architecture:** 在现有 `defaultModels` 和 `defaultSelectors` 配置中添加 arena 的条目，完全复用现有的 Webview 通用机制（`WebviewCard` 通过 `modelId` 动态查表），无需新增组件或数据流。

**Tech Stack:** Electron 28 + React 18 + TypeScript

---

### Task 1: 添加 arena 模型配置到 appStore.ts

**Files:**
- Modify: `src/renderer/src/store/appStore.ts`（`defaultModels` 数组末尾）

- [ ] **Step 1: 在 `defaultModels` 数组末尾添加 arena 配置**

找到 `defaultModels` 数组的最后一个元素（`yiyan`），在其后添加：

```ts
  { id: 'arena', name: 'Arena', url: 'https://arena.ai/', logo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAAAAABXZoBIAAAAp0lEQVR4AdWSLwjEIBSH7Xm9l/WyaGdlzWIXLphWbOvtFatRLiy/ZjILdjAJ9uod3LG5O1gc7OO1j/eHH4/UE24oM+HsACd572TosMEha8YW7L3b8D2WdudK5WND0rU9KKgIGr5oiCo2EsKAquSU31UUDgEOnRaNpHWaKpUGrQrtTjt2SVi/LN6I1I3PnxBMFOYjo/lLSO9SXyUhcO3m2Wke4K4/dMIL1Ne5UmnGphQAAAAASUVORK5CYII=', enabled: false }
```

修改后的数组末尾应为：
```ts
const defaultModels: ModelConfig[] = [
  // ... 前面的 11 个模型 ...
  { id: 'yiyan', name: '文心一言', url: 'https://yiyan.baidu.com/', logo: 'https://eb-static.cdn.bcebos.com/logo/favicon.ico', enabled: false },
  { id: 'arena', name: 'Arena', url: 'https://arena.ai/', logo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAAAAABXZoBIAAAAp0lEQVR4AdWSLwjEIBSH7Xm9l/WyaGdlzWIXLphWbOvtFatRLiy/ZjILdjAJ9uod3LG5O1gc7OO1j/eHH4/UE24oM+HsACd572TosMEha8YW7L3b8D2WdudK5WND0rU9KKgIGr5oiCo2EsKAquSU31UUDgEOnRaNpHWaKpUGrQrtTjt2SVi/LN6I1I3PnxBMFOYjo/lLSO9SXyUhcO3m2Wke4K4/dMIL1Ne5UmnGphQAAAAASUVORK5CYII=', enabled: false }
]
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/store/appStore.ts
git commit -m "$(cat <<'EOF'
feat: add arena.ai to default model list

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 添加 arena DOM 选择器到 selectors.ts

**Files:**
- Modify: `src/renderer/src/config/selectors.ts`（`defaultSelectors.models` 对象 + version/lastUpdated）

- [ ] **Step 1: 在 `defaultSelectors.models` 中添加 arena 选择器配置**

找到 `defaultSelectors.models` 中 `yiyan` 配置对象的结束大括号 `},`，在其后添加：

```ts
    arena: {
      textarea: [
        'textarea[placeholder*="Message"]',
        'textarea[placeholder*="message"]',
        'textarea',
        '[contenteditable="true"]'
      ],
      sendButton: [
        'button[type="submit"]',
        'button[aria-label*="Send"]',
        'button[aria-label*="send"]',
        'form button:last-child'
      ],
      messageContainer: [
        '.prose',
        '[class*="markdown"]',
        '.message-content',
        '[data-testid*="message"]',
        '.chat-message'
      ],
      customCSS: '',
      newConversationUrl: 'https://arena.ai/'
    }
```

注意 `yiyan` 原来的结束是 `}`（因为它是最后一个，后面没有逗号），需要将其改为 `},`。

- [ ] **Step 2: 更新版本信息**

将文件顶部的：
```ts
  version: 10,
  lastUpdated: '2026-05-03',
```
改为：
```ts
  version: 11,
  lastUpdated: '2026-05-04',
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/config/selectors.ts
git commit -m "$(cat <<'EOF'
feat: add arena.ai DOM selectors

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 验证编译通过

**Files:**
- 无文件修改

- [ ] **Step 1: 运行 ESLint**

```bash
npm run lint
```

Expected: 无错误，无 arena 相关警告。

- [ ] **Step 2: 运行构建**

```bash
npm run build
```

Expected: 构建成功，类型检查通过，无 TypeScript 错误。

- [ ] **Step 3: Commit（如 lint/build 通过）**

```bash
git commit --allow-empty -m "$(cat <<'EOF'
chore: verify arena.ai integration compiles

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 手动功能验证（dev 运行）

**Files:**
- 无文件修改

- [ ] **Step 1: 启动开发模式**

```bash
npm run dev
```

- [ ] **Step 2: 在设置面板中启用 Arena**

1. 点击左下角 Logo 打开设置面板
2. 在"模型排序"区域找到 Arena
3. 确保 Arena 在显示范围内（如使用三列模式，Arena 需要在前 3 位；或调整顺序将 Arena 移上去）
4. 关闭设置面板

- [ ] **Step 3: 测试文字输入**

1. 在底部输入框输入一条测试消息
2. 点击发送按钮（或按 Enter）
3. 观察 Arena 的 Webview 中是否出现输入的文字

- [ ] **Step 4: 测试消息发送**

1. 确保 Arena 已进入聊天界面（如 Direct Chat 模式）
2. 再次发送消息
3. 观察消息是否成功发出

- [ ] **Step 5: 测试回复提取**

1. 等待 Arena 中的模型回复完成
2. 点击"生成总结报告"按钮
3. 检查 Arena 的回复是否被正确抓取到总结中

- [ ] **Step 6: 记录选择器调试结果**

如果输入、发送或提取不成功，打开 Arena 的 DevTools（右键 → Inspect）检查实际 DOM 结构，记录：
- 输入框的 tag、class、placeholder
- 发送按钮的 selector
- 消息容器的 selector

将这些信息更新到 `selectors.ts` 中对应的 `arena` 配置，重复 Step 1-5。

---

## Self-Review

**1. Spec coverage:**
- ✅ `defaultModels` 中添加 arena 配置 → Task 1
- ✅ `defaultSelectors.models` 中添加 arena 选择器 → Task 2
- ✅ 更新 version 和 lastUpdated → Task 2 Step 2
- ✅ lint + build 验证 → Task 3
- ✅ dev 手动验证 → Task 4

**2. Placeholder scan:**
- ✅ 无 TBD/TODO
- ✅ 无 "add appropriate error handling"
- ✅ 每个代码步骤都有完整代码

**3. Type consistency:**
- ✅ 使用 `ModelConfig` 和 `ModelSelector` 的字段名与现有代码一致
- ✅ `id: 'arena'` 与选择器 key `'arena'` 匹配
