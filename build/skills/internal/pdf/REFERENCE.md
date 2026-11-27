# PDF 处理进阶参考

本文收录主技能文档之外的进阶特性、详细示例与其他库。目录：

- pypdfium2 库（渲染与文本）
- JavaScript 库（pdf-lib / pdfjs-dist）
- 命令行进阶（poppler-utils / qpdf，均为探测式可选）
- Python 进阶技巧（pdfplumber / reportlab）
- 复杂工作流（图片抽取、批处理）
- 性能优化
- 排错
- 许可证信息

## pypdfium2 库（Apache/BSD 许可证）

pypdfium2 是 PDFium（Chromium 的 PDF 库）的 Python 绑定，自带二进制 wheel，无需系统依赖。适合快速渲染、图片生成，可作为 PyMuPDF 的替代。本技能的 `convert_pdf_to_images.py` 默认后端就是它。

### 渲染 PDF 为图片

```python
import pypdfium2 as pdfium

pdf = pdfium.PdfDocument("document.pdf")

# 单页渲染
page = pdf[0]
bitmap = page.render(scale=2.0, rotation=0)  # scale 越大分辨率越高
img = bitmap.to_pil()
img.save("page_1.png", "PNG")

# 多页批渲
for i, page in enumerate(pdf):
    bitmap = page.render(scale=1.5)
    img = bitmap.to_pil()
    img.save(f"page_{i+1}.jpg", "JPEG", quality=90)
```

### 用 pypdfium2 抽取文本

```python
import pypdfium2 as pdfium

pdf = pdfium.PdfDocument("document.pdf")
for i, page in enumerate(pdf):
    textpage = page.get_textpage()
    text = textpage.get_text_range()
    print(f"第 {i+1} 页文本长度: {len(text)} 字符")
```

## JavaScript 库

宿主保证 `node` 命令可用，但**运行时没有 npm**——pdf-lib/pdfjs-dist 不随包预装，无法在线安装。本节作为知识参考保留：**默认走 Python 库路径**（pypdf/pdfplumber/reportlab 已覆盖全部场景）；只有当宿主未来预装了这些包、或用户明确要求且环境具备时，才使用本节示例。

### pdf-lib（MIT 许可证）

#### 加载并修改现有 PDF

```javascript
import { PDFDocument } from 'pdf-lib';
import fs from 'fs';

async function manipulatePDF() {
    const existingPdfBytes = fs.readFileSync('input.pdf');
    const pdfDoc = await PDFDocument.load(existingPdfBytes);

    console.log(`页数: ${pdfDoc.getPageCount()}`);

    const newPage = pdfDoc.addPage([600, 400]);
    newPage.drawText('added by pdf-lib', { x: 100, y: 300, size: 16 });

    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync('modified.pdf', pdfBytes);
}
```

**注意**：pdf-lib 的 `drawText` 默认用标准 14 字体，**不支持中文**——中文需 `fontkit` 注册后嵌入 TTF（`pdfDoc.registerFontkit(fontkit)` + `embedFont(ttfBytes)`）。中文任务优先走 Python/reportlab 路径。

#### 从零创建复杂 PDF

```javascript
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs';

async function createPDF() {
    const pdfDoc = await PDFDocument.create();
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const page = pdfDoc.addPage([595, 842]); // A4
    const { width, height } = page.getSize();

    page.drawText('Invoice #12345', {
        x: 50, y: height - 50, size: 18,
        font: helveticaBold, color: rgb(0.2, 0.2, 0.8)
    });

    page.drawRectangle({
        x: 40, y: height - 100, width: width - 80, height: 30,
        color: rgb(0.9, 0.9, 0.9)
    });

    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync('created.pdf', pdfBytes);
}
```

#### 进阶合并与拆分

```javascript
import { PDFDocument } from 'pdf-lib';
import fs from 'fs';

async function mergePDFs() {
    const mergedPdf = await PDFDocument.create();

    const pdf1 = await PDFDocument.load(fs.readFileSync('doc1.pdf'));
    const pdf2 = await PDFDocument.load(fs.readFileSync('doc2.pdf'));

    // 第一份全部页
    const pdf1Pages = await mergedPdf.copyPages(pdf1, pdf1.getPageIndices());
    pdf1Pages.forEach(page => mergedPdf.addPage(page));

    // 第二份只要第 0、2、4 页
    const pdf2Pages = await mergedPdf.copyPages(pdf2, [0, 2, 4]);
    pdf2Pages.forEach(page => mergedPdf.addPage(page));

    fs.writeFileSync('merged.pdf', await mergedPdf.save());
}
```

