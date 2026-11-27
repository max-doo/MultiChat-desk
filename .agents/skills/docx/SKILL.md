---
name: docx
description: "创建、读取、编辑或转换 Word 文档（.docx/.dotx）时使用本技能。触发：任何提到'Word 文档'、'.docx'、'.dotx'、公文、报告、备忘录、信函、合同、简历、论文排版，或要求产出带目录/标题层级/页码/页眉的正式文档；也包括抽取或重组 docx 内容、文档内查找替换、图片替换、表单/占位符填充、批注与修订（红线）工作流、把内容转成可编辑 Word 成品。Use for create/read/edit Word documents (.docx/.dotx), redlining, tracked changes, comments, Chinese typography, GB/T 9704 official documents. 不要用于 PDF、电子表格（用 xlsx 技能）、Google Docs 或纯编码任务；结构性套版（多模板合并、逐节不同页眉页脚）按降级弱项处理，见正文'套模板'一节。"
license: 主体 Apache-2.0 见 LICENSE.txt；references/ 下移植自 MiniMax 的文本资产为 MIT，见 LICENSE-minimax.txt
---

# DOCX 创建、编辑与分析（中文场景适配版）

`.docx` 本质是 XML 文件的 ZIP 包。按任务选路径：

| 任务 | 路径 |
|---|---|
| **从零创建**新文档 | 写 Node 脚本用 `docx`（npm，docx-js）——见下方坑点清单 |
| **编辑**已有文档 | 解包 → 编辑 `word/document.xml` → 重打包（docx-js 无法打开已有文件） |
| **读取**内容 | `python -m markitdown file.docx`（**不用 pandoc**——宿主不装 pandoc） |

> 下文脚本路径均相对于本 skill 目录。命令默认在 PowerShell 中执行；多行 Python 内联代码建议写成临时 `.py` 文件再执行，避免 PowerShell 引号地狱。

## 第 0 步（永远先做）：运行时接线

本 skill 的 Python 依赖链走自举，不假设用户机器装了 Python：

```powershell
node "$env:MULTICHAT_RUNTIME_DIR/shared/ensure-python.mjs" --packages "defusedxml lxml markitdown[docx]"
```

stdout 输出一行 JSON：`{"ok":true,"pythonExe":"C:\\...\\python.exe","reused":bool,"source":"managed|system-venv|bootstrapped",...}`。**取出 `pythonExe` 的绝对路径**，后续所有 `python xxx` 调用都换成这个绝对路径（例如 `& "C:\...\python.exe" scripts\unpack.py ...`），shell PATH 不会被持久修改。脚本幂等：第二次执行秒回，`reused:true`。若输出 `ok:false`，按其中 `hint` 字段引导用户手动安装 Python，**不要静默重试**。

`node` 由宿主保证在 PATH 中（复用 Electron 本体），**但没有 npm/npx**——`docx` 等 npm 依赖在打包期预装进本技能目录的 `node_modules`，加载方式见"从零创建"一节。

## 中文排版（本 skill 的核心增量）

处理中文文档时，先读 `references/cjk_typography.md`：

- **字体回退经验**：中文正文优先 `宋体`(SimSun)、标题优先 `微软雅黑`/`黑体`；中西文混排时 Latin 字体与 `w:eastAsia` 中文字体要分别设置。docx-js 里用 `font: { ascii: "Times New Roman", eastAsia: "宋体" }`；编辑 XML 时 `<w:rFonts w:ascii="..." w:hAnsi="..." w:eastAsia="宋体"/>` 缺一不可（没有 eastAsia 中文会变豆腐块）。
- **公文（GB/T 9704）**：红头文件格式（标题小标宋二号、正文仿宋_GB2312 三号、行距固定值 28 磅等）完整配方在 `references/cjk_typography.md` 的 GB/T 9704 一节，用户说"公文/红头文件/按国标格式"时严格照做。
- **学术格式**：学位论文常见字体字号要求同文收录。
- **排版排错**：中文变方块、字重不对、标点挤压问题查 `references/troubleshooting.md` 第 11 条。

手工编辑 XML 前必读 `references/openxml_element_order.md`（元素顺序错误是 Word"无法打开"的第一大原因）和 `references/openxml_units.md`（DXA/半磅/EMU 换算）。

