from __future__ import annotations

from datetime import datetime, timedelta
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, case, func, select
from sqlalchemy.orm import Session

from app.api.data_management import DISPLAY_TIMEZONE, _aware_utc, _bucket_index, _period_ranges, _utc_boundary
from app.api.dependencies import AuthenticatedUser, get_current_user, require_roles
from app.core.config import get_settings
from app.core.security import hash_password
from app.db.session import get_db
from app.enums.status import UserRole, UserStatus
from app.models.tables import UsageEvent, UserAccount
from app.schemas.account_usage import (
    AccountUsageDetailResponse,
    AccountUsagePeriodMetrics,
    AccountQuotaBalance,
    AccountUsageSummaryItem,
    AccountUsageTotals,
    CurrentAccountUsageResponse,
)
from app.schemas.auth import AccountCreateRequest, AccountRead, AccountUpdateRequest
from app.services.trial_inference_provider import trial_scheduling_settings

router = APIRouter(prefix="/accounts", tags=["accounts"])
DEFAULT_RESET_PASSWORD = "123456"


def _enum_value(value: object) -> str:
    return getattr(value, "value", value)


def _clean_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _account_or_404(db: Session, account_id: UUID) -> UserAccount:
    account = db.scalar(
        select(UserAccount).where(
            UserAccount.id == account_id,
            UserAccount.deleted_at.is_(None),
        )
    )
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="账号不存在。")
    return account


def _ensure_username_available(db: Session, username: str, exclude_id: UUID | None = None) -> None:
    criteria = [func.lower(UserAccount.username) == username.lower()]
    if exclude_id is not None:
        criteria.append(UserAccount.id != exclude_id)
    if db.scalar(select(UserAccount.id).where(*criteria)) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="用户名已存在。")


def _ensure_phone_available(db: Session, phone: str, exclude_id: UUID | None = None) -> None:
    criteria = [UserAccount.phone == phone]
    if exclude_id is not None:
        criteria.append(UserAccount.id != exclude_id)
    if db.scalar(select(UserAccount.id).where(*criteria)) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="手机号已被使用。")


def _has_other_active_admin(db: Session, account_id: UUID) -> bool:
    return (
        db.scalar(
            select(func.count())
            .select_from(UserAccount)
            .where(
                UserAccount.id != account_id,
                UserAccount.role == UserRole.ADMIN.value,
                UserAccount.status == UserStatus.ACTIVE.value,
                UserAccount.deleted_at.is_(None),
            )
        )
        or 0
    ) > 0


