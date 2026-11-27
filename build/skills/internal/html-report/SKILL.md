---
name: html-report
description: Convert documents, markdown notes, and research data into magazine-grade static HTML reports, or design, scaffold, validate, and build HTML data briefs and market research deliverables from scratch. Use when asked to turn a document into an HTML report, generate visual HTML reports, executive summaries, industry whitepapers, research briefings, or audit documents following strict editorial design standards, zero-card open layout, handcrafted inline SVG charts, and 100% self-contained single-file HTML specifications (文档转HTML、网页报告、单页图文报告).
---

# HTML Report: 杂志级静态 HTML 可视化报告工作流规范

本技能将杂志级静态 HTML 可视化报告的完整 SOP、视觉克制规范与工程脚手架沉淀为标准指南。设计哲学核心在于：**“死守出版级排版、色彩克制与工程硬底线，赋予 Agent 充足的题材适应性与编排自由度”**。报告不是死板的八股文或固定模板填空，而应根据题材（技术架构、学术综述、商业财务、宏观产业、消费品牌、文娱趋势）灵活组合版面节奏与编辑级手绘图解。

---

## 第 0 步（永远先做）：运行时接线

本 skill 的脚本链走 Python 自举，不假设用户机器装了 Python；核心脚本只用标准库（无需安装第三方包）：

```powershell
node "$env:MULTICHAT_RUNTIME_DIR/shared/ensure-python.mjs"
```

stdout 输出一行 JSON：`{"ok":true,"pythonExe":"C:\\...\\python.exe","reused":bool,...}`。**取出 `pythonExe` 的绝对路径**，后续所有 `python xxx` 调用都换成这个绝对路径（例如 `& "C:\...\python.exe" <skill目录>\scripts\scaffold.py ...`），shell PATH 不会被持久修改。脚本幂等：第二次执行秒回。若输出 `ok:false`，按其中 `hint` 字段引导用户手动安装 Python，**不要静默重试**。

`node` 由宿主保证在 PATH 中。**脚本路径必须解析为绝对路径**：内核会把本 SKILL.md 的绝对路径注入提示词，取其所在目录即为 skill 目录，`scripts/` 在其下；`build_report.py` 会从同目录导入 `inline_assets`/`validate_report`，直接以绝对路径调用即可，不需要 cd。

**视觉审计（`--visual-audit`）依赖 Playwright，属可选增强**：未安装时脚本自动跳过并明确提示，不影响静态校验链路。不要为启用它去全局安装 Playwright（其浏览器下载数百 MB，不值得）；如需渲染级审计，先向用户说明成本并征得同意。

---

## 一、 不可突破的设计与工程硬底线 (Hard Constraints)

无论何种题材、风格或篇幅，以下 6 项物理底线必须 100% 遵守，这是保障交付物呈现“顶级期刊/权威智库”精致质感而非“粗糙 PPT/SaaS 仪表盘”的根本防线：

1. **纯静态与单文件自包含 (Static & Zero-Dependency Portability)**：
   - 严禁 `<script>`、内联事件（`onclick=` 等）、`javascript:` 伪协议及交互表单标签（`<iframe|form|input|button>`）。
   - 除 Google Fonts 外，严禁引用任何外部 CSS、JS 或外部远程图片；所有位图必须内联为 Base64 Data URI。单个 `.html` 文件即可离线分享、直接双击打开。
2. **全域零卡片纪律与受控流体网格 (0 Cards Across HTML & SVG)**：
   - HTML 正文严禁卡片盒子堆砌（`background + border/border-radius + padding` 嵌套），**同样禁止在 SVG 图解内部堆砌四边全封闭彩色描边盒子（Visio/PPT 流程图感）**。
   - 页面必须包裹在居中的受控容器内（`max-width: 1360px–1440px; margin: 0 auto;`），采用 12 列开放式流体网格，依靠留白节距、发丝线（`var(--hair)`）、语义上边线与槽位对齐组织层级。正文行宽严格约束在 `max-width: 68–72ch`。
   - 避免边框叠加冗余：同一视觉边界只用一根线（严禁外容器与子项同时画 `border-top` 形成双横线，也不要在所有 `h2` 上硬塞粗黑线）。
