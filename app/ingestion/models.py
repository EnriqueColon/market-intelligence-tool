from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional

try:
    from pydantic import BaseModel  # type: ignore
except Exception:  # pragma: no cover - fallback when pydantic is not installed

    class BaseModel:
        def __init__(self, **data: Any) -> None:
            for key, value in data.items():
                setattr(self, key, value)

        def dict(self) -> Dict[str, Any]:
            return dict(self.__dict__)


class RawEvent(BaseModel):
    connector: str
    run_id: str
    event_type: str
    payload: Dict[str, Any]
    fetched_at: str
    notes: Optional[str] = None


class FfiecCallReportRow(BaseModel):
    institution_id: str
    reporting_period_end: str
    field_code: str
    field_name: str
    value: float
    units: str
    fetched_at: str


class CensusResConstRow(BaseModel):
    geography: str
    time_period: str
    metric_code: str
    metric_name: str
    value: float
    seasonal_adj: str
    fetched_at: str


class UccFilingRow(BaseModel):
    state: str
    filing_number: str
    filing_date: str
    debtor_name: str
    secured_party: str
    collateral_summary: str
    status: str
    fetched_at: str


class ForeclosureNoticeRow(BaseModel):
    county: str
    state: str
    case_number: str
    filing_date: str
    plaintiff: str
    defendant: str
    property_address: str
    status: str
    fetched_at: str

