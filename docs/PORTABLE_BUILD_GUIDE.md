# MultiChat 便携版构建指南

## 📦 概述

MultiChat 现在支持两种打包方式：

| 类型 | 特点 | 数据位置 | 适用场景 |
|------|------|---------|---------|
| **安装版 (NSIS)** | 需要安装，集成系统 | `%APPDATA%\MultiChat\` | 长期使用，推荐大多数用户 |
| **便携版 (Portable)** | 无需安装，解压即用 | `程序目录\resources\data\` | U盘运行，多版本共存 |

两种版本使用**完全相同的代码**，通过**运行时检测**自动切换数据存储位置。

---

## 🔧 工作原理

### 便携模式检测

程序启动时会检查 `resources/portable.txt` 文件：

```typescript
// 伪代码示意
if (存在 portable.txt) {
  数据目录 = "程序目录/resources/data/"  // 便携模式
} else {
  数据目录 = "%APPDATA%/MultiChat/"      // 安装模式
}
```

### 数据存储位置

**便携版目录结构：**
```
MultiChat-Portable-1.0.0/
├── MultiChat.exe
├── resources/
│   ├── app.asar
│   ├── portable.txt          # 🔑 标记文件
│   └── data/                 # 🔑 用户数据目录（自动创建）
│       ├── config.json       # 配置文件
│       ├── Session/          # Cookie/登录状态
│       ├── Cache/            # 缓存
│       └── logs/             # 日志
├── locales/
└── ...其他 Electron 文件
```

**安装版数据位置：**
```
%APPDATA%\MultiChat\
├── config.json
├── Session/
├── Cache/
└── logs/
```

---

## 🚀 构建命令

### 1. 构建安装版（推荐大多数用户）

```bash
npm run build:win:nsis
```

**输出：**
- `dist/MultiChat-Setup-1.0.0.exe` （约 150MB）

**特点：**
- ✅ 符合 Windows 安装规范
- ✅ 自动创建桌面快捷方式
- ✅ 支持开始菜单搜索
- ✅ 数据存储在 `%APPDATA%`

---

### 2. 构建便携版

```bash
npm run build:win:portable
```

**输出：**
- `dist/MultiChat-Portable-1.0.0.exe` （约 150MB）

**特点：**
- ✅ 无需安装，解压即用
- ✅ 数据存储在程序目录
- ✅ 真正便携，可放 U 盘
- ✅ 多版本共存

**构建流程：**
1. 编译应用代码
2. 执行 `add-portable-marker` 脚本（创建标记文件）
3. 使用 `electron-builder-portable.yml` 配置打包
4. 将 `portable.txt` 打包到 `resources/` 目录

---

### 3. 同时构建两个版本

```bash
npm run build:win:all
```

**输出：**
- `dist/MultiChat-Setup-1.0.0.exe` （安装版）
- `dist/MultiChat-Portable-1.0.0.exe` （便携版）

---

### 4. 完整构建（包含所有格式）

```bash
npm run build:win
```

**输出：**
- `dist/MultiChat-Setup-1.0.0.exe` （NSIS 安装包）
- `dist/MultiChat-Portable-1.0.0.exe` （便携版）
- `dist/MultiChat-1.0.0-win.zip` （压缩包，按安装版处理）

---

## 📝 发布建议

### GitHub Release 描述模板

```markdown
## 📦 下载

### 🎯 推荐：安装版
**[MultiChat-Setup-1.0.0.exe](link)** (约 150MB)
- ✅ 符合 Windows 标准安装流程
- ✅ 自动创建桌面快捷方式
- ✅ 支持开始菜单搜索
- ✅ 支持自动更新
- ✅ 卸载时可选清理数据
- 📂 数据位置：`%APPDATA%\MultiChat\`
- 👥 适合：长期使用的用户（推荐）

### 💼 便携版
**[MultiChat-Portable-1.0.0.exe](link)** (约 150MB)
- ✅ 无需安装，解压即用
- ✅ 数据存储在程序目录
- ✅ 真正便携，可放 U 盘
- ✅ 多版本共存
- 📂 数据位置：`程序目录\resources\data\`
- 👥 适合：
  - 需要在多台电脑间移动使用
  - U 盘/移动硬盘运行
  - 企业环境无安装权限
  - 临时使用或测试

⚠️ **注意**：两个版本的数据位置不同，不会自动同步。
```

