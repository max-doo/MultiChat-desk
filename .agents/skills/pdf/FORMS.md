# PDF 表单填写指南

**关键纪律：必须按顺序完成以下步骤，不要跳步直接写代码。**

下文所有 `<python>` 指 ensure-python.mjs 输出的 pythonExe 绝对路径；脚本路径相对于本技能目录。

填写 PDF 表单前，先检查 PDF 是否有可填写表单域：

```powershell
<python> scripts/check_fillable_fields.py <file.pdf>
```

根据结果进入"可填写域"或"不可填写域"分支。

# 可填写域

PDF 有可填写表单域时：

- 抽取域信息：

```powershell
<python> scripts/extract_form_field_info.py <input.pdf> <field_info.json>
```

生成的 JSON 格式如下：

```
[
  {
    "field_id": (域唯一 ID),
    "page": (页码，1 起),
    "rect": ([left, bottom, right, top] 包围盒，PDF 坐标系，y=0 在页面底部),
    "type": ("text"、"checkbox"、"radio_group" 或 "choice"),
  },
  // 复选框带 checked_value 和 unchecked_value：
  {
    "field_id": (域唯一 ID),
    "page": (页码，1 起),
    "type": "checkbox",
    "checked_value": (赋值此值=勾选),
    "unchecked_value": (赋值此值=取消勾选),
  },
  // 单选组带 radio_options 可选列表：
  {
    "field_id": (域唯一 ID),
    "page": (页码，1 起),
    "type": "radio_group",
    "radio_options": [
      {
        "value": (赋值此值=选中该选项),
        "rect": (该选项单选按钮的包围盒)
      },
    ]
  },
  // 多选域带 choice_options：
  {
    "field_id": (域唯一 ID),
    "page": (页码，1 起),
    "type": "choice",
    "choice_options": [
      {
        "value": (赋值此值=选中该选项),
        "text": (选项显示文本)
      },
    ],
  }
]
```

- 把 PDF 转成 PNG（每页一张）：

```powershell
<python> scripts/convert_pdf_to_images.py <file.pdf> <output_directory>
```

逐张分析图片，判断每个表单域的用途（注意把包围盒的 PDF 坐标换算到图片坐标）。

- 按以下格式创建 `field_values.json`，填入各域的值：

```
[
  {
    "field_id": "last_name", // 必须与 extract_form_field_info.py 输出的 field_id 一致
    "description": "用户的姓",
    "page": 1, // 必须与 field_info.json 中的 page 一致
    "value": "张"
  },
  {
    "field_id": "Checkbox12",
    "description": "年满 18 岁勾选框",
    "page": 1,
    "value": "/On" // 复选框用其 checked_value 勾选；单选组用 radio_options 中的某个 value
  },
]
```

- 运行填充脚本生成填好的 PDF：

```powershell
<python> scripts/fill_fillable_fields.py <input pdf> <field_values.json> <output pdf>
```

脚本会校验你给的域 ID 和值是否合法；报错就修正对应字段重试。

**中文值注意**：域的**值**会正确写入（读取 `/V` 验证无误），但 AcroForm 外观渲染依赖表单自带字体，多数表单只声明西文 base-14 字体——中文在部分查看器中可能显示为空白或方框。填写含中文的表单后**必须**用 `convert_pdf_to_images.py` 渲染验收；若外观确实缺失，缓解方式是 `auto_regenerate=True`（pypdf 生成外观，但中文仍受字体限制）或改为不可填写域的注解填写路径（`fill_pdf_form_with_annotations.py`，文字画在页面上不受表单字体限制）。如实告知用户该限制与最终渲染效果。

# 不可填写域

PDF 没有表单域时，用文本注解方式填写。先尝试从 PDF 结构抽取坐标（更精确），失败再退回视觉估算。

## 第一步：先做结构抽取

抽取文本标签、横线、复选框及其精确 PDF 坐标：

```powershell
<python> scripts/extract_form_structure.py <input.pdf> form_structure.json
```

生成的 JSON 含：

- **labels**：每个文本元素及精确坐标（x0, top, x1, bottom，单位 PDF 点）
- **lines**：界定行边界的横线
- **checkboxes**：小方形复选框（含中心坐标）
- **row_boundaries**：由横线算出的行顶部/底部位置

**检查结果**：`form_structure.json` 中有意义的 labels（能对应表单字段的文本）存在，走**路径 A：结构坐标**。PDF 是扫描件/图片型、labels 极少或没有，走**路径 B：视觉估算**。

---

## 路径 A：结构坐标（优先）

`extract_form_structure.py` 找到文本标签时使用。

### A.1：分析结构

读 form_structure.json 并识别：

1. **标签组**：相邻文本元素组成的完整标签（如"姓"+"名"）
2. **行结构**：`top` 值相近的标签在同一行
3. **字段列**：填写区从标签结束后开始（x0 = 标签 x1 + 间隙）
4. **复选框**：直接用结构中的复选框坐标

**坐标系**：PDF 坐标，y=0 在页面**顶部**，y 向下增长（extract_form_structure 输出的坐标系）。

### A.2：检查遗漏元素

结构抽取可能漏掉部分表单元素。常见情况：

- **圆形复选框**：只有方形会被识别为复选框
- **复杂图形**：装饰元素或非标准表单控件
- **浅色/淡化元素**：可能没被抽出

如果在 PDF 图片里看到 form_structure.json 中没有的表单字段，对那些字段用**视觉分析**（见下文"混合路径"）。

### A.3：用 PDF 坐标创建 fields.json

逐字段从抽取结构计算填写区坐标：

**文本字段：**

