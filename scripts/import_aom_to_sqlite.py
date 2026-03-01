#!/usr/bin/env python3
"""
Import Miami-Dade Assignment of Mortgage (AOM) event files into a single SQLite database.

Expected input formats:
- CSV/TSV exports (recommended): export from Numbers as CSV and drop into data/aom-source/

Usage:
  python3 scripts/import_aom_to_sqlite.py
  python3 scripts/import_aom_to_sqlite.py --input "/path/to/folder" --db "data/aom.sqlite"
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


SUPPORTED_EXTS = {".csv", ".tsv"}
ZIP_MAGIC = b"PK"


def norm_key(value: str) -> str:
    return "".join(ch for ch in value.strip().upper() if ch.isalnum() or ch == "_").replace("__", "_")


def parse_date(value: Any) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    # try common formats
    for fmt in (
        "%Y-%m-%d",
        "%m/%d/%Y",
        "%m/%d/%y",
        "%Y/%m/%d",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%m/%d/%Y %I:%M:%S %p",
        "%m/%d/%y %I:%M:%S %p",
    ):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except Exception:
            pass
    # If it's already ISO-ish, keep first 10 chars when it matches YYYY-MM-DD
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]
    return None


def parse_number(value: Any) -> Optional[float]:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    # strip currency/commas
    s = s.replace("$", "").replace(",", "")
    try:
        return float(s)
    except Exception:
        return None


def sniff_delimiter(sample: str, default: str) -> str:
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=[",", "\t", ";", "|"])
        return dialect.delimiter
    except Exception:
        return default


def read_rows(path: Path) -> Tuple[List[str], List[Dict[str, str]]]:
    # Guardrail: Numbers files are zip-based and often get misnamed as .csv.
    with path.open("rb") as f:
        prefix = f.read(4)
    if prefix.startswith(ZIP_MAGIC):
        raise ValueError(
            f"{path.name} looks like a zipped iWork/Numbers file (starts with PK), not a real CSV/TSV export."
        )

    text = path.read_text("utf-8-sig", errors="replace")
    sample = text[:4096]
    default_delim = "\t" if path.suffix.lower() == ".tsv" else ","
    delim = sniff_delimiter(sample, default_delim)
    reader = csv.DictReader(text.splitlines(), delimiter=delim)
    if not reader.fieldnames:
        return [], []
    headers = [h or "" for h in reader.fieldnames]
    rows: List[Dict[str, str]] = []
    for r in reader:
        rows.append({k or "": (v if v is not None else "") for k, v in r.items()})
    return headers, rows


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS aom_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_file TEXT NOT NULL,
          source_row INTEGER NOT NULL,

          event_date TEXT,
          doc_type TEXT,
          cik TEXT,

          cfn_master_id TEXT,
          cfn_year TEXT,
          cfn_seq TEXT,

          rec_date TEXT,
          doc_date TEXT,
          rec_book TEXT,
          rec_page TEXT,

          first_party TEXT,
          second_party TEXT,
          party_code TEXT,
          firm_indiv TEXT,

          folio_number TEXT,
          legal_description TEXT,

          consideration_1 REAL,
          consideration_2 REAL,
          deed_doc_tax REAL,
          surtax REAL,
          intangible REAL,
          documentary_stamps REAL,

          status TEXT,
          upb REAL,

          state TEXT,
          county TEXT,
          city TEXT,

          raw_json TEXT
        );
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_aom_event_date ON aom_events(event_date);")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_aom_doc_type ON aom_events(doc_type);")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_aom_parties ON aom_events(first_party, second_party);")


def map_row(raw: Dict[str, str]) -> Dict[str, Any]:
    # normalize keys to improve mapping robustness across exports
    normalized = {norm_key(k): v for k, v in raw.items() if k is not None}

    def g(*keys: str) -> Optional[str]:
        for k in keys:
            v = normalized.get(norm_key(k))
            if v is not None:
                s = str(v).strip()
                if s != "":
                    return s
        return None

    # Handle both underscore and space-separated export headers
    rec_date = parse_date(
        g(
            "REC_DATE",
            "RECORDING_DATE",
            "RECORD_DATE",
            "REC DATE",
            "RECORDING DATE",
            "RECDATE",
        )
    )
    doc_date = parse_date(g("DOC_DATE", "DOCUMENT_DATE", "DOC DATE", "DOCUMENT DATE", "DOCDATE"))
    event_date = rec_date or doc_date or parse_date(g("EVENT_DATE", "DATE", "EVENT DATE"))

    # Some exports include a single combined party field like "ASSIGNOR / ASSIGNEE"
    combined_party = g("PARTY_NAME", "PARTY NAME", "PARTYNAME")
    first_party = g("FIRST_PARTY", "ASSIGNOR", "PLAINTIFF", "GRANTOR")
    second_party = g("SECOND_PARTY", "ASSIGNEE", "DEFENDANT", "GRANTEE")
    if combined_party and not (first_party or second_party):
        # Prefer explicit " / " separator; otherwise fallback to first slash.
        if " / " in combined_party:
            left, right = combined_party.split(" / ", 1)
        elif "/" in combined_party:
            left, right = combined_party.split("/", 1)
        else:
            left, right = combined_party, ""
        first_party = (left or "").strip() or None
        second_party = (right or "").strip() or None

    # Default geography for this dataset when missing.
    state = g("STATE") or "FL"
    county = g("COUNTY") or "Miami-Dade"

    return {
        "event_date": event_date,
        "doc_type": g("DOC_TYPE", "DOCUMENT_TYPE", "DOC TYPE", "DOCUMENT TYPE", "DOCUMENTTYPE"),
        "cik": g("CIK"),
        "cfn_master_id": g("CFN_MASTER_ID", "CFNMASTERID", "CLERK'S FILE NUMBER", "CLERKS FILE NUMBER"),
        "cfn_year": g("CFN_YEAR", "CFNYEAR"),
        "cfn_seq": g("CFN_SEQ", "CFNSEQ"),
        "rec_date": rec_date,
        "doc_date": doc_date,
        "rec_book": g("REC_BOOK", "RECORD_BOOK"),
        "rec_page": g("REC_PAGE", "RECORD_PAGE"),
        "first_party": first_party,
        "second_party": second_party,
        "party_code": g("PARTY_CODE"),
        "firm_indiv": g("FIRM_INDIV"),
        "folio_number": g("FOLIO_NUMBER"),
        "legal_description": g("LEGAL_DESCRIPTION"),
        "consideration_1": parse_number(g("CONSIDERATION_1")),
        "consideration_2": parse_number(g("CONSIDERATION_2")),
        "deed_doc_tax": parse_number(g("DEED_DOC_TAX")),
        "surtax": parse_number(g("SURTAX")),
        "intangible": parse_number(g("INTANGIBLE")),
        "documentary_stamps": parse_number(g("DOCUMENTARY_STAMPS")),
        "status": g("STATUS"),
        "upb": parse_number(g("UPB", "BALANCE", "PRINCIPAL", "LOAN_BALANCE")),
        "state": state,
        "county": county,
        "city": g("CITY"),
        "raw_json": json.dumps(raw, ensure_ascii=False),
    }


def import_file(conn: sqlite3.Connection, path: Path) -> int:
    headers, rows = read_rows(path)
    if not rows:
        return 0

    inserted = 0
    for idx, raw in enumerate(rows, start=1):
        mapped = map_row(raw)
        conn.execute(
            """
            INSERT INTO aom_events (
              source_file, source_row,
              event_date, doc_type, cik,
              cfn_master_id, cfn_year, cfn_seq,
              rec_date, doc_date, rec_book, rec_page,
              first_party, second_party, party_code, firm_indiv,
              folio_number, legal_description,
              consideration_1, consideration_2, deed_doc_tax, surtax, intangible, documentary_stamps,
              status, upb, state, county, city,
              raw_json
            ) VALUES (
              ?, ?,
              ?, ?, ?,
              ?, ?, ?,
              ?, ?, ?, ?,
              ?, ?, ?, ?,
              ?, ?,
              ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?,
              ?
            );
            """,
            (
                str(path),
                idx,
                mapped["event_date"],
                mapped["doc_type"],
                mapped.get("cik"),
                mapped["cfn_master_id"],
                mapped["cfn_year"],
                mapped["cfn_seq"],
                mapped["rec_date"],
                mapped["doc_date"],
                mapped["rec_book"],
                mapped["rec_page"],
                mapped["first_party"],
                mapped["second_party"],
                mapped["party_code"],
                mapped["firm_indiv"],
                mapped["folio_number"],
                mapped["legal_description"],
                mapped["consideration_1"],
                mapped["consideration_2"],
                mapped["deed_doc_tax"],
                mapped["surtax"],
                mapped["intangible"],
                mapped["documentary_stamps"],
                mapped["status"],
                mapped["upb"],
                mapped["state"],
                mapped["county"],
                mapped["city"],
                mapped["raw_json"],
            ),
        )
        inserted += 1

    return inserted


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="data/aom-source", help="Folder containing exported CSV/TSV files")
    parser.add_argument("--db", default="data/aom.sqlite", help="SQLite DB path to create/update")
    args = parser.parse_args()

    input_dir = Path(args.input).expanduser().resolve()
    db_path = Path(args.db).expanduser().resolve()
    db_path.parent.mkdir(parents=True, exist_ok=True)

    if not input_dir.exists():
        raise SystemExit(f"Input folder not found: {input_dir}")

    files = []
    for p in input_dir.rglob("*"):
        if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS:
            files.append(p)
    if not files:
        raise SystemExit(f"No CSV/TSV files found in: {input_dir}")

    conn = sqlite3.connect(str(db_path))
    try:
        ensure_schema(conn)
        conn.execute("BEGIN;")
        total = 0
        for f in sorted(files):
            try:
                inserted = import_file(conn, f)
            except ValueError as e:
                conn.execute("ROLLBACK;")
                raise SystemExit(
                    "\n".join(
                        [
                            str(e),
                            "",
                            "These files are not plain CSV/TSV. If they came from Apple Numbers, export them as CSV first,",
                            "then place the real .csv exports into data/aom-source/ and rerun this importer.",
                        ]
                    )
                )
            total += inserted
            print(f"Imported {inserted} rows from {f}")
        conn.execute("COMMIT;")
        print(f"Done. Total rows inserted: {total}")
        print(f"DB: {db_path}")
    except Exception:
        conn.execute("ROLLBACK;")
        raise
    finally:
        conn.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

