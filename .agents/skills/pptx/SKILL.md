---
name: pptx
description: "当任务以任何方式涉及 .pptx 或 .potx 文件时——无论是输入、输出还是两者兼有——使用本技能。包括：从零创建幻灯片/演示文稿/路演材料（PPT、deck、slides、presentation）；读取、解析或抽取 .pptx/.potx 文本（即使内容后续用于邮件或摘要）；编辑、修改、更新现有演示文稿；合并或拆分幻灯片文件；处理模板（.potx）、版式、演讲者备注或批注。只要用户提到“PPT”“幻灯片”“演示”“deck”“slides”或出现 .pptx/.potx 文件名，无论后续要拿内容做什么，都应触发。Use this skill whenever a .pptx or .potx file needs to be opened, created, edited, read, or analyzed — slide decks, presentations, templates, speaker notes."
license: Complete terms in LICENSE.txt
---

# PPTX 创建、编辑与分析

`.pptx` 是一个 XML 文件的 ZIP 包。按任务选择路径：

| 任务 | 路径 |
|---|---|
| **从零创建**演示 | 编写 `pptxgenjs` 脚本——先读下文雷区——并按[结构化演示](#结构化演示)构建，除非用户明确要一次性草稿 |
| **编辑**现有文件，或基于模板改造 | 解包 → 编辑 `ppt/slides/slideN.xml` → 重打包（必须原子写回，见[编辑现有演示](#编辑现有演示与模板)） |
| **读取**内容 | `<python> scripts/slide_text.py deck.pptx`（每页一块文本，标有 `<!-- Slide number: N -->`）；模板版式网格：`<python> scripts/thumbnail.py deck.pptx` |

## 运行环境接线（先读这一节，再动手）

本技能运行于 MultiChat 内嵌 Agent：**shell 是 Windows PowerShell**；`node` 命令可用（复用 Electron 本体），**但没有 npm/npx**——npm 依赖在打包期预装进本技能目录的 `node_modules`，运行时直接命中。**Python 不预装**，需要时按需引导。所有脚本路径相对于本技能目录。

**Python 接线（幂等，每次会话只做一次）：**

```powershell
node "$env:MULTICHAT_RUNTIME_DIR/shared/ensure-python.mjs" --packages "python-pptx defusedxml lxml Pillow pypdfium2"
```

stdout 输出一行 JSON：`{"ok":true,"pythonExe":"<绝对路径>","reused":bool,"source":"managed|system-venv|bootstrapped",...}`。**后续所有 Python 脚本都必须用这个 `pythonExe` 绝对路径显式调用**（下文用 `<python>` 指代），不要写 `python` 或 `python3`。`ok:false` 时 JSON 中的 `hint` 字段是给用户的手动安装指引，原样转达，不要静默重试。

**LibreOffice / 渲染链路（探测式可选增强，不是前置条件）：**

```powershell
<python> scripts/office/soffice.py --check
```

输出 JSON：`{"available": bool, "binary": ..., "hint": ...}`。**仅当 `available` 为 true 时**才启用 soffice 渲染验证与缩略图网格；否则降级为：完成文件级校验后提示用户在 PowerPoint/WPS 中打开检查排版，并向用户说明原因与安装方式。**绝不**把 LibreOffice 当作硬前置——多数用户机器上没有它。PDF 转图片同理：`pdf2images.py` 优先走 `pypdfium2`（pip 包，随上面命令安装），其次探测 `pdftoppm`（poppler）；都没有时同样降级为提示人工检查。

**node 依赖（pptxgenjs）：** 依赖应已随包预装在本技能目录的 `node_modules` 中。在你的生成脚本里用 createRequire 指向技能目录加载，保证无论脚本放在哪个工作目录都能命中：

```javascript
const { createRequire } = require("module");
const skillRequire = createRequire("<本技能目录的绝对路径>/");
const pptxgen = skillRequire("pptxgenjs");
const { applyTheme } = skillRequire("./scripts/apply_theme.js");
```

也可以设 `NODE_PATH=<本技能目录>/node_modules` 后正常 `require('pptxgenjs')`（`apply_theme.js` 内部加载 jszip 也走同一解析链）。**不要尝试 `npm install`**——运行时没有 npm；require 失败属于打包缺陷，把事实报告给用户，不要静默重装。

## 脚本一览

| 脚本 | 作用 |
|---|---|
| `scripts/slide_text.py deck.pptx` | 每页幻灯片的标题、文本、表格、图表数据（散点/气泡图仅系列名）、图片替代文本与演讲者备注，输出 markdown。也能读 `.potx` |
| `scripts/thumbnail.py deck.pptx [prefix]` | 全部幻灯片的标注缩略图网格，用于挑选模板版式。仅 `.pptx`。**务必传第二参数 `prefix`**——默认 `thumbnails` 会覆盖同目录其他演示的网格。依赖渲染链路，不可用时优雅报错 |
| `scripts/add_slide.py unpacked/ slide2.xml [--after slideN.xml]` | 复制一张幻灯片（或 `slideLayoutN.xml`）并完成全部包内登记。也可直接 `-o out.pptx` 作用于文件 |
| `scripts/clean.py unpacked/` | 删除不再被引用的幻灯片、媒体与关系。**在 `<p:sldIdLst>` 定稿之后**运行 |
| `scripts/apply_theme.js` | Node 模块：`const { applyTheme } = require("<技能目录>/scripts/apply_theme.js")`；`pres.writeFile()` 之后 `await applyTheme("deck.pptx", THEME)` 写入主题色、主题名与东亚字体槽位。也可 CLI：`node scripts/apply_theme.js deck.pptx theme.json` |
| `scripts/pdf2images.py input.pdf outdir [--dpi 150]` | PDF 分页渲染为 JPEG（pypdfium2 优先，pdftoppm 兜底） |
| `scripts/office/validate.py deck.pptx [--original src.pptx]` | Schema、关系、内容类型、图表与幻灯片检查；每条失败都附修复方法。模板派生的文件**必须传 `--original`**——以模板为基线，模板自身的 XSD 错误不会算到你头上 |
| `scripts/office/soffice.py` | LibreOffice 包装器：`--check` 探测；其余参数原样转发。Windows 下解析 PATH/常见安装位置/`SOFFICE_PATH` 环境变量 |

## pptxgenjs 创建雷区

模型已熟悉 API，以下是真实会咬人的坑：

- **先设 `pres.layout` 再加幻灯片。** 默认画布是 `LAYOUT_16x9` = **10" × 5.625"**，不是 13.3" 宽。越界坐标会被原样写入而不裁剪——形状直接不在幻灯片上。（`LAYOUT_WIDE` 是 13.3" × 7.5"。）
- **十六进制颜色：不要 `#`，不要 8 位。** `color: "FF0000"`。`"#FF0000"` 或带 alpha 的 8 位 hex（`"00000020"`）会**损坏文件**。透明度：填充和图片用 `transparency: 0-100`，阴影用 `opacity: 0.0-1.0`——混用会被静默忽略。
- **pptxgenjs 原地修改选项对象**（首次使用时把值转 EMU）。永远不要在两个 `add*` 调用间共享同一个 `shadow`/选项对象——每次新建。
- **阴影 `offset` 必须 ≥ 0**——负值损坏文件。要向上的阴影，用 `angle: 270` 加正 offset。
- **`letterSpacing` 被静默忽略**——真正的选项是 `charSpacing`。
- **列表：** 每项用 `bullet: true`，绝不写字面 `•`（会渲染成双重圆点）。数组每项（最后一项除外）都要 `breakLine: true`。项目间距用 `paraSpaceAfter`，不用 `lineSpacing`（间距巨大）。
- **一个输出文件一个 `new pptxgen()`**——绝不复用实例。
- **`rectRadius` 只对 `ROUNDED_RECTANGLE` 生效**，`RECTANGLE` 上无效。
- **不支持渐变填充**——改用渐变图片做背景。
- **每个不带 `placeholder` 的 `addText` 都需要 `isTextBox: true`**——否则形状缺 `txBox="1"`，屏幕阅读器会把文本当成"图形"朗读。视觉无变化。
- **文本框有内置内边距**——文本要与形状、线条、图标对齐时设 `margin: 0`。
- **演讲者备注写在 `slide.addNotes("...")`**（纯文本，每页一次），绝不写在幻灯片文本框里。
- **图表保持原生。** PowerPoint 能画的都用 `addChart()`（组合图传 `[{type, data, options}]` 数组）。库未暴露的原生特性（趋势线、误差线）自己算序列或后处理 OOXML——不要退化成贴图。只有 PowerPoint 没有原生形态的图（桑基图、网络图、弦图）才用图片。
- **默认图表很裸**——无标题、无数值标签、配色陈旧。设 `showTitle`+`title`、`showValue: true`+`dataLabelPosition`、按调色板给 `chartColors: [...]`，并压低框架存在感（`catAxisLabelColor`/`valAxisLabelColor`、`valGridLine: { color, size }`、`catGridLine: { style: "none" }`、单系列 `showLegend: false`）。
- **堆积柱/条形图上 `dataLabelPosition` 必须是 `ctr`、`inEnd` 或 `inBase`。** `outEnd` **会损坏文件**。
- **使用 `secondaryValAxis`/`secondaryCatAxis` 的组合图，图表选项里必须同时有 `valAxes` 和 `catAxes`，且各两个条目。** 否则 pptxgenjs 写出未声明的轴 id，PowerPoint **丢弃整张图**并报文件损坏。只给 `valAxes` 不够。
- **`writeFile()` 之后跑 `<python> scripts/office/validate.py deck.pptx`。** 它能报出许多 PowerPoint 拒绝或修复的图表和幻灯片 XML 故障（包括上面两条），并指明修复方法。在生成器里修，不要手改打包后的 XML。
- **永远不要重排 `<p:presentation>` 的子元素。** pptxgenjs 把 `<p:notesMasterIdLst>` 写在 `<p:sldIdLst>` 之后，两个母版指向同一主题部件。PowerPoint 读得好好的——挪动它，同一个文件就打不开了。
- **图标（Iconify + SVG 静态嵌入）：** 图标用 Lucide 命名（如 `lucide:settings`、`lucide:rocket`，2000+ 枚，列表见 lucide.dev），从 `@iconify-json/lucide` 的图标数据生成 SVG 字符串，base64 后传给 `addImage`——pptxgenjs 会在文件内嵌入 SVG 实体（`svgBlip`），PowerPoint 2016+ 原生矢量渲染，放大不糊：

  ```javascript
  const lucide = skillRequire("@iconify-json/lucide/icons.json");
  const { getIconData, iconToSVG, iconToHTML } = skillRequire("@iconify/utils");

  // 注意：包根导出没有嵌套真实图标集，必须引到 icons.json；名字用 lucide:xxx 的 xxx 部分
  const iconData = getIconData(lucide, "settings");
  if (!iconData) throw new Error("lucide 里没有这个图标名"); // 选名失败时换名，不要静默略过
  const renderData = iconToSVG(iconData, { height: 24 });
  // lucide 图标描边是 stroke="currentColor"，替换来着色（衬深色底时用白色 "#FFFFFF"）
  const svgString = iconToHTML(renderData.body, renderData.attributes)
    .split("currentColor").join("#FF5500");
  const svgBase64 = Buffer.from(svgString, "utf8").toString("base64");
  slide.addImage({ data: "image/svg+xml;base64," + svgBase64, x: 0.8, y: 1.2, w: 0.4, h: 0.4 });
  ```

  图标显示尺寸只由 `w`/`h`（英寸）控制，与 SVG 内 width/height 无关；矢量格式任意尺寸都清晰。经典用法是彩色圆形衬底 + 白色图标叠放。**兼容性红线：PowerPoint 2016 之前的老版本与部分 WPS 版本不渲染 SVG**，那个位置会显示空白占位——生成正式商务演示前先确认打开环境，不确定时改用纯色圆形/圆角方块衬底 + 白色关键词或缩写文字（如 `01`、`AI`、`%`）、pptxgenjs 原生形状（`CHEVRON`、`OVAL`、`DIAMOND`、箭头族）组合的示意图形、表格化的数据强调块，这些效果同样专业。**禁用 emoji 充数。** 用户明确提供图标图片文件时，用 `addImage({ data: "image/png;base64," + buf.toString("base64") })` 插入——`image/png;base64,` 前缀必需。
- **`defineSlideMaster()` 创建的是幻灯片*版式*而不是母版**——一次调用一个 `slideLayoutN.xml`，挂在同一个无法更换的母版下。对用户沟通时称"版式"。
- **`pres.company` 和 `defineSlideMaster()` 的 `title` 写入 XML 时不转义**——其中出现 `&`（如 `"Harrow & Sons"`）会让 `docProps/app.xml` 或版式无法解析，`validate.py` 报错。这些位置手写 `&amp;`；`title`、`subject`、`author`、章节名、`objectName`、备注和幻灯片文本会自动转义。

## 中文字体与排版（中文场景必读）

**字体写入 `.pptx` 后由用户的 PowerPoint 渲染，不是本环境。** 视觉 QA 经 LibreOffice 渲染，缺字体会被替换——有些替换字体宽度不同，QA 预览显示的溢出（或刚好放下）在真实文件里可能相反。

**中文字体的关键事实（本技能的实地验证结论）：**

- pptxgenjs 写出的主题 fontScheme 中，`<a:ea>`（东亚字体槽位）为空、Hans 脚本字体写死为**等线 Light**。不设干预时，即使用了 `headFontFace`，中文仍按脚本回退表渲染——等线 Light 比正文偏细，视觉上像"没加粗的字重错误"。
- 解法：`applyTheme` 的主题对象里传 **`eastAsiaFontFace`**（本技能扩展字段）。它会写入 `<a:ea>` 并同步 Hans/Hant 脚本回退。中文演示的主题字体建议直接写完整：
  ```javascript
  const THEME = {
    name: "...",
    headFontFace: "Microsoft YaHei",   // 微软雅黑，Win 系统字体，中文环境最稳
    bodyFontFace: "Microsoft YaHei",
    eastAsiaFontFace: "Microsoft YaHei",
    colors: { ... },
  };
  ```
- 运行级 `fontFace`（pptxgenjs 会同时写 latin+ea+cs 三个槽位）优先级高于主题。中英混排且想区分中西文字体时（如中文雅黑+西文 Arial），对每个 `addText` 显式给 `fontFace`——中文场景统一雅黑最省心。
- **中文字体候选：** 微软雅黑（Microsoft YaHei，系统字体，首选）；等线（DengXian，Office 2016+，更现代但老机器缺）；思源黑体/Noto Sans CJK（开源，用户不一定装）；宋体/黑体（SimSun/SimHei，老式公文感）。**正文不要选楷体等书法字体**。
- 图表文本硬编码 Arial：给图表的 `*FontFace` 选项传 `"+mn-lt"`（跟随主题正文字体；`"+mj-lt"` 是标题字体），中西文保持一致。

**中文排版密度经验：** 中文是方块字，信息密度天然高于英文，同样字号下每行可容纳更多内容，但**不要因此塞满**——中文演示最常见的失败就是字太多：

- 正文每页要点 **3-5 条**，每条 **≤ 40 字**（英文对照约一行半）；超出拆页，不要缩字号。
- 标题 32-40pt 加粗（中文标题比英文更需要字重）；正文 14-16pt；注释/来源 10-12pt。**不要低于这个下限**——到了下限就删字、扩容器或拆页。
- 中文行内不需要两端对齐产生的空洞：**全部左对齐**；标题居中仅限封面/章节页。
- 全角标点（，。、；：）占一个汉字宽度，做字数估算时按字计。
- 中西文混排时数字与西文用半角，与中文之间视觉上会自动留出空隙，不要手动加空格对齐。

**设计细节（配色方案、风格配方、字号字距刻度、避坑清单）见 `references/design.md`**——创建任何新演示前读它。其中风格配方（直角紧凑/柔和均衡/圆角舒展/胶囊轻盈）借鉴自 MiniMax 的设计系统。

## 结构化演示

建立在主题、版式、占位符和章节之上的演示，能一处改样式全局生效，在 PowerPoint 里编辑也不会打架。除非用户要一次性草稿，每个新演示都按这个方式构建：

1. **主题先行：** `const THEME = { name, headFontFace, bodyFontFace, eastAsiaFontFace, colors: { dk1, lt1, dk2, lt2, accent1 … accent6, hlink, folHlink } }`，颜色为 hex。`pres.theme` 只接受两个字体。之后不再点名任何字体——标题得标题字体、其余得正文字体——图表文本除外（它硬编码 Arial，用 `"+mn-lt"`/`"+mj-lt"`）。
2. **所有颜色用 `const C = pres.SchemeColor`**——`C.text1`/`C.text2` 是 `dk1`/`dk2`，`C.background1`/`C.background2` 是 `lt1`/`lt2`。但这些位置只收 hex，必须从 `THEME` 读值：`valGridLine.color`、`catGridLine.color`、`shadow.color`，以及单系列柱图的 `invertedColors` 或多于一个的 `chartColors`。在那里写 scheme 色会被原样写成 `<a:srgbClr val="bg2"/>` 且无声无息，而且因为是 hex，之后换主题也不会跟随。
3. **章节：** 在该章首页之前 `pres.addSection({ title })`，之后每个 `addSlide` 带 `sectionTitle`。漏掉的幻灯片——或章节全部提前声明时表格自动分页产生的续页——会落进杂散的 "Default-N" 章节。
4. **一种画面框架一个版式**（`defineSlideMaster()`）：标题页、章节分隔页、仅标题页、图表+点评页、表格页；设计明暗交替就明暗各一套。文本区域是带位置、尺寸、字重和 `color` 的命名占位符——图表、图片、表格占位符也要给 `color`，否则提示文字和文本数组出来是写死的 000000。页脚、logo、`slideNumber` 放版式上，绝不放幻灯片上。
5. **按名填充：** `addSlide({ masterName, sectionTitle })`，然后 `addText("…", { placeholder: "title" })`，不传位置、尺寸、颜色——占位符自己的选项生效，它没设的（斜体、`align`、`fontFace`）仍然应用；单个 run 的样式用 `[{ text, options }]`。拼错的 `placeholder` 或 `masterName` 静默失败（0,0 处多一个文本框；空白版式）。只有 `title`、`body`、`chart` 占位符能只按名填充：`addImage({ placeholder })` 只取占位符的 x/y 不取尺寸（变成 1"×1" 图片）——`w`/`h` 也要传。`addTable({ placeholder })` 只取 x/y——永远传 `w`；自动分页时会忽略占位符并溢出页面，所以还要传 `x`、`y` 和 `autoPageSlideStartY`（与 `y` 相同，否则续页从页面上边距排起），给版式留出避开页脚的底部 `margin`，续页标题通过 `slide.newAutoPagedSlides` 填充。
6. **版式是框架，不是 Design Ideas 说的那种"排版"。** 卡片、图标、数据强调块、图片仍然在版式之上逐页组合，用 scheme 色、每个给 `objectName`——所有 Design Idea 都适用，大部分内容页放在仅标题版式上。
7. **写完再注入主题：** `await pres.writeFile({ fileName: "deck.pptx" })`，然后 `await applyTheme("deck.pptx", THEME)`。pptxgenjs 写不了主题色：这步之前 scheme 色都解析成 Office 默认蓝橙。如果某处把 scheme 色传给了只收 hex 的选项，它会抛错并指出位置——按它说的修完重建。

## 编辑现有演示与模板

**原子写回纪律（铁律）：** 编辑用户现有文件时，整个过程必须保证任何一步失败都不损坏原文件——先在同卷临时目录完成全部操作并验证通过，最后一步才替换原文件。`validate.py` 通过之前，原文件保持不动。`add_slide.py` 直接作用于文件时**必须传 `-o`**，否则原地重写输入文件。

先挑版式：`<python> scripts/thumbnail.py template.pptx template-thumbs` 生成全部幻灯片的标注网格并打印生成的文件名——`template-thumbs.jpg`，超过 12 页拆成 `template-thumbs-N.jpg`。**务必传第二参数，以演示命名。**（仅模板分析用——视觉 QA 需要后文"视觉 QA（探测式增强）"一节的全分辨率渲染；缩略图只接受 `.pptx`，`.potx` 先复制改名。）配合 `slide_text.py` 把每节内容映射到模板幻灯片，版式要有变化——不要把每节都放进同一个标题+要点版式。

```powershell
<python> -c "import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall('unpacked')" deck.pptx
<python> scripts/add_slide.py unpacked/ slide2.xml --after slide2.xml   # 复制幻灯片（或 slideLayoutN.xml）；打印新幻灯片路径
# 重排/删除幻灯片 = 编辑 ppt/presentation.xml 的 <p:sldIdLst>
<python> scripts/clean.py unpacked/                                     # 删除之后：清理孤儿幻灯片、媒体、关系
# 编辑 ppt/slides/slideN.xml 的内容
# 重打包：用 Python 而不要盲目依赖 zip 命令——见下方注意事项
```

重打包与原子写回（PowerShell 环境，先打包到**同目录的临时文件**，验证后再替换）。注意两个坑：validate.py 按扩展名识别 Office 文件，临时文件**必须保留 .pptx 后缀**（用 `deck.new.pptx` 而不是 `deck.pptx.tmp`）；zip 内路径必须为正斜杠相对路径，Windows 的 `os.path.relpath` 产出反斜杠，需要转换：

```powershell
<python> -c "import zipfile,os; z=zipfile.ZipFile('deck.new.pptx','w',zipfile.ZIP_DEFLATED); [z.write(os.path.join(r,f), os.path.relpath(os.path.join(r,f),'unpacked').replace(os.sep,'/')) for r,_,fs in os.walk('unpacked') for f in fs]; z.close()"
<python> scripts/office/validate.py deck.new.pptx --original deck.pptx
# 验证通过后原子替换：Move-Item -Force deck.new.pptx deck.pptx（同卷即原子语义）
```

打包注意事项：**不要**把旧的 `deck.pptx` 或上一个临时文件包含进新包；从解包目录遍历文件时排除输出文件本身。如果用 bash，`cd unpacked && rm -f ../out.pptx && zip -XrDy ../out.pptx .`——从目录内部打包，先 rm 否则被删部件会残留。

- **先做完所有结构性工作——增、删、排——再编辑任何幻灯片内容。** `add_slide.py` 逐字复制幻灯片文件，编辑后再复制会把改过的内容克隆出去；`clean.py` 会删除任何不在 `<p:sldIdLst>` 中的幻灯片，包括你刚写的。
- **绝不手工复制幻灯片文件**——`add_slide.py` 会完成新幻灯片需要的全部登记并报告结果（`Created ppt/slides/slide17.xml from slide2.xml`）。复制出的幻灯片仍然*引用*源幻灯片的图表/SmartArt/嵌入对象部件而非克隆——改一张的图表会影响另一张。
- **如果用 `python-pptx`**，三件它做不到的事：复制幻灯片（唯一入口是 `add_slide(layout)`）、`text_frame.text = "..."` 保格式（会把段落压成单个无样式 run——要赋 `run.text`）、读模板美术常用的 SVG/EMF（`add_picture` 抛 `UnidentifiedImageError`）。
- 旧格式 `.ppt` 必须先转换（需 LibreOffice）：`<python> scripts/office/soffice.py --headless --convert-to pptx file.ppt`。`.potx` 模板解包打包方式相同——输出保留 `.potx` 扩展名。
- 复用模板里的图标或图片：复制已含它的幻灯片或版式。

填充模板时：

- 脚本化 XML 变换用 `defusedxml.minidom` 解析——用 `xml.etree.ElementTree` 往返 OOXML 会重写命名空间前缀并损坏文件。
- **模板槽位 ≠ 源内容条目数。** 模板展示 4 个团队成员而你只有 3 个，删掉第 4 个成员的整组（图片+文本框），不只是删文字——然后在 QA 中检查孤儿视觉元素。
- 每个列表项一个 `<a:p>`——绝不把多项拼进一个段落。复制兄弟 `<a:pPr>` 保留间距，标题、节标题和行内标签（`状态：`、`负责人：`）的 `<a:rPr>` 上加 `b="1"`。
- 项目符号继承版式；只在需要覆盖时加 `<a:buChar>`、`<a:buAutoNum>`（编号）或 `<a:buNone>`——绝不在文本里写字面 `•`。
- 首尾带空格的文本需要在 `<a:t>` 上加 `xml:space="preserve"`。

## 内容与叙事

- **一页一个信息点。** 演示按主题推进、逐点展开。
- **常用结构是金字塔：** 核心信息前置，执行摘要预告各章，然后是各章正文，最后是结论——通常附带来落实发现的下一步行动。
- **结构匹配篇幅。** 短演示可能不需要引言和结论；长演示可能需要章节分隔页。
- **围绕演示的目的构建：** 促成决策、建立共识、庆祝、化解分歧或开启讨论。
- **围绕使用方式构建。** 现场演说有讲解和讨论；预读材料必须自己承载完整叙事。高管在场的现场汇报要少字多图；给领域专家或离线阅读的演示可以更详细。分析报告以图表表格为主。
- **按演讲时长定页数：** 每页约 1.5-2 分钟，有问答要留时间。

## QA（必做）

第一版渲染通常都有真实问题——重叠、溢出、错位。找到并修掉，只重渲改过的页，然后收工。

### 内容 QA（必做）

```powershell
<python> scripts/slide_text.py output.pptx
```

检查漏内容、错别字、顺序错误。**用模板时检查残留占位文本：**

```powershell
<python> scripts/slide_text.py output.pptx | Select-String -Pattern 'xxx|lorem|ipsum|TODO|\[insert|占位'
```

有命中先修再交付。

### 文件 QA（必做）

```powershell
<python> scripts/office/validate.py output.pptx                      # 从零创建
<python> scripts/office/validate.py output.pptx --original src.pptx  # 模板派生
```

**模板派生一定传 `--original`。** 模板自身可能有 XSD 不接受的部件，裸跑会报不是你造成的问题——真正的回归反而藏在其中。`--original` 以模板为基线做 schema 与幻灯片检查，抑制模板已有的错误；结构性检查（关系、内容类型、图表）忽略 `--original` 照常报告，按自身判断处理。

pptxgenjs 会产出 PowerPoint 拒绝打开、其他工具都接受的图表 XML：python-pptx 能开、LibreOffice 能渲、XSD 能过。每条失败都附修复方法，在生成器里修完重建。

**通过不等于文件有效：** `validate.py` 抓不全 PowerPoint 会修复的所有问题（图表元素超上限重复能通过）；从模板幻灯片删除带动画的形状时，连同幻灯片的 `<p:timing>` 元素一起删（动画随之失效），否则 PowerPoint 会提议修复文件。

### 视觉 QA（探测式增强）

先探测：`<python> scripts/office/soffice.py --check`。**available 为 true** 时执行渲染检查；为 false 时跳过本节，转为：告知用户"本机未安装 LibreOffice，自动视觉检查已跳过"，请用户在 PowerPoint/WPS 中打开重点核对——文字是否溢出、版式是否对齐，并向用户提供其 `hint` 中的启用方式。

渲染检查流程：

```powershell
<python> scripts/office/soffice.py --headless --convert-to pdf output.pptx
<python> scripts/pdf2images.py output.pdf . --dpi 150
```

逐张查看生成的 `slide-N.jpg`（`pdf2images.py` 打印全部路径）。盯着生成代码太久会产生预期性盲视，要用新鲜眼光看图。需要找的用户可见缺陷：

- **文字溢出或在文本框/页面边界被截断——最先查。** 最常见且永远用户可见。（预览器渲染不可靠的字体，预览是近似的：相信你留的 ~10% 余量，而不是它看起来刚好放下。）
- 元素重叠（文字穿过形状、线条穿过文字、元素堆叠）
- 引用来源或页脚与上方内容相撞
- 元素过近（< 0.3" 间隙）或卡片/区块几乎相触
- 间隙不均（一处大片空白、一处拥挤）
- 距页面边缘不足（< 0.5"）
- 列或同类元素对齐不一致
- 低对比文字（浅灰字配米色底）
- 模板装饰在文本替换后错位——如标题下划线按一行定位，替换后标题折成两行
- 低对比图标（深色图标配深色底且无反色圆形衬底）
- 文本框过窄导致过度折行
- 同类页面标题高度不一、图表标签样式页间不一致——页间互相对比，不要只看单页
- 一个单词或数字断在两行——词中断词，或数字与单位分离（"26" 一行、"M" 下一行）。中文没有断词问题，但**数字与单位、百分比符号、中西文混排处的折行**同样要查
- 残留占位内容

修复后重跑全部渲染命令——PDF 必须从改过的 `.pptx` 重新生成，图片才能反映修改。

## 依赖

`pptxgenjs`、`@iconify/utils`、`@iconify-json/lucide`（随包预装于技能目录 `node_modules`，打包期依 `package.json` 安装）· `python-pptx`、`Pillow`、`defusedxml`、`lxml`、`pypdfium2`（pip，经宿主 `ensure-python.mjs` 引导安装）· LibreOffice（`soffice`，探测式可选增强——PowerShell 中用 `Get-Command soffice` 探测，注意 `where` 是 Where-Object 别名、探测外部命令要写 `where.exe`）· `pdftoppm`（poppler，探测式可选，pypdfium2 的兜底）
