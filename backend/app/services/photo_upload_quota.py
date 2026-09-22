from __future__ import annotations

from contextlib import nullcontext
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.enums.status import AccountPlan, ProjectStatus, UserRole
from app.models.tables import Photo, Project, QuickDetectionPhoto, UsageEvent, UserAccount
from app.services.trial_inference_provider import trial_scheduling_settings
from app.services.usage_control import (
    UsageControlStore,
    enforce_limit,
    get_usage_store,
)


PhotoDetectionSource = Literal["trial", "formal"]
TIMEZONE_NAME = "Asia/Shanghai"
BASIC_TRIAL_LIFETIME_SCOPE = "photo-detection:basic:trial:lifetime"
BASIC_FORMAL_LIFETIME_SCOPE = "photo-detection:basic:formal:lifetime"
PROFESSIONAL_FORMAL_MONTHLY_SCOPE = "photo-detection:professional:formal:monthly"
PROFESSIONAL_TRIAL_MONTHLY_SCOPE = "photo-detection:professional:trial:monthly"


@dataclass(frozen=True, slots=True)
class PhotoDetectionQuotaReservation:
    store: UsageControlStore
    entries: tuple[tuple[str, str], ...]


def _lock_account_quota(db: Session | None, actor_id: UUID) -> None:
    if db is None or not isinstance(db, Session):
        return
    db.scalar(
        select(UserAccount.id)
        .where(UserAccount.id == actor_id)
        .with_for_update()
    )


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


def _current_month_start_utc() -> datetime:
    now = datetime.now(ZoneInfo(TIMEZONE_NAME))
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)


def _photo_detection_count(
    db: Session | None,
    actor_id: UUID,
    source: PhotoDetectionSource,
    *,
    since: datetime | None = None,
) -> int:
    if db is None or not hasattr(db, "get") or not hasattr(db, "scalar"):
        return 0
    with getattr(db, "no_autoflush", nullcontext()):
        account = db.get(UserAccount, actor_id)
        quota_reset_at = getattr(account, "quota_reset_at", None)
        criteria = [
            UsageEvent.actor_id == actor_id,
            UsageEvent.event_type == "photo_detection",
            UsageEvent.source_type == source,
        ]
        if since is not None:
            criteria.append(UsageEvent.occurred_at >= since)
        if quota_reset_at is not None:
            criteria.append(UsageEvent.occurred_at >= quota_reset_at)
        count = db.scalar(
            select(func.coalesce(func.sum(UsageEvent.photo_count), 0)).where(*criteria)
        )
    return max(0, int(count or 0))


def _quota_limit_and_baseline(
    db: Session | None,
    actor_id: UUID,
    source: PhotoDetectionSource,
    account_plan: str,
    settings: Settings | None = None,
) -> tuple[int, int]:
    scheduling = trial_scheduling_settings(db, settings or get_settings())
    account = db.get(UserAccount, actor_id) if db is not None and hasattr(db, "get") else None
    account_quota = getattr(account, "detection_quota", None)
    if account_quota is not None:
        limit = max(1, int(account_quota))
        baseline = _photo_detection_count(
            db,
            actor_id,
            source,
            since=_current_month_start_utc() if account_plan == AccountPlan.PROFESSIONAL.value else None,
        )
    elif account_plan == AccountPlan.PROFESSIONAL.value:
        limit = (
            scheduling.professional_trial_monthly_photo_upload_limit
            if source == "trial"
            else scheduling.professional_monthly_photo_upload_limit
        )
        baseline = _photo_detection_count(
            db,
            actor_id,
            source,
            since=_current_month_start_utc(),
        )
    elif source == "trial":
        limit = scheduling.monthly_photo_upload_limit
        baseline = _photo_detection_count(db, actor_id, source)
    else:
        limit = scheduling.basic_formal_monthly_photo_upload_limit
        baseline = _photo_detection_count(db, actor_id, source)
    return limit, baseline


def _pending_photo_count(
    db: Session,
    actor_id: UUID,
    source: PhotoDetectionSource,
) -> int:
    if source == "trial":
        statement = select(func.count(QuickDetectionPhoto.id)).where(
            QuickDetectionPhoto.uploaded_by == actor_id,
            QuickDetectionPhoto.generated_result_id.is_(None),
        )
    else:
        statement = (
            select(func.count(Photo.id))
            .join(Project, Project.id == Photo.project_id)
            .where(
                Project.created_by == actor_id,
                Project.status == ProjectStatus.DRAFT.value,
                Project.deleted_at.is_(None),
                Photo.deleted_at.is_(None),
            )
        )
    return max(0, int(db.scalar(statement) or 0))