def _ensure_admin_account_remains_available(
    db: Session,
    account: UserAccount,
    current_user: AuthenticatedUser,
    next_role: str,
    next_status: str,
) -> None:
    if account.id == current_user.id and (
        next_role != UserRole.ADMIN.value or next_status != UserStatus.ACTIVE.value
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能取消当前登录管理员的权限或禁用当前账号。")
    if (
        account.role == UserRole.ADMIN.value
        and (next_role != UserRole.ADMIN.value or next_status != UserStatus.ACTIVE.value)
        and not _has_other_active_admin(db, account.id)
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="至少需要保留一个启用的管理员账号。")


def _to_account_read(account: UserAccount) -> AccountRead:
    return AccountRead.model_validate(account)


USAGE_SUM_FIELDS = (
    "api_request_count",
    "token_count",
    "input_token_count",
    "output_token_count",
    "trial_task_count",
)


def _empty_usage_metrics() -> dict[str, int]:
    return {
        "task_count": 0,
        "formal_task_count": 0,
        "trial_task_count": 0,
        "api_request_count": 0,
        "token_count": 0,
        "input_token_count": 0,
        "output_token_count": 0,
    }


def _is_formal_inference(event_type: object, source_type: object) -> bool:
    return event_type == "inference" and source_type == "formal"


def _add_usage_event(metrics: dict[str, int], row: object) -> None:
    if _is_formal_inference(row.event_type, row.source_type):
        metrics["formal_task_count"] += 1
        metrics["task_count"] += 1
    trial_tasks = max(0, int(row.trial_task_count or 0))
    metrics["trial_task_count"] += trial_tasks
    metrics["task_count"] += trial_tasks
    for field in USAGE_SUM_FIELDS[:-1]:
        metrics[field] += max(0, int(getattr(row, field) or 0))


def _usage_aggregate_columns() -> tuple[object, ...]:
    formal_task_count = func.coalesce(
        func.sum(
            case(
                (
                    and_(
                        UsageEvent.event_type == "inference",
                        UsageEvent.source_type == "formal",
                    ),
                    1,
                ),
                else_=0,
            )
        ),
        0,
    )
    return (
        formal_task_count,
        *(func.coalesce(func.sum(getattr(UsageEvent, field)), 0) for field in USAGE_SUM_FIELDS),
    )


def _metrics_from_aggregate_row(row: object) -> dict[str, int]:
    formal_tasks = max(0, int(row[0] or 0))
    sums = {
        field: max(0, int(row[index] or 0))
        for index, field in enumerate(USAGE_SUM_FIELDS, start=1)
    }
    return {
        "task_count": formal_tasks + sums["trial_task_count"],
        "formal_task_count": formal_tasks,
        **sums,
    }


def _quota_balance(limit: int, used: int) -> AccountQuotaBalance:
    normalized_used = max(0, used)
    return AccountQuotaBalance(
        limit=limit,
        used=normalized_used,
        remaining=max(0, limit - normalized_used),
    )


@router.get("", response_model=list[AccountRead])
def list_accounts(
    _: AuthenticatedUser = Depends(require_roles(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> list[AccountRead]:
    accounts = list(
        db.scalars(
            select(UserAccount)
            .where(UserAccount.deleted_at.is_(None))
            .order_by(UserAccount.created_at.desc(), UserAccount.username.asc())
        )
    )
    return [_to_account_read(account) for account in accounts]


@router.get("/usage-summary", response_model=list[AccountUsageSummaryItem])
def list_account_usage_summary(
    _: AuthenticatedUser = Depends(require_roles(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> list[AccountUsageSummaryItem]:
    rows = db.execute(
        select(UsageEvent.actor_id, *_usage_aggregate_columns())
        .where(UsageEvent.actor_id.is_not(None))
        .group_by(UsageEvent.actor_id)
    ).all()
    return [
        AccountUsageSummaryItem(
            account_id=row[0],
            **_metrics_from_aggregate_row(tuple(row)[1:]),
        )
        for row in rows
        if row[0] is not None
    ]


@router.get("/me/usage", response_model=CurrentAccountUsageResponse)
def get_current_account_usage(
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CurrentAccountUsageResponse:
    """Return the signed-in account's current-month usage and today's Trial API quota balance."""
    today = datetime.now(DISPLAY_TIMEZONE).date()
    month_start = today.replace(day=1)
    month_start_utc = _utc_boundary(month_start)
    tomorrow_utc = _utc_boundary(today + timedelta(days=1))
    today_utc = _utc_boundary(today)
    metrics = _empty_usage_metrics()
    trial_api_request_count = 0

    rows = db.execute(
        select(
            UsageEvent.occurred_at,
            UsageEvent.event_type,
            UsageEvent.source_type,
            UsageEvent.photo_count,
            UsageEvent.api_request_count,
            UsageEvent.token_count,
            UsageEvent.input_token_count,
            UsageEvent.output_token_count,
            UsageEvent.trial_task_count,
        ).where(
            UsageEvent.actor_id == current_user.id,
            UsageEvent.occurred_at >= month_start_utc,
            UsageEvent.occurred_at < tomorrow_utc,
        )
    ).all()
    for row in rows:
        _add_usage_event(metrics, row)
        if (
            row.source_type == "trial"
            and row.event_type == "inference"
            and today_utc <= _aware_utc(row.occurred_at) < tomorrow_utc
        ):
            trial_api_request_count += max(0, int(row.api_request_count or 0))

    api_request_limit = trial_scheduling_settings(db, get_settings()).daily_api_request_limit
    return CurrentAccountUsageResponse(
        account_id=current_user.id,
        period_start=month_start,
        period_end=today,
        usage=AccountUsageTotals(**metrics),
        trial_api_request_balance=_quota_balance(api_request_limit, trial_api_request_count),
    )


@router.get("/{account_id}/usage", response_model=AccountUsageDetailResponse)
def get_account_usage(
    account_id: UUID,
    period: Literal["week", "month"] = Query(default="week"),
    _: AuthenticatedUser = Depends(require_roles(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> AccountUsageDetailResponse:
    _account_or_404(db, account_id)
    ranges = _period_ranges(period, datetime.now(DISPLAY_TIMEZONE).date())
    boundaries = [(_utc_boundary(start), _utc_boundary(end)) for start, end, _ in ranges]
    values = [_empty_usage_metrics() for _ in ranges]

    rows = db.execute(
        select(
            UsageEvent.occurred_at,
            UsageEvent.event_type,
            UsageEvent.source_type,
            UsageEvent.api_request_count,
            UsageEvent.token_count,
            UsageEvent.input_token_count,
            UsageEvent.output_token_count,
            UsageEvent.trial_task_count,
        ).where(
            UsageEvent.actor_id == account_id,
            UsageEvent.occurred_at >= boundaries[0][0],
            UsageEvent.occurred_at < boundaries[-1][1],
        )
    ).all()
    for row in rows:
        bucket = _bucket_index(row.occurred_at, boundaries)
        if bucket is not None:
            _add_usage_event(values[bucket], row)

    total_row = db.execute(
        select(*_usage_aggregate_columns()).where(UsageEvent.actor_id == account_id)
    ).one()
    history = [
        AccountUsagePeriodMetrics(
            label=label,
            start_date=start,
            end_date=end - timedelta(days=1),
            **metrics,
        )
        for (start, end, label), metrics in zip(ranges, values, strict=True)
    ]
    return AccountUsageDetailResponse(
        account_id=account_id,
        period=period,
        current=history[-1],
        history=history,
        all_time=AccountUsageTotals(**_metrics_from_aggregate_row(total_row)),
    )


@router.post("", response_model=AccountRead, status_code=status.HTTP_201_CREATED)
def create_account(
    payload: AccountCreateRequest,
    _: AuthenticatedUser = Depends(require_roles(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> AccountRead:
    username = payload.username.strip()
    if not username:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="用户名不能为空。")
    _ensure_username_available(db, username)
    phone = _clean_optional_text(payload.phone)
    if phone is not None:
        _ensure_phone_available(db, phone)

    account = UserAccount(
        username=username,
        password_hash=hash_password(payload.password),
        real_name=_clean_optional_text(payload.real_name),
        phone=phone,
        role=_enum_value(payload.role),
        organization=_clean_optional_text(payload.organization),
        status=_enum_value(payload.status),
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return _to_account_read(account)


@router.put("/{account_id}", response_model=AccountRead)
def update_account(
    account_id: UUID,
    payload: AccountUpdateRequest,
    current_user: AuthenticatedUser = Depends(require_roles(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> AccountRead:
    account = _account_or_404(db, account_id)
    data = payload.model_dump(exclude_unset=True)

    if "username" in data:
        username = (data.pop("username") or "").strip()
        if not username:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="用户名不能为空。")
        if username != account.username:
            _ensure_username_available(db, username, exclude_id=account.id)
        account.username = username

    next_role = account.role if data.get("role") is None else _enum_value(data["role"])
    next_status = account.status if data.get("status") is None else _enum_value(data["status"])
    _ensure_admin_account_remains_available(db, account, current_user, next_role, next_status)

    if "phone" in data:
        phone = _clean_optional_text(data.pop("phone"))
        if phone is not None and phone != account.phone:
            _ensure_phone_available(db, phone, exclude_id=account.id)
        account.phone = phone

    for field in ("real_name", "organization"):
        if field in data:
            setattr(account, field, _clean_optional_text(data[field]))
    if data.get("role") is not None:
        account.role = next_role
    if data.get("status") is not None:
        account.status = next_status

    db.commit()
    db.refresh(account)
    return _to_account_read(account)


@router.post("/{account_id}/reset-password", response_model=AccountRead)
def reset_account_password(
    account_id: UUID,
    _: AuthenticatedUser = Depends(require_roles(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> AccountRead:
    account = _account_or_404(db, account_id)
    account.password_hash = hash_password(DEFAULT_RESET_PASSWORD)
    db.commit()
    db.refresh(account)
    return _to_account_read(account)
