#!/usr/bin/env python3
"""
Converts local image references in an HTML report into Base64 Data URIs,
guaranteeing a 100% self-contained single-file HTML report.
"""

import base64
import mimetypes
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

def inline_images(src_path: str, out_path: str = None) -> str:
    if out_path is None:
        out_path = src_path

    base_dir = os.path.dirname(os.path.abspath(src_path))

    with open(src_path, "r", encoding="utf-8") as f:
        html_content = f.read()

    def replace_src(match):
        prefix = match.group(1)
        filepath = match.group(2).strip()
        suffix = match.group(3)

        # Ignore data URIs or already-remote URLs (though remote non-font URLs violate static spec)
        if filepath.startswith("data:") or filepath.startswith("http://") or filepath.startswith("https://"):
            return match.group(0)

        # Resolve local file path
        resolved_path = filepath
        if not os.path.isabs(resolved_path):
            candidate = os.path.join(base_dir, filepath)
            if os.path.exists(candidate):
                resolved_path = candidate
            elif os.path.exists(filepath):
                resolved_path = os.path.abspath(filepath)

        if not os.path.exists(resolved_path):
            print(f"[Warning] Local asset not found: {filepath}", file=sys.stderr)
            return match.group(0)

        mime, _ = mimetypes.guess_type(resolved_path)
        if not mime:
            if resolved_path.lower().endswith(".svg"):
                mime = "image/svg+xml"
            elif resolved_path.lower().endswith(".webp"):
                mime = "image/webp"
            else:
                mime = "image/png"

        try:
            with open(resolved_path, "rb") as img_f:
                b64_data = base64.b64encode(img_f.read()).decode("ascii")
            print(f"[Inlined] {filepath} -> data:{mime};base64,... ({len(b64_data)} bytes)")
            return f'{prefix}data:{mime};base64,{b64_data}{suffix}'
        except Exception as e:
            print(f"[Error] Failed to inline {resolved_path}: {e}", file=sys.stderr)
            return match.group(0)

    pattern = re.compile(r'(<img\b[^>]*?\bsrc=["\'])([^"\']+)(["\'])', re.IGNORECASE)
    updated_html = pattern.sub(replace_src, html_content)

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(updated_html)

    print(f"Asset inlining complete -> {out_path}")
    return out_path

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python inline_assets.py <input.html> [output.html]")
        sys.exit(1)
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else src
    inline_images(src, out)
