from __future__ import annotations

from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class AccountUsageTotals(BaseModel):
    task_count: int
    formal_task_count: int
    trial_task_count: int
    api_request_count: int
    token_count: int
    input_token_count: int
    output_token_count: int


class AccountUsagePeriodMetrics(AccountUsageTotals):
    label: str
    start_date: date
    end_date: date


class AccountUsageSummaryItem(AccountUsageTotals):
    account_id: UUID


class AccountUsageDetailResponse(BaseModel):
    account_id: UUID
    period: Literal["week", "month"]
    current: AccountUsagePeriodMetrics
    history: list[AccountUsagePeriodMetrics]
    all_time: AccountUsageTotals


class AccountQuotaBalance(BaseModel):
    limit: int
    used: int
    remaining: int


class CurrentAccountUsageResponse(BaseModel):
    account_id: UUID
    period_start: date
    period_end: date
    usage: AccountUsageTotals
    trial_api_request_balance: AccountQuotaBalance
