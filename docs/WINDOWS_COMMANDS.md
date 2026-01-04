# Windows PowerShell 命令参考

> ModelMash 开发和构建的 Windows PowerShell 命令速查

---

## 📋 常用命令对照表

| 操作 | Bash (Linux/macOS) | PowerShell (Windows) |
|------|-------------------|---------------------|
| **删除目录** | `rm -rf dist` | `Remove-Item -Recurse -Force dist` |
| **删除文件** | `rm file.txt` | `Remove-Item file.txt` |
| **列出文件** | `ls -lh` | `Get-ChildItem` 或 `ls` |
| **查看文件大小** | `ls -lh dist/` | `Get-ChildItem dist \| Format-Table Name, Length` |
| **创建目录** | `mkdir -p build` | `New-Item -ItemType Directory -Path build -Force` |
| **复制目录** | `cp -r src dest` | `Copy-Item -Recurse src dest` |
| **查看文件内容** | `cat file.txt` | `Get-Content file.txt` 或 `cat file.txt` |
| **查找进程** | `ps aux \| grep node` | `Get-Process \| Where-Object {$_.Name -like "*node*"}` |
| **环境变量** | `export VAR=value` | `$env:VAR = "value"` |

---

## 🚀 ModelMash 开发命令

### 清理构建目录

```powershell
# 删除 dist 和 out 目录
Remove-Item -Recurse -Force dist, out -ErrorAction SilentlyContinue

# 或使用简写（别名）
rm -Recurse -Force dist, out -ErrorAction SilentlyContinue

# 或使用传统 Windows 命令
if (Test-Path dist) { rd /s /q dist }
if (Test-Path out) { rd /s /q out }
```

### 查看构建结果

```powershell
# 列出 dist 目录内容
Get-ChildItem dist

# 显示文件大小（易读格式）
Get-ChildItem dist | Select-Object Name, @{Name="Size(MB)";Expression={[math]::Round($_.Length/1MB, 2)}}

# 或使用简单格式
ls dist
```

### 完整构建流程

```powershell
# 1. 清理旧构建
Remove-Item -Recurse -Force dist, out -ErrorAction SilentlyContinue

# 2. 安装依赖（首次或依赖更新后）
npm install

# 3. 构建所有版本
npm run build:win:all

# 4. 检查输出文件
Get-ChildItem dist

# 5. 查看文件大小
Get-ChildItem dist | Format-Table Name, @{Name="Size(MB)";Expression={[math]::Round($_.Length/1MB, 2)}}
```

---

## 🛠️ 实用 PowerShell 技巧

### 检查文件/目录是否存在

```powershell
# 检查目录
if (Test-Path dist) {
    Write-Host "dist 目录存在"
} else {
    Write-Host "dist 目录不存在"
}

# 检查文件
if (Test-Path "dist\ModelMash-Setup-1.0.0.exe") {
    Write-Host "安装包已生成"
}
```

### 安全删除（带确认）

```powershell
# 删除前检查
if (Test-Path dist) {
    Remove-Item -Recurse -Force dist
    Write-Host "已删除 dist 目录"
}

# 或使用 -ErrorAction 忽略错误
Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue
```

### 创建目录

```powershell
# 创建单个目录
New-Item -ItemType Directory -Path build

# 创建多级目录（如果不存在）
New-Item -ItemType Directory -Path build\temp\test -Force

# 或使用简写
mkdir build -Force
```

### 文件操作

```powershell
# 复制文件
Copy-Item source.txt dest.txt

# 复制目录（递归）
Copy-Item -Recurse src\ dest\

# 移动文件
Move-Item old.txt new.txt

# 重命名文件
Rename-Item old.txt new.txt
```

---

## 🔍 调试和检查

### 查看 Node.js 和 npm 版本

```powershell
# Node.js 版本
node --version

# npm 版本
npm --version

# 查看所有全局安装的包
npm list -g --depth=0
```

### 查看环境变量

```powershell
# 查看特定环境变量
$env:APPDATA
$env:PATH

# 查看所有环境变量
Get-ChildItem Env:

# 临时设置环境变量
$env:NODE_ENV = "production"
```

### 进程管理

```powershell
# 查找 Node.js 进程
Get-Process | Where-Object {$_.Name -like "*node*"}

# 终止进程（按名称）
Stop-Process -Name "node" -Force

# 终止进程（按 PID）
Stop-Process -Id 12345
```

---

## 📦 npm 相关命令

### 安装和清理

```powershell
# 安装依赖
npm install

# 清理 npm 缓存
npm cache clean --force

# 删除 node_modules 并重新安装
Remove-Item -Recurse -Force node_modules
npm install

# 使用 pnpm（更快）
pnpm install
```

