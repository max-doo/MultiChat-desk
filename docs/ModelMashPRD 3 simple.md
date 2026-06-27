# **产品需求文档 (PRD): MultiChat (模方)**

| 文档属性 | 详情 |
| :---- | :---- |
| **产品名称** | EN: MultiChat / CN: 模方 |
| **版本号** | V3.0 (桌面应用方案) |
| **状态** | 待开发 (Ready for Dev) |
| **文档作者** | AI Product Manager |
| **最后更新** | 2025-12-02 |
| **方案变更** | 从 Web API 方案调整为 Electron 桌面应用 |

---

## **1. 产品概述 (Product Overview)**

### **1.1 背景与核心问题**

当前高阶 AI 用户（学术研究员、数据分析师、内容创作者）面临的核心痛点：

**痛点 1：Deep Research 无法并行对比**
- ChatGPT、Claude、Gemini 都有深度研究功能
- 但用户只能在各平台间手动切换
- 无法同时启动多个模型进行研究并对比结果

**痛点 2：文件需要重复上传**
- 分析 PDF/图片时，需要在三个平台各上传一次
- 耗时且容易出错
- 无法高效对比不同模型的分析视角

**痛点 3：缺乏智能验证机制**
- 单一模型可能产生幻觉（hallucination）
- 用户缺乏工具来交叉验证结果
- 人工对比费时费力

**痛点 4：现有方案的致命缺陷**
- **Web API 方案**：无法使用 Deep Research 等 Web 端独有功能
- **浏览器插件方案**：技术不稳定，频繁因厂商 UI 更新而失效
- **多标签页切换**：效率低下，无法并行查看

---

### **1.2 产品愿景**

**MultiChat (模方)** 是一款基于 **Electron 桌面应用** 的专业 AI 研究工具。通过并排嵌入多个 AI 平台的 Web 端，实现真正的并行对话、Deep Research 对比和统一文件分发，结合 AI Agent 自动生成验证报告，帮助用户做出更可靠的决策。

**核心价值主张：**
> **"Ask Once, Compare All, Decide Better"**  
> （一次提问，全面对比，更好决策）

**产品定位：**
- **不是** 另一个 AI 聊天界面
- **不是** API 聚合平台
- **而是** 专业研究者的"AI 验证工作台"

---

### **1.3 为什么选择桌面应用？**

| 维度 | 浏览器插件 | Web API | **Electron 桌面应用** |
|------|----------|---------|---------------------|
| **Deep Research** | ⚠️ 支持但不稳定 | ❌ 不支持 | ✅ **完整支持** |
| **统一文件上传** | 🔴 极其困难 | ⚠️ 仅 API 模型 | ✅ **原生支持** |
| **技术稳定性** | 🔴 易失效 | 🟢 高 | 🟢 **可热更新选择器** |
| **登录持久化** | ⚠️ 依赖浏览器 | N/A | ✅ **独立 Session** |
| **用户体验** | 🟡 依赖浏览器 | 🟢 Web 界面 | ✅ **原生应用体验** |
| **分发难度** | 🟡 需审核 | 🟢 直接访问 | 🟡 需下载（但无审核） |
| **更新速度** | 🔴 慢 | 🟢 快 | 🟢 **自动更新** |
| **商业化** | 🟡 困难 | 🟢 订阅方便 | 🟢 **内置支付** |

**核心优势总结：**
- 🏆 唯一能实现"并行 Deep Research 对比"的方案
- 🏆 文件上传技术难度仅为插件方案的 20%
- 🏆 用户体验接近原生应用

---

### **1.4 竞争优势**

| 竞品 | 缺失的能力 | MultiChat 的优势 |
|------|----------|----------------|
| **Poe** | 不支持并行对比，无 Deep Research | ✅ 多模型并行 + Deep Research |
| **ChatHub (插件)** | 技术不稳定，文件上传困难 | ✅ 桌面应用稳定 + 原生文件上传 |
| **Franz/Station** | 仅聚合界面，无 AI 总结 | ✅ AI 自动验证报告 |
| **官方产品** | 单一模型，无跨平台对比 | ✅ 三模型交叉验证 |

---

## **2. 用户故事 (User Stories)**

| 角色 | 场景 | 用户需求 | 价值 |
| :---- | :---- | :---- | :---- |
| **学术研究员** | 需要验证某个科学事实 | 同时在 ChatGPT、Claude、Gemini 启动 Deep Research，获得 AI 对比报告指出共识和矛盾 | 快速发现幻觉，提高研究严谨性 |
| **数据分析师** | 分析一份复杂的财报 PDF | 上传一次 PDF，自动分发到所有模型，对比三个分析报告 | 多视角洞察，提升决策质量 |
| **法律顾问** | 审查合同条款 | 上传合同，三个模型同时审查，AI 总结找出潜在风险点 | 降低遗漏风险，提高审查效率 |
| **内容创作者** | 构思文章大纲 | 一次提问，获得三个模型的创意，AI 整合为完整大纲 | 最大化创意多样性 |
| **开发者** | 代码审计与优化 | 上传代码文件，三个模型同时审计，对比发现的问题 | 全面的代码质量检查 |
| **企业决策者** | 评估市场策略 | 使用 Deep Research 模式研究竞品，三个模型同时分析，获得综合报告 | 降低战略决策风险 |

