> Created: 2026-10-03 22:45 (+08:00)

# 思维导图初始界面 UI 重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构思维导图初始界面 UI：移除冗余的“思维导图/更多”次级顶栏及底部的提示文案，在中央区域直接外显“生成导图”、“手动创建”、“选择模型（带平台Logo）”和“额外要求（内联折叠展开）”。

**Architecture:** 在 `src/renderer/src/components/ConversationMindmapPanel.tsx` 中重构无 activeMap 时的空态渲染逻辑；复用 `CustomDropdown` 组件定制模型选择器（带图标 Logo）；增加内联折叠的额外要求输入区；主次分离“生成导图”与“手动创建”按钮；保留 `MindmapEditor` 编辑态的正常操作。

**Tech Stack:** React 18, TypeScript, Tailwind CSS 3, Zustand (`useAppStore`), Material Symbols 图标。

---

### Task 1: 改造 `ConversationMindmapPanel.tsx` 空态界面结构

**Files:**
- Modify: `src/renderer/src/components/ConversationMindmapPanel.tsx:325-376`

- [ ] **Step 1: 添加内联额外要求状态**
在 `ConversationMindmapPanel` 组件内部新增 `inlineReqOpen` 折叠展开状态：
```tsx
const [inlineReqOpen, setInlineReqOpen] = useState(false)
```

- [ ] **Step 2: 移除空态下的红框顶栏与底部文案，构建方案 A 的控制台布局**
在 `activeMap && conversation` 为 false 的分支中：
1. 移除 `<div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between gap-2"><span className="text-sm font-medium text-gray-700">思维导图</span>{controls}</div>`；
2. 保留 `{notice}` 并在最顶部吸顶展示；
3. 将中间空态容器改造为包含以下组件的聚焦控制台：
   - 顶部空态插画与标题/描述；
   - 包含模型选择器（带 Logo）和额外要求（内联展开）的配置卡片；
   - 主按钮【✨ 生成导图】与次按钮【✏️ 手动创建空白导图】；
   - 完全移除原有的底部辅助说明文字（“使用 ChatGPT · 自动保存到笔记”）。

- [ ] **Step 3: 运行 ESLint 校验代码质量**
Run: `npm run lint`
Expected: 检查通过，无 lint 错误或未使用的变量。

- [ ] **Step 4: 运行前端构建校验**
Run: `npm run build`
Expected: 构建成功，无类型错误与打包错误。

- [ ] **Step 5: 提交代码**
```bash
git add src/renderer/src/components/ConversationMindmapPanel.tsx docs/superpowers/plans/2026-10-03-mindmap-initial-ui-plan.md
git commit -m "feat(mindmap): redesign initial empty state UI with model selector and actions"
```
