# ORIGIN — pptx skill 来源与改编记录

## 上游

| 来源 | 仓库 | commit | 许可证 |
|---|---|---|---|
| 主骨架 | anthropics/skills `skills/pptx` | e4bb5d960d87126ff3b3a8af1a104b7db67560ba | Apache-2.0（LICENSE.txt 随目录分发） |
| 内容参考 | MiniMax-AI/skills `skills/pptx-generator`（references/design-system.md 风格配方与行业色板） | 02853d885acb1abc157477ce00c4d98a8ed14a71 | MIT |

## 复制文件清单（anthropics，原样或小幅修改）

- `LICENSE.txt`（原样）
- `scripts/__init__.py`、`add_slide.py`、`apply_theme.js`、`clean.py`、`slide_text.py`、`thumbnail.py`
- `scripts/office/soffice.py`、`validate.py`、`helpers/*`、`schemas/*`、`validators/*`

改编新增：

- `SKILL.md`（中文适配重写）
- `references/design.md`（anthropics 设计指南 + MiniMax 设计系统的中文合并改写）
- `scripts/ensure-python.mjs`（Python embeddable bootstrap，Node 编写）
- `scripts/pdf2images.py`（pypdfium2 优先的 PDF 渲染，替代对 poppler 的硬依赖）
- `ORIGIN.md`（本文件）

## 改编决策清单

1. **SKILL.md 全量中文适配重写**：保留上游全部技术要点（pptxgenjs 雷区、结构化演示、编辑路径、QA 流程、字体安全表），按中国用户场景重组；description 中英双语。
2. **设计内容拆分**：原 SKILL.md 的 Design Ideas/色板/排版表移入 `references/design.md`（渐进式披露），并合并 MiniMax 的 18 组行业色板与 4 档圆角/间距风格配方（MIT 允许）。
3. **Python 接线**：宿主不预装 Python，新增 `ensure-python.mjs`（幂等下载 embeddable Python + get-pip 引导 + 解除 `import site` 注释 + pip 装包，JSON 状态输出，网络重试 ≤2 次）。SKILL.md 要求所有脚本用返回的 `pythonExe` 绝对路径显式调用。
4. **soffice 探测式改造**：`soffice.py` 增加 `find_soffice()`（SOFFICE_PATH 环境变量 → PATH → Windows 常见安装位置）与 `--check` JSON 探测出口；未安装时 `run_soffice` 抛 FileNotFoundError，CLI 退出码 3 并提示降级为人工检查。Windows 下跳过 AF_UNIX LD_PRELOAD shim（Linux 沙箱专用）。
5. **poppler 硬依赖解除**：`thumbnail.py` 的 pdftoppm 调用替换为新增的 `scripts/pdf2images.py`（pypdfium2 优先、pdftoppm 兜底、都没有时退出码 3 优雅降级）。
6. **脚本可移植性修复**：`validate.py`/`thumbnail.py`/`clean.py`/`add_slide.py` 增加 `sys.path` 自举（上游假设从特定 cwd 运行）；`slide_text.py`/`validate.py` 等增加 stdout UTF-8 重配（Windows GBK 控制台中文乱码）。
7. **中文字体适配（实地验证驱动）**：实测发现 pptxgenjs 主题 fontScheme 的 `<a:ea>` 为空、Hans 脚本写死"等线 Light"，中文不跟随 headFontFace。`apply_theme.js` 扩展 `eastAsiaFontFace` 字段：写入 `<a:ea>` 并同步 Hans/Hant 脚本回退。该结论写入 SKILL.md"中文字体与排版"。
8. **原子写回纪律**：SKILL.md 明确要求——同卷临时文件操作 → validate 通过 → 原子替换；`add_slide.py` 必须传 `-o`；打包用 Python zipfile 而非依赖 zip 命令。
9. **zip 打包指引改写**：上游 bash zip 命令保留为可选，主路径改为 Python zipfile 示例（Windows 无 zip 命令风险）。
10. **未引入 .NET/pandoc**：与定稿一致，无 .NET 依赖；本 skill 原本就不依赖 pandoc。

## 依赖与版本

| 依赖 | 类型 | 供给方式 | 实测版本 |
|---|---|---|---|
| Python embeddable | 运行时 | `ensure-python.mjs` 按需下载 3.12.7 embed-amd64 | 3.12.7 |
| python-pptx / defusedxml / lxml / Pillow | pip | ensure-python 安装 | python-pptx 1.0.2 |
| pypdfium2 | pip | ensure-python 安装（渲染链路） | latest |
| pptxgenjs | npm | **打包期预装**：技能根 `package.json` 声明 `^4.0.1`，主 agent 在打包期安装进技能目录 `node_modules`（运行时无 npm） | 实测 4.0.1 |
| LibreOffice (soffice) | 系统 | 探测式可选增强，未安装降级为人工检查 | 本机未装，降级路径已验证 |
| pdftoppm (poppler) | 系统 | 探测式可选，pypdfium2 的兜底 | — |

**图标链（react-icons/react/react-dom/sharp）本期不做**：sharp 为平台相关原生模块，跨平台预装成本高。SKILL.md 图标一节已改写为降级路径（衬底+文字/原生形状/用户提供图片）。

**契约修正记录（2026-11-27）**：运行时仅有 `node`（复用 Electron 本体），无 npm/npx——SKILL.md 中"npm install 兜底"类指引已全部移除，替换为 createRequire/NODE_PATH 命中技能目录 node_modules 的写法；require 失败定性为打包缺陷报告给用户。
