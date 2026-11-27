---
name: pdf
description: "当用户需要对 PDF 文件做任何操作时使用本技能。包括：读取或抽取 PDF 文本/表格、合并多个 PDF、拆分 PDF、旋转页面、添加水印、从零创建 PDF（报告、表单、文档）、填写 PDF 表单、加密/解密、抽取图片、对扫描件做 OCR 使其可搜索。只要用户提到 .pdf 文件、要求产出 PDF，或出现“合并/拆分/提取/转换 PDF”“填表”等需求，无论内容后续作何用途都应触发。Use this skill whenever the user wants to read, extract, merge, split, rotate, watermark, create, form-fill, encrypt, or OCR PDF files."
license: Complete terms in LICENSE.txt
---

# PDF 处理指南

本文覆盖 PDF 处理的核心操作。进阶特性、JavaScript 库与详细示例见 `REFERENCE.md`；**填写 PDF 表单必读 `FORMS.md`** 并严格遵循其中步骤。

## 运行环境接线（先读这一节，再动手）

本技能运行于 MultiChat 内嵌 Agent：**shell 是 Windows PowerShell**；`node` 命令可用（复用 Electron 本体，无 npm/npx）；**Python 不预装**，按需引导。所有脚本路径相对于本技能目录。

```powershell
node "$env:MULTICHAT_RUNTIME_DIR/shared/ensure-python.mjs" --packages "pypdf reportlab pdfplumber pypdfium2 Pillow"
```

stdout 输出一行 JSON：`{"ok":true,"pythonExe":"<绝对路径>","reused":bool,"source":"managed|system-venv|bootstrapped",...}`。**后续所有 Python 脚本都必须用这个 `pythonExe` 绝对路径显式调用**（下文用 `<python>` 指代）。`ok:false` 时 JSON 的 `hint` 字段是给用户的手动安装指引，原样转达，不要静默重试。扫描件 OCR 还需要 `pytesseract pdf2image`（外加系统级 Tesseract——未安装时按降级原则提示用户，不要硬装）。

**命令行工具均为探测式可选增强**：`pdftotext`/`pdfimages`/`pdftoppm`（poppler）、`qpdf`、`pdftk`、ImageMagick 在多数用户机器上**不存在**。用 `Get-Command` 探测到才用（注意 PowerShell 中 `where` 是 Where-Object 别名，探测外部命令必须写 `where.exe` 或用 Get-Command）；探不到就走 Python 库路径——pypdf/pdfplumber/pypdfium2 已覆盖合并、拆分、文本表格抽取、渲染等全部核心场景。**绝不**把它们当作硬前置。

## 快速上手

```python
from pypdf import PdfReader, PdfWriter

# 读取
reader = PdfReader("document.pdf")
print(f"页数: {len(reader.pages)}")

# 抽取文本
text = ""
for page in reader.pages:
    text += page.extract_text()
```

## Python 库

### pypdf — 基础操作

#### 合并 PDF
```python
from pypdf import PdfWriter, PdfReader

writer = PdfWriter()
for pdf_file in ["doc1.pdf", "doc2.pdf", "doc3.pdf"]:
    reader = PdfReader(pdf_file)
    for page in reader.pages:
        writer.add_page(page)

with open("merged.pdf", "wb") as output:
    writer.write(output)
```

#### 拆分 PDF
```python
reader = PdfReader("input.pdf")
for i, page in enumerate(reader.pages):
    writer = PdfWriter()
    writer.add_page(page)
    with open(f"page_{i+1}.pdf", "wb") as output:
        writer.write(output)
```

#### 抽取元数据
```python
reader = PdfReader("document.pdf")
meta = reader.metadata
print(f"标题: {meta.title}")
print(f"作者: {meta.author}")
print(f"主题: {meta.subject}")
print(f"创建程序: {meta.creator}")
```

#### 旋转页面
```python
reader = PdfReader("input.pdf")
writer = PdfWriter()

page = reader.pages[0]
page.rotate(90)  # 顺时针 90 度
writer.add_page(page)

with open("rotated.pdf", "wb") as output:
    writer.write(output)
```

