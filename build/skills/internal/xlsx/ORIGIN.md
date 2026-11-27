> Created: 2026-11-27 17:40 (UTC+8)

# ORIGIN — xlsx skill 出处与改编记录

## 上游来源

| 内容 | 上游仓库 | 固定 commit | 许可证 |
|---|---|---|---|
| 全部骨架与脚本、references、templates | MiniMax-AI/skills `skills/minimax-xlsx` | 02853d885acb1abc157477ce00c4d98a8ed14a71 | MIT（LICENSE.txt，复制自仓库根 LICENSE，"Copyright (c) 2026 MiniMax"） |

注：上游 minimax-xlsx 目录内无独立 LICENSE 文件，按整仓 MIT 惯例复制仓库根 LICENSE 入包并注明出处。anthropics/skills 的 xlsx 未采用（定稿：MiniMax 版为唯一主干，anthropics 版无需吸收任何组件）。

## 复制的文件清单

**原样复制（未改动）：**
- `references/`：`create.md`、`edit.md`、`fix.md`、`format.md`、`ooxml-cheatsheet.md`、`read-analyze.md`、`validate.md`
- `scripts/`：`xlsx_reader.py`、`xlsx_unpack.py`、`xlsx_pack.py`、`xlsx_shift_rows.py`、`xlsx_insert_row.py`、`xlsx_add_column.py`、`shared_strings_builder.py`、`style_audit.py`、`formula_check.py`
- `templates/minimal_xlsx/`（从零创建的 XML 模板）

**小幅修改：**
- `scripts/libreoffice_recalc.py`：`find_soffice()` 增补 Windows 安装路径与 `soffice.exe` PATH 探测（原仅 macOS/Linux）
- `scripts/xlsx_insert_row.py`、`scripts/xlsx_add_column.py`：
  (a) `find_ws_path` 兼容 OPC 绝对部件名 Target（`/xl/worksheets/sheet1.xml`，openpyxl 即此写法——原版直接 join 后在任何平台都解析失败，属上游 bug 宿主暴露）；
  (b) `add_shared_string` 增加 `_ensure_shared_strings` 懒初始化——openpyxl 生成的文件用 inlineStr 不带 sharedStrings.xml 部件，首次写字符串时自动补部件 + [Content_Types] override + workbook relationship
- `scripts/xlsx_shift_rows.py`：公式平移增加**多行区间边界扩张**（`SUM(B2:B4)` 在末尾插入行时扩为 `B2:B5`，单行横向区间如 `B4:E4` 不扩张）——原版平移后合计公式漏算新行，与其自身文档宣称的"updates SUM formulas"不符
- `scripts/formula_check.py`：`get_sheet_files` 兼容绝对部件名 Target（lstrip("/")）——原版对 openpyxl 文件静默报 0 公式 0 sheet，门禁形同虚设

**改写：**
- `SKILL.md`：中文场景适配、python3 引用改为绝对路径调用约定、bash 反斜杠续行改 PowerShell 反引号、python bootstrap 接线、原子写回纪律、description 双语重写、`SKILL_DIR` 占位改为相对 skill 目录调用

**新增（本仓编写）：**
- `scripts/ensure-python.mjs`：与 docx skill 相同的 embeddable Python 幂等 bootstrap（各 skill 自包含一份）

## 改编决策清单

1. **MiniMax 为唯一主干**：XML 直改路径（解包→编辑→重打包 + xlsx_insert_row/xlsx_add_column/xlsx_pack 成套辅助脚本）是存量文件零损失编辑的唯一可靠方案；anthropics 版无任何组件被吸收。
2. **openpyxl/pandas 定位**：从零创建与读取分析可用；存量文件编辑严禁 openpyxl 往返（破坏 VBA、数据透视表、迷你图）。
3. **公式验证双轨**：`formula_check.py` 静态校验为主；`libreoffice_recalc.py` 动态重算为探测式可选增强，未装 LibreOffice 时降级不报错。
4. **python 绝对路径调用**：shell PATH 不可持久修改，全程用 ensure-python.mjs 输出的 `pythonExe` 绝对路径。
5. **中文适配**：中文 sheet 名/标签定位的编码注意事项写入 SKILL.md；关键示例改用中文 sheet 名演示。
6. **模板注释警告**：`templates/minimal_xlsx` 的 XML 注释是编写指导，`<sheets>`/`<sheetData>` 内残留注释会被 lxml/openpyxl 当元素解析导致读取失败——编辑时必须连注释带占位符一起删除（已写入 SKILL.md CREATE 一节）。

## 依赖及版本

**pip（随 ensure-python.mjs bootstrap 安装，embeddable Python 3.13.9 默认）：**
- `openpyxl`（从零创建/读取分析路径）
- `pandas`（批量数据分析）

**无 npm 依赖。**

**可选增强（探测式启用，未装走降级）：**
- LibreOffice（soffice）：`libreoffice_recalc.py` 动态公式重算