---

## **3. 商业模式 (Business Model)**

暂不考虑

---

## **4. 核心功能需求 (Functional Requirements)**

### **4.1 技术架构（Electron 桌面应用）**

#### **技术栈选择参考建议**

```
桌面应用框架：
  • Electron 28+ (最新稳定版)
  • Node.js 18+ (LTS)

前端界面：
  • HTML5 + CSS3 (原生或集成 React)
  • Tailwind CSS (UI 样式)

状态管理：
  • Electron Store (持久化配置)
  • IPC (进程间通信)

后端服务（可选）：
  • Node.js + Express (云端选择器更新)
  • PostgreSQL (用户数据、订阅管理)
  • Stripe (支付)

Web 嵌入：
  • <webview> 标签（Electron 内置）
  • Partition (独立 Session 管理)
```

---

#### **架构图**

```
┌─────────────────────────────────────────────┐
│         Electron 主进程 (Main Process)       │
│  • 窗口管理                                  │
│  • 文件系统访问                              │
│  • 选择器热更新                              │
│  • 订阅验证                                  │
└─────────────────────────────────────────────┘
           ↓ IPC 通信 ↓
┌─────────────────────────────────────────────┐
│        渲染进程 (Renderer Process)           │
│  ┌───────────────────────────────────────┐  │
│  │       主控制面板 (Control Panel)       │  │
│  │  • 统一输入框                          │  │
│  │  • 文件上传按钮                        │  │
│  │  • 模式切换（普通/Deep Research）      │  │
│  │  • 生成验证报告按钮                    │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ Webview 1│  │ Webview 2│  │ Webview 3│  │
│  │ ChatGPT  │  │ Claude   │  │ Gemini   │  │
│  │          │  │          │  │          │  │
│  │ (iframe) │  │ (iframe) │  │ (iframe) │  │
│  └──────────┘  └──────────┘  └──────────┘  │
└─────────────────────────────────────────────┘
           ↓ executeJavaScript ↓
┌─────────────────────────────────────────────┐
│      官方 AI 平台 (Web Interfaces)          │
│  chatgpt.com | claude.ai | gemini.google.com│
└─────────────────────────────────────────────┘
```

---

### **4.2 核心功能模块**

#### **功能 A：并排 Webview 工作台**

**界面设计（详见原型图）：**

**技术实现：Webview 嵌入**

#### **功能 B：统一消息发送**

**核心逻辑：**

示例代码

