from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.services.trial_inference_provider import trial_scheduling_settings
from app.services.usage_control import (
    UsageControlStore,
    daily_identity,
    enforce_limit,
    get_usage_store,
    seconds_until_next_day,
)


PhotoUploadSource = Literal["trial", "formal"]
TIMEZONE_NAME = "Asia/Shanghai"
TRIAL_DAILY_SCOPE = "photo-upload:trial:daily"
TRIAL_MONTHLY_SCOPE = "photo-upload:trial:monthly"
FORMAL_MONTHLY_SCOPE = "photo-upload:formal:monthly"


@dataclass(frozen=True, slots=True)
class PhotoUploadQuotaReservation:
    store: UsageControlStore
    entries: tuple[tuple[str, str], ...]


def _monthly_identity(identity: str) -> str:
    month = datetime.now(ZoneInfo(TIMEZONE_NAME)).strftime("%Y-%m")
    return f"{identity}:{month}"


def _seconds_until_next_month() -> int:
    now = datetime.now(ZoneInfo(TIMEZONE_NAME))
    if now.month == 12:
        next_month = now.replace(year=now.year + 1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        next_month = now.replace(month=now.month + 1, day=1, hour=0, minute=0, second=0, microsecond=0)
    return max(1, int((next_month - now).total_seconds()))


def reserve_photo_upload_quota(
    actor_id: UUID,
    *,
    source: PhotoUploadSource,
    amount: int = 1,
    db: Session | None = None,
    settings: Settings | None = None,
) -> PhotoUploadQuotaReservation:
    scheduling = trial_scheduling_settings(db, settings or get_settings())
    store = get_usage_store()
    user_identity = str(actor_id)
    entries: list[tuple[str, str]] = []
    limits = (
        (
            TRIAL_DAILY_SCOPE,
            daily_identity(user_identity),
            scheduling.daily_photo_upload_limit,
            seconds_until_next_day(),
            f"快速体验每账号每天最多上传 {scheduling.daily_photo_upload_limit} 张照片。",
        ),
        (
            TRIAL_MONTHLY_SCOPE if source == "trial" else FORMAL_MONTHLY_SCOPE,
            _monthly_identity(user_identity),
            (
                scheduling.monthly_photo_upload_limit
                if source == "trial"
                else scheduling.formal_monthly_photo_upload_limit
            ),
            _seconds_until_next_month(),
            (
                f"快速体验每账号每月最多上传 {scheduling.monthly_photo_upload_limit} 张照片。"
                if source == "trial"
                else f"专业检测每账号每月最多上传 {scheduling.formal_monthly_photo_upload_limit} 张照片。"
            ),
        ),
    )
    if source == "formal":
        limits = limits[1:]
    try:
        for scope, identity, limit, ttl_seconds, detail in limits:
            enforce_limit(
                store,
                scope,
                identity,
                amount=amount,
                limit=limit,
                ttl_seconds=ttl_seconds,
                detail=detail,
            )
            entries.append((scope, identity))
    except Exception:
        for scope, identity in entries:
            store.refund(scope, identity, amount=amount)
        raise
    return PhotoUploadQuotaReservation(store=store, entries=tuple(entries))


def refund_photo_upload_quota(
    reservation: PhotoUploadQuotaReservation,
    *,
    amount: int = 1,
) -> None:
    for scope, identity in reservation.entries:
        reservation.store.refund(scope, identity, amount=amount)
