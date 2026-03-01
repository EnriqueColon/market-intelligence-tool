from __future__ import annotations

from typing import Dict

from app.ingestion.base import BaseConnector, RunContext, RunResult


class ForeclosureConnector(BaseConnector):
    key = "foreclosures"

    def __init__(self, config: Dict[str, object]) -> None:
        self.config = config

    def uses_playwright(self) -> bool:
        return True

    def run(self, ctx: RunContext) -> RunResult:
        counties = self.config.get("counties", {}) if isinstance(self.config.get("counties", {}), dict) else {}
        if not counties:
            return RunResult(0, "not_configured", "No foreclosure counties configured.")

        try:
            import playwright  # type: ignore
        except Exception:
            return RunResult(0, "needs_manual_login", "Playwright not available or login required.")

        return RunResult(0, "needs_manual_login", "Foreclosure scraping requires manual login setup.")

