# MultiChat 文档索引

> 快速找到你需要的文档

---

## 📚 主要文档

### 🏠 项目概览
**[README.md](README.md)** - 项目主文档
- 项目介绍和核心功能
- 快速开始指南
- 技术栈说明
- 常见问题解答

### 📦 构建与打包
**[BUILD_GUIDE.md](BUILD_GUIDE.md)** - 完整打包指南（⭐ 推荐）
- 环境准备
- 构建命令详解
- 两种打包模式对比
- 完整打包流程
- 验证构建结果
- 发布流程
- 常见问题解决

**[PORTABLE_BUILD_GUIDE.md](PORTABLE_BUILD_GUIDE.md)** - 便携版详解
- 便携模式工作原理
- 实现细节
- 数据存储机制
- 配置文件说明

**[QUICK_BUILD_REFERENCE.md](QUICK_BUILD_REFERENCE.md)** - 快速参考
- 常用命令速查
- 发布检查清单
- 快速验证方法
- 常见问题速查

### ⚙️ 配置说明
**[API_CONFIG_GUIDE.md](API_CONFIG_GUIDE.md)** - API 配置指南
- API 供应商配置
- 模型配置
- 参数说明

### 💻 开发辅助
**[WINDOWS_COMMANDS.md](WINDOWS_COMMANDS.md)** - Windows PowerShell 命令参考
- Bash 与 PowerShell 命令对照
- 常用开发命令
- 实用技巧和自定义函数
- 常见错误解决方案

**[GITHUB_GUIDE.md](GITHUB_GUIDE.md)** - GitHub 仓库管理指南
- 初始化与连接
- 常用开发工作流 (Pull, Branch, Commit, Push)
- 分支管理策略与提交规范
- 版本发布流程

**[PORTABLE_MODE_EXPLAINED.md](PORTABLE_MODE_EXPLAINED.md)** - 便携模式说明
- 为什么改用 ZIP 格式
- 使用方法和验证
- 迁移指南

---

## 📖 按用途查找

### 🎯 我想开始开发
1. 阅读 [README.md](README.md) 了解项目
2. 按照"快速开始"章节配置环境
3. 运行 `npm run dev` 启动开发

### 📦 我想打包发布
1. 快速入门：[QUICK_BUILD_REFERENCE.md](QUICK_BUILD_REFERENCE.md)
2. 详细指南：[BUILD_GUIDE.md](BUILD_GUIDE.md)
3. 发布检查：使用 BUILD_GUIDE 中的检查清单

### 🎒 我想了解便携版
1. 原理说明：[PORTABLE_BUILD_GUIDE.md](PORTABLE_BUILD_GUIDE.md)
2. 构建方法：[BUILD_GUIDE.md](BUILD_GUIDE.md) 第3章
3. 快速构建：`npm run build:win:portable`

### 🔧 我想配置 API
1. 完整指南：[API_CONFIG_GUIDE.md](API_CONFIG_GUIDE.md)
2. 快速配置：README.md 配置说明章节