## 从零创建（docx-js）——坑点清单

写 Node 脚本，用 createRequire 从技能目录加载 `docx` 包：

```javascript
const { createRequire } = require("module");
const skillRequire = createRequire("<本技能目录的绝对路径>/");
const docx = skillRequire("docx");
```

`docx`（npm 包）应已随包预装在本技能目录的 `node_modules` 中，打包期依本目录 `package.json` 安装。用 `createRequire` 指向技能目录加载，保证无论脚本放在哪个工作目录都能命中；也可以设 `NODE_PATH=<本技能目录>/node_modules` 后正常 `require('docx')`。**运行时没有 npm**——require 失败属于打包缺陷，把事实报告给用户，不要尝试静默重装。

模型熟悉 docx-js API；以下是血泪坑点：

- **页面默认 A4**。中文公文/报告用 A4 正好；要 US Letter 设 `page: { size: { width: 12240, height: 15840 } }`（DXA；1440 = 1 英寸）。
- **横向**：传纵向尺寸 + `orientation: PageOrientation.LANDSCAPE`，docx-js 内部交换宽高。
- **表格要双宽度**：表上设 `columnWidths` 且每个单元格设 `width`，都用 `WidthType.DXA`（PERCENTAGE 在 Google Docs 会坏）。列宽之和必须等于表宽。
- **表格底纹**用 `ShadingType.CLEAR`，绝不用 `SOLID`（渲染成黑色）。
- **列表**绝不直接插入 `•` 字符，用 `numbering` 配置 + `LevelFormat.BULLET`。
- **`ImageRun` 必须带 `type:`**（`"png"`、`"jpg"`…）。
- **`PageBreak` 必须包在 `Paragraph` 里。**
- **绝不用 `\n`**——用多个 `Paragraph`。
- **标题**：用到的每一级都要在 `styles.default` 里显式配置（`heading1: { run: { font: {...}, size: 32, bold: true }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true } }`）。每级都要独立设字体（即使有文档级默认）、before/after（即使是 0）和 `keepNext`——内置样式这些全不设。中文字号换算查 `references/cjk_typography.md`（如三号=16pt=docx-js size 32，因为 size 单位是半磅）。
- **目录（TOC）**：标题必须用内置 `HeadingLevel.*`；自定义标题样式需设 `outlineLevel` 否则不进目录。
- **不要用表格当水平分隔线**——用段落底边框。
- **点线引导/同行右对齐**：用 `PositionalTab`（`alignment: PositionalTabAlignment.RIGHT`、`leader: PositionalTabLeader.DOT`）放在 `TextRun` 里，不要手打一堆 `.` 或空格。

## 验证产出

写出 `.docx` 后要渲染查看。LibreOffice 是**探测式可选增强**，不是硬前置：

```powershell
& "C:\...\python.exe" scripts\office\soffice_probe.py probe
```

- `{"available":true}` → 可渲染验证：
  ```powershell
  & "C:\...\python.exe" scripts\office\soffice_probe.py convert output.docx --to pdf --outdir preview
  ```
  若再探测到 `pdftoppm`（poppler）可把 PDF 转图片逐页查看；查不到时直接告知用户在 Word/WPS 中打开检查。
- `{"available":false}` → **降级**：不渲染，明确告诉用户"请用 Word 或 WPS 打开检查排版"，绝不在此处卡住或报错。这是正常的降级路径，不是失败。

## 编辑已有文档（原子写回纪律）

旧版 `.doc` 先转 `.docx`（需 LibreOffice；没有就让用户在 Word 里另存为）。

**铁律：全流程任何失败都不得损坏用户原文件。** 标准流程：

```powershell
# 1. 在同卷临时目录解包（与目标文件同一盘符，保证最后一步 os.replace 原子）
$work = Join-Path (Split-Path $target) ".docx-work-$PID"
& "C:\...\python.exe" scripts\unpack.py $target $work

# 2. 合并碎裂的 run，让文本可被查找替换
& "C:\...\python.exe" scripts\merge_runs.py $work

# 3. 直接编辑 $work\word\document.xml —— 不要重排/美化整个文件的 XML

# 4. 重打包到临时副本（不是原文件！）
& "C:\...\python.exe" scripts\pack.py $work ($target + ".new")

# 5. 验证通过后才替换原文件；失败则删除临时副本，原文件分毫未动
& "C:\...\python.exe" scripts\office\validate.py ($target + ".new") --original $target
if ($LASTEXITCODE -eq 0) {
  Copy-Item $target ($target + ".bak")
  Move-Item -Force ($target + ".new") $target
  Remove-Item -Recurse -Force $work
} else {
  Remove-Item ($target + ".new")   # 交付失败，但原文件完好
}
```