```javascript
// renderer.js - 渲染进程
const chatgptView = document.getElementById('chatgpt');
const claudeView = document.getElementById('claude');
const geminiView = document.getElementById('gemini');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');

// 从云端加载最新的选择器配置
let selectors = {};

async function loadSelectors() {
  try {
    // 优先从云端拉取
    const response = await fetch('https://api.multichat.ai/selectors.json');
    selectors = await response.json();
    
    // 缓存到本地
    localStorage.setItem('selectors', JSON.stringify(selectors));
    localStorage.setItem('selectors_updated', Date.now());
    
  } catch (error) {
    // 降级到本地缓存
    const cached = localStorage.getItem('selectors');
    if (cached) {
      selectors = JSON.parse(cached);
    } else {
      // 使用内置的默认配置
      selectors = DEFAULT_SELECTORS;
    }
  }
}

// 等待所有 Webview 加载完成
let loadedCount = 0;
const totalWebviews = 3;

[chatgptView, claudeView, geminiView].forEach((webview, index) => {
  webview.addEventListener('dom-ready', () => {
    loadedCount++;
    
    // 注入 CSS 隐藏不必要的元素
    injectCustomCSS(webview);
    
    // 更新状态指示器
    updateStatusIndicator(webview.id, 'ready');
    
    // 所有加载完成后启用输入
    if (loadedCount === totalWebviews) {
      enableInput();
    }
  });
  
  // 处理加载错误
  webview.addEventListener('did-fail-load', () => {
    updateStatusIndicator(webview.id, 'error');
  });
});

// 注入自定义 CSS
function injectCustomCSS(webview) {
  const modelId = webview.id;
  const css = selectors[modelId]?.customCSS || '';
  
  // 通用隐藏规则
  const commonCSS = `
    /* 隐藏侧边栏 */
    nav[aria-label*="sidebar"], 
    aside,
    .side-navigation,
    [class*="sidebar"] {
      display: none !important;
    }
    
    /* 扩展主内容区域 */
    main, 
    [role="main"],
    .main-content {
      max-width: 100% !important;
      margin: 0 auto !important;
    }
    
    /* 优化移动端显示 */
    @media (max-width: 800px) {
      body {
        font-size: 14px !important;
      }
    }
  `;
  
  webview.insertCSS(commonCSS + css);
}

// 统一发送消息
sendBtn.addEventListener('click', sendToAll);
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendToAll();
  }
});

async function sendToAll() {
  const message = userInput.value.trim();
  if (!message) return;
  
  // 禁用输入，防止重复发送
  disableInput();
  
  try {
    // 并行发送到所有模型
    const results = await Promise.all([
      sendToModel('chatgpt', chatgptView, message),
      sendToModel('claude', claudeView, message),
      sendToModel('gemini', geminiView, message)
    ]);
    
    // 检查失败的模型
    const failed = results.filter(r => !r.success);
    if (failed.length > 0) {
      showNotification(`部分模型发送失败: ${failed.map(f => f.model).join(', ')}`);
    }
    
    // 清空输入框
    userInput.value = '';
    
    // 保存到历史
    saveToHistory(message, Date.now());
    
  } catch (error) {
    console.error('发送失败:', error);
    showNotification('发送失败，请重试');
  } finally {
    enableInput();
  }
}

// 发送到单个模型
async function sendToModel(modelId, webview, message) {
  const config = selectors[modelId];
  if (!config) {
    return { success: false, model: modelId, error: '缺少配置' };
  }
  
  // 构建注入代码
  const code = `
    (async function() {
      try {
        // 尝试多个选择器（fallback 机制）
        const textareaSelectors = ${JSON.stringify(config.textarea)};
        const buttonSelectors = ${JSON.stringify(config.sendButton)};
        
        let textarea = null;
        let button = null;
        
        // 查找 textarea
        for (const selector of textareaSelectors) {
          textarea = document.querySelector(selector);
          if (textarea) break;
        }
        
        // 查找发送按钮
        for (const selector of buttonSelectors) {
          button = document.querySelector(selector);
          if (button) break;
        }
        
        if (!textarea || !button) {
          return {
            success: false,
            error: 'Elements not found',
            foundTextarea: !!textarea,
            foundButton: !!button
          };
        }
        
        // 设置值（兼容 contenteditable 和 textarea）
        if (textarea.contentEditable === 'true') {
          textarea.textContent = ${JSON.stringify(message)};
        } else {
          textarea.value = ${JSON.stringify(message)};
        }
        
        // 触发 input 事件（激活按钮）
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        
        // 等待按钮激活
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // 点击发送按钮
        button.click();
        
        return { success: true };
        
      } catch (error) {
        return { success: false, error: error.message };
      }
    })();
  `;
  
  try {
    updateStatusIndicator(modelId, 'sending');
    
    const result = await webview.executeJavaScript(code);
    
    if (result.success) {
      updateStatusIndicator(modelId, 'success');
    } else {
      updateStatusIndicator(modelId, 'error');
      console.error(`${modelId} 发送失败:`, result.error);
    }
    
    return { success: result.success, model: modelId, ...result };
    
  } catch (error) {
    updateStatusIndicator(modelId, 'error');
    return { success: false, model: modelId, error: error.message };
  }
}

// 更新状态指示器
function updateStatusIndicator(modelId, status) {
  const indicator = document.getElementById(`${modelId}-status`);
  if (!indicator) return;
  
  const statusConfig = {
    ready: { text: '●', color: '#10b981', title: '就绪' },
    sending: { text: '●', color: '#f59e0b', title: '发送中...' },
    success: { text: '●', color: '#10b981', title: '发送成功' },
    error: { text: '●', color: '#ef4444', title: '发送失败' }
  };
  
  const config = statusConfig[status] || statusConfig.ready;
  indicator.textContent = config.text;
  indicator.style.color = config.color;
  indicator.title = config.title;
}
```

---

#### **功能 C：统一文件上传（核心差异化功能）**

**用户流程：**

```
1. 用户点击 📎 按钮
   ↓
2. 系统文件选择器打开
   ↓
3. 用户选择文件（PDF/图片/Excel）
   ↓
4. 应用显示上传进度弹窗：
   
   正在上传文件到所有模型...
   ━━━━━━━━━━━━━━━━━━━━ 67%
   
   ChatGPT: ✅ 上传成功
   Claude: ⏳ 上传中...
   Gemini: ⏳ 上传中...
   
   ↓
5. 所有模型上传完成
   ↓
6. 用户输入问题："分析这个文件"
   ↓
7. 三个模型同时分析同一文件
```

---

**技术实现：**

示例代码

```javascript
// preload.js - 安全的 IPC 桥接
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 选择文件
  selectFile: () => ipcRenderer.invoke('select-file'),
  
  // 读取文件
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  
  // 订阅管理
  checkSubscription: () => ipcRenderer.invoke('check-subscription'),
  
  // 保存历史
  saveHistory: (data) => ipcRenderer.invoke('save-history', data),
  
  // 导出对话
  exportChat: (format) => ipcRenderer.invoke('export-chat', format)
});
```

