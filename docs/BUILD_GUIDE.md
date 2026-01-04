# ModelMash 打包发布指南

本指南详细说明如何构建和发布 ModelMash 的各种版本。

---

## 📑 目录

- [环境准备](#-环境准备)
- [快速开始](#-快速开始)
- [构建命令详解](#-构建命令详解)
- [两种打包模式](#-两种打包模式)
- [打包流程](#-打包流程)
- [验证构建结果](#-验证构建结果)
- [发布流程](#-发布流程)
- [常见问题](#-常见问题)
- [最佳实践](#-最佳实践)

---

## 📋 环境准备

### 系统要求

- **操作系统**：Windows 10/11（主要开发平台）
- **Node.js**：20.x LTS 或更高版本
- **包管理器**：npm 10.x+ 或 pnpm 8.x+
- **磁盘空间**：至少 2GB 可用空间

### 安装依赖

```bash
# 克隆项目
git clone https://github.com/your-username/modelmash.git
cd modelmash

# 安装依赖
npm install
# 或使用 pnpm（推荐）
pnpm install
```

### 首次构建检查

```bash
# 确保开发环境正常
npm run dev

# 测试构建（不打包）
npm run build
```

---

## 🚀 快速开始

### 推荐：一键构建所有版本

```bash
npm run build:win:all
```

**输出文件：**
- 输出目录以 `electron-builder.yml` 的 `directories.output` 为准（本仓库当前默认：`dist-build-run/`）
- `dist-build-run/ModelMash Setup 1.0.0.exe` - 安装版（NSIS）
- `dist-build-run/ModelMash-Portable-1.0.0.zip` - 便携版（ZIP）

**耗时：** 约 3-5 分钟（取决于机器性能）

---

## 📦 构建命令详解

### 开发相关命令

```bash
# 启动开发服务器（支持热更新）
npm run dev

# 编译代码（不打包）
npm run build

# 预览编译结果
npm run preview
```

### Windows 打包命令

| 命令 | 说明 | 输出 | 耗时 |
|------|------|------|------|
| `npm run build:win` | 构建所有 Windows 版本 | NSIS + Portable + ZIP | ~5分钟 |
| `npm run build:win:nsis` | 只构建安装版 | ModelMash Setup 1.0.0.exe | ~3分钟 |
| `npm run build:win:portable` | 只构建便携版 | ModelMash-Portable-1.0.0.zip | ~3分钟 |
| `npm run build:win:all` | 构建安装版和便携版 | Setup + Portable | ~4分钟 |

### 其他平台命令

```bash
# macOS（需要在 macOS 系统上运行）
npm run build:mac

# Linux
npm run build:linux
```

### 辅助命令

```bash
# 清理存储的配置（用于测试）
npm run clean:store

# 生成便携版标记文件
npm run add-portable-marker
```

---

## 🎯 两种打包模式

ModelMash 支持两种打包模式，满足不同用户需求：

### 1️⃣ 安装版（NSIS）- 推荐大多数用户

**特点：**
- ✅ 符合 Windows 标准安装流程
- ✅ 自动创建桌面和开始菜单快捷方式
- ✅ 支持卸载程序
- ✅ 支持自动更新（如果配置）
- ✅ 用户体验最佳

**数据存储位置：**
```
%APPDATA%\ModelMash\
├── config.json         # 用户配置
├── Session\            # Cookie、登录状态
├── Cache\              # 缓存文件
└── logs\               # 日志文件
```

**适合场景：**
- 长期使用的主力用户（占比约 80%）
- 需要系统集成
- 希望自动更新

**构建命令：**
```bash
npm run build:win:nsis
```

---

### 2️⃣ 便携版（Portable）- 特殊需求用户

**特点：**
- ✅ 无需安装，解压即用
- ✅ 数据存储在程序目录，真正便携
- ✅ 可放在 U 盘、移动硬盘运行
- ✅ 多版本可共存
- ✅ 不写入注册表

**数据存储位置：**
```
ModelMash-Portable-1.0.0\
├── ModelMash.exe
├── resources\
│   ├── app.asar
│   ├── portable.txt    # 便携模式标记文件
│   └── data\           # 用户数据（自动创建）
│       ├── config.json
│       ├── Session\
│       ├── Cache\
│       └── logs\
└── ...
```

**适合场景：**
- 需要在多台电脑间移动使用
- U 盘/移动硬盘运行
- 企业环境无安装权限
- 临时使用或测试
- 多版本共存

**构建命令：**
```bash
npm run build:win:portable
```

---

## 🔧 打包流程

### 完整打包流程（推荐）

#### Linux/macOS (Bash)

```bash
# 1. 确保代码最新
git pull origin main

# 2. 清理旧构建
rm -rf dist-build-run out

# 3. 安装/更新依赖
npm install

# 4. 运行测试（如果有）
# npm test

# 5. 更新版本号（如果需要）
# 编辑 package.json 中的 version 字段

# 6. 构建所有版本
npm run build:win:all

# 7. 检查输出
ls -lh dist-build-run/
```

#### Windows (PowerShell)

```powershell
# 1. 确保代码最新
git pull origin main

# 2. 清理旧构建
Remove-Item -Recurse -Force dist-build-run, out -ErrorAction SilentlyContinue

# 3. 安装/更新依赖
npm install

# 4. 运行测试（如果有）
# npm test

# 5. 更新版本号（如果需要）
# 编辑 package.json 中的 version 字段

# 6. 构建所有版本
npm run build:win:all

# 7. 检查输出
Get-ChildItem dist-build-run
```

### 分步打包流程

#### 步骤 1: 编译代码

```bash
npm run build
```

**输出目录：** `out/`
- `out/main/` - 主进程代码
- `out/preload/` - 预加载脚本
- `out/renderer/` - 渲染进程代码

#### 步骤 2: 生成便携版标记（仅便携版需要）

```bash
npm run add-portable-marker
```

**效果：**
- 创建/更新 `build/portable.txt`
- 显示构建信息和版本号

#### 步骤 3: 打包

**安装版：**
```bash
electron-builder --win nsis --config electron-builder.yml
```

**便携版：**
```bash
electron-builder --win zip --config electron-builder-portable.yml
```

---

## ✅ 验证构建结果

### 1. 检查输出文件

```bash
# 查看输出目录（以 electron-builder.yml 的 directories.output 为准）
ls -lh dist-build-run/

# 应该看到：
# ModelMash Setup 1.0.0.exe        (安装版)
# ModelMash-Portable-1.0.0.zip     (便携版)
# ModelMash-1.0.0-win.zip          (可选)
```

### 2. 验证安装版

#### 安装测试
1. 双击 `ModelMash Setup 1.0.0.exe`
2. 选择安装路径（或使用默认）
3. 在安装过程可勾选“创建桌面快捷方式”
4. 完成安装，结束页可勾选“固定到任务栏”

#### 运行验证
1. 启动应用
2. 按 `F12` 打开开发者工具
3. 查看控制台日志：
   ```
   [Main] 运行模式: 💿 安装版
   [Main] 数据目录: C:\Users\YourName\AppData\Roaming\ModelMash
   ```

#### 数据位置验证
1. 按 `Win+R` 打开运行
2. 输入 `%APPDATA%\ModelMash`
3. 应该看到：
   ```
   config.json
   Session\
   Cache\
   logs\
   ```

#### 快捷方式验证
- ✅ 如果安装时勾选了“创建桌面快捷方式”，桌面上会出现 "ModelMash 模方"
- ✅ 开始菜单中可以搜索到 "ModelMash"
- ✅ 如果结束页勾选了“固定到任务栏”，任务栏会出现固定项（可能受系统策略影响）

### 3. 验证便携版

#### 解压测试
1. 解压 `ModelMash-Portable-1.0.0.zip` 到测试目录
2. 双击 `ModelMash.exe` 运行

#### 标记文件验证
检查 `resources/` 目录：
```bash
# 应该存在这个文件
resources/portable.txt
```

#### 运行验证
1. 双击 `ModelMash.exe`
2. 按 `F12` 打开开发者工具
3. 查看控制台日志：
   ```
   [Portable] 运行模式: 便携版
   [Portable] 数据目录: [程序目录]\resources\data
   [Main] 运行模式: 🎒 便携版
   ```

#### 数据目录验证
1. 首次运行后，检查程序目录
2. 应该自动创建：
   ```
   resources\
     └── data\
         ├── config.json
         ├── Session\
         ├── Cache\
         └── logs\
   ```

### 4. 功能测试清单

#### 基础功能
- [ ] 应用正常启动
- [ ] 窗口显示正常
- [ ] 无启动错误

#### 核心功能
- [ ] 登录各 AI 平台
- [ ] 发送消息
- [ ] 文件上传
- [ ] 总结功能
- [ ] 历史记录保存

#### 数据持久化
- [ ] 关闭应用后重新打开
- [ ] 配置保持不变
- [ ] 登录状态保持
- [ ] 历史记录保留

#### 卸载测试（仅安装版）
- [ ] 卸载程序运行正常
- [ ] 可选择保留/删除数据
- [ ] 卸载后注册表清理

---

## 📤 发布流程

### 1. 准备发布

#### 更新版本号

编辑 `package.json`：
```json
{
  "version": "1.0.1"  // 更新版本号
}
```

#### 更新 CHANGELOG

创建或更新 `CHANGELOG.md`：
```markdown
## [1.0.1] - 2025-12-26

### 新增
- 便携版支持

### 优化
- 改进数据存储机制

### 修复
- 修复某个 Bug
```

#### 创建 Git Tag

```bash
# 提交所有更改
git add .
git commit -m "chore: release v1.0.1"

# 创建标签
git tag -a v1.0.1 -m "Release version 1.0.1"

# 推送代码和标签
git push origin main
git push origin v1.0.1
```

### 2. 构建发布版本

```bash
# 清理旧构建
rm -rf dist-build-run out

# 构建所有版本
npm run build:win:all

# 验证输出
ls -lh dist-build-run/
```

### 3. 创建 GitHub Release

#### 方法一：通过 GitHub 网页

1. 访问 `https://github.com/your-username/modelmash/releases`
2. 点击 "Draft a new release"
3. 选择标签：`v1.0.1`
4. 填写 Release 标题：`ModelMash v1.0.1`
5. 填写 Release 说明（参考下方模板）
6. 上传文件：
   - `dist-build-run/ModelMash Setup 1.0.0.exe`
   - `dist-build-run/ModelMash-Portable-1.0.0.zip`
7. 点击 "Publish release"

#### 方法二：使用 GitHub CLI

```bash
# 安装 GitHub CLI (如果未安装)
# winget install GitHub.cli

# 创建 Release
gh release create v1.0.1 \
  "dist-build-run/ModelMash Setup 1.0.1.exe" \
  dist-build-run/ModelMash-Portable-1.0.1.zip \
  --title "ModelMash v1.0.1" \
  --notes-file RELEASE_NOTES.md
```

### 4. Release 说明模板

创建 `RELEASE_NOTES.md`：

```markdown
# ModelMash v1.0.1

## 📦 下载

### 🎯 推荐：安装版
**[ModelMash Setup 1.0.1.exe](link)** (约 150MB)
- ✅ 符合 Windows 标准安装流程
- ✅ 自动创建桌面快捷方式
- ✅ 支持开始菜单搜索
- ✅ 支持自动更新
- ✅ 卸载时可选清理数据
- 📂 数据位置：`%APPDATA%\ModelMash\`
- 👥 **适合大多数用户**

### 💼 便携版
**[ModelMash-Portable-1.0.1.zip](link)** (约 150MB)
- ✅ 无需安装，解压即用
- ✅ 数据存储在程序目录
- ✅ 真正便携，可放 U 盘
- ✅ 多版本共存
- 📂 数据位置：`程序目录\resources\data\`
- 👥 适合：移动使用、企业环境、测试等场景

⚠️ **重要提示**：
- 两个版本的数据存储位置不同，不会自动同步
- 首次使用需要在各 AI 平台分别登录一次
- 便携版需要放在有写入权限的目录

---

## ✨ 更新内容

### 新增功能
- 🎒 新增便携版支持
- 📦 支持两种打包模式自动切换

### 优化改进
- 🔧 改进数据存储机制
- 📝 完善构建文档

### Bug 修复
- 🐛 修复某个问题

---

## 📝 安装说明

### 安装版
1. 下载 `ModelMash Setup 1.0.1.exe`
2. 双击运行安装程序
3. 选择安装路径（或使用默认）
4. 完成安装后启动应用

### 便携版
1. 下载 `ModelMash-Portable-1.0.1.zip`
2. 解压到任意目录（建议非系统盘）
3. 确保目录有写入权限
4. 双击 `ModelMash.exe` 运行

---

## 🔧 系统要求

- **操作系统**：Windows 10/11
- **内存**：建议 4GB 以上
- **磁盘空间**：约 200MB
- **网络**：需要网络连接访问 AI 平台

---

## 📖 完整文档

- [README.md](https://github.com/your-username/modelmash#readme) - 项目介绍
- [API_CONFIG_GUIDE.md](link) - API 配置指南
- [BUILD_GUIDE.md](link) - 构建打包指南

---

## 🐛 问题反馈

如遇到问题，请：
1. 查看 [常见问题](https://github.com/your-username/modelmash#常见问题)
2. 搜索 [Issues](https://github.com/your-username/modelmash/issues)
3. 提交新的 [Issue](https://github.com/your-username/modelmash/issues/new)

---

**完整更新日志**：[CHANGELOG.md](link)
```

### 5. 发布后验证

- [ ] GitHub Release 页面显示正常
- [ ] 下载链接可用
- [ ] 文件大小正确
- [ ] 测试下载并运行

---

## ❓ 常见问题

### Q0: 构建失败：app.asar 被占用（文件被另一个进程使用）

**问题：**
```
remove ...\\resources\\app.asar: The process cannot access the file because it is being used by another process.
```

**原因：** 上一次打包输出目录里生成的 `win-unpacked`/`app.asar` 被正在运行的应用、杀毒软件或索引服务占用。

**解决方案：**
1. 关闭正在运行的 ModelMash（包括从 `dist-build-run/win-unpacked/ModelMash.exe` 启动的情况）
2. 清理输出目录后重试构建

```powershell
# 1) 结束可能占用的进程
taskkill /IM ModelMash.exe /F 2>$null | Out-Null
taskkill /IM electron.exe /F 2>$null | Out-Null

# 2) 删除输出目录（以 electron-builder.yml 的 directories.output 为准）
Remove-Item -Recurse -Force dist-build-run -ErrorAction SilentlyContinue

# 3) 重新构建
npm run build:win:nsis
```

### Q1: 构建失败：electron 下载超时

**问题：**
```
Error: net::ERR_CONNECTION_TIMED_OUT
```

**解决方案：**
```bash
# 配置国内镜像
npm config set registry https://registry.npmmirror.com/
npm config set electron_mirror https://npmmirror.com/mirrors/electron/

# 重新安装
rm -rf node_modules
npm install
```

### Q2: 构建失败：权限不足

**问题：**
```
Error: EPERM: operation not permitted
```

**解决方案：**
1. 关闭杀毒软件（暂时）
2. 以管理员身份运行命令行
3. 或使用 WSL 环境构建

### Q3: 便携版数据没有保存

**问题：** 便携版关闭后配置丢失

**原因：** 程序目录没有写入权限

**解决方案：**
1. 将便携版移动到有权限的目录（如桌面、文档）
2. 避免放在 `C:\Program Files\` 等系统目录

### Q4: 安装版和便携版数据能否共享？

**回答：** 不能自动共享，但可以手动迁移。

**迁移方法：**
```bash
# 从安装版复制到便携版
xcopy /E /I "%APPDATA%\ModelMash" "便携版路径\resources\data"

# 从便携版复制到安装版
xcopy /E /I "便携版路径\resources\data" "%APPDATA%\ModelMash"
```

### Q5: 如何同时运行安装版和便携版？

**回答：** 可以，它们使用不同的数据目录，互不干扰。

但需要注意：
- 登录状态可能会冲突（共享 Cookie）
- 建议只使用一个版本

### Q6: 构建太慢怎么办？

**优化建议：**

1. **使用 pnpm 代替 npm**
   ```bash
   npm install -g pnpm
   pnpm install
   pnpm run build:win
   ```

2. **禁用压缩（开发测试时）**
   ```yaml
   # electron-builder.yml
   compression: store  # 不压缩，加快构建
   ```

3. **缓存 node_modules**
   - 不要每次都删除 `node_modules`
   - 只在依赖更新时重新安装

### Q7: 如何自定义图标？

**步骤：**
1. 准备图标文件：
   - `assets/logo.png` (256x256 或更大)
   - `assets/logo.ico` (可选，Windows 图标)

2. 更新配置：
   ```yaml
   # electron-builder.yml
   icon: assets/logo.png
   ```

3. 重新构建

### Q8: 打包后文件太大怎么办？

**优化方法：**

1. **启用 asar 压缩**（默认已启用）
   ```yaml
   asar: true
   ```

2. **排除不必要的文件**
   ```yaml
   files:
     - "!**/*.map"      # 排除 source map
     - "!**/*.md"       # 排除文档
     - "!**/test/**"    # 排除测试
   ```

3. **使用 7zip 压缩**
   ```yaml
   compression: maximum
   ```

---

## 💡 最佳实践

### 1. 版本管理

- ✅ 使用语义化版本号（MAJOR.MINOR.PATCH）
- ✅ 在 Git 中打标签
- ✅ 维护 CHANGELOG.md
- ✅ 每个版本对应一个 Release

### 2. 构建流程

- ✅ 构建前运行测试
- ✅ 使用 CI/CD 自动化构建
- ✅ 保留构建日志
- ✅ 验证构建结果

### 3. 发布策略

- ✅ 同时发布安装版和便携版
- ✅ 主推安装版，标注"推荐"
- ✅ 清晰说明两者区别
- ✅ 提供详细的使用说明

### 4. 文档维护

- ✅ 更新 README.md
- ✅ 维护 BUILD_GUIDE.md
- ✅ 记录 CHANGELOG.md
- ✅ 提供 Release Notes

### 5. 质量保证

- ✅ 测试所有核心功能
- ✅ 验证数据持久化
- ✅ 测试安装/卸载流程
- ✅ 检查不同环境兼容性

### 6. 用户支持

- ✅ 提供清晰的错误信息
- ✅ 维护 FAQ 文档
- ✅ 及时响应 Issues
- ✅ 收集用户反馈

---

## 📚 相关资源

### 官方文档
- [Electron](https://www.electronjs.org/docs)
- [electron-builder](https://www.electron.build/)
- [electron-vite](https://electron-vite.org/)

### 项目文档
- [README.md](../README.md) - 项目说明
- [API_CONFIG_GUIDE.md](../API_CONFIG_GUIDE.md) - API 配置
- [PORTABLE_BUILD_GUIDE.md](../PORTABLE_BUILD_GUIDE.md) - 便携版详解

### 工具
- [NSIS](https://nsis.sourceforge.io/) - 安装包制作工具
- [7-Zip](https://www.7-zip.org/) - 压缩工具
- [GitHub CLI](https://cli.github.com/) - GitHub 命令行工具

---

## 🎉 总结

通过本指南，你应该能够：

- ✅ 理解两种打包模式的区别
- ✅ 熟练使用各种构建命令
- ✅ 验证构建结果的正确性
- ✅ 完成完整的发布流程
- ✅ 解决常见的构建问题

如有任何问题，欢迎提交 Issue 或查看详细文档！

---

**最后更新**：2025-12-25
**版本**：1.0.0

