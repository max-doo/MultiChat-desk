# MultiChat adaptation: pypdfium2-first rendering — pdf2image requires poppler
# on the system PATH, which most Windows user machines lack. pypdfium2 ships
# as a self-contained pip wheel. pdf2image remains a fallback when present.
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass


def convert_with_pdfium(pdf_path, output_dir, max_dim=1000, dpi=200):
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(pdf_path)
    scale = dpi / 72.0
    count = 0
    for i in range(len(pdf)):
        image = pdf[i].render(scale=scale).to_pil().convert("RGB")
        width, height = image.size
        if width > max_dim or height > max_dim:
            scale_factor = min(max_dim / width, max_dim / height)
            image = image.resize((int(width * scale_factor), int(height * scale_factor)))
        image_path = os.path.join(output_dir, f"page_{i + 1}.png")
        image.save(image_path)
        print(f"Saved page {i + 1} as {image_path} (size: {image.size})")
        count += 1
    pdf.close()
    print(f"Converted {count} pages to PNG images (backend: pypdfium2)")


def convert_with_pdf2image(pdf_path, output_dir, max_dim=1000):
    from pdf2image import convert_from_path

    images = convert_from_path(pdf_path, dpi=200)
    for i, image in enumerate(images):
        width, height = image.size
        if width > max_dim or height > max_dim:
            scale_factor = min(max_dim / width, max_dim / height)
            image = image.resize((int(width * scale_factor), int(height * scale_factor)))
        image_path = os.path.join(output_dir, f"page_{i + 1}.png")
        image.save(image_path)
        print(f"Saved page {i + 1} as {image_path} (size: {image.size})")
    print(f"Converted {len(images)} pages to PNG images (backend: pdf2image/poppler)")


def convert(pdf_path, output_dir, max_dim=1000):
    os.makedirs(output_dir, exist_ok=True)
    try:
        import pypdfium2  # noqa: F401
    except ImportError:
        try:
            convert_with_pdf2image(pdf_path, output_dir, max_dim)
            return
        except Exception as err:
            print(
                "Error: neither pypdfium2 (pip install pypdfium2) nor pdf2image+poppler "
                f"is usable ({err}). Rendering is an optional enhancement — degrade by "
                "asking the user to inspect the PDF manually.",
                file=sys.stderr,
            )
            sys.exit(3)
    convert_with_pdfium(pdf_path, output_dir, max_dim)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: convert_pdf_to_images.py [input pdf] [output directory]")
        sys.exit(1)
    pdf_path = sys.argv[1]
    output_directory = sys.argv[2]
    convert(pdf_path, output_directory)