```javascript
// main.js - 主进程处理文件操作
const { ipcMain, dialog } = require('electron');
const fs = require('fs').promises;
const path = require('path');

// 处理文件选择
ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: '所有支持的文件', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'txt', 'csv', 'xlsx', 'docx'] },
      { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] },
      { name: '文档', extensions: ['pdf', 'txt', 'docx'] },
      { name: '表格', extensions: ['csv', 'xlsx'] }
    ]
  });
  
  if (result.canceled) return null;
  
  const filePath = result.filePaths[0];
  const stats = await fs.stat(filePath);
  
  // 检查文件大小（免费版 5MB，Pro 版 20MB）
  const maxSize = await getMaxFileSize();
  if (stats.size > maxSize) {
    dialog.showErrorBox(
      '文件过大',
      `文件大小超过限制 (${(maxSize / 1024 / 1024).toFixed(0)}MB)。\n升级到 Pro 版以上传更大的文件。`
    );
    return null;
  }
  
  return filePath;
});

// 读取文件内容
ipcMain.handle('read-file', async (event, filePath) => {
  try {
    const buffer = await fs.readFile(filePath);
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = getMimeType(ext);
    
    return {
      buffer: buffer.toString('base64'),  // 转为 Base64
      fileName,
      mimeType,
      size: buffer.length,
      extension: ext
    };
  } catch (error) {
    console.error('读取文件失败:', error);
    throw error;
  }
});

// MIME 类型映射
function getMimeType(ext) {
  const types = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  };
  return types[ext] || 'application/octet-stream';
}

// 获取最大文件大小限制
async function getMaxFileSize() {
  const subscription = await checkUserSubscription();
  
  if (subscription.plan === 'free') {
    return 5 * 1024 * 1024;  // 5MB
  } else if (subscription.plan === 'pro' || subscription.plan === 'team') {
    return 20 * 1024 * 1024;  // 20MB
  }
  
  return 5 * 1024 * 1024;  // 默认 5MB
}
```

```javascript
// renderer.js - 文件上传逻辑
const uploadFileBtn = document.getElementById('uploadFileBtn');
const uploadProgress = document.getElementById('uploadProgress');

uploadFileBtn.addEventListener('click', selectAndUploadFile);

async function selectAndUploadFile() {
  try {
    // 1. 选择文件
    const filePath = await window.electronAPI.selectFile();
    if (!filePath) return;
    
    // 2. 读取文件
    const fileData = await window.electronAPI.readFile(filePath);
    
    // 3. 显示上传进度
    showUploadProgress();
    
    // 4. 并行上传到所有 webview
    const results = await Promise.all([
      uploadToWebview('chatgpt', chatgptView, fileData),
      uploadToWebview('claude', claudeView, fileData),
      uploadToWebview('gemini', geminiView, fileData)
    ]);
    
    // 5. 检查结果
    const allSuccess = results.every(r => r.success);
    
    if (allSuccess) {
      showNotification('✅ 文件已上传到所有模型');
    } else {
      const failed = results.filter(r => !r.success).map(r => r.model);
      showNotification(`⚠️ 部分模型上传失败: ${failed.join(', ')}`);
    }
    
    // 6. 隐藏进度
    setTimeout(hideUploadProgress, 2000);
    
  } catch (error) {
    console.error('文件上传失败:', error);
    showNotification('❌ 文件上传失败');
    hideUploadProgress();
  }
}

// 上传文件到单个 webview
async function uploadToWebview(modelId, webview, fileData) {
  const config = selectors[modelId];
  if (!config || !config.fileUpload) {
    return { success: false, model: modelId, error: '不支持文件上传' };
  }
  
  updateUploadStatus(modelId, 'uploading');
  
  const { buffer, fileName, mimeType } = fileData;
  
  // 构建注入代码
  const code = `
    (async function() {
      try {
        // 1. Base64 转 Blob
        const byteCharacters = atob('${buffer}');
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: '${mimeType}' });
        
        // 2. 创建 File 对象
        const file = new File([blob], '${fileName}', {
          type: '${mimeType}',
          lastModified: Date.now()
        });
        
        // 3. 创建 DataTransfer
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        
        // 4. 查找上传区域（尝试多种方式）
        const uploadSelectors = ${JSON.stringify(config.fileUpload)};
        let target = null;
        
        for (const selector of uploadSelectors) {
          target = document.querySelector(selector);
          if (target) break;
        }
        
        if (!target) {
          return { success: false, error: 'Upload area not found' };
        }
        
        // 5. 模拟文件上传
        if (target.tagName === 'INPUT' && target.type === 'file') {
          // 方法 A: 直接赋值给 file input
          target.files = dataTransfer.files;
          target.dispatchEvent(new Event('change', { bubbles: true }));
          
        } else {
          // 方法 B: 模拟拖拽
          const dropEvent = new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            dataTransfer: dataTransfer
          });
          target.dispatchEvent(dropEvent);
        }
        
        // 6. 等待上传完成（观察 UI 变化）
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        return { success: true };
        
      } catch (error) {
        return { success: false, error: error.message };
      }
    })();
  `;
  
  try {
    const result = await webview.executeJavaScript(code);
    
    if (result.success) {
      updateUploadStatus(modelId, 'success');
    } else {
      updateUploadStatus(modelId, 'error');
      console.error(`${modelId} 上传失败:`, result.error);
    }
    
    return { success: result.success, model: modelId };
    
  } catch (error) {
    updateUploadStatus(modelId, 'error');
    return { success: false, model: modelId, error: error.message };
  }
}

// 更新上传状态显示
function updateUploadStatus(modelId, status) {
  const statusEl = document.getElementById(`${modelId}-upload`);
  if (!statusEl) return;
  
  const icons = {
    uploading: '⏳',
    success: '✅',
    error: '❌'
  };
  
  statusEl.textContent = `${modelId}: ${icons[status]}`;
}

// 显示/隐藏上传进度
function showUploadProgress() {
  uploadProgress.style.display = 'flex';
  // 重置所有状态
  ['chatgpt', 'claude', 'gemini'].forEach(model => {
    updateUploadStatus(model, 'uploading');
  });
}

function hideUploadProgress() {
  uploadProgress.style.display = 'none';
}
```

