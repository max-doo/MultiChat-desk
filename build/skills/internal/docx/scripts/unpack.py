"""Unpack a .docx/.dotx into a working directory for XML editing (safe extraction).

Windows adaptation of the upstream one-liner ``python3 -c "...extractall"``:
same effect, but symlink/zip-slip hardened via office.helpers.safe_extract.

Usage:
    python unpack.py file.docx unpacked/

Prints the absolute extraction directory on success. Exit code 1 on failure.
"""

import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from office.helpers import safe_extract  # noqa: E402


def main() -> None:
    if len(sys.argv) != 3:
        print("Usage: unpack.py <file.docx> <output_dir>", file=sys.stderr)
        sys.exit(1)

    src = Path(sys.argv[1])
    dest = Path(sys.argv[2])

    if not src.is_file():
        print(f"Error: {src} not found", file=sys.stderr)
        sys.exit(1)

    dest.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(src) as zf:
            safe_extract(zf, dest)
    except (zipfile.BadZipFile, ValueError, OSError) as e:
        print(f"Error: could not unpack {src}: {e}", file=sys.stderr)
        sys.exit(1)

    print(str(dest.resolve()))


if __name__ == "__main__":
    main()
