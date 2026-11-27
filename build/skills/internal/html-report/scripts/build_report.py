#!/usr/bin/env python3
"""
Build pipeline tool for visual reports.
Steps:
  1. Inline local image assets into Base64 Data URIs
  2. Validate report according to static, WCAG contrast & editorial design rules
  3. Optional (--visual-audit): Render via headless Playwright at 1440px to detect
     SVG text clipping/overlaps, oversized SVG scaling, short table-cell wrapping,
     and horizontal overflow.
"""

import argparse
import os
import pathlib
import sys

from inline_assets import inline_images
from validate_report import validate_html

# 中文 Windows 控制台默认 GBK，中文/符号输出会乱码——统一按 UTF-8 输出
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ('utf-8', 'utf8'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass


def run_visual_audit(html_path: str, screenshots_dir: str | None = None) -> tuple[bool, list[str]]:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("[Visual Audit] 未检测到 Playwright，已跳过渲染级审计（安装 playwright 可启用）。")
        return True, []

    abs_uri = pathlib.Path(os.path.abspath(html_path)).as_uri()
    findings = []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 960}, device_scale_factor=1.5)
        page.goto(abs_uri, wait_until="networkidle")
        page.wait_for_timeout(600)

        audit = page.evaluate("""() => {
            const overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth + 2;

            // 1. Audit visible SVGs for clipping, text overlaps, and rendered font-size scale
            const svgs = Array.from(document.querySelectorAll('svg')).filter(s => {
                const r = s.getBoundingClientRect();
                return r.width > 10 && r.height > 10;
            });

            const svgReports = svgs.map((s, idx) => {
                const r = s.getBoundingClientRect();
                const vb = s.getAttribute('viewBox') || '';
                const vbParts = vb.trim().split(/[\\s,]+/).map(Number);
                const scaleX = (vbParts.length === 4 && vbParts[2] > 0) ? (r.width / vbParts[2]) : 1;

                const texts = Array.from(s.querySelectorAll('text'));
                let clipped = [];
                let overlaps = [];
                let renderedSizes = [];

                const boxes = texts.map(t => {
                    const tr = t.getBoundingClientRect();
                    const fs = parseFloat(getComputedStyle(t).fontSize) || 12;
                    const effFs = fs * scaleX;
                    renderedSizes.push(effFs);
                    return { text: (t.textContent || '').trim(), rect: tr };
                });

                for (const b of boxes) {
                    const tr = b.rect;
                    if (tr.width === 0 || tr.height === 0) continue;
                    if (tr.right > r.right + 3 || tr.left < r.left - 3 || tr.bottom > r.bottom + 3 || tr.top < r.top - 3) {
                        clipped.push(b.text.slice(0, 24));
                    }
                }

                for (let i = 0; i < boxes.length; i++) {
                    for (let j = i + 1; j < boxes.length; j++) {
                        const a = boxes[i].rect, b = boxes[j].rect;
                        if (a.width === 0 || b.width === 0) continue;
                        const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                        const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                        if (ix > 2 && iy > 2) {
                            overlaps.push(`${boxes[i].text.slice(0, 14)} <-> ${boxes[j].text.slice(0, 14)}`);
                        }
                    }
                }

                const minEff = renderedSizes.length ? Math.min(...renderedSizes) : 0;
                const maxEff = renderedSizes.length ? Math.max(...renderedSizes) : 0;
                return { idx: idx + 1, scaleX: Number(scaleX.toFixed(2)), clipped, overlaps, minEff: Number(minEff.toFixed(1)), maxEff: Number(maxEff.toFixed(1)) };
            });

            // 2. Audit short first-column table cells (<= 6 chars without <br>) for ugly wrapping
            const wrappedLeadCells = [];
            document.querySelectorAll('table tbody tr').forEach(tr => {
                const td = tr.querySelector('td');
                if (!td) return;
                if (td.querySelector('br')) return;
                const txt = (td.textContent || '').trim();
                if (txt.length >= 2 && txt.length <= 6) {
                    const st = getComputedStyle(td);
                    const lh = parseFloat(st.lineHeight) || 22;
                    const padTop = parseFloat(st.paddingTop) || 0;
                    const padBot = parseFloat(st.paddingBottom) || 0;
                    const contentH = td.getBoundingClientRect().height - padTop - padBot;
                    if (contentH > lh * 1.65) {
                        wrappedLeadCells.push(txt);
                    }
                }
            });

            return {
                overflowX,
                docHeight: document.documentElement.scrollHeight,
                svgReports,
                wrappedLeadCells
            };
        }""")

        if audit["overflowX"]:
            findings.append("页面存在横向溢出（scrollWidth > clientWidth），请检查宽表格或负边距通栏设置。")

        for sr in audit["svgReports"]:
            if sr["clipped"]:
                findings.append(f"SVG #{sr['idx']} 存在文字越界裁切: {sr['clipped'][:3]}")
            if sr["overlaps"]:
                findings.append(f"SVG #{sr['idx']} 存在文字框重叠: {sr['overlaps'][:3]}")
            if sr["scaleX"] > 1.55:
                findings.append(f"SVG #{sr['idx']} 桌面端放大倍率偏高（{sr['scaleX']}x，渲染最大字号 {sr['maxEff']}px），建议调宽 viewBox 至 860–960。")
            if sr["minEff"] > 0 and sr["minEff"] < 11.0:
                findings.append(f"SVG #{sr['idx']} 渲染后最小等效字号仅 {sr['minEff']}px（< 11px）。")

        if audit["wrappedLeadCells"]:
            sample = ", ".join(audit["wrappedLeadCells"][:5])
            findings.append(f"表格首列存在短词异常折行（建议添加 `.lead` 类防折行）: {sample}")

        if screenshots_dir:
            os.makedirs(screenshots_dir, exist_ok=True)
            base = os.path.splitext(os.path.basename(html_path))[0]
            page.evaluate("window.scrollTo(0, 0)")
            page.wait_for_timeout(150)
            page.screenshot(path=os.path.join(screenshots_dir, f"{base}_hero.png"))
            page.screenshot(path=os.path.join(screenshots_dir, f"{base}_full.png"), full_page=True)
            print(f"[Visual Audit] 已输出验证截图至: {screenshots_dir}")

        browser.close()

    return len(findings) == 0, findings


