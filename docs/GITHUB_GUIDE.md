# GitHub 仓库管理指南

本指南旨在规范项目的版本控制流程，确保代码库的整洁与可维护性。

## 1. 仓库初始化与连接

如果你是从零开始或者是接手现有代码但未关联远程仓库：

### 关联远程仓库
```bash
# 初始化 git（如果尚未初始化）
git init

# 关联远程仓库（请替换为实际地址）
git remote add origin https://github.com/max-doo/multichat.git

# 验证关联
git remote -v
```

### 首次推送
```bash
git add .
git commit -m "feat: initial commit"
git branch -M main
git push -u origin main
```

---

## 2. 日常开发工作流

推荐采用简单的 **Feature Branch** 工作流。

### 2.1 开始新功能
永远不要直接在 `main` 分支上开发。

```bash
# 1. 确保主分支是最新的
git checkout main
git pull origin main

# 2. 创建并切换到新功能分支
# 命名规范: type/feature-name 或 feat/feature-name
git checkout -b feat/add-deep-research
```

### 2.2 提交更改 (Committing)

我们遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范。

**格式**: `<type>(<scope>): <description>`

**常用 Type**:
- `feat`: 新功能 (feature)
- `fix`: 修复 bug
- `docs`: 文档变更
- `style`: 代码格式 (不影响代码运行的变动)
- `refactor`: 重构 (即不是新增功能，也不是修改 bug 的代码变动)
- `perf`: 性能优化
- `test`: 增加测试
- `chore`: 构建过程或辅助工具的变动

**示例**:
```bash
git commit -m "feat(ui): add new settings drawer"
git commit -m "fix(webview): resolve login persistence issue"
git commit -m "docs: update README with build instructions"
```

### 2.3 推送与合并

```bash
# 推送分支到远程
git push -u origin feat/add-deep-research

# 建议在 GitHub 页面上创建 Pull Request (PR) 请求合并到 main
# 这允许进行代码审查（Code Review）
```

如果是个人开发，也可以直接在本地合并（不推荐，建议养成 PR 习惯）：
```bash
git checkout main
git merge feat/add-deep-research
git push origin main
```

---

## 3. 分支管理策略

| 分支名 | 说明 | 保护规则 |
|--------|------|----------|
| `main` | 主分支，由于是发布分支，必须保持随时可部署状态。 | 禁止直接 Push，需通过 PR 合并 |
| `feat/*` | 功能分支，用于开发新功能。 | 开发完成后合并至 main 并删除 |
| `fix/*` |修复分支，用于修复 Bug。 | 修复完成后合并至 main 并删除 |
| `release/*` | 发布分支（可选），用于准备新版本发布。 | - |

---

## 4. 这里的 `.gitignore`

项目根目录的 `.gitignore` 已经配置好，自动忽略了以下文件，**切勿强制提交**：

- `node_modules/`: 依赖包
- `out/`, `dist/`: 构建产物
- `.env`: **敏感的环境变量配置文件** (包含 API Key 等)
- `.vscode/`, `.idea/`: 编辑器配置
- `logs/`: 运行日志

---

## 5. 版本发布 (Releases)

当准备发布新版本时（例如 v1.0.0）：

1. **更新版本号**: 修改 `package.json` 中的 `version` 字段。
2. **构建应用**: 确保 `npm run build` 和 `npm run build:win` 通过。
3. **提交版本**:
   ```bash
   git add package.json
   git commit -m "chore(release): bump version to 1.0.0"
   git push origin main
   ```
4. **打标签 (Tag)**:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
5. **GitHub Release**:
   - 在 GitHub 仓库页面点击 "Releases" -> "Draft a new release"。
   - 选择刚才推送的 Tag (`v1.0.0`)。
   - 填写标题和发布说明（Release Notes）。
   - **上传构建产物**: 将 `dist/` 目录下的安装包（`.exe`, `.zip`）上传到附件中。
   - 点击 "Publish release"。

---

## 6. 常见问题处理

### 撤销本地修改
```bash
# 丢弃工作区的修改（危险操作）
git checkout -- <file>

# 丢弃暂存区的修改（已 add 但未 commit）
git reset HEAD <file>
```

### 修改上一次提交信息
```bash
git commit --amend -m "新的提交信息"
# 注意：如果已经推送到远程，需要 git push --force (慎用)
```

### 解决冲突
当 `git pull` 或 `git merge` 提示冲突时：
1. 打开相关文件，寻找 `<<<<<<<`, `=======`, `>>>>>>>` 标记。
2. 手动修改代码，保留需要的部分。
3. 保存文件。
4. `git add <file>`。
5. `git commit` 完成合并。