3. **色彩克制与表面层级纪律 (Color Restraint & Surface Hierarchy)**：
   - 遵循 **85% 中性面与文字 + 10% 主强调色 + 5% 语义辅色** 的克制配比。亮色画布应具备至少两阶浅底过渡（`--paper` 微着色纸底 + `--band` 同色系浅一阶过渡带），避免纯白 `#FFFFFF` 与纯黑块生硬碰撞。
   - **严禁突兀重色**：在亮色长文报告（深度研究/学术/商业财务）中，禁止在 SVG 内部用大面积实心深黑块（如 `#0F172A`）强行高亮重点；重点应通过“浅色着底 + 左侧/顶部粗定位条”或同色系主色轮廓表达。全宽通栏默认使用同色系轻着色带（`.pull-band`）；深黑通栏（`.band-dark`）仅限 `Expressive` 强表现力题材或用户明确要求时使用（全篇上限 1 处）。
   - **数据图表单色编码**：同类数据序列必须使用单一主色（可用浅色延伸段表达区间/估算上限），仅对关键异动项/新范式项赋予语义辅色，严禁“一根柱子一个颜色”。
4. **字号、对比度与中文排版性格 (Readability, Contrast & CJK Craft)**：
   - 全局文本、表格、图注与 SVG 内部文本字号严格 `>= 11px`（正文推荐 `15–16px`）。
   - 主画布上的全部文本对比度严格满足 `>= 7:1`（WCAG AAA 级），过渡带上的文本对比度 `>= 6.5:1`。
   - **中文排版必须有字形性格区分**：不要依赖不含中文字符的纯拉丁字体撑标题层级；中文报告应按题材配置显式的中文字体映射（详见 `references/tone-routing.md`）。
   - 主副标题应用 `text-wrap: balance;`；表格数值列应用 `.num`、短文本主键列应用 `.lead`（`white-space: nowrap`），严禁 2–4 字类别词被劈成两行。
5. **带观点的章节标题与语义导引 (Opinionated Headings & Meaningful Kickers)**：
   - 所有 `<h2>` 必须写成传递完整结论判断的陈述句，**严禁模板化空标题**（如“引言”“概述”“方法论”“总结”等），**严禁在 `<h2>` 内部写机械编号前缀**（如 `01 ·`、`第一章`）。
   - 严禁无信息量的伪刊头与装饰性英文标签（如 `PAGE 01`、`DATA BRIEF`）；但**允许且鼓励使用有真实语义信息的轻量中文定位眉题（`.kicker` / `.sec-kicker`）与图表读图导语（`.fig-sub`）**来帮助读者建立阅读预期。
6. **编辑级 SVG 比例尺与三层图注 (Editorial SVG Scale & Anatomy)**：
   - 全宽内联 SVG 推荐 `viewBox="0 0 860-960 <height>"`（`width="100%"`），避免因 `viewBox` 过窄（如 `< 760`）在桌面宽屏被放大 1.6× 以上导致字号笨重、线条粗钝。
   - 所有图形与标签必须完整落在 `viewBox` 内，无裁切、无重叠、无折线压字，柱条与标签间距 `>= 8px`，严禁使用 `//` 分隔符。
   - 每个 `<figure>` 采用三层结构：顶部结论句主标题（`.fig-title`）+ 顶部读图副标题（`.fig-sub`，说明坐标轴/视角）+ SVG 图形 + 底部轻量化数据来源注（`<figcaption>`，不加冗余顶线）。

---

## 二、 题材驱动的高自由度排版与图解工具箱 (Flexible Kit)

