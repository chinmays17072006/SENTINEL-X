#!/usr/bin/env python3
"""Build a portable, credential-free SENTINEL-X container source package."""
from __future__ import annotations

from pathlib import Path
import sys
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent
ARCHIVE_ROOT = "sentinelx-production"


def package_files() -> list[Path]:
    required = [ROOT / "Dockerfile", ROOT / "DEPLOYMENT.md", ROOT / "server.py"]
    public = sorted(path for path in (ROOT / "public").rglob("*") if path.is_file())
    files = required + public
    missing = [str(path.relative_to(ROOT)) for path in required + [ROOT / "public" / "index.html"] if not path.is_file()]
    if missing:
        raise FileNotFoundError("Required production package file(s) missing: " + ", ".join(missing))
    for path in public:
        body = path.read_bytes()
        if b"AIza" in body:
            raise ValueError(f"Refusing to package a Google-key-like string in {path.relative_to(ROOT)}")
    return files


def main() -> None:
    output = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else ROOT.parent / "sentinelx-production.zip"
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    files = package_files()
    with ZipFile(output, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            relative = path.relative_to(ROOT).as_posix()
            archive.write(path, f"{ARCHIVE_ROOT}/{relative}")
    print(f"Created {output} ({len(files)} runtime files)")


if __name__ == "__main__":
    main()