### pdfplumber — 文本与表格抽取

#### 保留版式抽取文本
```python
import pdfplumber

with pdfplumber.open("document.pdf") as pdf:
    for page in pdf.pages:
        text = page.extract_text()
        print(text)
```

#### 抽取表格
```python
import pdfplumber

with pdfplumber.open("document.pdf") as pdf:
    for i, page in enumerate(pdf.pages):
        tables = page.extract_tables()
        for j, table in enumerate(tables):
            print(f"第 {i+1} 页表格 {j+1}:")
            for row in table:
                print(row)
```

#### 表格导出为 Excel（需追加安装 pandas openpyxl）
```python
import pandas as pd

with pdfplumber.open("document.pdf") as pdf:
    all_tables = []
    for page in pdf.pages:
        tables = page.extract_tables()
        for table in tables:
            if table:  # 跳过空表
                df = pd.DataFrame(table[1:], columns=table[0])
                all_tables.append(df)

if all_tables:
    combined_df = pd.concat(all_tables, ignore_index=True)
    combined_df.to_excel("extracted_tables.xlsx", index=False)
```

### reportlab — 从零生成 PDF

#### 中文生成的关键：字体

reportlab 内置西文字体（Helvetica 等）**不含中文字形**——直接 `drawString` 中文会变黑块或报错。两条路径：

**路径一（零依赖，优先）：内置 CID 字体。** reportlab 自带 Adobe CID 字体映射，无需字体文件：

```python
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont

pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))  # 简体中文宋体
# 其他可选：STSongStd-Light（简）、MSung-Light/MHei-Medium（繁）、HeiseiMin-W3（日）
```

注意：CID 字体不嵌入文件，渲染字形由查看器替换——文字可正常显示与复制，但精确排版（字宽级对齐）不可依赖。标题/正文/表格够用；需要精确排版或特定字体（雅黑、思源）时走路径二。

**路径二（精确排版）：嵌入 TTF。** 用系统字体文件（Windows：`C:\Windows\Fonts\msyh.ttc` 雅黑、`simsun.ttc` 宋体）或用户提供的字体：

```python
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

pdfmetrics.registerFont(TTFont("YaHei", r"C:\Windows\Fonts\msyh.ttc", subfontIndex=0))
# .ttc 集合必须给 subfontIndex；雅黑常规为 0
```

#### 基础生成
```python
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

c = canvas.Canvas("hello.pdf", pagesize=A4)
width, height = A4

c.setFont("STSong-Light", 12)  # 先注册 CID 字体
c.drawString(100, height - 100, "你好，世界！")
c.line(100, height - 140, 400, height - 140)
c.save()
```

#### 多页文档（Platypus）
```python
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak

doc = SimpleDocTemplate("report.pdf", pagesize=A4)
styles = getSampleStyleSheet()
# 中文必须覆盖样式的字体，否则正文仍是 Helvetica
styles["Normal"].fontName = "STSong-Light"
styles["Title"].fontName = "STSong-Light"

story = []
story.append(Paragraph("报告标题", styles["Title"]))
story.append(Spacer(1, 12))
story.append(Paragraph("正文段落。" * 20, styles["Normal"]))
story.append(PageBreak())
story.append(Paragraph("第二页", styles["Heading1"]))
doc.build(story)
```

#### 上下标

**重要**：绝不在 reportlab 里用 Unicode 上下标字符（₀₁₂₃₄₅₆₇₈₉、⁰¹²³⁴⁵⁶⁷⁸⁹）——内置字体没有这些字形，会渲染成实心黑块。Paragraph 里用 XML 标签：

```python
chemical = Paragraph("H<sub>2</sub>O", styles["Normal"])
squared = Paragraph("x<super>2</super> + y<super>2</super>", styles["Normal"])
```

canvas 直绘文本（非 Paragraph）则手动调整字号和位置。

## 常见任务