### ❓ 我遇到了问题
1. 查看 [README.md](README.md#常见问题)
2. 查看 [BUILD_GUIDE.md](BUILD_GUIDE.md#常见问题)
3. 搜索 [GitHub Issues](https://github.com/max-doo/multichat/issues)
4. 提交新 Issue

---

## 🔍 按主题查找

### 开发相关
- 项目结构：[README.md](README.md#项目结构)
- 技术栈：[README.md](README.md#技术栈)
- 开发环境：[README.md](README.md#快速开始)
- **版本控制：[GITHUB_GUIDE.md](GITHUB_GUIDE.md)**

### 构建相关
- 构建命令：[BUILD_GUIDE.md](BUILD_GUIDE.md#构建命令详解)
- 打包流程：[BUILD_GUIDE.md](BUILD_GUIDE.md#打包流程)
- 便携模式：[PORTABLE_BUILD_GUIDE.md](PORTABLE_BUILD_GUIDE.md)

### 配置相关
- API 配置：[API_CONFIG_GUIDE.md](API_CONFIG_GUIDE.md)
- 模型管理：[README.md](README.md#模型管理)
- DOM 选择器：[README.md](README.md#dom-选择器配置)

### 发布相关
- 发布流程：[BUILD_GUIDE.md](BUILD_GUIDE.md#发布流程)
- Release 说明：[BUILD_GUIDE.md](BUILD_GUIDE.md#release-说明模板)
- 版本管理：[BUILD_GUIDE.md](BUILD_GUIDE.md#版本管理)

---

## 🗂️ 文件清单

### 核心文档
```
📄 README.md                      # 项目主文档
📄 BUILD_GUIDE.md                 # 构建打包指南
📄 PORTABLE_BUILD_GUIDE.md        # 便携版详解
📄 QUICK_BUILD_REFERENCE.md       # 快速参考
📄 API_CONFIG_GUIDE.md            # API 配置指南
📄 GITHUB_GUIDE.md                # GitHub 仓库管理指南
📄 USER_GUIDE.md                  # 用户指南
📄 WINDOWS_COMMANDS.md            # Windows PowerShell 命令参考
📄 DOCS_INDEX.md                  # 文档索引（本文件）
```

### 设计笔记与 DOM 选择器文档
```
📄 Gemini canvas dom.md           # Gemini Canvas DOM 结构
📄 输入框dom.md                    # 输入框 DOM 选择器
📄 输出内容dom.md                  # 输出内容 DOM 选择器
📄 上传文件dom.md                  # 上传文件 DOM 选择器
📄 深度研究dom.md                  # 深度研究 DOM 选择器
📄 研究报告dom选择器.md            # 研究报告 DOM 选择器
📄 gemin开启推理.md                # Gemini 开启推理说明
📄 总结模块提示词架构方案.md        # 总结模块提示词架构
📄 MultiChatPRD 3 simple.md       # 产品需求文档
📄 清空开发服务器本地储存.md        # 清空本地存储方法
```

### 配置文件
```
⚙️ package.json                   # 项目配置与脚本
⚙️ electron-builder.yml           # 通用打包配置
⚙️ electron-builder-portable.yml  # 便携版配置
⚙️ electron.vite.config.ts        # Vite 配置
⚙️ tsconfig.json                  # TypeScript 配置
⚙️ tailwind.config.js             # Tailwind CSS 配置
```

### 脚本文件
```
🔧 scripts/add-portable-marker.js # 便携版标记生成
```

### 标记文件
```
📋 build/portable.txt             # 便携版标记文件
```

---

## 💡 推荐阅读顺序

### 新手入门
1. **[README.md](README.md)** - 了解项目
2. **[README.md#快速开始](README.md#快速开始)** - 配置环境
3. 运行 `npm run dev` 体验开发

### 准备发布
1. **[QUICK_BUILD_REFERENCE.md](QUICK_BUILD_REFERENCE.md)** - 快速了解
2. **[BUILD_GUIDE.md](BUILD_GUIDE.md)** - 详细学习
3. 按照检查清单执行发布

### 深入学习
1. **[PORTABLE_BUILD_GUIDE.md](PORTABLE_BUILD_GUIDE.md)** - 便携模式原理
2. **[项目结构](README.md#项目结构)** - 代码组织
3. **源码阅读** - 理解实现细节

---

## 📞 获取帮助

### 文档中找不到答案？

1. **搜索文档**
   - 使用 `Ctrl+F` 在文档中搜索关键词
   - 查看相关章节的"常见问题"部分

2. **搜索 Issues**
   - [已有 Issues](https://github.com/max-doo/multichat/issues?q=is%3Aissue)
   - 可能已经有人遇到相同问题

3. **提问**
   - [Discussions](https://github.com/max-doo/multichat/discussions) - 一般性讨论
   - [New Issue](https://github.com/max-doo/multichat/issues/new) - 报告 Bug

4. **联系方式**
   - Email: your-email@example.com
   - GitHub: @your-username

---

## 🔄 文档更新

- **最后更新**：2025-12-25
- **版本**：1.0.0
- **维护者**：MultiChat Team

### 贡献文档

如果你发现文档有误或需要改进：

1. Fork 项目
2. 修改文档
3. 提交 Pull Request

我们欢迎所有形式的文档改进！

---

## ✅ 文档检查清单

使用本索引前，请确保以下文档存在：

- [x] README.md
- [x] BUILD_GUIDE.md
- [x] PORTABLE_BUILD_GUIDE.md
- [x] QUICK_BUILD_REFERENCE.md
- [x] API_CONFIG_GUIDE.md
- [x] GITHUB_GUIDE.md
- [x] DOCS_INDEX.md

---

**Happy Building! 🚀**