---

## 🔍 验证构建

### 验证便携版

1. **解压便携版安装包**
2. **检查 `resources/` 目录：**
   ```
   resources/
   ├── app.asar
   ├── portable.txt  ← 确认此文件存在
   └── ...
   ```
3. **运行程序：**
   - 首次运行会自动创建 `resources/data/` 目录
   - 查看控制台日志，确认显示 "🎒 便携版"
4. **检查数据位置：**
   - 配置文件应在 `resources/data/config.json`
   - Session 数据在 `resources/data/Session/`

### 验证安装版

1. **运行安装程序**
2. **安装后运行应用**
3. **查看控制台日志：**
   - 确认显示 "💿 安装版"
4. **检查数据位置：**
   - 打开文件管理器：`%APPDATA%\MultiChat\`
   - 应该看到 `config.json`、`Session/` 等文件夹

---

## ⚠️ 注意事项

### 1. 便携版放置位置

便携版需要**写入权限**，建议放在：
- ✅ 桌面
- ✅ 文档文件夹
- ✅ D 盘等非系统盘
- ❌ `C:\Program Files\` （需要管理员权限）
- ❌ `C:\Windows\` （系统目录）

### 2. 数据迁移

如果用户从安装版切换到便携版（或反之），数据不会自动迁移。

可以手动复制：
```
从：%APPDATA%\MultiChat\
到：程序目录\resources\data\
```

### 3. 自动更新

- **安装版**：支持自动更新
- **便携版**：建议禁用自动更新，提示用户手动下载新版本

### 4. 首次运行提示

便携版首次运行时，代码会自动创建数据目录。如果失败（权限问题），会在日志中显示错误。

---

## 🐛 故障排查

### 便携版无法保存数据

**症状：** 退出后所有设置丢失

**原因：** 程序目录没有写入权限

**解决：**
1. 将便携版移动到有写入权限的目录（如桌面）
2. 或右键 MultiChat.exe → 属性 → 兼容性 → 以管理员身份运行

### 控制台看不到运行模式日志

**症状：** 没有 "🎒 便携版" 或 "💿 安装版" 日志

**原因：** 在开发环境运行（`npm run dev`）

**说明：** 开发环境始终使用标准模式，便携检测只在生产构建中生效

### 便携版标记文件丢失

**症状：** 便携版按安装版运行

**原因：** `resources/portable.txt` 文件丢失

**解决：**
1. 重新构建便携版：`npm run build:win:portable`
2. 检查 `electron-builder-portable.yml` 配置是否正确

---

## 📚 相关文件

| 文件 | 说明 |
|------|------|
| `src/main/index.ts` | 便携模式检测逻辑 |
| `electron-builder.yml` | 通用打包配置 |
| `electron-builder-portable.yml` | 便携版专用配置 |
| `build/portable.txt` | 便携版标记文件 |
| `scripts/add-portable-marker.js` | 标记文件生成脚本 |
| `package.json` | 构建命令定义 |

---

## ✅ 最佳实践

1. **同时发布两个版本**
   - 主推安装版（80% 用户）
   - 提供便携版（20% 特殊需求）

2. **清晰的版本命名**
   - `MultiChat-Setup-1.0.0.exe` （安装版）
   - `MultiChat-Portable-1.0.0.exe` （便携版）

3. **明确说明数据位置**
   - 在 Release 说明中注明数据存储位置
   - 提醒用户两个版本的数据不互通

4. **提供使用指南**
   - 便携版使用说明
   - 数据迁移指南
   - 常见问题解答

---

## 🎉 总结

通过这套实现，MultiChat 现在可以：
- ✅ 一套代码支持两种打包方式
- ✅ 自动检测运行模式
- ✅ 数据位置完全可控
- ✅ 满足不同用户需求
- ✅ 零维护成本

用户可以根据自己的使用场景自由选择合适的版本！