### 扫描件文本抽取（OCR）
```python
# 需要 pip 追加 pytesseract pdf2image，且系统装有 Tesseract 与 poppler——均为探测式可选
import pytesseract
from pdf2image import convert_from_path

images = convert_from_path('scanned.pdf')
text = ""
for i, image in enumerate(images):
    text += f"第 {i+1} 页:\n"
    text += pytesseract.image_to_string(image, lang="chi_sim+eng")  # 中文简体+英文
    text += "\n\n"
```

Tesseract 中文需要 `chi_sim` 语言包；缺语言包或系统未装 Tesseract 时降级为提示用户，不要静默产出空文本。

### 添加水印
```python
from pypdf import PdfReader, PdfWriter

# 水印 PDF 可用 reportlab 先生成
watermark = PdfReader("watermark.pdf").pages[0]

reader = PdfReader("document.pdf")
writer = PdfWriter()

for page in reader.pages:
    page.merge_page(watermark)
    writer.add_page(page)

with open("watermarked.pdf", "wb") as output:
    writer.write(output)
```

### 抽取内嵌图片
优先 `pdfimages`（poppler，探测到才用）：`pdfimages -j input.pdf output_prefix`。
无 poppler 时的纯 Python 路径见 `REFERENCE.md`（pypdfium2 区域检测）。

### 密码保护
```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader("input.pdf")
writer = PdfWriter()
for page in reader.pages:
    writer.add_page(page)

writer.encrypt("userpassword", "ownerpassword")

with open("encrypted.pdf", "wb") as output:
    writer.write(output)
```

### 裁剪页面
```python
from pypdf import PdfWriter, PdfReader

reader = PdfReader("input.pdf")
writer = PdfWriter()

page = reader.pages[0]
page.mediabox.left = 50
page.mediabox.bottom = 50
page.mediabox.right = 550
page.mediabox.top = 750

writer.add_page(page)
with open("cropped.pdf", "wb") as output:
    writer.write(output)
```

## 渲染验收（探测式增强）

生成或修改 PDF 后，渲染成图片逐页检查：

```powershell
<python> scripts/convert_pdf_to_images.py output.pdf render-out
```

后端优先 `pypdfium2`（pip 包，随接线命令安装），其次 `pdf2image`+poppler；都不可用时脚本以退出码 3 报错——降级为提示用户人工打开检查。表单类产出的验收流程详见 `FORMS.md`。

## 命令行工具速查（全部探测式可选）

### pdftotext / pdfimages / pdftoppm（poppler）
```bash
pdftotext input.pdf output.txt            # 抽取文本
pdftotext -layout input.pdf output.txt    # 保留版式
pdftotext -f 1 -l 5 input.pdf output.txt  # 第 1-5 页
pdfimages -j input.pdf output_prefix      # 抽取内嵌图片
```

### qpdf
```bash
qpdf --empty --pages file1.pdf file2.pdf -- merged.pdf       # 合并
qpdf input.pdf --pages . 1-5 -- pages1-5.pdf                 # 拆分
qpdf input.pdf output.pdf --rotate=+90:1                     # 旋转第 1 页
qpdf --password=mypassword --decrypt encrypted.pdf out.pdf   # 解密
```

## 任务速查表

| 任务 | 首选工具 | 命令/代码 |
|------|---------------|--------------|
| 合并 PDF | pypdf | `writer.add_page(page)` |
| 拆分 PDF | pypdf | 每页一个文件 |
| 抽取文本 | pdfplumber | `page.extract_text()` |
| 抽取表格 | pdfplumber | `page.extract_tables()` |
| 生成 PDF | reportlab | Canvas 或 Platypus（中文先注册字体） |
| 扫描件 OCR | pytesseract | 先转图片（探测式） |
| 填写表单 | pdf-lib 或 pypdf | **必读 FORMS.md** |
| 渲染验收 | convert_pdf_to_images.py | pypdfium2 后端 |

## 下一步

- 进阶 pypdfium2 用法、JavaScript 库（pdf-lib/pdfjs-dist）、性能优化与排错：见 `REFERENCE.md`
- 填写 PDF 表单：严格遵循 `FORMS.md` 的步骤顺序