def build_report(src_path: str, out_path: str = None, strict: bool = True,
                 visual_audit: bool = False, screenshots_dir: str | None = None) -> bool:
    if out_path is None:
        out_path = src_path

    print(f"--- 阶段 1: 资产内联处理 ({src_path} -> {out_path}) ---")
    inline_images(src_path, out_path)

    print(f"\n--- 阶段 2: 静态规范、对比度与重色校验 ({out_path}) ---")
    is_valid, errors, warnings = validate_html(out_path)

    if warnings:
        print(f"[视觉与排版优化建议 ({len(warnings)})]:")
        for w in warnings:
            print(f"  ▲ {w}")

    if errors:
        print(f"[致命错误 ({len(errors)})]:")
        for e in errors:
            print(f"  ✖ {e}")
        if strict:
            print("\n构建失败: 未通过静态安全与设计规范校验。")
            return False

    if visual_audit:
        print(f"\n--- 阶段 3: Playwright 渲染级视觉审计 ({out_path}) ---")
        audit_ok, audit_findings = run_visual_audit(out_path, screenshots_dir=screenshots_dir)
        if audit_findings:
            print(f"[渲染审计告警 ({len(audit_findings)})]:")
            for item in audit_findings:
                print(f"  ▲ {item}")
        else:
            print("[渲染审计通过]: 零横向溢出、零 SVG 文字裁切/重叠、零表格短词折行。")

    size_bytes = os.path.getsize(out_path)
    size_kb = size_bytes / 1024.0

    print("\n--- 构建成功 ---")
    print(f"交付文件: {out_path}")
    print(f"文件大小: {size_kb:.2f} KB (自包含单文件)")
    print("离线查看: 浏览器直接双击即可打开分享")
    return True


def main():
    parser = argparse.ArgumentParser(description="Build and validate a self-contained visual report")
    parser.add_argument("input", help="Source HTML file path")
    parser.add_argument("output", nargs="?", default=None, help="Output HTML file path (optional, overwrites input if omitted)")
    parser.add_argument("--no-strict", action="store_true", help="Do not exit with error on validation failures")
    parser.add_argument("--visual-audit", action="store_true", help="Run Playwright headless visual audit at 1440px")
    parser.add_argument("--screenshots-dir", default=None, help="Optional directory to save audit screenshots (requires --visual-audit)")
    args = parser.parse_args()

    success = build_report(
        args.input,
        args.output,
        strict=not args.no_strict,
        visual_audit=args.visual_audit,
        screenshots_dir=args.screenshots_dir,
    )
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