- 填写区 x0 = 标签 x1 + 5（标签后留小间隙）
- 填写区 x1 = 下一个标签的 x0，或行边界
- 填写区 top = 与标签 top 相同
- 填写区 bottom = 下方行边界线，或标签 bottom + 行高

**复选框：**

- 直接用 form_structure.json 中的复选框矩形坐标
- entry_bounding_box = [checkbox.x0, checkbox.top, checkbox.x1, checkbox.bottom]

用 `pdf_width`/`pdf_height` 创建 fields.json（标记 PDF 坐标系）：

```json
{
  "pages": [
    {"page_number": 1, "pdf_width": 612, "pdf_height": 792}
  ],
  "form_fields": [
    {
      "page_number": 1,
      "description": "姓填写区",
      "field_label": "姓",
      "label_bounding_box": [43, 63, 87, 73],
      "entry_bounding_box": [92, 63, 260, 79],
      "entry_text": {"text": "张", "font_size": 10}
    },
    {
      "page_number": 1,
      "description": "中国国籍-是 复选框",
      "field_label": "是",
      "label_bounding_box": [260, 200, 280, 210],
      "entry_bounding_box": [285, 197, 292, 205],
      "entry_text": {"text": "X"}
    }
  ]
}
```

**重要**：用 `pdf_width`/`pdf_height`，坐标直接取 form_structure.json 的值。

### A.4：校验包围盒

填充前检查包围盒错误：

```powershell
<python> scripts/check_bounding_boxes.py fields.json
```

检查相交包围盒和对字号来说过小的填写区。修好所有报错再填充。

---

## 路径 B：视觉估算（兜底）

PDF 为扫描件/图片型、结构抽取拿不到可用文本标签（如全部显示为 "(cid:X)"）时使用。

### B.1：PDF 转图片

```powershell
<python> scripts/convert_pdf_to_images.py <input.pdf> <images_dir/>
```

### B.2：初步字段识别

逐页查看图片，识别表单分区并粗估字段位置：

- 字段标签及其大致位置
- 填写区（横线、方框或留白）
- 复选框及其大致位置

逐字段记录大致像素坐标（此阶段不求精确）。

### B.3：放大细化（精度的关键）

逐字段裁剪估算位置周边区域，精化坐标。**用 Pillow 裁剪**（无需 ImageMagick）：

```python
from PIL import Image
img = Image.open("images_dir/page_1.png")
# (left, top, right, bottom)，在粗估值四周各留约 50px 余量
crop = img.crop((50, 120, 350, 200))
crop.save("crops/name_field.png")
```

**查看裁剪图**确定精确坐标：

1. 填写区起点（标签结束后）的精确像素
2. 填写区终点（下一字段或边缘前）
3. 填写线/框的顶边与底边

**裁剪坐标换算回整图坐标：**

- full_x = crop_x + crop_offset_x
- full_y = crop_y + crop_offset_y

例：裁剪起点 (50, 120)，填写框在裁剪图内起点 (52, 18)：

- entry_x0 = 52 + 50 = 102
- entry_top = 18 + 120 = 138

**逐字段重复**，邻近字段可合并到一张裁剪图里。

### B.4：用精化坐标创建 fields.json

用 `image_width`/`image_height`（标记图片坐标系）：

```json
{
  "pages": [
    {"page_number": 1, "image_width": 1700, "image_height": 2200}
  ],
  "form_fields": [
    {
      "page_number": 1,
      "description": "姓填写区",
      "field_label": "姓",
      "label_bounding_box": [120, 175, 242, 198],
      "entry_bounding_box": [255, 175, 720, 218],
      "entry_text": {"text": "张", "font_size": 10}
    }
  ]
}
```

**重要**：用 `image_width`/`image_height`，坐标为放大分析精化后的像素值。

### B.5：校验包围盒

同 A.4：`<python> scripts/check_bounding_boxes.py fields.json`，修好报错再继续。

---

## 混合路径：结构 + 视觉

结构抽取覆盖了大部分字段、但漏掉个别元素（圆形复选框、非常规控件）时使用：

1. 被抽到的字段走**路径 A**
2. **PDF 转图片**用于遗漏字段的视觉分析
3. 遗漏字段用**放大细化**（路径 B 的方法）
4. **合并坐标**：结构字段用 `pdf_width`/`pdf_height`；视觉估算字段必须把图片坐标换算成 PDF 坐标：
   - pdf_x = image_x * (pdf_width / image_width)
   - pdf_y = image_y * (pdf_height / image_height)
5. fields.json 统一用**一种坐标系**——全部换算为 PDF 坐标配 `pdf_width`/`pdf_height`

---

## 第二步：填充前校验

**填充前必做包围盒校验：**

```powershell
<python> scripts/check_bounding_boxes.py fields.json
```

检查项：相交包围盒（会导致文字重叠）、对字号过小的填写区。修好 fields.json 再继续。

## 第三步：填充表单

填充脚本自动识别坐标系并换算：

```powershell
<python> scripts/fill_pdf_form_with_annotations.py <input.pdf> fields.json <output.pdf>
```

**原子写回纪律**：输出文件必须写到新路径（不要覆盖用户原文件）；如需替换原文件，先输出到同卷临时文件、验证通过后再替换。

## 第四步：验收产出

把填好的 PDF 转图片，核对文字落位：

```powershell
<python> scripts/convert_pdf_to_images.py <output.pdf> <verify_images/>
```

文字错位时：

- **路径 A**：检查是否用了 form_structure.json 的 PDF 坐标配 `pdf_width`/`pdf_height`
- **路径 B**：检查图片尺寸是否匹配、坐标是否为精确像素
- **混合路径**：检查视觉估算字段的坐标换算是否正确
