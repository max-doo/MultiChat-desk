# ORIGIN — pdf skill 来源与改编记录

## 上游

| 来源 | 仓库 | commit | 许可证 |
|---|---|---|---|
| 全部骨架 | anthropics/skills `skills/pdf` | e4bb5d960d87126ff3b3a8af1a104b7db67560ba | Apache-2.0（LICENSE.txt 随目录分发） |

## 复制文件清单（anthropics）

- `LICENSE.txt`（原样）
- `scripts/check_bounding_boxes.py`、`check_fillable_fields.py`、`create_validation_image.py`、`extract_form_field_info.py`、`extract_form_structure.py`、`fill_fillable_fields.py`、`fill_pdf_form_with_annotations.py`
- `scripts/convert_pdf_to_images.py`（改编重写，见下）

改编新增：

- `SKILL.md`、`FORMS.md`、`REFERENCE.md`（中文适配重写）
- `scripts/ensure-python.mjs`（Python embeddable bootstrap，与 pptx skill 同一份副本）
- `ORIGIN.md`（本文件）

## 改编决策清单

1. **三份文档全量中文适配重写**：SKILL.md 保留全部核心操作示例；FORMS.md 保留严格步骤顺序与两种坐标系路径；REFERENCE.md 保留进阶内容（pypdfium2/pdf-lib/pdfjs-dist/性能/排错）。description 中英双语。
2. **中文字体知识补强**（定稿"中文场景适配"要求）：SKILL.md 新增 reportlab 中文生成的两条路径——内置 CID 字体 `UnicodeCIDFont("STSong-Light")`（零依赖，实测验证可用）与 TTF 嵌入（`.ttc` 需 `subfontIndex`）；`REFERENCE.md` 增加中文黑块排错条目。
3. **poppler 硬依赖解除**：`convert_pdf_to_images.py` 重写为 pypdfium2 优先（pip wheel 自带二进制）、pdf2image+poppler 兜底、都不可用退出码 3 优雅降级。
4. **系统工具全部降级为探测式可选**：pdftotext/pdfimages/pdftoppm/qpdf/pdftk/ImageMagick/Tesseract 在 SKILL.md 中明确标注探测式，给出无系统依赖的 Python 替代路径；FORMS.md 中 ImageMagick 裁剪替换为 Pillow（`Image.crop`），消除一个硬依赖。
5. **Python 接线**：`ensure-python.mjs` 幂等引导，包集为 `pypdf reportlab pdfplumber pypdfium2 Pillow`；OCR 另需 `pytesseract pdf2image`（文档注明）。
6. **UTF-8 输出修复**：7 个脚本增加 stdout UTF-8 重配（Windows GBK 控制台中文乱码）。
7. **原子写回**：FORMS.md 明确输出写新路径，替换原文件须先验证再原子替换。
8. **OCR 中文语言包**：示例明确 `lang="chi_sim+eng"`，缺语言包/未装 Tesseract 时降级提示。

## 依赖与版本

| 依赖 | 类型 | 供给方式 | 实测版本 |
|---|---|---|---|
| Python embeddable | 运行时 | `ensure-python.mjs` 按需下载 3.12.7 | 3.12.7 |
| pypdf / reportlab / pdfplumber / Pillow | pip | ensure-python 安装 | 实测可用 |
| pypdfium2 | pip | ensure-python 安装（渲染验收后端） | 实测可用 |
| pdf-lib / pdfjs-dist | npm | **不预装**（运行时无 npm）；REFERENCE.md 保留为知识参考，主路径为 Python 库 | — |
| poppler-utils / qpdf / pdftk / ImageMagick / Tesseract | 系统 | 探测式可选增强，未安装走 Python 路径或降级提示 | 本机有 poppler，验证未依赖 |
