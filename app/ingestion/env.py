from __future__ import annotations

import os
from typing import Dict


def _parse_env_line(line: str) -> Dict[str, str]:
    if not line or line.startswith("#") or "=" not in line:
        return {}
    key, value = line.split("=", 1)
    key = key.strip()
    value = value.strip()
    if not key:
        return {}
    if value.startswith(("\"", "'")) and value.endswith(("\"", "'")) and len(value) >= 2:
        value = value[1:-1]
    return {key: value}


def load_env_file(path: str) -> None:
    if not os.path.exists(path):
        return
    try:
        with open(path, "r", encoding="utf-8") as handle:
            for raw in handle:
                entry = _parse_env_line(raw.strip())
                for key, value in entry.items():
                    if not os.environ.get(key):
                        os.environ[key] = value
    except Exception:
        return
