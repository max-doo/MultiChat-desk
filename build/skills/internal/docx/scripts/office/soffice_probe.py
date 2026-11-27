"""Windows-first LibreOffice probe + conversion runner.

The upstream office/soffice.py assumes a Unix environment (LD_PRELOAD shim,
bare ``soffice`` on PATH). On Windows hosts LibreOffice is never a hard
requirement — it is a probe-based optional enhancement. This module:

1. probes PATH and the standard Windows install locations for soffice.exe;
2. runs conversions headlessly with an isolated user profile when found;
3. reports unavailability on stdout (JSON) so the Agent can degrade to
   "ask the user to review the file in Word/WPS" instead of failing.

Usage:
    python scripts/office/soffice_probe.py probe
    python scripts/office/soffice_probe.py convert input.docx --to pdf --outdir out/

Always prints one JSON object on stdout; exit code 0 = soffice available and
conversion succeeded (or probe found it), 3 = soffice unavailable, 2 = error.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

WINDOWS_CANDIDATES = [
    os.path.expandvars(r"%ProgramFiles%\LibreOffice\program\soffice.exe"),
    os.path.expandvars(r"%ProgramFiles(x86)%\LibreOffice\program\soffice.exe"),
    os.path.expandvars(r"%LOCALAPPDATA%\Programs\LibreOffice\program\soffice.exe"),
]


def find_soffice():
    on_path = shutil.which("soffice") or shutil.which("soffice.exe")
    if on_path:
        return on_path
    for candidate in WINDOWS_CANDIDATES:
        if candidate and os.path.isfile(candidate):
            return candidate
    return None


def probe():
    path = find_soffice()
    return {"available": bool(path), "path": path}


def convert(soffice, input_path, to_format, outdir):
    Path(outdir).mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="lo_profile_", ignore_cleanup_errors=True) as profile:
        uri = Path(profile).as_uri()
        result = subprocess.run(
            [
                soffice,
                f"-env:UserInstallation={uri}",
                "--headless", "--norestore", "--nolockcheck", "--nodefault",
                "--convert-to", to_format,
                "--outdir", outdir,
                input_path,
            ],
            capture_output=True, text=True, timeout=180,
        )
    produced = sorted(
        str(p) for p in Path(outdir).glob(f"{Path(input_path).stem}.*")
        if p.suffix.lstrip(".").lower().startswith(to_format.split(":")[0].lower())
    )
    ok = result.returncode == 0 and bool(produced)
    return {
        "available": True, "converted": ok,
        "output": produced[0] if produced else None,
        "stderr": (result.stderr or "").strip()[-400:],
    }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: soffice_probe.py probe | convert <input> --to <fmt> --outdir <dir>"}))
        sys.exit(2)

    if sys.argv[1] == "probe":
        info = probe()
        print(json.dumps(info))
        sys.exit(0 if info["available"] else 3)

    if sys.argv[1] == "convert":
        args = sys.argv[2:]
        if not args:
            print(json.dumps({"error": "missing input file"}))
            sys.exit(2)
        input_path = args[0]
        to_format = "pdf"
        outdir = str(Path(input_path).parent)
        if "--to" in args:
            to_format = args[args.index("--to") + 1]
        if "--outdir" in args:
            outdir = args[args.index("--outdir") + 1]
        soffice = find_soffice()
        if not soffice:
            print(json.dumps({
                "available": False, "converted": False,
                "hint": "LibreOffice not installed — visual verification is unavailable. "
                        "Tell the user to open the file in Word/WPS and check it manually.",
            }))
            sys.exit(3)
        try:
            info = convert(soffice, input_path, to_format, outdir)
            print(json.dumps(info))
            sys.exit(0 if info.get("converted") else 2)
        except subprocess.TimeoutExpired:
            print(json.dumps({"available": True, "converted": False, "error": "conversion timed out after 180s"}))
            sys.exit(2)

    print(json.dumps({"error": f"unknown command: {sys.argv[1]}"}))
    sys.exit(2)


if __name__ == "__main__":
    main()
