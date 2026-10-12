from __future__ import annotations

from contextlib import nullcontext
from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.enums.status import ProjectStatus, UserRole
from app.models.tables import Photo, Project, QuickDetectionPhoto, UsageEvent, UserAccount
from app.services.trial_inference_provider import trial_scheduling_settings
from app.services.usage_control import (
    UsageControlStore,
    enforce_limit,
    get_usage_store,
)


PhotoDetectionSource = Literal["trial", "formal"]
TRIAL_LIFETIME_SCOPE = "photo-detection:trial:lifetime"
FORMAL_LIFETIME_SCOPE = "photo-detection:formal:lifetime"


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


def _photo_detection_count(
    db: Session | None,
    actor_id: UUID,
    source: PhotoDetectionSource,
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
    settings: Settings | None = None,
) -> tuple[int, int]:
    scheduling = trial_scheduling_settings(db, settings or get_settings())
    account = db.get(UserAccount, actor_id) if db is not None and hasattr(db, "get") else None
    account_quota = getattr(account, f"{source}_detection_quota", None)
    default_limit = (
        scheduling.trial_photo_detection_limit
        if source == "trial"
        else scheduling.formal_photo_detection_limit
    )
    limit = max(1, int(account_quota)) if account_quota is not None else default_limit
    return limit, _photo_detection_count(db, actor_id, source)


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
    amount: int = 1,
    settings: Settings | None = None,
) -> None:
    """Keep undetected uploads within the account's current detection balance."""
    if role not in {UserRole.CUSTOMER.value, UserRole.ADMIN.value} or not isinstance(db, Session):
        return
    _lock_account_quota(db, actor_id)
    limit, used = _quota_limit_and_baseline(
        db,
        actor_id,
        source,
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
    amount: int = 1,
    db: Session | None = None,
    settings: Settings | None = None,
) -> PhotoDetectionQuotaReservation:
    store = get_usage_store()
    if role not in {UserRole.CUSTOMER.value, UserRole.ADMIN.value}:
        return PhotoDetectionQuotaReservation(store=store, entries=())
    _lock_account_quota(db, actor_id)
    user_identity = str(actor_id)
    limit, usage_baseline = _quota_limit_and_baseline(
        db,
        actor_id,
        source,
        settings,
    )
    entries: list[tuple[str, str]] = []
    source_label = "快速体验" if source == "trial" else "专业检测"
    scope = TRIAL_LIFETIME_SCOPE if source == "trial" else FORMAL_LIFETIME_SCOPE
    limits = ((scope, user_identity, limit, None),)
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
    for scope, scoped_identity in (
        (TRIAL_LIFETIME_SCOPE, identity),
        (FORMAL_LIFETIME_SCOPE, identity),
        ("trial:generate:user", identity),
    ):
        store.clear_limit(scope, scoped_identity)
