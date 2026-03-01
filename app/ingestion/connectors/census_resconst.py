from __future__ import annotations

import datetime as dt
import json
import os
import urllib.parse
import urllib.request
from typing import Dict, List, Tuple

from app.ingestion.base import BaseConnector, RunContext, RunResult
from app.ingestion.models import CensusResConstRow, RawEvent
from app.ingestion.storage.db import insert_many, init_db
from app.ingestion.storage.raw_store import store_raw_events


BASE_URL = "https://api.census.gov/data/timeseries/eits/resconst"


def _now_iso() -> str:
    return dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _month_series(months: int) -> List[str]:
    base = dt.date.today().replace(day=1)
    points = []
    for i in range(months):
        year = base.year
        month = base.month - i
        while month <= 0:
            month += 12
            year -= 1
        points.append(f"{year:04d}-{month:02d}")
    return list(reversed(points))


def _http_get(url: str) -> List[List[str]]:
    with urllib.request.urlopen(url, timeout=60) as resp:
        text = resp.read().decode("utf-8")
    data = json.loads(text)
    return data if isinstance(data, list) else []


class CensusResConstConnector(BaseConnector):
    key = "census_resconst"

    def __init__(self, config: Dict[str, object]) -> None:
        self.config = config

    def run(self, ctx: RunContext) -> RunResult:
        auth = self.config.get("auth", {}) if isinstance(self.config.get("auth", {}), dict) else {}
        key_env = auth.get("api_key_env", "CENSUS_API_KEY")
        api_key = os.getenv(str(key_env), "").strip()
        api_key = api_key or ""

        params = self.config.get("params", {}) if isinstance(self.config.get("params", {}), dict) else {}
        metric_map = {
            "permits": "PERMITS",
            "starts": "STARTS",
            "completions": "COMPLETIONS",
        }
        metrics = params.get("metrics", ["permits", "starts", "completions"])
        wanted = {metric_map[m]: m for m in metrics if m in metric_map}

        conn = None if ctx.dry_run else init_db()
        rows: List[Tuple[str, str, str, str, float, str, str]] = []
        raw_events: List[RawEvent] = []

        years = sorted({int(m.split("-")[0]) for m in _month_series(12)})
        for year in years:
            query = {
                "get": "data_type_code,time_slot_id,seasonally_adj,category_code,cell_value,error_data",
                "time": str(year),
            }
            if api_key:
                query["key"] = api_key
            url = f"{BASE_URL}?{urllib.parse.urlencode(query)}"
            try:
                data = _http_get(url)
            except Exception:
                continue

            if not data or len(data) < 2:
                continue
            headers = data[0]
            for row in data[1:]:
                entry = dict(zip(headers, row))
                category = entry.get("category_code")
                if category not in wanted:
                    continue
                if entry.get("data_type_code") not in {"TOTAL", "E_TOTAL"}:
                    continue
                try:
                    value = float(entry.get("cell_value", "0"))
                except ValueError:
                    continue
                time_period = entry.get("time", "")
                if not time_period:
                    continue
                rows.append(
                    (
                        "us",
                        time_period,
                        category,
                        wanted.get(category, category),
                        value,
                        entry.get("seasonally_adj", ""),
                        _now_iso(),
                    )
                )

            raw_events.append(
                RawEvent(
                    connector=self.key,
                    run_id=ctx.run_id,
                    event_type="resconst",
                    payload={"time": str(year), "geo": "us"},
                    fetched_at=_now_iso(),
                )
            )

        if conn is not None and rows:
            insert_many(
                conn,
                """
                INSERT INTO census_resconst (
                    geography, time_period, metric_code, metric_name, value, seasonal_adj, fetched_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
            store_raw_events(conn, raw_events)
            conn.close()

        status = "ok" if rows else "no_data"
        return RunResult(len(rows), status, f"Census rows: {len(rows)}")