### pdfjs-dist（Apache 许可证）

Mozilla 的 PDF 渲染库，浏览器场景为主。Node 环境下抽取文本与坐标也可用：

```javascript
import * as pdfjsLib from 'pdfjs-dist';

async function extractText() {
    const loadingTask = pdfjsLib.getDocument('document.pdf');
    const pdf = await loadingTask.promise;

    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        fullText += `\n--- page ${i} ---\n` + textContent.items.map(item => item.str).join(' ');

        // 带坐标的文本，供结构化处理
        const textWithCoords = textContent.items.map(item => ({
            text: item.str,
            x: item.transform[4],
            y: item.transform[5],
            width: item.width,
            height: item.height
        }));
    }
    return fullText;
}
```

#### 抽取注解与表单

```javascript
const annotations = await page.getAnnotations();
annotations.forEach(annotation => {
    console.log(`type: ${annotation.subtype}`);
    console.log(`content: ${annotation.contents}`);
    console.log(`rect: ${JSON.stringify(annotation.rect)}`);
});
```

## 命令行进阶

**全部为探测式可选增强**——用 `Get-Command` 探测，不存在就走 Python 路径。

### poppler-utils 进阶

```bash
# 带包围盒坐标抽取文本（结构化数据必需）
pdftotext -bbox-layout document.pdf output.xml

# 指定分辨率渲染 PNG
pdftoppm -png -r 300 document.pdf output_prefix

# 高分辨率渲染指定页范围
pdftoppm -png -r 600 -f 1 -l 3 document.pdf high_res_pages

# JPEG 质量参数
pdftoppm -jpeg -jpegopt quality=85 -r 200 document.pdf jpeg_output

# 抽取内嵌图片（原格式）
pdfimages -all document.pdf images/img

# 只列图片信息不抽取
pdfimages -list document.pdf
```

### qpdf 进阶

```bash
# 按页数分组拆分
qpdf --split-pages=3 input.pdf output_group_%02d.pdf

# 复杂页范围抽取
qpdf input.pdf --pages input.pdf 1,3-5,8,10-end -- extracted.pdf

# 跨文件挑页合并
qpdf --empty --pages doc1.pdf 1-3 doc2.pdf 5-7 doc3.pdf 2,4 -- combined.pdf

# Web 优化（线性化流式加载）
qpdf --linearize input.pdf optimized.pdf

# 检查损坏结构
qpdf --check input.pdf

# 指定权限的加密
qpdf --encrypt user_pass owner_pass 256 --print=none --modify=none -- input.pdf encrypted.pdf

# 查看加密状态
qpdf --show-encryption encrypted.pdf
```

## Python 进阶技巧

### pdfplumber 进阶

#### 带精确坐标的文本抽取

```python
import pdfplumber

with pdfplumber.open("document.pdf") as pdf:
    page = pdf.pages[0]

    chars = page.chars
    for char in chars[:10]:
        print(f"字符: '{char['text']}' 位于 x:{char['x0']:.1f} y:{char['y0']:.1f}")

    # 按包围盒抽取（left, top, right, bottom）
    bbox_text = page.within_bbox((100, 100, 400, 200)).extract_text()
```

#### 复杂表格的自定义抽取

```python
import pdfplumber
import pandas as pd

with pdfplumber.open("complex_table.pdf") as pdf:
    page = pdf.pages[0]

    table_settings = {
        "vertical_strategy": "lines",
        "horizontal_strategy": "lines",
        "snap_tolerance": 3,
        "intersection_tolerance": 15
    }
    tables = page.extract_tables(table_settings)

    # 可视化调试表格抽取
    img = page.to_image(resolution=150)
    img.save("debug_layout.png")
```

### reportlab 进阶：专业表格报告

```python
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors

data = [
    ['产品', '一季度', '二季度', '三季度', '四季度'],
    ['桌面版', '120', '135', '142', '158'],
    ['移动版', '85', '92', '98', '105']
]

doc = SimpleDocTemplate("report.pdf")
elements = []

styles = getSampleStyleSheet()
styles["Title"].fontName = "STSong-Light"  # 中文先注册 CID 字体
elements.append(Paragraph("季度销售报告", styles['Title']))

table = Table(data)
table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
    ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
    ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
    ('FONTNAME', (0, 0), (-1, -1), 'STSong-Light'),  # 表格中文同样要指定
    ('FONTSIZE', (0, 0), (-1, 0), 14),
    ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
    ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
    ('GRID', (0, 0), (-1, -1), 1, colors.black)
]))
elements.append(table)

doc.build(elements)
```

