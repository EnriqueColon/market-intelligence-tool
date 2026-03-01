#!/usr/bin/env python3
"""
Batch convert Apple Numbers documents to CSV using the Numbers app (AppleScript).

This is intended for the Miami-Dade AOM files you have (which are zip-based iWork files).
If your files are misnamed (e.g. ".csv" but actually start with "PK"), this script will
create temporary ".numbers" copies before exporting.

Requirements:
- macOS with Numbers installed
- You may be prompted to allow automation permissions for Terminal/Python to control Numbers

Usage:
  python3 scripts/convert_numbers_to_csv.py
  python3 scripts/convert_numbers_to_csv.py --input data/aom-source --output data/aom-csv
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path
from typing import List, Tuple


ZIP_MAGIC = b"PK"


def looks_like_iwork_zip(path: Path) -> bool:
    try:
        with path.open("rb") as f:
            prefix = f.read(2)
        return prefix == ZIP_MAGIC
    except Exception:
        return False


def find_input_files(input_dir: Path) -> List[Path]:
    exts = {".numbers", ".csv", ".tsv", ".xlsx", ".xls"}
    files: List[Path] = []
    for p in input_dir.iterdir():
        if p.is_file() and p.suffix.lower() in exts:
            files.append(p)
    return sorted(files)


def applescript_export(numbers_path: Path, csv_path: Path) -> str:
    # Use POSIX paths; AppleScript must coerce to alias/file.
    # Export "front document" to CSV.
    return f"""
on run
  set inPosix to "{numbers_path.as_posix()}"
  set outPosix to "{csv_path.as_posix()}"

  tell application "Numbers"
    activate
    set theDoc to open (POSIX file inPosix)
    delay 0.5
    export theDoc to (POSIX file outPosix) as CSV
    close theDoc saving no
  end tell
end run
""".strip()


def run_osascript(script: str) -> Tuple[int, str, str]:
    proc = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True,
        text=True,
    )
    return proc.returncode, proc.stdout, proc.stderr


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="data/aom-source", help="Folder containing Numbers/iWork files")
    parser.add_argument("--output", default="data/aom-csv", help="Folder to write CSV exports into")
    args = parser.parse_args()

    input_dir = Path(args.input).expanduser().resolve()
    output_dir = Path(args.output).expanduser().resolve()
    tmp_dir = output_dir / ".tmp-numbers"

    if not input_dir.exists():
        print(f"Input folder not found: {input_dir}", file=sys.stderr)
        return 2

    files = find_input_files(input_dir)
    if not files:
        print(f"No candidate files found in: {input_dir}", file=sys.stderr)
        return 2

    output_dir.mkdir(parents=True, exist_ok=True)
    # Fresh temp workspace each run
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir, ignore_errors=True)
    tmp_dir.mkdir(parents=True, exist_ok=True)

    converted = 0
    skipped = 0

    for src in files:
        # Only attempt conversion for files that are already .numbers OR look like iWork zip.
        is_numbers = src.suffix.lower() == ".numbers"
        is_iwork_zip = looks_like_iwork_zip(src)
        if not is_numbers and not is_iwork_zip:
            skipped += 1
            continue

        base = src.stem
        dest_csv = output_dir / f"{base}.csv"

        # Numbers expects a .numbers package (directory). Many iWork docs are zip-based bundles when copied around.
        # If the input is a zip (PK...), unzip it into a .numbers directory and open that.
        open_path = src
        if is_iwork_zip:
            open_path = tmp_dir / f"{base}.numbers"
            if open_path.exists():
                shutil.rmtree(open_path, ignore_errors=True)
            open_path.mkdir(parents=True, exist_ok=True)
            try:
                with zipfile.ZipFile(src, "r") as zf:
                    zf.extractall(open_path)
            except Exception as e:
                print(f"[FAIL] {src.name} (unable to unzip iWork bundle): {e}", file=sys.stderr)
                continue
        elif src.suffix.lower() != ".numbers":
            # Not zip-based, but still not a .numbers extension: make a temp copy with .numbers.
            open_path = tmp_dir / f"{base}.numbers"
            shutil.copy2(src, open_path)

        # Ensure destination is writable and cleared
        try:
            if dest_csv.exists():
                dest_csv.unlink()
        except Exception:
            pass

        script = applescript_export(open_path, dest_csv)
        code, out, err = run_osascript(script)
        if code != 0:
            print(f"[FAIL] {src.name}", file=sys.stderr)
            if out.strip():
                print(out.strip(), file=sys.stderr)
            if err.strip():
                print(err.strip(), file=sys.stderr)
            continue

        if dest_csv.exists() and dest_csv.stat().st_size > 0:
            converted += 1
            print(f"[OK] {src.name} -> {dest_csv}")
        else:
            print(f"[WARN] Export produced empty CSV: {dest_csv}", file=sys.stderr)

    # Cleanup temp workspace
    shutil.rmtree(tmp_dir, ignore_errors=True)

    print(f"Done. Converted: {converted}. Skipped (non-iWork): {skipped}. Output: {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

