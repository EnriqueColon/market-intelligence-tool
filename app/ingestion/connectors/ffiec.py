from __future__ import annotations

import base64
import datetime as dt
import json
import os
import time
import urllib.parse
import urllib.request
from typing import Dict, Iterable, List, Tuple

from app.ingestion.base import BaseConnector, RunContext, RunResult
from app.ingestion.models import FfiecCallReportRow, RawEvent
from app.ingestion.storage.db import insert_many, init_db
from app.ingestion.storage.raw_store import store_raw_events


FFIEC_BASE = "https://ffieccdr.azure-api.us/public"


def _now_iso() -> str:
    return dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _load_fields(mapping_path: str) -> List[Dict[str, str]]:
    fields: List[Dict[str, str]] = []
    if not os.path.exists(mapping_path):
        return fields
    current: Dict[str, str] = {}
    with open(mapping_path, "r", encoding="utf-8") as handle:
        for raw in handle:
            line = raw.strip()
            if line.startswith("- "):
                if current:
                    fields.append(current)
                current = {}
                line = line[2:].strip()
            if ":" in line:
                key, value = line.split(":", 1)
                current[key.strip()] = value.strip().strip('"').strip("'")
        if current:
            fields.append(current)
    return [f for f in fields if f.get("code")]


def _http_get(url: str, headers: Dict[str, str]) -> bytes:
    req = urllib.request.Request(url, method="GET", headers=headers)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def _decode_facsimile(payload: object) -> str:
    if isinstance(payload, list) and payload and isinstance(payload[0], int):
        return bytes(payload).decode("utf-8", errors="ignore")
    if isinstance(payload, str):
        try:
            return base64.b64decode(payload).decode("utf-8", errors="ignore")
        except Exception:
            return payload
    if isinstance(payload, dict) and "FacsimileFile" in payload:
        return _decode_facsimile(payload["FacsimileFile"])
    return ""


def _extract_values(text: str, field_codes: Iterable[str]) -> Dict[str, float]:
    values: Dict[str, float] = {}
    wanted = set(field_codes)
    for raw_line in text.splitlines():
        if ";" not in raw_line:
            continue
        parts = [p.strip() for p in raw_line.split(";")]
        if not parts:
            continue
        code = parts[0]
        if code not in wanted:
            continue
        value = None
        for part in reversed(parts[1:]):
            cleaned = part.replace(",", "")
            try:
                value = float(cleaned)
                break
            except ValueError:
                continue
        if value is not None:
            values[code] = value
    return values


class FFIECConnector(BaseConnector):
    key = "ffiec"

    def __init__(self, config: Dict[str, object]) -> None:
        self.config = config

    def run(self, ctx: RunContext) -> RunResult:
        auth = self.config.get("auth", {}) if isinstance(self.config.get("auth", {}), dict) else {}
        user_env = auth.get("user_id_env", "FFIEC_USER_ID")
        token_env = auth.get("token_env", "FFIEC_TOKEN")
        user_id = os.getenv(str(user_env), "").strip()
        token = os.getenv(str(token_env), "").strip()
        if not user_id or not token:
            return RunResult(0, "not_configured", "Missing FFIEC credentials.")

        headers = {"UserID": user_id, "Authentication": f"Bearer {token}", "dataSeries": "Call"}
        try:
            raw = _http_get(f"{FFIEC_BASE}/RetrieveReportingPeriods", headers)
            reporting_periods = json.loads(raw.decode("utf-8"))
        except Exception as exc:
            return RunResult(0, "failed", f"FFIEC reporting periods error: {exc}")

        if not reporting_periods:
            return RunResult(0, "failed", "No FFIEC reporting periods returned.")
        reporting_period = reporting_periods[-1]

        params = self.config.get("params", {}) if isinstance(self.config.get("params", {}), dict) else {}
        institutions = params.get("institutions", []) if isinstance(params.get("institutions", []), list) else []
        max_institutions = int(params.get("max_institutions", 25))
        sleep_seconds = float(params.get("sleep_seconds", 1.0))

        if not institutions:
            headers_por = dict(headers)
            headers_por["reportingPeriodEndDate"] = reporting_period
            try:
                raw = _http_get(f"{FFIEC_BASE}/RetrievePanelOfReporters", headers_por)
                panel = json.loads(raw.decode("utf-8"))
                institutions = [
                    entry.get("ID_RSSD")
                    for entry in panel
                    if isinstance(entry, dict) and entry.get("HasFiledForReportingPeriod")
                ]
            except Exception as exc:
                return RunResult(0, "failed", f"FFIEC panel error: {exc}")

        institutions = [str(i) for i in institutions if i]
        if max_institutions and len(institutions) > max_institutions:
            institutions = institutions[:max_institutions]

        mapping_path = os.path.join(os.path.dirname(__file__), "..", "mappings", "ffiec_fields.yaml")
        fields = _load_fields(os.path.normpath(mapping_path))
        if not fields:
            return RunResult(0, "failed", "FFIEC field mapping file is empty.")

        field_codes = [f["code"] for f in fields]
        field_name_lookup = {f["code"]: f.get("name", f["code"]) for f in fields}
        field_units_lookup = {f["code"]: f.get("units", "USD") for f in fields}

        conn = None if ctx.dry_run else init_db()
        total_records = 0
        raw_events: List[RawEvent] = []
        rows: List[Tuple[str, str, str, str, float, str, str]] = []

        for institution_id in institutions:
            headers_fac = dict(headers)
            headers_fac["reportingPeriodEndDate"] = reporting_period
            headers_fac["fiIdType"] = "ID_RSSD"
            headers_fac["fiId"] = institution_id
            headers_fac["facsimileFormat"] = "SDF"

            try:
                payload_bytes = _http_get(f"{FFIEC_BASE}/RetrieveFacsimile", headers_fac)
                payload = json.loads(payload_bytes.decode("utf-8"))
                sdf_text = _decode_facsimile(payload)
            except Exception:
                continue

            values = _extract_values(sdf_text, field_codes)
            fetched_at = _now_iso()
            for code, value in values.items():
                rows.append(
                    (
                        institution_id,
                        reporting_period,
                        code,
                        field_name_lookup.get(code, code),
                        float(value),
                        field_units_lookup.get(code, "USD"),
                        fetched_at,
                    )
                )

            raw_events.append(
                RawEvent(
                    connector=self.key,
                    run_id=ctx.run_id,
                    event_type="facsimile",
                    payload={
                        "reporting_period": reporting_period,
                        "institution_id": institution_id,
                        "field_count": len(values),
                    },
                    fetched_at=fetched_at,
                )
            )
            time.sleep(max(0.0, sleep_seconds))

        if conn is not None and rows:
            insert_many(
                conn,
                """
                INSERT INTO ffiec_call_report (
                    institution_id, reporting_period_end, field_code, field_name, value, units, fetched_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
            store_raw_events(conn, raw_events)
            conn.close()

        total_records = len(rows)
        status = "ok" if total_records > 0 else "no_data"
        return RunResult(total_records, status, f"FFIEC rows: {total_records}")

