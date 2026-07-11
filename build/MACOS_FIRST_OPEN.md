> Created: 2026-07-11 14:08 (+08:00)

# MultiChat 首次打开说明（macOS 验证期）

本版本暂未进行 Apple Developer ID 签名和公证。请仅从官方发布页下载，并先核对 Release 页面公布的 SHA-256。

1. 将 `MultiChat.app` 拖到“应用程序”文件夹。
2. 在 Finder 中按住 Control 点击 `MultiChat.app`，选择“打开”。
3. 在系统确认对话框中再次选择“打开”。
4. 若仍被拦截，请先尝试打开一次，再前往“系统设置 → 隐私与安全性”选择“仍要打开”。

不要关闭 Gatekeeper，也不要运行来源不明的“修复脚本”。高级用户如确认文件来自官方且校验和一致，可自行移除下载隔离标记：

```sh
xattr -dr com.apple.quarantine /Applications/MultiChat.app
```

划词工具条首次启用时需要授予“辅助功能”权限；首次读取外部应用选区时，macOS 还可能请求允许 MultiChat 自动化“System Events”。

macOS CLI 位于 `MultiChat.app/Contents/multichat-cli.sh`，可在终端直接运行该脚本。
