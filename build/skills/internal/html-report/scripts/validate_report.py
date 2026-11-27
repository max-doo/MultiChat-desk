#!/usr/bin/env python3
"""
Static security, self-containment, contrast, and editorial design validator
for visual HTML reports.
Enforces magazine-grade craft: zero scripts, WCAG AAA contrast, editorial SVG
scale/color restraint, and zero-card layout discipline.
"""

import os
import re
import sys

# 中文 Windows 控制台默认 GBK，中文/符号输出会乱码——统一按 UTF-8 输出
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ('utf-8', 'utf8'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

PROHIBITED_H2_TERMS = [
    "引言", "概述", "方法论", "总结", "前言", "结论", "背景", "结语", "附录",
    "introduction", "overview", "methodology", "conclusion", "summary", "background"
]

NUMBERED_PREFIX_PATTERN = re.compile(
    r'^\s*(?:\d+[\.、·/]|第[一二三四五六七八九十0-9]+[章节篇]|step\s*\d+)',
    re.IGNORECASE
)

HEX_COLOR_RE = re.compile(r'^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$')


def hex_to_rgb(hex_str: str) -> tuple[int, int, int] | None:
    hex_str = hex_str.strip()
    m = HEX_COLOR_RE.match(hex_str)
    if not m:
        return None
    val = m.group(1)
    if len(val) == 3:
        val = "".join(c * 2 for c in val)
    return int(val[0:2], 16), int(val[2:4], 16), int(val[4:6], 16)


def relative_luminance(hex_str: str) -> float | None:
    rgb = hex_to_rgb(hex_str)
    if rgb is None:
        return None
    channels = []
    for c in rgb:
        s = c / 255.0
        channels.append(s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4)
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]


def contrast_ratio(hex_a: str, hex_b: str) -> float | None:
    la = relative_luminance(hex_a)
    lb = relative_luminance(hex_b)
    if la is None or lb is None:
        return None
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def extract_root_vars(content: str) -> dict[str, str]:
    root_match = re.search(r':root\s*\{([^}]+)\}', content, re.DOTALL | re.IGNORECASE)
    if not root_match:
        return {}
    block = root_match.group(1)
    vars_map = {}
    for m in re.finditer(r'(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);', block):
        vars_map[m.group(1).strip()] = m.group(2).strip()
    return vars_map


def parse_attr(tag_str: str, attr: str) -> str | None:
    m = re.search(rf'\b{attr}\s*=\s*["\']([^"\']+)["\']', tag_str, re.IGNORECASE)
    return m.group(1).strip() if m else None