### 脚本执行

```powershell
# 运行 package.json 中的脚本
npm run dev
npm run build
npm run build:win:all

# 查看所有可用脚本
npm run
```

---

## 🎨 PowerShell 美化

### 设置别名（临时）

```powershell
# 为常用命令设置别名
Set-Alias ll Get-ChildItem
Set-Alias cls Clear-Host

# 使用别名
ll dist
```

### 永久设置（PowerShell Profile）

```powershell
# 打开 PowerShell 配置文件
notepad $PROFILE

# 如果文件不存在，先创建
if (!(Test-Path $PROFILE)) {
    New-Item -Path $PROFILE -ItemType File -Force
}

# 在配置文件中添加自定义函数和别名
# 例如：
function dev { npm run dev }
function build { npm run build:win:all }
function clean { Remove-Item -Recurse -Force dist, out -ErrorAction SilentlyContinue }
```

---

## 🚨 常见错误和解决方案

### 错误 1: 找不到参数 "rf"

```powershell
# ❌ 错误写法（Bash 风格）
rm -rf dist

# ✅ 正确写法（PowerShell）
Remove-Item -Recurse -Force dist
# 或
rm -Recurse -Force dist
```

### 错误 2: 权限不足

```powershell
# 以管理员身份运行 PowerShell
# 右键 PowerShell → 以管理员身份运行

# 或临时提升权限（需要 UAC 确认）
Start-Process powershell -Verb runAs
```

### 错误 3: 执行策略限制

```powershell
# 查看当前执行策略
Get-ExecutionPolicy

# 临时允许脚本执行（当前会话）
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

# 永久设置（需要管理员权限）
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned
```

### 错误 4: 路径包含空格

```powershell
# 使用引号包裹路径
Remove-Item -Recurse -Force "C:\Program Files\ModelMash"

# 或使用转义
Remove-Item -Recurse -Force C:\Program` Files\ModelMash
```

---

## 📚 快速参考

### ModelMash 开发一键命令

```powershell
# 开发环境
npm run dev

# 清理 + 构建安装版
Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue; npm run build:win:nsis

# 清理 + 构建便携版
Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue; npm run build:win:portable

# 清理 + 构建所有版本
Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue; npm run build:win:all

# 快速验证构建结果
Get-ChildItem dist | Select-Object Name, @{Name="Size(MB)";Expression={[math]::Round($_.Length/1MB, 2)}}
```

### 创建自定义函数（添加到 $PROFILE）

```powershell
# ModelMash 开发助手函数
function mm-clean {
    Remove-Item -Recurse -Force dist, out -ErrorAction SilentlyContinue
    Write-Host "已清理构建目录" -ForegroundColor Green
}

function mm-build {
    mm-clean
    npm run build:win:all
}

function mm-check {
    if (Test-Path dist) {
        Get-ChildItem dist | Format-Table Name, @{Name="Size(MB)";Expression={[math]::Round($_.Length/1MB, 2)}}
    } else {
        Write-Host "dist 目录不存在，请先构建" -ForegroundColor Yellow
    }
}

# 使用方法
# mm-clean   # 清理
# mm-build   # 构建
# mm-check   # 检查
```

---

## 💡 推荐工具

### Windows Terminal

- 官方下载：Microsoft Store 搜索 "Windows Terminal"
- 支持多标签、美化、自定义主题
- 更好的 PowerShell 体验

### Oh My Posh

```powershell
# 安装 Oh My Posh（美化 PowerShell）
winget install JanDeDobbeleer.OhMyPosh

# 安装 Nerd 字体
oh-my-posh font install
```

### PSReadLine

```powershell
# 安装 PSReadLine（命令行增强）
Install-Module -Name PSReadLine -Force

# 启用预测建议
Set-PSReadLineOption -PredictionSource History
```

---

## 🔗 相关资源

- [PowerShell 官方文档](https://docs.microsoft.com/powershell/)
- [Windows Terminal 文档](https://docs.microsoft.com/windows/terminal/)
- [Oh My Posh 文档](https://ohmyposh.dev/)

---

## 📝 总结

主要区别：
- Bash: `-rf` 是两个选项的组合
- PowerShell: `-Recurse -Force` 是两个完整的参数名

建议：
- ✅ 习惯使用 PowerShell 的完整参数名
- ✅ 使用 `-ErrorAction SilentlyContinue` 忽略不存在的文件/目录错误
- ✅ 创建自定义函数简化常用操作

---

**最后更新**：2025-12-25