---

#### **功能 D：Deep Research 模式**

**模式切换：**

示例代码

```javascript
// 模式切换逻辑
const modeSelect = document.getElementById('modeSelect');

modeSelect.addEventListener('change', async (e) => {
  const mode = e.target.value;
  
  if (mode === 'research') {
    // 检查是否有 Pro 订阅
    const subscription = await window.electronAPI.checkSubscription();
    
    if (subscription.plan === 'free') {
      // 显示升级提示
      showUpgradeModal('Deep Research 功能需要 Pro 版本');
      modeSelect.value = 'quick';  // 恢复到快速模式
      return;
    }
    
    // 切换到 Deep Research 模式
    switchToResearchMode();
  } else {
    switchToQuickMode();
  }
});

function switchToResearchMode() {
  // 1. 修改输入框提示
  userInput.placeholder = '输入研究主题，将启动所有模型的 Deep Research...';
  
  // 2. 在每个 webview 中启用 Research 模式
  [chatgptView, claudeView, geminiView].forEach(webview => {
    enableResearchMode(webview);
  });
  
  // 3. 修改 UI 样式（可选）
  document.body.classList.add('research-mode');
  
  showNotification('已切换到 Deep Research 模式');
}

async function enableResearchMode(webview) {
  const modelId = webview.id;
  const config = selectors[modelId];
  
  if (!config.researchMode) return;
  
  // 注入代码，尝试启用 Research 模式
  const code = `
    (function() {
      try {
        // ChatGPT: 点击 "Search the web" 或 "Deep Research" 按钮
        const researchBtn = document.querySelector('${config.researchMode.button}');
        if (researchBtn) {
          researchBtn.click();
          return { success: true };
        }
        
        return { success: false, error: 'Research mode button not found' };
      } catch (error) {
        return { success: false, error: error.message };
      }
    })();
  `;
  
  await webview.executeJavaScript(code);
}
```

---

#### **功能 E：AI 验证报告生成**

**工作原理：**

```
用户点击"生成验证报告"
  ↓
1. 从三个 webview 抓取最新回复
  ↓
2. 构建上下文数据包：
   - 用户的原始问题
   - ChatGPT 的回答
   - Claude 的回答
   - Gemini 的回答
  ↓
3. 发送到后端 API（或本地调用 LLM）
  ↓
4. 使用预设的 System Prompt 生成报告
  ↓
5. 在新窗口显示报告（支持 Markdown 渲染）
```

---

**技术实现：**

示例代码

