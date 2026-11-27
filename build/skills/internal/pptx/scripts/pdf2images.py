"""Render PDF pages to JPEG images without requiring poppler.

Primary backend is pypdfium2 (pip wheel, Apache/BSD license) so the visual-QA
pipeline only depends on LibreOffice plus pip packages. When pypdfium2 is not
installed but `pdftoppm` (poppler) is available, it is used as a fallback.

Usage:
    python pdf2images.py input.pdf output_dir [--dpi N]

Creates output_dir/slide-1.jpg, slide-2.jpg, ... (padding matches page count:
slide-01.jpg for 10-99 pages, slide-001.jpg for 100+).
Exits 3 when neither pypdfium2 nor pdftoppm is usable.
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


def render_with_pdfium(pdf_path: Path, out_dir: Path, dpi: int) -> list[Path]:
    import pypdfium2 as pdfium

    scale = dpi / 72.0
    pdf = pdfium.PdfDocument(str(pdf_path))
    n = len(pdf)
    width = len(str(n))
    written = []
    for i in range(n):
        bitmap = pdf[i].render(scale=scale)
        img = bitmap.to_pil().convert("RGB")
        out = out_dir / f"slide-{i + 1:0{width}d}.jpg"
        img.save(out, "JPEG", quality=92)
        written.append(out)
    pdf.close()
    return written


def render_with_pdftoppm(pdf_path: Path, out_dir: Path, dpi: int) -> list[Path]:
    binary = shutil.which("pdftoppm") or shutil.which("pdftoppm.exe")
    if binary is None:
        return []
    result = subprocess.run(
        [binary, "-jpeg", "-r", str(dpi), str(pdf_path), str(out_dir / "slide")],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"pdftoppm failed: {result.stderr.strip()}")
    return sorted(out_dir.glob("slide-*.jpg"))


def main():
    parser = argparse.ArgumentParser(description="Render PDF pages to JPEG images.")
    parser.add_argument("input", help="Input PDF file")
    parser.add_argument("output_dir", help="Directory for slide-N.jpg images")
    parser.add_argument("--dpi", type=int, default=150, help="Render resolution (default 150)")
    args = parser.parse_args()

    pdf_path = Path(args.input)
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    backend = None
    written: list[Path] = []
    try:
        import pypdfium2  # noqa: F401
        written = render_with_pdfium(pdf_path, out_dir, args.dpi)
        backend = "pypdfium2"
    except ImportError:
        written = render_with_pdftoppm(pdf_path, out_dir, args.dpi)
        backend = "pdftoppm" if written else None

    if not written:
        print(
            "Error: neither pypdfium2 (pip install pypdfium2) nor poppler's pdftoppm "
            "is available. Page rendering is an optional enhancement — degrade by "
            "asking the user to inspect the PDF/PPTX manually.",
            file=sys.stderr,
        )
        sys.exit(3)

    print(f"backend: {backend}")
    for p in written:
        print(p)


if __name__ == "__main__":
    main()
