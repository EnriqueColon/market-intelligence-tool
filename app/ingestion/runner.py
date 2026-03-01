from __future__ import annotations

import datetime as dt
import uuid
from typing import Optional

from app.ingestion.base import RunContext, RunResult
from app.ingestion.registry import build_connectors, load_connector_config
from app.ingestion.storage.db import init_db


def _now_iso() -> str:
    return dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _write_run(
    conn,
    run_id: str,
    connector: str,
    status: str,
    started_at: str,
    finished_at: Optional[str],
    records: int,
    message: str,
) -> None:
    if conn is None:
        return
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO ingestion_runs (run_id, connector, status, started_at, finished_at, records, message)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (run_id, connector, status, started_at, finished_at, records, message),
    )
    conn.commit()


def run_all(
    mode: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    dry_run: bool = False,
    config_path: Optional[str] = None,
    db_path: Optional[str] = None,
) -> int:
    config = load_connector_config(config_path)
    connectors = build_connectors(config)
    conn = None if dry_run else init_db(db_path)

    total_records = 0
    for connector, _cfg in connectors:
        run_id = str(uuid.uuid4())
        started_at = _now_iso()
        result = RunResult(records=0, status="skipped", message="Not started")
        try:
            ctx = RunContext(
                run_id=run_id, mode=mode, start_date=start_date, end_date=end_date, dry_run=dry_run
            )
            result = connector.run(ctx)
            status = result.status
        except Exception as exc:
            status = "failed"
            result = RunResult(records=0, status=status, message=str(exc))
        finished_at = _now_iso()
        total_records += result.records
        _write_run(conn, run_id, connector.key, status, started_at, finished_at, result.records, result.message)

    if conn is not None:
        conn.close()
    return total_records

