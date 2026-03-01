#!/usr/bin/env python3

import argparse
import os
import sqlite3
import sys


ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.append(ROOT)

from app.ingestion.runner import run_all  # noqa: E402
from app.ingestion.env import load_env_file  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke test for ingestion connectors.")
    parser.add_argument("--write", action="store_true", help="Write to ingestion.sqlite (default is dry run).")
    args = parser.parse_args()

    load_env_file(os.path.join(ROOT, ".env.local"))
    load_env_file(os.path.join(ROOT, ".env"))

    run_all(mode="incremental", dry_run=not args.write)

    if not args.write:
        print("Dry run complete. Use --write to insert rows.")
        return 0

    db_path = os.path.join(ROOT, "data", "ingestion.sqlite")
    if not os.path.exists(db_path):
        print("No ingestion.sqlite found.")
        return 1

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    for table in ["ffiec_call_report", "census_resconst", "ucc_filings", "foreclosure_notices"]:
        try:
            cursor.execute(f"SELECT COUNT(*) FROM {table}")
            count = cursor.fetchone()[0]
            print(f"{table}: {count} rows")
        except Exception as exc:
            print(f"{table}: error ({exc})")
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
