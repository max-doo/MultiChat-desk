# Troubleshooting Guide — Symptom-Driven

> 移植说明：本文件移植自 MiniMax minimax-docx（MIT）。原文中的 .NET CLI 命令（`$CLI analyze/validate/fix-order/apply-template` 等）与 C# 修复示例已改写为运行时无关的操作：解包后用 python/lxml 检查与编辑 XML、本 skill 的 scripts/office/validate.py 做 XSD 校验、scripts/unpack.py / scripts/pack.py 做解包与重打包。所有诊断逻辑与修复语义保持不变。

## How to Use This Guide

Search by the **SYMPTOM** you observe, not the technical concept. Each entry follows:
- **Symptom** — what you see or what the user reports
- **Diagnosis** — how to confirm the root cause
- **Fix** — exact steps, commands, or code
- **Prevention** — how to avoid it next time

**Quick search keywords:** headings wrong, body text, repair, corrupt, font, tables missing, images missing, TOC broken, update table, page break, section break, hyperlink, numbered list, bullets, margins, page size, Chinese tofu, cover page, track changes, revision marks

---

## 1. "All headings look like body text" (Heading Styles Not Applied)

**Symptom:** After template application, headings have no formatting — they look like Normal paragraphs. Font size, bold, spacing are all wrong.

**Diagnosis:** The `pStyle` values in `document.xml` don't match the `styleId` values in `styles.xml`.

Common mismatches:
- Source uses `Heading1` but template defines the style as `1` (Chinese templates often use numeric styleIds)
- Source uses `heading1` (lowercase) but template has `Heading1` (case-sensitive!)
- `pStyle` references a style that simply doesn't exist in the output's `styles.xml`

Check with（解包后操作）:
```powershell
# List all pStyle values used in the document
Select-String -Path unpacked/word/document.xml -Pattern 'w:pStyle w:val="([^"]+)"' -AllMatches |
  ForEach-Object { $_.Matches } | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique

# List all styleIds defined in styles.xml
Select-String -Path unpacked/word/styles.xml -Pattern 'w:styleId="([^"]+)"' -AllMatches |
  ForEach-Object { $_.Matches } | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
```

**Fix:** Build a styleId mapping table before applying the template. Update every `pStyle` value in the document content.

```python
# Build mapping: source styleId → template styleId, compare by style NAME (w:name), not styleId
from lxml import etree
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

def style_names(styles_xml):
    root = etree.parse(styles_xml)
    result = {}
    for s in root.iter(f'{{{W}}}style'):
        name_el = s.find(f'{{{W}}}name')
        result[s.get(f'{{{W}}}styleId')] = name_el.get(f'{{{W}}}val') if name_el is not None else None
    return result

source_styles = style_names('source_unpacked/word/styles.xml')
template_styles = style_names('template_unpacked/word/styles.xml')
template_by_name = {v: k for k, v in template_styles.items() if v}

mapping = {}
for sid, sname in source_styles.items():
    if sid in template_styles:
        mapping[sid] = sid                        # Tier 1: exact styleId match
    elif sname and sname.lower() in {n.lower() for n in template_by_name if n}:
        for tid, tname in template_styles.items():
            if tname and tname.lower() == sname.lower():
                mapping[sid] = tid                # Tier 2: match by w:name
                break

# Apply mapping to all paragraphs in the copied content
for p in body.iter(f'{{{W}}}p'):
    pStyle = p.find(f'{{{W}}}pPr/{{{W}}}pStyle')
    if pStyle is not None and pStyle.get(f'{{{W}}}val') in mapping:
        pStyle.set(f'{{{W}}}val', mapping[pStyle.get(f'{{{W}}}val')])
```

**Prevention:** ALWAYS extract and compare styleIds from both source and template before template application. Never assume styleIds are the same across documents.

---

## 2. "Document opens with repair warnings" (XML Corruption)

**Symptom:** Word says "We found a problem with some content" or "Word found unreadable content" when opening.

**Diagnosis:** Element ordering is wrong. OpenXML is strict about child element order.

Common violations:
- `pPr` must come before runs in `w:p`
- `tblPr` must come before `tblGrid` in `w:tbl`
- `rPr` must come before `t`/`br`/`tab` in `w:r`
- `trPr` must come before `tc` in `w:tr`
- `tcPr` must come before content in `w:tc`

```powershell
# Validate against the full ECMA-376 XSDs shipped with this skill
& python.exe scripts\office\validate.py doc.docx
# 元素顺序错误会以 XSD validation error 的形式逐条报出（含行内容）
```

