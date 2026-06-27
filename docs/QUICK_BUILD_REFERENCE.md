# MultiChat 构建快速参考

> 快速查阅常用构建命令和发布流程

---

## 🚀 常用命令

```bash
# 开发
npm run dev                    # 启动开发服务器

# 构建（推荐）
npm run build:win:all          # 构建安装版 + 便携版

# 单独构建
npm run build:win:nsis         # 只构建安装版
npm run build:win:portable     # 只构建便携版

# 完整构建
npm run build:win              # 构建所有 Windows 版本
```

---

## 📦 输出文件

| 文件名 | 类型 | 大小 | 推荐 |
|--------|------|------|------|
| `MultiChat-Setup-1.0.0.exe` | 安装版 | ~150MB | ⭐⭐⭐⭐⭐ |
| `MultiChat-Portable-1.0.0.exe` | 便携版 | ~150MB | ⭐⭐⭐ |
| `MultiChat-1.0.0-win.zip` | 压缩包 | ~150MB | ⭐⭐ |

---

## 🎯 两种模式对比

| 特性 | 安装版 | 便携版 |
|------|--------|--------|
| **需要安装** | ✅ 是 | ❌ 否 |
| **快捷方式** | ✅ 自动 | ❌ 手动 |
| **数据位置** | `%APPDATA%` | 程序目录 |
| **真正便携** | ❌ | ✅ |
| **推荐用户** | 长期使用 | 移动使用 |

---

## 📋 发布检查清单

### 发布前

- [ ] 更新 `package.json` 版本号
- [ ] 更新 `CHANGELOG.md`
- [ ] 提交所有代码更改
- [ ] 创建 Git 标签
- [ ] 运行测试（如果有）

### 构建

#### Bash (Linux/macOS)
```bash
# 1. 清理旧构建
rm -rf dist out

# 2. 构建
npm run build:win:all

# 3. 验证
ls -lh dist/
```

#### PowerShell (Windows)
```powershell
# 1. 清理旧构建
Remove-Item -Recurse -Force dist, out -ErrorAction SilentlyContinue

# 2. 构建
npm run build:win:all

# 3. 验证
Get-ChildItem dist
```

### 验证

- [ ] 安装版能正常安装
- [ ] 便携版能正常运行
- [ ] 数据保存在正确位置
- [ ] 核心功能正常工作
- [ ] 快捷方式创建成功

### 发布

- [ ] 创建 GitHub Release
- [ ] 上传安装包
- [ ] 填写 Release Notes
- [ ] 发布并验证

---

## 🔧 快速验证

### 验证安装版

```bash
# 1. 安装后运行
# 2. 按 F12 打开控制台
# 3. 查看日志：
#    [Main] 运行模式: 💿 安装版
#    [Main] 数据目录: C:\Users\...\AppData\Roaming\MultiChat

# 4. 验证数据位置
# Win+R → 输入 %APPDATA%\MultiChat
```

### 验证便携版

```bash
# 1. 解压并运行
# 2. 按 F12 打开控制台
# 3. 查看日志：
#    [Portable] 运行模式: 便携版
#    [Main] 运行模式: 🎒 便携版

# 4. 验证标记文件
# 检查：resources/portable.txt

# 5. 验证数据位置
# 检查：resources/data/
```

---

## 🐛 常见问题速查

| 问题 | 解决方案 |
|------|---------|
| electron 下载超时 | `npm config set electron_mirror https://npmmirror.com/mirrors/electron/` |
| 构建权限错误 | 以管理员身份运行 / 关闭杀毒软件 |
| 便携版数据不保存 | 将程序放到有写入权限的目录 |
| 构建太慢 | 使用 pnpm / 禁用压缩（测试时） |
| 两版本数据共享 | 手动复制数据目录 |

---

## 📚 完整文档

- 📖 **详细打包指南**：[BUILD_GUIDE.md](BUILD_GUIDE.md)
- 🎒 **便携版详解**：[PORTABLE_BUILD_GUIDE.md](PORTABLE_BUILD_GUIDE.md)
- 📘 **项目说明**：[README.md](README.md)
- 🔧 **API 配置**：[API_CONFIG_GUIDE.md](API_CONFIG_GUIDE.md)

---

## ⏱️ 预计时间

| 操作 | 耗时 |
|------|------|
| 安装依赖（首次） | 5-10 分钟 |
| 编译代码 | 1-2 分钟 |
| 打包单个版本 | 2-3 分钟 |
| 打包所有版本 | 4-5 分钟 |
| 完整发布流程 | 10-15 分钟 |

---

**最后更新**：2025-12-25

