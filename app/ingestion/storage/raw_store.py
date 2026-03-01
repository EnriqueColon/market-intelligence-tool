from __future__ import annotations

import json
from typing import Iterable

from app.ingestion.models import RawEvent
from app.ingestion.storage.db import insert_many


def store_raw_events(conn, events: Iterable[RawEvent]) -> int:
    rows = [
        (
            event.connector,
            event.run_id,
            event.event_type,
            json.dumps(event.payload, ensure_ascii=True),
            event.fetched_at,
            event.notes,
        )
        for event in events
    ]
    if not rows:
        return 0
    return insert_many(
        conn,
        """
        INSERT INTO raw_events (connector, run_id, event_type, payload_json, fetched_at, notes)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        rows,
    )

