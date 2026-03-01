from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional


@dataclass
class RunContext:
    run_id: str
    mode: str
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    dry_run: bool = False


@dataclass
class RunResult:
    records: int
    status: str
    message: str = ""


class BaseConnector:
    key: str = "base"

    def run(self, ctx: RunContext) -> RunResult:
        raise NotImplementedError

    def uses_playwright(self) -> bool:
        return False

    def dependencies(self) -> Iterable[str]:
        return []