`pack.py`/`validate.py` 内部的重打包本身就是同卷临时文件 + `os.replace` 原子写入；上面的"先验证后替换"是在它之上再加一道交付门禁。红线修订时 validate 加 `--author "<你修订用的名字>"`。

Word 会把文字拆进大量 `<w:r>` run（修订 id、拼写检查标记），看到的句子在 XML 里往往不是连续字符串。`merge_runs.py` 合并不改渲染的相邻同格式 run，也能直接处理 `.docx` 文件（`python scripts/merge_runs.py doc.docx -o merged.docx`）。

**修订（tracked changes）**：改稿留痕时，把 run 包进 `<w:ins>`/`<w:del>` 并带 `w:id`、`w:author`、`w:date` 属性。`<w:del>` 内文本元素是 `<w:delText>` 不是 `<w:t>`。删除整段 = 给段落标记加 `<w:pPr><w:rPr><w:del .../></w:rPr></w:pPr>` + 每个 run 包 `<w:del>`。`<w:del/>` 必须是 rPr 的第一个子元素——顺序有 schema 强制，细节见 `references/openxml_element_order.md`。

生成接受全部修订的干净副本：`& python scripts/accept_changes.py in.docx out.docx`（依赖 LibreOffice，先 probe；不可用时降级为提示用户在 Word 中"接受所有修订"）。注意：接受删除的段落标记应把该段并入下一段——Word 会这样做，accept_changes.py 在多数情况正确，但若后接空段则否；pandoc 从不并段。两视图里的空 bullet 都是视图假象不是文档缺陷，以 XML 检查为准。

## 套模板（降级弱项——尽力而为）

**主场景**：从零创建中文文档、表单/占位符填充、简单模板重排（替换文本、换字体样式）——这些用 docx-js 和上方编辑路径完全够用。

**降级弱项**：多模板合并、逐节不同页眉页脚、把整副模板外观完整套到内容文档上（结构性套版）。这些场景没有确定性工具，按 `references/scenario_c_apply_template.md` 的方法论直接操作 XML 尽力处理：

1. 先读该参考的 Zone 分析、Overlay vs Base-Replace 决策树、styleId 三层映射（精确匹配 → w:name 匹配 → 手工映射表）；
2. 严格执行其中的"直接格式清理规则"（保留 `w:eastAsia`！剥掉其余 rPr 覆盖）；
3. 用 `references/troubleshooting.md` 的症状索引排错。

遇到此场景时向用户明说：这是尽力处理，复杂套版可能需要在 Word/WPS 里人工收尾。

## 批注（comments）

批注需要六个交叉联动的文件，用 helper 脚本。解包目录模式（还要编辑 document.xml 时）优先：

```powershell
& "C:\...\python.exe" scripts\comment.py unpacked/ "费用封顶太低了"
& "C:\...\python.exe" scripts\comment.py unpacked/ "同意" --parent 0
# 或直接对 docx 操作
& "C:\...\python.exe" scripts\comment.py contract.docx "这个封顶太低了" -o annotated.docx
```

脚本写好 `comments.xml` 等五个部件和关系/内容类型，然后打印要加进 `word/document.xml` 的 `<w:commentRangeStart>`/`<w:commentRangeEnd>`/`<w:commentReference>` 片段——**锚点标记放入文档前批注不可见**。

## 依赖

- `docx`（npm）——随包预装于技能目录 `node_modules`，打包期依本目录 `package.json` 安装
- Python 依赖链（ensure-python.mjs 自举）：`defusedxml`、`lxml`、`markitdown`
- LibreOffice（`soffice`）与 poppler（`pdftoppm`）——探测式可选，未装走降级路径
- **不用 pandoc**（读取走 markitdown）；**不用 unzip/zip 命令行**（解包重打包走 Python zipfile，见 unpack.py/pack.py）