深度报告绝不是千篇一律地塞入“系统架构拓扑图”或“代码块”。**排版组件与手绘图解是按需取用的弹药库，绝非每篇必填的完形填空。**

### 1. 五大题材视觉图解匹配指南 (选配 1–3 个结构化/定量资产)
详细图谱与编辑级 SVG 绘图语法参考 `references/diagram-routing.md`：

* **技术 / 系统 / 学术综述类**：绘制 **无描边分层色带架构图、演进轨迹路径图、时序流图**；仅在确有协议/数学指标时配套 `.schema-spec` 参数/公式块。
* **财务 / 投资 / 商业类**：绘制 **单色系横向排名/区间套柱图、杜邦 ROE 分解树、资金流向桑基图、毛利桥梁瀑布图**；配套开放式三线财务报表，绝不硬塞代码块。
* **宏观 / 产业 / 供应链类**：绘制 **产业链价值传导图、供需周期时钟图、价值链利润池拆解**；配套多列宏观变量对比条带与 `.kpi-row`。
* **消费 / 生活 / 品牌类**：绘制 **品牌认知 2x2 象限矩阵、消费者决策漏斗图、价格带分布图**；配套大引语特写（`.pull-quote`）与暖纸色底。
* **文娱 / 传媒 / 游戏类**：绘制 **IP 宇宙衍生网络谱系、工业化制作管线时序图**；可适度提高留白与海报级对比张力。

### 2. 核心排版组件自由选配

| 组件类名 | 功能与适用场景 | 是否必须 |
| :--- | :--- | :--- |
| **`.hero` + `.emphasis-block` + `.meta-strip`** | 首屏结论先行，配合单一核心量化大数字与范围元信息条。 | **推荐标配**（任何研报都需要 30 秒首屏断言）。 |
| **`.verdict-strip`** | 首屏下方的 3 栏核心判断条带（单根分隔线，无冗余双线）。 | **可选**（短报告或首屏已足够紧凑时可省略）。 |
| **`.sec-split-head` + `.sec-split-body`** | 4:8 左右分栏章节，左放论点与导语，右展推演。 | **推荐**（与全宽图表/表格交替，打破版式疲劳）。 |
| **`.kpi-row`** | 3–4 列开放式横向关键指标条带（上下发丝线，零卡片）。 | **可选**（汇总 3–4 个关键实证数字时极清爽）。 |
| **`.pillar` / `.pillar-accent` / `.pillar-alert`** | 开放式多列语义条带（顶部 1px 灰线 / 2px 主色线 / 2px 警示辅色线）。 | **推荐**（多学派、多维度边界、演进步骤展示）。 |
| **`.pull-band`（默认）/ `.band-dark`（限 Expressive）** | 全宽通栏高潮带，上限 1 处。亮色深研/商业默认用 `.pull-band` 同色系浅底；`.band-dark` 仅限强表现力题材。 | **可选（上限 1 处）**。 |
| **三线表 `table`（配 `.lead` & `.num`）** | 顶底 2px、表头 1px 的出版级开放表；支持同类项 `rowspan` 合并去重。 | **推荐**（横向速查对比，注意与正文互补不重复）。 |
| **`.schema-spec`** | 左发丝线代码/配置/数学公式块。 | **仅限技术规约或量化公式题材**；商业/生活题材严禁强塞。 |
| **`ul.clean-list` / `ol.clean-list`** | 破折号或等宽计数器序号的无卡片优雅列表。 | **推荐**（替代粗糙的原生圆点列表）。 |
| **`.sources-list`** | 文末 `column-count: 2` 双栏流式参考来源列表。 | **推荐标配**（保障客观性与事实可溯源）。 |

---

## 三、 三阶段生成 SOP

