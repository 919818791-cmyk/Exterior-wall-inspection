from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel


class UsagePeriodMetrics(BaseModel):
    label: str
    start_date: date
    end_date: date
    photo_count: int
    storage_bytes: int
    storage_mb: float
    api_request_count: int
    token_count: int
    input_token_count: int
    output_token_count: int
    trial_task_count: int


class UsageTotals(BaseModel):
    photo_count: int
    storage_bytes: int
    storage_mb: float
    api_request_count: int
    token_count: int
    input_token_count: int
    output_token_count: int
    trial_task_count: int


class DataUsageResponse(BaseModel):
    period: Literal["week", "month"]
    current: UsagePeriodMetrics
    history: list[UsagePeriodMetrics]
    all_time: UsageTotals
