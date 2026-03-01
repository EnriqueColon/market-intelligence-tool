from __future__ import annotations

import os
from typing import Any, Dict, List, Tuple

from app.ingestion.base import BaseConnector


def _default_config_path() -> str:
    root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    return os.path.join(root, "configs", "connectors.yaml")


def _parse_scalar(value: str) -> Any:
    raw = value.strip().strip('"').strip("'")
    if raw.startswith("[") and raw.endswith("]"):
        try:
            import json

            parsed = json.loads(raw)
            return parsed
        except Exception:
            pass
    if raw.lower() in {"true", "false"}:
        return raw.lower() == "true"
    try:
        if "." in raw:
            return float(raw)
        return int(raw)
    except ValueError:
        return raw


def _simple_yaml_load(text: str) -> Dict[str, Any]:
    lines = [line.rstrip("\n") for line in text.splitlines()]
    root: Dict[str, Any] = {}
    stack: List[Tuple[int, Any]] = [(0, root)]

    def next_non_empty(start: int) -> str:
        for idx in range(start, len(lines)):
            stripped = lines[idx].strip()
            if stripped and not stripped.startswith("#"):
                return stripped
        return ""

    for idx, line in enumerate(lines):
        if not line.strip() or line.strip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip(" "))
        content = line.strip()
        while stack and indent < stack[-1][0]:
            stack.pop()
        container = stack[-1][1]

        if content.startswith("- "):
            value = _parse_scalar(content[2:].strip())
            if isinstance(container, list):
                container.append(value)
            continue

        if ":" in content:
            key, rest = content.split(":", 1)
            key = key.strip().strip('"').strip("'")
            rest = rest.strip()
            if rest:
                if isinstance(container, dict):
                    container[key] = _parse_scalar(rest)
                continue

            next_line = next_non_empty(idx + 1)
            next_is_list = next_line.startswith("- ")
            new_container: Any = [] if next_is_list else {}
            if isinstance(container, dict):
                container[key] = new_container
                stack.append((indent + 2, new_container))

    return root


def _load_yaml(path: str) -> Dict[str, Any]:
    try:
        import yaml  # type: ignore
    except Exception:
        yaml = None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            raw = handle.read()
            if yaml:
                data = yaml.safe_load(raw) or {}
                return data if isinstance(data, dict) else {}
            return _simple_yaml_load(raw)
    except FileNotFoundError:
        return {}


def load_connector_config(config_path: str | None = None) -> Dict[str, Any]:
    path = config_path or _default_config_path()
    return _load_yaml(path)


def build_connectors(config: Dict[str, Any]) -> List[Tuple[BaseConnector, Dict[str, Any]]]:
    connectors: List[Tuple[BaseConnector, Dict[str, Any]]] = []
    if not config:
        return connectors

    try:
        from app.ingestion.connectors.ffiec import FFIECConnector
        from app.ingestion.connectors.census_resconst import CensusResConstConnector
        from app.ingestion.connectors.ucc import UCCConnector
        from app.ingestion.connectors.foreclosure import ForeclosureConnector
    except Exception:
        return connectors

    ffiec_cfg = config.get("ffiec", {}) if isinstance(config.get("ffiec", {}), dict) else {}
    if ffiec_cfg.get("enabled"):
        connectors.append((FFIECConnector(ffiec_cfg), ffiec_cfg))

    census_cfg = config.get("census_resconst", {}) if isinstance(config.get("census_resconst", {}), dict) else {}
    if census_cfg.get("enabled"):
        connectors.append((CensusResConstConnector(census_cfg), census_cfg))

    ucc_cfg = config.get("ucc", {}) if isinstance(config.get("ucc", {}), dict) else {}
    if ucc_cfg.get("enabled"):
        connectors.append((UCCConnector(ucc_cfg), ucc_cfg))

    foreclosure_cfg = config.get("foreclosures", {}) if isinstance(config.get("foreclosures", {}), dict) else {}
    if foreclosure_cfg.get("enabled"):
        connectors.append((ForeclosureConnector(foreclosure_cfg), foreclosure_cfg))

    return connectors

