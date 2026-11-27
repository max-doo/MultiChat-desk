---
name: xlsx
description: "打开、创建、读取、分析、编辑或校验 Excel 电子表格文件（.xlsx/.xlsm/.csv/.tsv）时使用本技能。触发：任何提到'Excel'、'电子表格'、'表格文件'、'.xlsx'、'.csv'、数据透视表、财务模型、预算表、公式，或要求产出/修改 Excel 格式的表格数据。覆盖：从零创建新表、读取分析现有文件、零格式损失编辑存量文件、公式重算与校验、专业财务格式规范。Use for create/read/analyze/edit/validate Excel spreadsheets (.xlsx/.xlsm/.csv), financial models, pivot tables, formula validation, zero-loss XML editing. 不要用于 Word 文档（用 docx 技能）、PDF 或纯文本报告；简单的一次性 CSV 查看（几行数据）可直接读取不必动用完整流程。"
license: MIT（见 LICENSE.txt，"Copyright (c) 2026 MiniMax"）
metadata:
  version: "1.0-multichat"
  category: productivity
  sources:
    - ECMA-376 Office Open XML File Formats
    - Microsoft Open XML SDK documentation
    - MiniMax-AI/skills minimax-xlsx（commit 02853d8）
---

# XLSX Skill（中文场景适配版）

直接处理请求，**不要派生子代理**。始终产出用户要求的文件。

## 第 0 步（永远先做）：运行时接线

Python 依赖链走自举，不假设用户机器装了 Python：

```powershell
node "$env:MULTICHAT_RUNTIME_DIR/shared/ensure-python.mjs" --packages "openpyxl pandas"
```

stdout 输出一行 JSON：`{"ok":true,"pythonExe":"C:\\...\\python.exe","reused":bool,"source":"managed|system-venv|bootstrapped",...}`。**取出 `pythonExe` 绝对路径**，后续所有 `python xxx` 调用都换成绝对路径（`& "C:\...\python.exe" scripts\xlsx_reader.py ...`）。脚本幂等，二次执行秒回；`ok:false` 时按 `hint` 引导用户手动安装，不要静默重试。

注意：本 skill 自带的 `xlsx_*.py` 脚本与 `formula_check.py` **只用标准库**，上述 pip 安装是为 pandas/openpyxl 分析路径与 CREATE 场景准备的。

## 任务路由

| 任务 | 方法 | 指南 |
|------|------|------|
| **读取** — 分析现有数据 | `xlsx_reader.py` + pandas | `references/read-analyze.md` |
| **创建** — 从零建新表 | XML 模板直改 | `references/create.md` + `references/format.md` |
| **编辑** — 修改存量文件 | XML 解包→编辑→重打包 | `references/edit.md`（要改样式再看 `format.md`） |
| **修复** — 修复坏公式 | XML 解包→修 `<f>` 节点→重打包 | `references/fix.md` |
| **校验** — 检查公式 | `formula_check.py` | `references/validate.md` |

## 读取 — 分析数据（先读 `references/read-analyze.md`）

先用 `xlsx_reader.py` 做结构发现，再用 pandas 做定制分析。**绝不修改源文件**。

**格式规则**：用户指定小数位（如"保留两位小数"）时，对**所有**数值套用该格式——每个数字都用 `f'{v:.2f}'`，需要 `12875.00` 时绝不输出 `12875`。

**聚合规则**：求和/均值/计数直接对 DataFrame 列操作——`df['Revenue'].sum()`，绝不先重建列值再聚合。

## 创建 — XML 模板（先读 `references/create.md` + `references/format.md`）

复制 `templates/minimal_xlsx/` → 直接编辑 XML → `xlsx_pack.py` 打包。**每个派生值必须是 Excel 公式**（`<f>SUM(B2:B9)</f>`），绝不硬编码数字。字体颜色按 `format.md` 执行。数据量大或需要复杂计算时，也可以走 openpyxl/pandas 从零创建（新文件无往返损失问题）；存量文件绝不用这条路，见下。