**Fix:**
元素顺序没有自动修复工具——按 `references/openxml_element_order.md` 的顺序表手工调整：

```powershell
# unpack → 编辑 word/document.xml 把 pPr/rPr/tblPr 等属性元素移到正确位置 → repack
& python.exe scripts\unpack.py doc.docx unpacked/
# ... 编辑 XML：把 pPr 挪到 w:p 的第一个子元素位置，tblPr 挪到 tblGrid 之前，以此类推 ...
& python.exe scripts\pack.py unpacked/ fixed.docx
& python.exe scripts\office\validate.py fixed.docx
```

**Prevention:** Read `references/openxml_element_order.md` before writing any XML manipulation code. Always append properties elements first, then content elements.

---

## 3. "All text is in wrong font" (Font Contamination)

**Symptom:** Template specifies 宋体/Times New Roman but document shows Google Sans, Arial, Calibri, or whatever font the source document used.

**Diagnosis:** Source document's `rPr` contains inline `rFonts` declarations that override template styles. Direct formatting always wins over style-based formatting in OpenXML.

```powershell
# Check for font contamination — rFonts in document.xml means inline overrides
Select-String -Path unpacked/word/document.xml -Pattern 'w:rFonts' | Measure-Object | Select-Object -ExpandProperty Count
```

**Fix:** Strip `rFonts` from `rPr` when copying content, but KEEP `w:eastAsia` for CJK text:

```python
from lxml import etree
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

for rPr in body.iter(f'{{{W}}}rPr'):
    rFonts = rPr.find(f'{{{W}}}rFonts')
    if rFonts is not None:
        # Preserve EastAsia font for CJK — removing it causes tofu (□□□)
        east_asia = rFonts.get(f'{{{W}}}eastAsia')
        rPr.remove(rFonts)
        if east_asia:
            clean = etree.SubElement(rPr, f'{{{W}}}rFonts')
            clean.set(f'{{{W}}}eastAsia', east_asia)
```

Also strip these common direct formatting overrides:
- `w:sz` / `w:szCs` (font size)
- `w:color` (text color)
- `w:b` / `w:i` when they contradict the style

**Prevention:** Always clean direct formatting when copying content between documents. Keep only `pStyle`/`rStyle` references and `w:t` text.

---

## 4. "Tables are missing" (Tables Lost During Copy)

**Symptom:** Source had 5 tables but output only has 2 (or 0).

**Diagnosis:** Code used `body.findall('w:p')` or `body.Descendants<Paragraph>()` at the top level instead of iterating all children. This skips `w:tbl` elements.

```powershell
# Verify table count — count top-level w:tbl elements in each document
(Select-String -Path source_unpacked/word/document.xml -Pattern '<w:tbl>' -AllMatches | ForEach-Object { $_.Matches }).Count
(Select-String -Path output_unpacked/word/document.xml -Pattern '<w:tbl>' -AllMatches | ForEach-Object { $_.Matches }).Count
```

**Fix:** Use `list(body)` to get ALL top-level children including tables:

```python
# WRONG — skips tables, section properties, and other non-paragraph elements
elements = body.findall(f'{{{W}}}p')

# CORRECT — gets everything: paragraphs, tables, SDT blocks, etc.
elements = list(body)  # lxml: all direct children regardless of tag
```

**Prevention:** Always use `list(body)` for iteration, never filter by a single element type alone when copying content.

---

## 5. "Images are missing or show broken icon"

**Symptom:** Image placeholders appear but images don't render. Or images are completely absent.

**Diagnosis:** The `r:embed` rId in `w:drawing` doesn't match any relationship in `document.xml.rels`, or the media file wasn't copied to the output ZIP.

```powershell
# Check relationships — image rels live in word/_rels/document.xml.rels
Select-String -Path unpacked/word/_rels/document.xml.rels -Pattern 'image'

# Check if media files exist
Get-ChildItem unpacked/word/media/ -ErrorAction SilentlyContinue
```

**Fix:**
1. Check source rels for image file paths
2. Copy media files from source to output
3. Add/update relationships in output rels
4. Update `r:embed` values in drawing elements

