from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.dependencies import AuthenticatedUser, require_roles
from app.db.session import get_db
from app.enums.status import UserRole
from app.models.tables import UsageEvent
from app.schemas.data_management import DataUsageResponse, UsagePeriodMetrics, UsageTotals
from app.services.usage_tracking import api_request_count as _api_request_count
from app.services.usage_tracking import token_counts as _token_counts

router = APIRouter(prefix="/data-management", tags=["data-management"])

DISPLAY_TIMEZONE = ZoneInfo("Asia/Shanghai")
BYTES_PER_MB = 1024 * 1024


def _month_start(value: date, offset: int = 0) -> date:
    month_index = value.year * 12 + value.month - 1 + offset
    return date(month_index // 12, month_index % 12 + 1, 1)


def _period_ranges(period: Literal["week", "month"], today: date) -> list[tuple[date, date, str]]:
    if period == "week":
        current_start = today - timedelta(days=today.weekday())
        starts = [current_start - timedelta(weeks=offset) for offset in range(7, -1, -1)]
        return [
            (
                start,
                start + timedelta(days=7),
                f"{start:%m月%d日}-{(start + timedelta(days=6)):%m月%d日}",
            )
            for start in starts
        ]

    current_start = today.replace(day=1)
    starts = [_month_start(current_start, offset) for offset in range(-11, 1)]
    return [
        (start, _month_start(start, 1), f"{start:%Y年%m月}")
        for start in starts
    ]


def _utc_boundary(value: date) -> datetime:
    return datetime.combine(value, time.min, tzinfo=DISPLAY_TIMEZONE).astimezone(UTC)


def _aware_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _token_count(report_data: dict | None) -> int:
    return _token_counts(report_data)[2]


def _bucket_index(timestamp: datetime, boundaries: list[tuple[datetime, datetime]]) -> int | None:
    value = _aware_utc(timestamp)
    for index, (start, end) in enumerate(boundaries):
        if start <= value < end:
            return index
    return None


@router.get("/usage", response_model=DataUsageResponse)
def get_data_usage(
    period: Literal["week", "month"] = Query(default="week"),
    _: AuthenticatedUser = Depends(require_roles(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> DataUsageResponse:
    ranges = _period_ranges(period, datetime.now(DISPLAY_TIMEZONE).date())
    boundaries = [(_utc_boundary(start), _utc_boundary(end)) for start, end, _ in ranges]
    range_start, range_end = boundaries[0][0], boundaries[-1][1]
    values = [
        {
            "photo_count": 0,
            "storage_bytes": 0,
            "api_request_count": 0,
            "token_count": 0,
            "input_token_count": 0,
            "output_token_count": 0,
            "trial_task_count": 0,
        }
        for _ in ranges
    ]

    event_rows = db.execute(
        select(
            UsageEvent.occurred_at,
            UsageEvent.photo_count,
            UsageEvent.storage_bytes,
            UsageEvent.api_request_count,
            UsageEvent.token_count,
            UsageEvent.input_token_count,
            UsageEvent.output_token_count,
            UsageEvent.trial_task_count,
        ).where(
            UsageEvent.occurred_at >= range_start,
            UsageEvent.occurred_at < range_end,
        )
    ).all()
    metric_keys = (
        "photo_count",
        "storage_bytes",
        "api_request_count",
        "token_count",
        "input_token_count",
        "output_token_count",
        "trial_task_count",
    )
    for row in event_rows:
        index = _bucket_index(row[0], boundaries)
        if index is not None:
            for metric_index, metric_key in enumerate(metric_keys, start=1):
                values[index][metric_key] += max(0, int(row[metric_index] or 0))

    total_row = db.execute(
        select(
            *(
                func.coalesce(func.sum(getattr(UsageEvent, metric_key)), 0)
                for metric_key in metric_keys
            )
        )
    ).one()
    totals = {
        metric_key: max(0, int(total_row[index] or 0))
        for index, metric_key in enumerate(metric_keys)
    }

    history = []
    for (start, end, label), metrics in zip(ranges, values, strict=True):
        storage_bytes = metrics["storage_bytes"]
        history.append(
            UsagePeriodMetrics(
                label=label,
                start_date=start,
                end_date=end - timedelta(days=1),
                photo_count=metrics["photo_count"],
                storage_bytes=storage_bytes,
                storage_mb=round(storage_bytes / BYTES_PER_MB, 2),
                api_request_count=metrics["api_request_count"],
                token_count=metrics["token_count"],
                input_token_count=metrics["input_token_count"],
                output_token_count=metrics["output_token_count"],
                trial_task_count=metrics["trial_task_count"],
            )
        )

    total_storage_bytes = totals["storage_bytes"]
    return DataUsageResponse(
        period=period,
        current=history[-1],
        history=history,
        all_time=UsageTotals(
            photo_count=totals["photo_count"],
            storage_bytes=total_storage_bytes,
            storage_mb=round(total_storage_bytes / BYTES_PER_MB, 2),
            api_request_count=totals["api_request_count"],
            token_count=totals["token_count"],
            input_token_count=totals["input_token_count"],
            output_token_count=totals["output_token_count"],
            trial_task_count=totals["trial_task_count"],
        ),
    )