```javascript
// renderer.js - 生成验证报告
const generateReportBtn = document.getElementById('generateReportBtn');

generateReportBtn.addEventListener('click', generateValidationReport);

async function generateValidationReport() {
  try {
    // 1. 禁用按钮，显示加载状态
    generateReportBtn.disabled = true;
    generateReportBtn.textContent = '🔄 生成中...';
    
    // 2. 抓取所有模型的最新回复
    const outputs = await captureAllOutputs();
    
    if (outputs.length === 0) {
      showNotification('❌ 没有可分析的内容');
      return;
    }
    
    // 3. 获取用户的原始问题（从历史中）
    const lastUserMessage = getLastUserMessage();
    
    // 4. 调用后端生成报告
    const report = await callReportAPI({
      userQuestion: lastUserMessage,
      modelOutputs: outputs,
      mode: getCurrentReportMode()  // 综合/裁判/学术/创意
    });
    
    // 5. 显示报告
    showReportWindow(report);
    
    // 6. 保存报告到历史
    saveReport(report);
    
  } catch (error) {
    console.error('生成报告失败:', error);
    showNotification('❌ 生成报告失败: ' + error.message);
  } finally {
    generateReportBtn.disabled = false;
    generateReportBtn.textContent = '🤖 生成验证报告';
  }
}

// 抓取所有模型的输出
async function captureAllOutputs() {
  const outputs = [];
  
  for (const [modelId, webview] of [
    ['chatgpt', chatgptView],
    ['claude', claudeView],
    ['gemini', geminiView]
  ]) {
    const config = selectors[modelId];
    if (!config) continue;
    
    const code = `
      (function() {
        try {
          // 查找所有 AI 回复的 DOM 元素
          const messageSelectors = ${JSON.stringify(config.messageContainer)};
          let messages = null;
          
          for (const selector of messageSelectors) {
            messages = document.querySelectorAll(selector);
            if (messages.length > 0) break;
          }
          
          if (!messages || messages.length === 0) {
            return { content: '', found: false };
          }
          
          // 获取最后一条消息
          const lastMessage = messages[messages.length - 1];
          let content = lastMessage.innerText || lastMessage.textContent;
          
          // 回溯逻辑：如果最后一条太短，抓取倒数第二条
          if (content.trim().length < 20 && messages.length >= 2) {
            content = messages[messages.length - 2].innerText;
          }
          
          return {
            content: content.trim(),
            found: true,
            messageCount: messages.length
          };
          
        } catch (error) {
          return { content: '', found: false, error: error.message };
        }
      })();
    `;
    
    try {
      const result = await webview.executeJavaScript(code);
      
      if (result.found && result.content) {
        outputs.push({
          model: modelId,
          content: result.content,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error(`抓取 ${modelId} 输出失败:`, error);
    }
  }
  
  return outputs;
}

// 调用后端 API 生成报告
async function callReportAPI(data) {
  const response = await fetch('https://api.multichat.ai/generate-report', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${await getAuthToken()}`
    },
    body: JSON.stringify(data)
  });
  
  if (!response.ok) {
    throw new Error(`API 错误: ${response.statusText}`);
  }
  
  const result = await response.json();
  return result.report;
}