def validate_html(filepath: str) -> tuple[bool, list[str], list[str]]:
    if not os.path.exists(filepath):
        return False, [f"File not found: {filepath}"], []

    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    errors = []
    warnings = []

    # 1. Static Security Hard Constraints (Zero Compromise)
    if re.search(r'<\s*script\b', content, re.IGNORECASE):
        errors.append("禁止出现 <script> 标签（必须为纯静态展示）。")

    if re.search(r'\bon[a-z]+\s*=', content, re.IGNORECASE):
        errors.append("禁止出现内联事件处理器（如 onclick=, onload= 等）。")

    if re.search(r'href\s*=\s*["\']javascript:', content, re.IGNORECASE):
        errors.append("禁止出现 javascript: 伪协议链接。")

    interactive_tags = re.findall(r'<\s*(iframe|form|input|button)\b', content, re.IGNORECASE)
    if interactive_tags:
        errors.append(f"禁止包含可交互控件或框架标签: {set(interactive_tags)}。")

    # 2. Self-containment & External Resources (Only Google Fonts allowed)
    external_urls = re.findall(
        r'<(?:img|link|source|video|audio)\b[^>]*?(?:src|href)\s*=\s*["\'](https?://[^"\']+)["\']',
        content,
        re.IGNORECASE
    )
    for url in external_urls:
        if not ("fonts.googleapis.com" in url or "fonts.gstatic.com" in url):
            errors.append(f"禁止外部远程资源链接（仅允许 Google Fonts）: {url}。请将本地资产内联为 Base64 Data URI。")

    local_imgs = re.findall(r'<img\b[^>]*?\bsrc=["\']([^"\']+)["\']', content, re.IGNORECASE)
    for img_src in local_imgs:
        if not img_src.startswith("data:"):
            errors.append(f"图片未完成 Base64 内联封装: <img src='{img_src}'>。请运行 inline_assets.py。")

    # 3. Minimum Font Size (Global minimum >= 11px across CSS & SVG)
    css_font_sizes = re.findall(r'font-size\s*:\s*(\d+(?:\.\d+)?)\s*px', content, re.IGNORECASE)
    for fs in css_font_sizes:
        val = float(fs)
        if val < 11.0:
            errors.append(f"CSS 中检测到小于 11px 的字体规则 (font-size: {fs}px)。底线约束字号必须 >= 11px。")

    svg_font_sizes = re.findall(r'<[^>]+font-size=["\'](\d+(?:\.\d+)?)["\']', content, re.IGNORECASE)
    for fs in svg_font_sizes:
        val = float(fs)
        if val < 11.0:
            errors.append(f"SVG 图表中检测到小于 11px 的字体 (font-size='{fs}')。底线约束刻度与标签必须 >= 11px。")

    # 4. Real WCAG Contrast & Surface Hierarchy Verification
    root_vars = extract_root_vars(content)
    paper_hex = root_vars.get("--paper")
    band_hex = root_vars.get("--band")
    paper_lum = relative_luminance(paper_hex) if paper_hex else None

    if paper_hex and paper_lum is not None:
        if not band_hex:
            warnings.append("`:root` 未定义 `--band` 次级过渡底色变量，建议配备同色系浅一阶底色以形成细腻表面层级。")
        text_tokens = ["--ink", "--ink2", "--mute", "--accent-text", "--accent-2-text"]
        for tok in text_tokens:
            fg_hex = root_vars.get(tok)
            if not fg_hex:
                continue
            cr_paper = contrast_ratio(fg_hex, paper_hex)
            if cr_paper is not None:
                if cr_paper < 4.5:
                    errors.append(f"WCAG 对比度严重不足：{tok} ({fg_hex}) 在 --paper ({paper_hex}) 上仅 {cr_paper:.2f}:1（最低硬底线 7.0:1）。")
                elif cr_paper < 7.0:
                    errors.append(f"未满足 WCAG AAA 对比度底线：{tok} ({fg_hex}) 在 --paper ({paper_hex}) 上为 {cr_paper:.2f}:1（要求 >= 7.0:1）。")
            if band_hex:
                cr_band = contrast_ratio(fg_hex, band_hex)
                if cr_band is not None and cr_band < 6.5:
                    warnings.append(f"过渡带对比度偏低：{tok} ({fg_hex}) 在 --band ({band_hex}) 上为 {cr_band:.2f}:1（建议 >= 6.5:1）。")

    # 5. Layout Container & Typography Hygiene
    if not re.search(r'max-width\s*:\s*(?:1[1-5]\d\d)px', content, re.IGNORECASE):
        warnings.append("未检测到页面级最大宽度容器（推荐 `.page { max-width: 1360px–1440px; margin: 0 auto; }`），宽屏显示器上网格与图表可能过度拉伸。")

    # 6. Heading Rules (Opinionated H2 and No Numbered Prefixes inside H2)
    h2_matches = re.findall(r'<h2\b[^>]*>(.*?)</h2>', content, re.DOTALL | re.IGNORECASE)
    for h2 in h2_matches:
        clean_h2 = re.sub(r'<[^>]+>', '', h2).strip()
        lower_h2 = clean_h2.lower()

        for term in PROHIBITED_H2_TERMS:
            if lower_h2 == term or lower_h2 == f"{term}：" or lower_h2 == f"{term}:":
                errors.append(f"h2 标题严禁使用模板化空标题 '{clean_h2}'，必须写成传递观点的完整陈述句。")

        if NUMBERED_PREFIX_PATTERN.match(clean_h2):
            warnings.append(f"h2 标题检测到章节编号前缀 '{clean_h2}'，建议移除编号直接陈述结论（可将语境移至 `.sec-kicker`）。")

    # 7. Quantity, Card Discipline & Table Hygiene
    tables = re.findall(r'<table\b', content, re.IGNORECASE)
    if len(tables) > 8:
        warnings.append(f"全篇表格数量较多（检测到 {len(tables)} 个），建议精炼避免阅读疲劳。")
    if tables and not re.search(r'white-space\s*:\s*nowrap', content, re.IGNORECASE):
        warnings.append("检测到表格但 CSS 未定义 `white-space: nowrap`（建议为 `.num` 与短主键列 `.lead` 防折行）。")

    signature_bands = re.findall(r'class=["\'][^"\']*\b(?:pull-band|band-dark)\b[^"\']*["\']', content, re.IGNORECASE)
    if len(signature_bands) > 2:
        warnings.append(f"通栏高潮带较多: 检测到 {len(signature_bands)} 处，规范建议克制在 1 处。")

    if paper_lum is not None and paper_lum > 0.7 and re.search(r'class=["\'][^"\']*\bband-dark\b', content, re.IGNORECASE):
        warnings.append("亮色画布中检测到 `.band-dark` 深黑通栏：若属深研/学术/商业长文，建议优先改用同色系 `.pull-band` 避免视觉亮度剧烈跳变。")

    card_classes = re.findall(r'class=["\'][^"\']*\bcard\b[^"\']*["\']', content, re.IGNORECASE)
    if card_classes:
        warnings.append("检测到可疑卡片类名 (.card)。规范要求全域遵循零卡片开放网格。")

    # 8. Editorial SVG Quality, Scale & Color Restraint Checks
    svg_texts = re.findall(r'<text\b[^>]*>(.*?)</text>', content, re.DOTALL | re.IGNORECASE)
    for st in svg_texts:
        if "//" in st:
            errors.append(f"SVG 文本标签中检测到禁止的 '//' 分隔符: '{st.strip()}'。")

    svgs = re.findall(r'(<svg\b[^>]*>)(.*?)</svg>', content, re.DOTALL | re.IGNORECASE)
    is_light_canvas = paper_lum is None or paper_lum > 0.6

    for idx, (svg_open, svg_body) in enumerate(svgs, 1):
        if re.search(r'display\s*:\s*none', svg_open, re.IGNORECASE):
            continue
        vb = parse_attr(svg_open, "viewBox")
        if vb:
            parts = [p for p in re.split(r'[\s,]+', vb) if p]
            if len(parts) == 4:
                try:
                    vb_w = float(parts[2])
                    if vb_w < 800:
                        warnings.append(
                            f"第 {idx} 个 SVG 的 viewBox 宽度偏窄（{vb_w:.0f}px < 800px）：在 1440px 桌面端会被等比放大 >1.5x 导致字体笨重，推荐设为 860–960。"
                        )
                except ValueError:
                    pass

        # Check for jarring heavy solid dark rectangles inside light-canvas SVGs
        rects = re.findall(r'<rect\b[^>]*>', svg_body, re.IGNORECASE)
        bar_fills = set()
        bar_count = 0
        for rect_tag in rects:
            fill = parse_attr(rect_tag, "fill")
            w_str = parse_attr(rect_tag, "width")
            h_str = parse_attr(rect_tag, "height")
            if not (fill and w_str and h_str):
                continue
            try:
                rw, rh = float(w_str), float(h_str)
            except ValueError:
                continue

            if is_light_canvas and HEX_COLOR_RE.match(fill):
                flum = relative_luminance(fill)
                if flum is not None and flum < 0.04 and (rw * rh) >= 4000:
                    warnings.append(
                        f"第 {idx} 个 SVG 中检测到高面积深黑实心矩形（fill='{fill}', {rw:.0f}x{rh:.0f}），易产生突兀重色；建议改用浅色带 + 单边定位色条或主色外环。"
                    )

            # Heuristic for horizontal bar-chart data bars (height 14..36, width >= 15)
            if 14 <= rh <= 36 and rw >= 15 and HEX_COLOR_RE.match(fill):
                bar_count += 1
                bar_fills.add(fill.upper())

        if bar_count >= 4 and len(bar_fills) >= 4:
            warnings.append(
                f"第 {idx} 个 SVG 柱状图检测到 {len(bar_fills)} 种不同柱条填色（疑似无语义多色编码），建议同类序列统一主色，仅对关键异动项使用语义辅色。"
            )

    # 9. Three-layer Figure Anatomy Checks
    figures = re.findall(r'<figure\b[^>]*>(.*?)</figure>', content, re.DOTALL | re.IGNORECASE)
    for fig in figures:
        if not re.search(r'class=["\'][^"\']*\bfig-title\b[^"\']*["\']', fig, re.IGNORECASE):
            warnings.append("检测到 <figure> 缺少带动词结论句的 .fig-title 标题。")
        if not re.search(r'class=["\'][^"\']*\bfig-sub\b[^"\']*["\']', fig, re.IGNORECASE):
            warnings.append("检测到 <figure> 缺少顶部读图导语副标题（.fig-sub），建议补充坐标轴或阅读视角说明。")
        if not re.search(r'<figcaption\b', fig, re.IGNORECASE):
            warnings.append("检测到 <figure> 缺少注明单位与数据来源的 <figcaption>。")

    is_valid = len(errors) == 0
    return is_valid, errors, warnings


def main():
    if len(sys.argv) < 2:
        print("Usage: python validate_report.py <report.html>")
        sys.exit(1)

    target_file = sys.argv[1]
    is_valid, errors, warnings = validate_html(target_file)

    print("\n================ 报告静态规范与视觉纪律校验报告 ================")
    print(f"目标文件: {target_file}")

    if warnings:
        print(f"\n[视觉与排版优化建议 ({len(warnings)})]:")
        for w in warnings:
            print(f"  ▲ {w}")

    if errors:
        print(f"\n[致命校验错误 ({len(errors)})]:")
        for e in errors:
            print(f"  ✖ {e}")
        print("\n校验状态: 失败 (FAILED) - 请修正上述硬约束缺陷后重试。")
        sys.exit(1)
    else:
        print("\n[全部硬底线检查通过]: 纯静态安全、单文件自包含、WCAG AAA 对比度与排版规范达标！")
        print("校验状态: 成功 (PASSED)")
        sys.exit(0)


if __name__ == "__main__":
    main()