## 复杂工作流

### 抽取图片/图形

**方法一：pdfimages（最快，探测到才用）**

```bash
pdfimages -all document.pdf images/img
```

**方法二：pypdfium2 + 图像处理（无系统依赖）**

```python
import pypdfium2 as pdfium
from PIL import Image
import numpy as np

def extract_figures(pdf_path, output_dir):
    pdf = pdfium.PdfDocument(pdf_path)
    for page_num, page in enumerate(pdf):
        bitmap = page.render(scale=3.0)  # 高分辨率
        img = bitmap.to_pil()
        img_array = np.array(img)
        # 简化示例：非白区域检测。真实实现需要更精细的轮廓与包围盒分析
        mask = np.any(img_array != [255, 255, 255], axis=2)
```

### 带错误处理的批量处理

```python
import os
import glob
from pypdf import PdfReader, PdfWriter
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def batch_process_pdfs(input_dir, operation='merge'):
    pdf_files = glob.glob(os.path.join(input_dir, "*.pdf"))

    if operation == 'merge':
        writer = PdfWriter()
        for pdf_file in pdf_files:
            try:
                reader = PdfReader(pdf_file)
                for page in reader.pages:
                    writer.add_page(page)
                logger.info(f"已处理: {pdf_file}")
            except Exception as e:
                logger.error(f"处理失败 {pdf_file}: {e}")
                continue
        with open("batch_merged.pdf", "wb") as output:
            writer.write(output)

    elif operation == 'extract_text':
        for pdf_file in pdf_files:
            try:
                reader = PdfReader(pdf_file)
                text = ""
                for page in reader.pages:
                    text += page.extract_text()
                output_file = pdf_file.replace('.pdf', '.txt')
                with open(output_file, 'w', encoding='utf-8') as f:
                    f.write(text)
                logger.info(f"已抽取: {pdf_file}")
            except Exception as e:
                logger.error(f"抽取失败 {pdf_file}: {e}")
                continue
```

## 性能优化建议

### 大文件

- 用流式处理，不要整文件读进内存
- 大文件拆分优先 `qpdf --split-pages`（探测到才用）
- 逐页处理用 pypdfium2

### 文本抽取

- 纯文本最快是 `pdftotext`（可选）
- 结构化数据和表格用 pdfplumber
- 超大文档避免 `pypdf.extract_text()`

### 图片抽取

- `pdfimages` 远快于页面渲染（可选）
- 预览用低分辨率，最终产出用高分辨率

### 内存管理

```python
def process_large_pdf(pdf_path, chunk_size=10):
    reader = PdfReader(pdf_path)
    total_pages = len(reader.pages)

    for start_idx in range(0, total_pages, chunk_size):
        end_idx = min(start_idx + chunk_size, total_pages)
        writer = PdfWriter()
        for i in range(start_idx, end_idx):
            writer.add_page(reader.pages[i])
        with open(f"chunk_{start_idx//chunk_size}.pdf", "wb") as output:
            writer.write(output)
```

## 排错

### 加密 PDF

```python
from pypdf import PdfReader

try:
    reader = PdfReader("encrypted.pdf")
    if reader.is_encrypted:
        reader.decrypt("password")
except Exception as e:
    print(f"解密失败: {e}")
```

### 损坏的 PDF

有 qpdf 时：`qpdf --check corrupted.pdf` / `qpdf --replace-input corrupted.pdf`。
没有时的 Python 兜底：可尝试 `PdfReader(path, strict=False)`。

### 文本抽取失败

扫描件没有文本层，抽取出来是空的——退回 OCR（见 SKILL.md，系统依赖为探测式）。判断方法：`page.extract_text()` 全空但页面渲染后有文字图像。

### 中文显示为黑块或空白

reportlab 用了未注册字体的中文文本——检查是否注册 CID 字体（`UnicodeCIDFont("STSong-Light")`）或嵌入 TTF，并且**每个样式**（Normal/Title/表格 FONTNAME）都指定了中文字体。

## 许可证信息

- **pypdf**: BSD
- **pdfplumber**: MIT
- **pypdfium2**: Apache/BSD
- **reportlab**: BSD
- **poppler-utils**: GPL-2（可选系统工具）
- **qpdf**: Apache（可选系统工具）
- **pdf-lib**: MIT
- **pdfjs-dist**: Apache
