"""Repack an unpacked docx directory into a .docx and write it back atomically.

This is the Windows adaptation of the upstream `zip -XrDy` repack step. It
implements the atomic-writeback discipline the skill requires: build the new
zip in a same-volume temporary file next to the output, then os.replace() it
into place. The original file is never touched until the replacement is
fully written — validation failures or crashes leave the user's file intact.
os.replace() on the same volume is atomic on Windows and POSIX alike.

Folder entries (``*/``) are NOT created — Word has refused documents carrying
them when opened through cloud co-editing services.

Usage:
    python pack.py unpacked/ out.docx

Exit code 0 on success; 1 with an error message on stderr otherwise.
"""

import sys
import zipfile
from pathlib import Path

# allow both "python pack.py" (scripts/ on sys.path) and explicit invocations
sys.path.insert(0, str(Path(__file__).resolve().parent))
from office.helpers import rezip  # noqa: E402


def main() -> None:
    if len(sys.argv) != 3:
        print("Usage: pack.py <unpacked_dir> <output.docx>", file=sys.stderr)
        sys.exit(1)

    src_dir = Path(sys.argv[1])
    out_path = Path(sys.argv[2])

    if not src_dir.is_dir():
        print(f"Error: {src_dir} is not a directory", file=sys.stderr)
        sys.exit(1)
    if not (src_dir / "[Content_Types].xml").exists():
        print(f"Error: {src_dir}/[Content_Types].xml missing — not an unpacked OOXML package", file=sys.stderr)
        sys.exit(1)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        rezip(src_dir, out_path)
    except (OSError, zipfile.BadZipFile, ValueError) as e:
        print(f"Error: repack failed — the original file was NOT modified: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"Wrote {out_path} ({out_path.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