### 阶段一：意图、深度与调性定调
1. **提取核心断言**：明确全篇 30 秒心智模型与单一核心量化大数字，将过长的源文档文件名改写为精炼有力的杂志主标题（配合 `.kicker` 交代报告范围）。
2. **按题材选择预设与调性**（详见 `references/tone-routing.md`）：
   - **深度研究 / 学术 / 工程系统**：`--preset deep-research`（冷纸灰双阶底 + 深青绿主色 + 锈橙警示辅色，`Noto Serif SC` 标题 + `Noto Sans SC` 正文 + `JetBrains Mono`）；
   - **商业 / 财务 / 行业策略**：`--preset business-finance`（净灰白双阶底 + 经典深蓝主色 + 琥珀锈辅色，`Inter` + `Noto Sans SC` + `IBM Plex Mono`）；
   - **消费 / 生活 / 品牌人文**：`--preset consumer-editorial`（暖米白双阶纸底 +  slate 靛蓝主色 + 陶红辅色，`Instrument Serif` + `Noto Serif SC` + `Noto Sans SC`）。
3. **正表互补剪裁**：规划“正文讲因果与洞察，表格做结构化速查，图表呈空间/数量关系”，**严禁正文大段罗列完案例后，表格又把同口径描述完整重复一遍**。

### 阶段二：叙事大纲与编辑级视觉规划
1. **拟定陈述句章节标题**：所有 `<h2>` 直陈观点，辅以轻量 `.sec-kicker` 交代模块语境（如“理论边界与学派谱系”）。
2. **规划编辑级 SVG 图解**：确保 `viewBox` 宽度在 `860–960` 之间，采用“无描边浅色带 + 定位条”或“单色系数据柱 + 区间延伸段”，杜绝黑砖块与彩虹柱。
3. **节奏交替**：在左右分栏、多列 `.pillar`、`.kpi-row`、全宽图解、三线表与 `.pull-band` 之间交替推进，相邻两节绝不使用同一版式。

### 阶段三：HTML 构建、静态校验与视觉审计
1. **脚手架生成**：调用 Skill 目录下的 `scripts/scaffold.py` 快速初始化。
2. **填充内容与手绘 SVG**：替换占位符，严守正表互补与坐标留白。
3. **构建与双重自检**：运行 `scripts/build_report.py <report.html> --visual-audit`（若环境支持 Playwright，将自动完成静态规范校验 + WCAG 对比度核算 + SVG 碰撞/缩放/断行渲染审计）。

---

## 四、 配套工具脚本使用说明

脚本位于本 Skill 目录的 `scripts/` 下。以下示例中的 `python` 一律替换为第 0 步取得的 `pythonExe` 绝对路径，`scripts/` 前缀一律替换为 skill 目录的绝对路径前缀（如 `C:\...\skills\html-report\scripts\scaffold.py`）：

### 1. 题材驱动的脚手架生成 (Scaffold)
```bash
# 场景 1：深度研究 / 学术综述 / 工程系统
python scripts/scaffold.py --preset deep-research --title "报告核心主标题" --deck "调研导语" --output report.html

# 场景 2：商业金融 / 行业市场与财报分析
python scripts/scaffold.py --preset business-finance --title "报告核心主标题" --deck "调研导语" --output report.html

# 场景 3：消费生活 / 品牌与生活方式
python scripts/scaffold.py --preset consumer-editorial --title "报告核心主标题" --deck "调研导语" --output report.html
```

### 2. 本地资产 Base64 内联封装 (Inline Assets)
```bash
python scripts/inline_assets.py <input.html> [output.html]
```

### 3. 静态规范、对比度与重色校验 (Validate Report)
```bash
python scripts/validate_report.py <report.html>
```

### 4. 一键构建与可选视觉审计流水线 (Build Report)
```bash
# 仅静态内联 + 规范校验
python scripts/build_report.py <input.html> [output.html]

# 开启 Playwright 渲染级视觉审计（检测 SVG 裁切/重叠、缩放字号、表格短列断行，可选输出截图）
python scripts/build_report.py <input.html> [output.html] --visual-audit
```