**模板注释必须清除**：`templates/minimal_xlsx/` 各 XML 中的 `<!-- ... -->` 是编写指导，不是数据。实测发现 `<sheets>`/`<sheetData>` 内残留的注释节点会被 lxml/openpyxl 当作元素解析导致读取失败（`ChildSheet.name is None`）。编辑时把所有注释连同占位符一起删掉；打包含注释的文件后务必用 openpyxl 读回验证。

## 编辑 — XML 直改路径（先读 `references/edit.md`）

**编辑完整性铁律：**
1. **绝不为编辑任务新建 `Workbook()`**。永远加载原始文件。
2. 产出必须包含与输入**相同的工作表**（同名同数据）。
3. 只改任务要求的单元格——其他一切必须原样保留。
4. **保存后必须验证**：用 `xlsx_reader.py` 或 pandas 打开产出，确认原工作表名和抽样数据都在。验证失败就是你写错了文件——交付前必须修好。

绝不对存量文件做 openpyxl 往返（会破坏 VBA、数据透视表、迷你图）。正确路径：解包 → 用辅助脚本 → 重打包。

**"填充单元格"/"给已有单元格加公式" = 编辑任务。** 输入文件已存在并要求填充/更新/加公式时，必须走 XML 编辑路径。示例——给 B3 填跨表 SUM 公式：
```powershell
& python.exe scripts\xlsx_unpack.py input.xlsx work_dir\
# 通过 xl/workbook.xml → xl/_rels/workbook.xml.rels 找到目标 sheet 的 XML
# 然后直接编辑 XML，在目标 <c> 元素内加 <f>：
#   <c r="B3"><f>SUM('销售数据'!D2:D13)</f><v></v></c>
& python.exe scripts\xlsx_pack.py work_dir\ output.xlsx
```

**加列**（公式、数字格式、样式自动从相邻列复制）：
```powershell
& python.exe scripts\xlsx_unpack.py input.xlsx work_dir\
& python.exe scripts\xlsx_add_column.py work_dir\ --col G `
    --sheet "Sheet1" --header "% of Total" `
    --formula '=F{row}/$F$10' --formula-rows 2:9 `
    --total-row 10 --total-formula '=SUM(G2:G9)' --numfmt '0.0%' `
    --border-row 10 --border-style medium
& python.exe scripts\xlsx_pack.py work_dir\ output.xlsx
```
`--border-row` 会给该行**所有**单元格（不止新列）加上边框，合计行需要会计式边框时使用。注意 PowerShell 用反引号 `` ` `` 续行，与 bash 的 `\` 不同。

**插入行**（自动平移现有行、更新 SUM 公式、修复循环引用）：
```powershell
& python.exe scripts\xlsx_unpack.py input.xlsx work_dir\
# 重要：--at 的行号必须通过在 worksheet XML 中搜索标签文本定位，
# 不要用用户口述的行号。用户说"第 5 行(办公租金)"时办公租金可能在第 4 行。
# 先用文本标签定位实际行号。
& python.exe scripts\xlsx_insert_row.py work_dir\ --at 5 `
    --sheet "2025预算" --text A=水电费 `
    --values B=3000 C=3000 D=3500 E=3500 `
    --formula 'F=SUM(B{row}:E{row})' --copy-style-from 4
& python.exe scripts\xlsx_pack.py work_dir\ output.xlsx
```
**行定位规则**：任务说"在第 N 行(标签)之后"时，必须在 worksheet XML 中搜标签文本（`Select-String -Path work_dir\xl\worksheets\sheet*.xml -Pattern "标签"`，或查 sharedStrings.xml），用实际行号 + 1 作为 `--at`。不要单独调 `xlsx_shift_rows.py`——`xlsx_insert_row.py` 内部会调。

