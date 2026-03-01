from __future__ import annotations

import os
import sqlite3
from typing import Iterable, Optional


def default_db_path() -> str:
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
    return os.path.join(root, "data", "ingestion.sqlite")


def connect(db_path: Optional[str] = None) -> sqlite3.Connection:
    path = db_path or default_db_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def apply_schema(conn: sqlite3.Connection) -> None:
    cursor = conn.cursor()
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS ingestion_runs (
            run_id TEXT PRIMARY KEY,
            connector TEXT NOT NULL,
            status TEXT NOT NULL,
            started_at TEXT NOT NULL,
            finished_at TEXT,
            records INTEGER DEFAULT 0,
            message TEXT
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS raw_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            connector TEXT NOT NULL,
            run_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            fetched_at TEXT NOT NULL,
            notes TEXT
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS ffiec_call_report (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            institution_id TEXT NOT NULL,
            reporting_period_end TEXT NOT NULL,
            field_code TEXT NOT NULL,
            field_name TEXT NOT NULL,
            value REAL NOT NULL,
            units TEXT NOT NULL,
            fetched_at TEXT NOT NULL
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS census_resconst (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            geography TEXT NOT NULL,
            time_period TEXT NOT NULL,
            metric_code TEXT NOT NULL,
            metric_name TEXT NOT NULL,
            value REAL NOT NULL,
            seasonal_adj TEXT NOT NULL,
            fetched_at TEXT NOT NULL
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS ucc_filings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            state TEXT NOT NULL,
            filing_number TEXT NOT NULL,
            filing_date TEXT NOT NULL,
            debtor_name TEXT NOT NULL,
            secured_party TEXT NOT NULL,
            collateral_summary TEXT NOT NULL,
            status TEXT NOT NULL,
            fetched_at TEXT NOT NULL
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS foreclosure_notices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            county TEXT NOT NULL,
            state TEXT NOT NULL,
            case_number TEXT NOT NULL,
            filing_date TEXT NOT NULL,
            plaintiff TEXT NOT NULL,
            defendant TEXT NOT NULL,
            property_address TEXT NOT NULL,
            status TEXT NOT NULL,
            fetched_at TEXT NOT NULL
        )
        """
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_ffiec_period ON ffiec_call_report(reporting_period_end)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_census_time ON census_resconst(time_period)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_ucc_state_date ON ucc_filings(state, filing_date)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_foreclosure_county_date ON foreclosure_notices(county, filing_date)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_raw_connector ON raw_events(connector, fetched_at)"
    )
    conn.commit()


def init_db(db_path: Optional[str] = None) -> sqlite3.Connection:
    conn = connect(db_path)
    apply_schema(conn)
    return conn


def insert_many(conn: sqlite3.Connection, sql: str, rows: Iterable[tuple]) -> int:
    cursor = conn.cursor()
    cursor.executemany(sql, rows)
    conn.commit()
    return cursor.rowcount