def ensure_photo_upload_capacity(
    db: Session,
    actor_id: UUID,
    *,
    source: PhotoDetectionSource,
    role: str = UserRole.CUSTOMER.value,
    account_plan: str = AccountPlan.BASIC.value,
    amount: int = 1,
    settings: Settings | None = None,
) -> None:
    """Keep undetected uploads within the account's current detection balance."""
    if role != UserRole.CUSTOMER.value or not isinstance(db, Session):
        return
    _lock_account_quota(db, actor_id)
    limit, used = _quota_limit_and_baseline(
        db,
        actor_id,
        source,
        account_plan,
        settings,
    )
    pending = _pending_photo_count(db, actor_id, source)
    available = max(0, limit - used - pending)
    if amount > available:
        remaining = max(0, limit - used)
        source_label = "快速体验" if source == "trial" else "专业检测"
        raise HTTPException(
            status_code=409,
            detail=(
                f"账号当前{source_label}照片额度剩余 {remaining} 张，"
                f"已有 {pending} 张未送检照片，本次最多还能上传 {available} 张。"
            ),
        )


def reserve_photo_detection_quota(
    actor_id: UUID,
    *,
    source: PhotoDetectionSource,
    role: str = UserRole.CUSTOMER.value,
    account_plan: str = AccountPlan.BASIC.value,
    amount: int = 1,
    db: Session | None = None,
    settings: Settings | None = None,
) -> PhotoDetectionQuotaReservation:
    store = get_usage_store()
    if role != UserRole.CUSTOMER.value:
        return PhotoDetectionQuotaReservation(store=store, entries=())
    _lock_account_quota(db, actor_id)
    user_identity = str(actor_id)
    limit, usage_baseline = _quota_limit_and_baseline(
        db,
        actor_id,
        source,
        account_plan,
        settings,
    )
    entries: list[tuple[str, str]] = []
    source_label = "快速体验" if source == "trial" else "专业检测"
    if account_plan == AccountPlan.PROFESSIONAL.value:
        scope = PROFESSIONAL_TRIAL_MONTHLY_SCOPE if source == "trial" else PROFESSIONAL_FORMAL_MONTHLY_SCOPE
        limits = ((
            scope,
            _monthly_identity(user_identity),
            limit,
            _seconds_until_next_month(),
        ),)
    elif source == "trial":
        limits = ((
            BASIC_TRIAL_LIFETIME_SCOPE,
            user_identity,
            limit,
            None,
        ),)
    else:
        limits = ((
            BASIC_FORMAL_LIFETIME_SCOPE,
            user_identity,
            limit,
            None,
        ),)
    try:
        for scope, identity, limit, ttl_seconds in limits:
            enforce_limit(
                store,
                scope,
                identity,
                amount=amount,
                limit=limit,
                ttl_seconds=ttl_seconds,
                baseline=usage_baseline,
                detail=lambda result: (
                    f"账号当前{source_label}照片额度剩余 "
                    f"{max(0, limit - max(0, result.current - amount))} 张，"
                    f"本次检测包含 {amount} 张照片，请减少照片数量后重试。"
                ),
            )
            entries.append((scope, identity))
    except Exception:
        for scope, identity in entries:
            store.refund(scope, identity, amount=amount)
        raise
    return PhotoDetectionQuotaReservation(store=store, entries=tuple(entries))


def refund_photo_detection_quota(
    reservation: PhotoDetectionQuotaReservation,
    *,
    amount: int = 1,
) -> None:
    for scope, identity in reservation.entries:
        reservation.store.refund(scope, identity, amount=amount)


def reset_account_quota_counters(actor_id: UUID) -> None:
    store = get_usage_store()
    identity = str(actor_id)
    month_identity = _monthly_identity(identity)
    for scope, scoped_identity in (
        (BASIC_TRIAL_LIFETIME_SCOPE, identity),
        (BASIC_FORMAL_LIFETIME_SCOPE, identity),
        (PROFESSIONAL_FORMAL_MONTHLY_SCOPE, month_identity),
        (PROFESSIONAL_TRIAL_MONTHLY_SCOPE, month_identity),
        ("trial:generate:user", identity),
    ):
        store.clear_limit(scope, scoped_identity)