// 在新窗口显示报告
function showReportWindow(report) {
  const { BrowserWindow } = require('@electron/remote');
  
  const reportWindow = new BrowserWindow({
    width: 900,
    height: 700,
    title: '验证报告',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  
  // 渲染 Markdown 报告
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>验证报告</title>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/github-markdown-css@5/github-markdown.min.css">
      <style>
        body {
          padding: 40px;
          background: #0d1117;
          color: #c9d1d9;
        }
        .markdown-body {
          background: #0d1117;
          color: #c9d1d9;
        }
        .actions {
          margin-bottom: 20px;
        }
        button {
          padding: 8px 16px;
          margin-right: 8px;
          background: #238636;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
        }
      </style>
      <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    </head>
    <body>
      <div class="actions">
        <button onclick="copyReport()">📋 复制</button>
        <button onclick="exportPDF()">💾 导出 PDF</button>
      </div>
      <div class="markdown-body" id="report"></div>
      <script>
        const reportContent = ${JSON.stringify(report)};
        document.getElementById('report').innerHTML = marked.parse(reportContent);
        
        function copyReport() {
          navigator.clipboard.writeText(reportContent);
          alert('已复制到剪贴板');
        }
        
        function exportPDF() {
          // 调用主进程导出 PDF
          window.electronAPI.exportPDF(reportContent);
        }
      </script>
    </body>
    </html>
  `;
  
  reportWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}
```

---

### **4.3 预设验证模式（System Prompts）**

**模式 1: 综合最佳 (Synthesizer)** 

```markdown
你是一个专业的 AI 分析师。用户向多个 AI 模型提问了同一个问题，你需要：

1. **提取共识**：找出所有模型都认同的核心观点
2. **去重整合**：合并相似的表述，保留最清晰的版本
3. **补充独特见解**：列出某个模型独有的有价值观点
4. **综合结论**：给出融合所有优点的最终答案

输出格式（Markdown）：

## 🎯 核心共识
[所有模型都认同的内容，用简洁的语言总结]

## 💡 独特观点
- **ChatGPT 独有**: [...]
- **Claude 独有**: [...]
- **Gemini 独有**: [...]

## ✅ 综合建议
[你的最终结论，融合所有模型的优点]

## 📚 延伸阅读
[建议用户进一步查阅的方向]
```

---

**模式 2: 裁判找茬 (The Critic)** 

```markdown
你是一个严格的事实核查专家和批判性思维导师。你的任务是：

1. **发现矛盾**：标记模型间的冲突观点
2. **检测幻觉**：识别可能不准确或虚构的内容
3. **评估置信度**：对每个模型的回答打分（1-10）
4. **验证建议**：告诉用户哪些需要进一步核查

输出格式（Markdown）：

## ⚠️ 发现的矛盾

| 问题点 | ChatGPT | Claude | Gemini | 风险等级 |
|-------|--------|--------|--------|---------|
| [主题] | [观点A] | [观点B] | [观点C] | 🔴高/🟡中/🟢低 |

## 🔍 可疑内容标记

**ChatGPT:**
- ⚠️ [可疑的引用/数据]：理由...
- ✅ [可信的内容]

**Claude:**
- ⚠️ [...]

**Gemini:**
- ⚠️ [...]

## 📊 置信度评分

| 模型 | 评分 | 理由 |
|------|------|------|
| ChatGPT | 8/10 | 逻辑严谨，但引用来源不明 |
| Claude | 9/10 | 保守谨慎，承认知识限制 |
| Gemini | 7/10 | 提供了独特视角，但部分数据需验证 |

## ✅ 验证清单
用户应自行核查的内容：
1. [ ] ...
2. [ ] ...
```

---

**模式 3: 学术严谨性分析** [Pro 可用]

```markdown
你是一个学术研究顾问。针对各模型的回答，请：

1. **引用质量评估**：检查是否有虚假或不完整的引用
2. **逻辑严谨性**：分析论证结构是否充分
3. **研究方向建议**：提供下一步研究的关键词和方向

输出格式（Markdown）：

## 📚 引用与来源评估

**ChatGPT:**
- ✅ 提到了 [论文/报告名称]，可信
- ⚠️ 引用 "[...]" 但未提供具体来源

**Claude:**
- ...

## 🧠 论证质量分析

| 模型 | 论证结构 | 逻辑完整性 | 证据支持 |
|------|---------|-----------|---------|
| ChatGPT | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| Claude | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| Gemini | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |

## 🔬 下一步研究建议

**推荐文献关键词:**
- [关键词1]
- [关键词2]

**推荐数据库:**
- Google Scholar
- PubMed
- arXiv

**需要验证的假设:**
1. ...
```

---

**模式 4: 创意发散 (Brainstorm)**

```markdown
你是一个创意策展人。你的任务是：

1. **保留多样性**：不合并观点，展示所有独特视角
2. **分类整理**：按主题或角度分组
3. **激发灵感**：在每个观点后添加延伸思考

输出格式（Markdown）：

## 🎨 创意矩阵

### 角度 1: [主题]
- **ChatGPT 的视角**: [...]
  💡 **延伸思考**: 如果将这个想法应用到 [...] 领域会如何？

- **Claude 的视角**: [...]
  💡 **延伸思考**: [...]

### 角度 2: [主题]
- ...

## 🔥 最具潜力的方向

根据三个模型的回答，以下方向最值得深入探索：
1. **[方向1]**: 结合了 [ChatGPT 的X] 和 [Claude 的Y]
2. **[方向2]**: ...

## 🚀 下一步行动建议
[具体的可执行步骤]
```

---

## **5. MVP 范围定义 (Minimum Viable Product)**

### **5.1 Phase 1: 核心架构 MVP（Week 1-2，10-14 人日）**

**必须包含：**

| 模块 | 功能范围 | 验收标准 |
|------|---------|---------|
| **基础架构** | • Electron 应用框架<br>• 3 个并排 Webview<br>• 登录状态持久化 | 应用可以启动，显示三个 AI 平台 |
| **统一输入** | • 主输入框<br>• 同步发送到所有模型<br>• 基础错误处理 | 输入消息后，三个模型同时收到 |
| **CSS 优化** | • 隐藏侧边栏<br>• 优化显示宽度 | 界面简洁，无多余元素 |
| **选择器管理** | • 本地默认配置<br>• 云端热更新准备 | 选择器可配置，便于后续维护 |

**不做的功能（Phase 2）：**
- ❌ 文件上传
- ❌ Deep Research 模式
- ❌ AI 验证报告
- ❌ 历史记录
- ❌ 订阅系统

**目标：** 验证核心技术可行性，获取早期用户反馈。

---

### **5.2 Phase 2: 文件上传 + 验证报告（Week 3-4，12-16 人日）**

**新增功能：**

| 模块 | 功能范围 |
|------|---------|
| **文件上传** | • 文件选择器<br>• Base64 转换<br>• 并行上传到所有模型<br>• 上传进度显示 |
| **智能抓取** | • 从 Webview 抓取最新回复<br>• 回溯逻辑（太短则抓取上一条） |
| **AI 验证报告** | • 后端 API 集成<br>• "综合最佳"模式<br>• 报告窗口显示 |
| **历史记录** | • 本地存储（SQLite）<br>• 基础搜索 |

---

### **5.3 Phase 3: Deep Research + 付费（Week 5-7，15-20 人日）**

**新增功能：**

| 模块 | 功能范围 |
|------|---------|
| **Deep Research** | • 模式切换 UI<br>• 在 Webview 中启用研究模式<br>• 长时间生成的进度提示 |
| **订阅系统** | • 本地订阅验证<br>• Stripe 支付集成<br>• 功能限制管理 |
| **高级报告模式** | • 裁判找茬<br>• 学术分析<br>• 创意发散 |
| **导出功能** | • Markdown 导出<br>• PDF 导出 |

---

### **5.4 Phase 4: 优化与发布（Week 8，5-7 人日）**

**优化项：**
- 性能优化（启动速度、内存占用）
- Bug 修复
- 用户反馈收集
- 应用签名（macOS）
- 打包发布（Windows/Mac/Linux）

---

## **6. 非功能需求 (Non-Functional Requirements)**

### **6.1 性能指标**

| 指标 | 目标值 | 测量方法 |
|------|--------|---------|
| **应用启动时间** | < 3 秒 | 从点击图标到显示界面 |
| **Webview 加载时间** | < 5 秒 | 首次加载官方平台 |
| **消息发送延迟** | < 500ms | 点击发送到注入完成 |
| **内存占用** | < 500MB (空闲) | 三个
Webview 加载后 |
| **安装包大小** | < 100MB | 压缩后 |

---

### **6.2 兼容性**

**支持的操作系统：**
- macOS 11+ (Big Sur 及以上)
- Windows 10/11 (64-bit)

**最低硬件要求：**
- CPU: Intel i5 / AMD Ryzen 5 或更好
- 内存: 8GB RAM
- 硬盘: 200MB 可用空间

---

### **6.3 安全性**

**数据隐私：**
- ✅ 对话内容不上传到我们的服务器（仅在生成报告时）
- ✅ API Key / 登录 Token 加密存储（AES-256）
- ✅ Webview 使用独立 Partition（隔离 Cookie）

**代码签名：**
- macOS: 使用 Apple Developer 证书签名
- Windows: 使用 Code Signing 证书

**自动更新安全：**
- 更新包签名验证
- HTTPS 传输
- 回滚机制

---

### **6.4 可维护性**

**选择器热更新机制：**

```javascript
// 应用启动时检查更新
app.on('ready', async () => {
  await updateSelectors();
  createWindow();
});

// 每 24 小时检查一次
setInterval(updateSelectors, 24 * 60 * 60 * 1000);

async function updateSelectors() {
  try {
    const response = await fetch('https://api.multichat.ai/selectors.json?v=' + Date.now());
    const latestSelectors = await response.json();
    
    // 检查版本号
    const localVersion = store.get('selectors_version');
    if (latestSelectors.version > localVersion) {
      store.set('selectors', latestSelectors);
      store.set('selectors_version', latestSelectors.version);
      
      // 通知用户（可选）
      if (latestSelectors.requiresRestart) {
        showNotification('配置已更新，将在重启后生效');
      }
    }
  } catch (error) {
    console.error('更新选择器失败，使用本地缓存:', error);
  }
}
```

**错误上报：**
- 集成 Sentry 或自建错误追踪
- 自动收集崩溃日志
- 用户可选是否发送使用统计

---

### **7. 典型用户场景示例**

**场景 1：学术研究员验证事实**

```
1. 用户输入：
   "2024 年诺贝尔化学奖得主是谁？请列出他们的主要贡献。"

2. 三个模型同时回答（流式显示）

3. 用户点击"生成验证报告"

4. 报告显示：
   """
   ## 🎯 核心共识
   ChatGPT 和 Gemini 一致认为是 David Baker, Demis Hassabis, 
   John Jumper，表彰他们在蛋白质结构预测方面的贡献。
   
   ## ⚠️ 注意
   Claude 的训练数据截止于 2024 年初，无法确认此信息。
   
   ## 📊 置信度评分
   - ChatGPT: 9/10
   - Gemini: 9/10
   - Claude: N/A (知识限制)
   
   ## ✅ 结论
   基于两个模型的一致性，答案可信度：高
   建议：访问诺贝尔奖官网进行最终确认
   """

5. 用户导出markdown报告到本地
```

---

**场景 2：数据分析师分析财报**

```
1. 用户点击 📎 上传 PDF（某公司财报）

2. 上传进度显示：
   ChatGPT: ✅
   Claude: ✅
   Gemini: ✅

3. 用户输入："分析这份财报的风险点"

4. 三个模型同时分析（5-10 秒）

5. 生成验证报告：
   """
   ## 💡 独特观点
   
   **ChatGPT 发现：**
   - 现金流下降 15%
   - 应收账款周转率恶化
   
   **Claude 发现：**
   - 长期债务占比过高（65%）
   - 研发支出削减可能影响长期竞争力
   
   **Gemini 发现：**
   - 营收增长但利润率下降
   - 汇率风险敞口较大
   
   ## 🔥 综合建议
   三个模型共同关注现金流和债务问题，建议重点关注...
   """

```

---
**文档版本历史：**
- V1.0 (2023-10-27): 初始版本（浏览器插件方案）
- V2.0 (2024-12-01): 调整为 Web API 方案
- V3.0 (2024-12-02): **最终方案 - Electron 桌面应用**