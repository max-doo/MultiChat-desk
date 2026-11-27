> Created: 2026-11-27 17:35 (UTC+8)

# ORIGIN — docx skill 出处与改编记录

## 上游来源

| 内容 | 上游仓库 | 固定 commit | 许可证 |
|---|---|---|---|
| 主干骨架（SKILL.md 框架、scripts/ 全部 Python、schemas、templates） | anthropics/skills `skills/docx` | e4bb5d960d87126ff3b3a8af1a104b7db67560ba | Apache-2.0（LICENSE.txt） |
| references/ 下五个文本知识资产 | MiniMax-AI/skills `skills/minimax-docx` | 02853d885acb1abc157477ce00c4d98a8ed14a71 | MIT（LICENSE-minimax.txt，"Copyright (c) 2026 MiniMaxAI"） |

## 复制的文件清单

**anthropics（原样复制，未改动）：**
- `LICENSE.txt`
- `scripts/__init__.py`、`accept_changes.py`、`comment.py`、`merge_runs.py`
- `scripts/office/` 全部：soffice.py、validate.py、helpers/、schemas/（ECMA-376 XSD 全集）、validators/
- `scripts/templates/`（批注 XML 模板）

**anthropics（改写）：**
- `SKILL.md`：中文场景适配、pandoc→markitdown、bash→PowerShell/python 流程、python bootstrap 接线、原子写回纪律、场景边界、description 双语重写
- `scripts/merge_runs.py`、`scripts/comment.py`、`scripts/office/validate.py`：各加 2 行 `sys.path.insert`——embeddable Python 的 `._pth` 存在时解释器跳过脚本目录注入 sys.path，`from office.helpers import`/`from helpers import` 在原版 CPython 下靠隐式行为工作、在宿主 embeddable 环境下直接 ModuleNotFoundError。上游 bug 的宿主暴露，非逻辑改动。

**MiniMax（移植文本资产，.NET 依赖已剥离改写）：**
- `references/cjk_typography.md`：C# 示例改写为等价 OOXML XML 片段 + docx-js 写法
- `references/scenario_c_apply_template.md`：CLI 工作流改写为手工 XML + validate.py 链路；business-rules.xsd 未移植，改为核查清单
- `references/troubleshooting.md`：`$CLI` 命令与 C# 修复示例改写为 PowerShell 检查 + python/lxml 修复
- `references/openxml_element_order.md`、`openxml_units.md`：原文无 .NET 依赖，原样复制

**新增（本仓编写）：**
- `scripts/ensure-python.mjs`：embeddable Python 幂等 bootstrap（Node 编写，JSON 输出）
- `scripts/unpack.py` / `scripts/pack.py`：安全解包与原子重打包写回
- `scripts/office/soffice_probe.py`：Windows 探测式 LibreOffice 调用（上游 soffice.py 面向 Unix，保留未删）

## 改编决策清单

1. **不引入 .NET**：MiniMax 的 Samples/*.cs、MiniMaxAIDocx.* 项目、setup.ps1/sh、env_check.sh 一律未拷贝。套模板方法论剥离运行时绑定后按手工 XML 处理。
2. **读取路径 pandoc → markitdown**：pandoc 不在宿主运行时供给清单内；markitdown 随 python bootstrap 安装。
3. **不用 zip/unzip 命令行**：解包走 python zipfile + zip-slip 防护（unpack.py），重打包走 rezip 原子写入（pack.py）。
4. **LibreOffice/poppler 探测式可选**：未安装时降级为"提示用户在 Word/WPS 中人工检查"，绝不硬前置；上游 soffice.py 的 LD_PRELOAD shim 是 Unix 专用，Windows 走 soffice_probe.py。
5. **场景边界**：主场景=从零创建中文文档/表单占位符填充/简单模板重排；降级弱项=多模板合并、逐节页眉页脚等结构性套版（依 scenario_c 知识直接操作 XML 尽力处理，向用户明说）。
6. **python 绝对路径调用**：shell PATH 不可持久修改，SKILL.md 要求从 ensure-python.mjs 的 JSON 输出取 `pythonExe` 后全程绝对路径调用。
7. **track changes 知识不重复移植**：MiniMax 版与 anthropics 版重叠度高，以 anthropics SKILL.md 正文为准。
8. **markitdown 必须带 `[docx]` extra**：裸 `pip install markitdown` 不含 mammoth，读 docx 直接 MissingDependencyException；bootstrap 脚本对 extras 做关键模块探测（markitdown[docx]→mammoth），避免"装了但读不了"。
9. **sitecustomize UTF-8 修正**：中文 Windows console 默认 GBK，脚本打印 ✓/制表符即 UnicodeEncodeError 崩溃；bootstrap 在解释器目录写 `sitecustomize.py` 强制 stdout/stderr UTF-8（Agent shell 捕获管道输出，方向正确）。

## 依赖及版本

**npm（node 由宿主随包保证在 PATH 中）：**
- `docx`（docx-js）：宿主预装或脚本内惰性安装到 `$MULTICHAT_AGENT_DIR/node-libs`（验证使用 docx@9.x）

**pip（随 ensure-python.mjs bootstrap 安装，embeddable Python 3.13.9 默认）：**
- `defusedxml`（merge_runs.py / comment.py / validate.py / accept_changes.py 必需）
- `lxml`（validate.py XSD 校验必需；手工 XML 编辑推荐）
- `markitdown[docx]`（读取现有 docx；[docx] 扩展拉入 mammoth，裸 markitdown 无法读 docx——bootstrap 脚本对 extras 有专门的模块探测）

**可选增强（探测式启用，未装走降级）：**
- LibreOffice（soffice）：渲染验证、.doc 转换、accept_changes.py 依赖
- poppler（pdftoppm）：PDF 转图片逐页视觉检查