**整行边框**（如合计行的会计线）：
辅助脚本跑完后，对目标行**所有**单元格应用边框，不只是新增单元格。在 `xl/styles.xml` 中追加一个带目标样式的 `<border>`，再为该行每个单元格现有的 `<xf>` 克隆一个换 `borderId` 的新 `<xf>` 追加进 `<cellXfs>`，把新样式索引通过 `s` 属性应用到该行每个 `<c>`：
```xml
<!-- 在 xl/styles.xml 的 <borders> 中追加： -->
<border>
  <left/><right/><top style="medium"/><bottom/><diagonal/>
</border>
<!-- 然后在 <cellXfs> 中为每个相关样式追加换用新 borderId 的 xf 克隆 -->
```
**关键规则**：任务说"给第 N 行加边框"时，遍历 A 到最后一列的**所有**单元格，不只是新增的。

**手工 XML 编辑**（辅助脚本覆盖不到的操作）：
```powershell
& python.exe scripts\xlsx_unpack.py input.xlsx work_dir\
# ... 直接编辑 XML ...
& python.exe scripts\xlsx_pack.py work_dir\ output.xlsx
```

## 修复 — 坏公式（先读 `references/fix.md`）

这是编辑任务。解包 → 修坏掉的 `<f>` 节点 → 重打包。保留全部原工作表与数据。

## 校验 — 公式检查（先读 `references/validate.md`）

跑 `formula_check.py` 做静态校验。`libreoffice_recalc.py` 做动态重算——**探测式启用**：脚本自动探测 LibreOffice（含 Windows 安装路径），未安装时降级为仅靠静态校验 + 提示用户在 Excel/WPS 中打开检查，绝不作为硬前置。

## 原子写回纪律（编辑任务的铁律）

**全流程任何失败都不得损坏用户原文件。** `xlsx_unpack.py`/`xlsx_pack.py` 操作的是工作目录与输出文件，不会碰原文件；但交付时遵守：

1. 工作目录放在**与目标文件同一盘符**下（`Join-Path (Split-Path $target) ".xlsx-work-$PID"`）；
2. 重打包先输出到 `$target + ".new"`；
3. `formula_check.py` 验证通过后（校验静态错误）再替换：`Copy-Item $target ($target + ".bak")` 备份 → `Move-Item -Force` 替换；
4. 验证失败则删除 `.new`，原文件分毫未动。

## 财务格式颜色规范

| 单元格角色 | 字体颜色 | 十六进制 |
|-----------|---------|---------|
| 硬编码输入/假设 | 蓝 | `0000FF` |
| 公式/计算结果 | 黑 | `000000` |
| 跨表引用公式 | 绿 | `00B050` |

## 关键规则

1. **公式优先**：每个计算单元格必须是 Excel 公式，不是硬编码数字
2. **创建 → XML 模板**：复制 minimal 模板、直改 XML、`xlsx_pack.py` 打包
3. **编辑 → XML**：绝不 openpyxl 往返。走解包/编辑/重打包脚本
4. **永远产出文件**——第一优先级
5. **交付前校验**：`formula_check.py` 退出码 0 = 安全
6. **中文工作表名**：XML 中带中文的 sheet 名是 UTF-8 明文，搜索定位时 PowerShell 注意文件编码（`Select-String` 默认能处理 UTF-8；如遇到乱码用 `-Encoding utf8`）

## 工具脚本速查

```powershell
& python.exe scripts\xlsx_reader.py input.xlsx                 # 结构发现
& python.exe scripts\formula_check.py file.xlsx --json         # 公式校验
& python.exe scripts\formula_check.py file.xlsx --report       # 标准化校验报告
& python.exe scripts\xlsx_unpack.py in.xlsx work_dir\          # 解包待编辑
& python.exe scripts\xlsx_pack.py work_dir\ out.xlsx           # 编辑后重打包
& python.exe scripts\xlsx_shift_rows.py work_dir\ insert 5 1   # 平移行（一般不直接调）
& python.exe scripts\xlsx_add_column.py work_dir\ --col G ...  # 加列带公式
& python.exe scripts\xlsx_insert_row.py work_dir\ --at 6 ...   # 插行带数据
```
