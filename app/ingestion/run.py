from __future__ import annotations

import argparse
import os

from app.ingestion.env import load_env_file

from app.ingestion.runner import run_all


def main() -> int:
    parser = argparse.ArgumentParser(description="Run ingestion connectors.")
    parser.add_argument("--mode", choices=["incremental", "backfill"], required=True)
    parser.add_argument("--start", dest="start_date")
    parser.add_argument("--end", dest="end_date")
    parser.add_argument("--config", dest="config_path")
    parser.add_argument("--db", dest="db_path")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    load_env_file(os.path.join(os.getcwd(), ".env.local"))
    load_env_file(os.path.join(os.getcwd(), ".env"))

    run_all(
        mode=args.mode,
        start_date=args.start_date,
        end_date=args.end_date,
        dry_run=args.dry_run,
        config_path=args.config_path,
        db_path=args.db_path,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