When copying content with images between documents, remap every embedded image（python/lxml 版：图片部件 = 复制 word/media/* 文件 + 在 document.xml.rels 追加 Relationship + 改写 r:embed）:

```python
import shutil, re
from lxml import etree
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PR = 'http://schemas.openxmlformats.org/package/2006/relationships'

# 1. 读取目标 rels，计算最大 rId
rels_tree = etree.parse('target_unpacked/word/_rels/document.xml.rels')
existing = [rel.get('Id') for rel in rels_tree.getroot()]
max_id = max([int(m.group(1)) for rid in existing if (m := re.fullmatch(r'rId(\d+)', rid))] or [0])

# 2. 对每个 drawing/blip：复制媒体文件 + 新建 rel + 改写 r:embed
for blip in body.iter(f'{{{A}}}blip'):
    old_rid = blip.get(f'{{{R}}}embed')
    if not old_rid:
        continue
    # 在源 rels 里查 old_rid 对应的 Target（如 media/image1.png），复制文件到目标包
    # shutil.copy(source_unpacked/'word'/target, target_unpacked/'word'/target)
    max_id += 1
    new_rel = etree.SubElement(rels_tree.getroot(), f'{{{PR}}}Relationship')
    new_rel.set('Id', f'rId{max_id}')
    new_rel.set('Type', f'{R}/image')
    new_rel.set('Target', target)  # 与源 rels 相同的相对路径
    blip.set(f'{{{R}}}embed', f'rId{max_id}')
```

**Prevention:** Always do rId remapping + media file copy when moving content between documents. Never assume rIds are portable across documents.

---

## 6. "TOC shows stale/wrong entries" or "Update Table doesn't work"

**Symptom:** Table of contents shows the template's example entries (e.g., "第1章 绪论...1") instead of actual headings. Or clicking "Update Table" in Word does nothing.

**Diagnosis:**
- **Stale entries (normal):** TOC entries are static text cached inside the field. They don't auto-update until the user explicitly updates in Word.
- **Update Table fails:** The SDT wrapper or field code structure is damaged. The TOC in real templates is a mixed structure: SDT block + field code + static entries.

```powershell
# Check if TOC SDT exists
Select-String -Path unpacked/word/document.xml -Pattern 'w:sdt|TOC' | Select-Object -First 5
```

**Fix:**
- **If entries are just stale:** This is expected behavior. The user must right-click TOC, then "Update Field" in Word. Or enable auto-update:
  在 `word/settings.xml` 中加入 `<w:updateFields w:val="true"/>`（放在 `</w:settings>` 之前），
  Word 打开文档时会提示自动更新域：
  ```xml
  <w:updateFields w:val="true"/>
  ```
- **If SDT is damaged:** Keep the entire SDT block from the template intact. Do not modify it.
- **If field code is missing:** Ensure the TOC contains: `fldChar begin` + `instrText`（如 `TOC \o "1-3" \h \z \u`）+ `fldChar separate` + static entries + `fldChar end`。
- **If you rebuilt TOC from scratch (common mistake):** You likely destroyed the SDT wrapper. Use the template's original SDT block instead.

**Prevention:** When doing Base-Replace (C-2), keep the template's TOC zone completely untouched. Do not strip, rebuild, or modify the SDT block. The TOC will auto-update when the user opens in Word.

---

## 7. "Chapters don't start on new pages" (Missing Section Breaks)

**Symptom:** Content flows continuously without page breaks between chapters. Chapter 2 starts right after Chapter 1's last paragraph on the same page.

**Diagnosis:** No `sectPr` elements or page break paragraphs between chapters.

**Fix:** Insert a paragraph with `sectPr` in its `pPr` before each chapter heading, or insert a page break:

```xml
<!-- Option 1: Section break (preserves per-section settings like headers/margins) -->
<w:p><w:pPr><w:sectPr><w:type w:val="nextPage"/></w:sectPr></w:pPr></w:p>

<!-- Option 2: Simple page break (lighter weight) -->
<w:p><w:r><w:br w:type="page"/></w:r></w:p>
```

在每个一级标题段落之前插入上述段落之一即可（lxml 中先构造元素再 `heading.addprevious(new_element)`，注意带命名空间构造）。

**Prevention:** When copying content, insert page/section breaks before Heading1 paragraphs as needed. Check source document's section structure before copying.

---

## 8. "Hyperlinks don't work" (Broken Links)

**Symptom:** Clicking a hyperlink in the output document does nothing, or it navigates to the wrong URL.

**Diagnosis:** `w:hyperlink r:id` points to a relationship that doesn't exist in `document.xml.rels`.

```powershell
# Check hyperlink relationships
Select-String -Path unpacked/word/_rels/document.xml.rels -Pattern 'hyperlink'
```

**Fix:** Merge source document's hyperlink relationships into output's rels file. Update rId references.

```python
# 对文档中每个 <w:hyperlink r:id="X">：
# 1. 在源 document.xml.rels 中找 Id=X 的 Relationship（Target 是外网 URL，TargetMode="External"）
# 2. 在目标 rels 中新建 Relationship，Id 取未占用的下一个 rId，Target/TargetMode 照抄
# 3. 把 hyperlink 元素的 r:id 改成新 Id
# 目标 rels 中已有相同 Target URL 时应复用其 rId 而不是新建（避免重复）。
for hyperlink in body.iter(f'{{{W}}}hyperlink'):
    rid = hyperlink.get(f'{{{R}}}id')
    if rid is None:
        continue
    # ... 查源 rels、分配新 rId、追加 Relationship、hyperlink.set(f'{{{R}}}id', new_rid)
```

**Prevention:** Always merge ALL relationship types (images, hyperlinks, headers, footers) when combining documents. Never assume source rIds work in the target.

---

## 9. "Numbered lists show wrong numbers" or "Bullets disappeared"

**Symptom:** Lists that were numbered 1, 2, 3 now show 1, 1, 1 or have no numbers/bullets at all.

**Diagnosis:** `numId` in `pPr` references a numbering definition that doesn't exist in `numbering.xml`, or `abstractNumId` mapping is broken.

```powershell
# Check numbering definitions — num 引用 abstractNumId 的映射都在 numbering.xml
Select-String -Path unpacked/word/numbering.xml -Pattern 'w:num w:numId|w:abstractNumId' | Select-Object -First 10
```

**Fix:** Map source numIds to template numIds, or merge numbering definitions:

合并步骤（手工 XML 操作）：
1. 把源 numbering.xml 中的 `<w:abstractNum>` 定义复制进目标 numbering.xml，`w:abstractNumId` 全部重编号为目标中未占用的值（先扫描目标现有最大值 +1 起）
2. 为每个复制的 abstractNum 新建 `<w:num>`，分配新的 `w:numId` 并指向重编号后的 abstractNumId
3. 更新正文内容中所有 `<w:numId w:val="..."/>` 引用到新 numId

**Prevention:** Include `numbering.xml` reconciliation in template application workflow. 详细的 numId/abstractNumId 两级结构说明见 `references/openxml_element_order.md` 与本文件第 9 条诊断逻辑。

---

## 10. "Page margins/size are wrong"

**Symptom:** Output has different margins, page size, or orientation than the template.

**Diagnosis:** Source document's `sectPr` is overriding the template's `sectPr`. The final `sectPr` (child of `body`) controls the last section's layout.

```powershell
# Compare section properties — sectPr/pgSz/pgMar 直接可在 XML 中比对
Select-String -Path template_unpacked/word/document.xml -Pattern 'w:pgSz|w:pgMar' | Select-Object -First 5
Select-String -Path output_unpacked/word/document.xml -Pattern 'w:pgSz|w:pgMar' | Select-Object -First 5
```

**Fix:** Use the template's final `sectPr`. For intermediate `sectPr` elements (multi-section documents), merge carefully.

```python
# 用模板的最终 sectPr 替换输出文档的最终 sectPr（body 的直接子元素）
import copy
template_sectPr = template_body.find(f'{{{W}}}sectPr')
output_sectPr = output_body.find(f'{{{W}}}sectPr')
if template_sectPr is not None:
    cloned = copy.deepcopy(template_sectPr)
    if output_sectPr is not None:
        output_body.replace(output_sectPr, cloned)
    else:
        output_body.append(cloned)
}
```

**Prevention:** Always use the template's `sectPr` as authority for page layout. Strip source document's `sectPr` before copying content.

---

## 11. "Chinese text renders as boxes/tofu"

**Symptom:** Chinese characters display as square boxes (□□□) or missing glyphs.

**Diagnosis:** `rFonts w:eastAsia` is set to a font that doesn't exist on the system, or is missing entirely. Without an East Asian font declaration, the rendering engine may fall back to a font without CJK coverage.

**Fix:** Ensure all CJK text has `w:eastAsia` set to an available font:

```python
def contains_cjk(text):
    return any('\u4e00' <= c <= '\u9fff' for c in text)

for run in body.iter(f'{{{W}}}r'):
    text = ''.join(t.text or '' for t in run.iter(f'{{{W}}}t'))
    if not contains_cjk(text):
        continue
    rPr = run.find(f'{{{W}}}rPr')
    if rPr is None:
        rPr = etree.Element(f'{{{W}}}rPr')
        run.insert(0, rPr)  # rPr 必须是 w:r 的第一个子元素
    rFonts = rPr.find(f'{{{W}}}rFonts')
    if rFonts is None:
        rFonts = etree.SubElement(rPr, f'{{{W}}}rFonts')
    # Set to a universally available CJK font
    rFonts.set(f'{{{W}}}eastAsia', 'SimSun')  # 宋体 — safest default
```

Common safe CJK fonts: 宋体 (SimSun), 黑体 (SimHei), 仿宋 (FangSong), 楷体 (KaiTi).

**Prevention:** When cleaning `rPr` formatting, ALWAYS preserve `w:eastAsia` font declarations. See also `references/cjk_typography.md`.

---

## 12. "Template's cover page / declaration page is missing"

**Symptom:** Output document starts directly with body content — no cover page, no declaration, no abstract, no table of contents. The template's structural front matter was discarded.

**Diagnosis:** Used Overlay (C-1) strategy when Base-Replace (C-2) was needed. Overlay applies styles to the source document but discards the template's structural content (cover, declaration, abstract, TOC).

```powershell
# Check template structure — 统计 body 顶层元素数并浏览（见 scenario_c 的 structure scan 脚本）
# If template has >50 paragraphs with cover/TOC/declaration, C-2 is needed
```

**Fix:** Use Base-Replace (C-2) strategy — template is the base, only replace the example body content zone with the user's content:

1. Identify the template's "body zone" (everything between TOC and final sectPr)
2. Remove the template's example body content
3. Insert the user's content into the body zone
4. Keep everything else from the template (cover, declaration, abstract, TOC, sectPr)

手工执行：以解包后的 template 为底包，按 `references/scenario_c_apply_template.md` 的
Base-Replace 步骤把用户内容（清理直接格式、映射 styleId、重映射 rId）插入 Zone B 边界之间，
最后用 scripts/pack.py 重打包 + validate.py 校验。

**Prevention:** Analyze template structure FIRST. If template has structural content (cover, TOC, declaration sections), always use C-2 (Base-Replace). Read `references/scenario_c_apply_template.md` for detailed decision criteria.

---

## 13. "Track changes markers appear unexpectedly"

**Symptom:** Output shows red/green revision marks (insertions, deletions) that weren't in the source document.

**Diagnosis:** Template had track changes enabled, or content was inserted as revisions rather than normal text.

```powershell
# Check for revision marks
Select-String -Path unpacked/word/document.xml -Pattern '<w:ins |<w:del ' | Select-Object -First 5
```

**Fix:** Accept all revisions by flattening `w:ins` and `w:del` elements:

```python
# 注意：本 skill 自带 scripts/accept_changes.py 可自动完成此操作（依赖 LibreOffice，先 probe）。
# 手工版本——接受插入：解开 w:ins 包装，保留内容；接受删除：整个移除 w:del
for ins in list(body.iter(f'{{{W}}}ins')):
    parent = ins.getparent()
    index = parent.index(ins)
    for child in list(ins):
        parent.insert(index, child)
        index += 1
    parent.remove(ins)

for dele in list(body.iter(f'{{{W}}}del')):
    dele.getparent().remove(dele)
```

Or disable tracking in settings:

删除 `word/settings.xml` 中的 `<w:trackChanges/>` 元素。

**Prevention:** Check template's `settings.xml` for `trackChanges` before starting. If present, accept all revisions in the template first.

---

## Recovery Strategy — When Multiple Issues Exist

When a document has multiple problems, fix them in this priority order:

```
1. [Content_Types].xml  — without this, nothing opens
2. _rels/.rels          — package relationships
3. word/_rels/document.xml.rels — part relationships (images, hyperlinks)
4. word/document.xml    — element ordering（对照 references/openxml_element_order.md 手工修复）
5. word/styles.xml      — style definitions and styleId mapping
6. word/numbering.xml   — list/numbering definitions
7. Everything else      — headers, footers, comments, settings
```

```powershell
# Full recovery pipeline
& python.exe scripts\unpack.py broken.docx unpacked/
& python.exe scripts\office\validate.py broken.docx     # 列出全部 XSD 错误
# 对照 references/openxml_element_order.md 手工修复元素顺序
# 对照 scenario_c 的业务规则核查清单逐项核查
# 修复后重打包再验证；LibreOffice 可用时渲染 PDF 做视觉检查（见 SKILL.md 验证产出）
& python.exe scripts\pack.py unpacked/ fixed.docx
& python.exe scripts\office\validate.py fixed.docx
```
