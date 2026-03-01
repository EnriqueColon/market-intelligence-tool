from __future__ import annotations

from typing import Dict

from app.ingestion.base import BaseConnector, RunContext, RunResult


class UCCConnector(BaseConnector):
    key = "ucc"

    def __init__(self, config: Dict[str, object]) -> None:
        self.config = config

    def uses_playwright(self) -> bool:
        return True

    def run(self, ctx: RunContext) -> RunResult:
        states = self.config.get("states", {}) if isinstance(self.config.get("states", {}), dict) else {}
        if not states:
            return RunResult(0, "not_configured", "No UCC states configured.")

        try:
            import playwright  # type: ignore
        except Exception:
            return RunResult(0, "needs_manual_login", "Playwright not available or login required.")

        return RunResult(0, "needs_manual_login", "UCC scraping requires manual login setup.")

