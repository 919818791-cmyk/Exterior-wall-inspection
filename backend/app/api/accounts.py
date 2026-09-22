from __future__ import annotations

import secrets
from calendar import monthrange
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import and_, case, func, select
from sqlalchemy.orm import Session

from app.api.dependencies import AuthenticatedUser, get_current_user, require_roles
from app.core.config import get_settings
from app.core.security import hash_password
from app.db.session import get_db
from app.enums.status import AccountPlan, ProfessionalApplicationStatus, UserRole, UserStatus
from app.models.tables import UsageEvent, UserAccount
from app.schemas.account_usage import (
    AccountUsageDetailResponse,
    AccountUsagePeriodMetrics,
    AccountQuotaBalance,
    AccountUsageSummaryItem,
    AccountUsageTotals,
    CurrentAccountUsageResponse,
)
from app.schemas.auth import (
    AccountCreateRequest,
    AccountPasswordResetResponse,
    AccountQuotaResetResponse,
    AccountRead,
    AccountUpdateRequest,
    ProfessionalApplicationResponse,
    ProfessionalApplicationReviewRequest,
)
from app.services.photo_upload_quota import reset_account_quota_counters
from app.services.trial_inference_provider import trial_scheduling_settings

router = APIRouter(prefix="/accounts", tags=["accounts"])
TEMPORARY_PASSWORD_BYTES = 18
DISPLAY_TIMEZONE = ZoneInfo("Asia/Shanghai")


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


def _add_months(value: datetime, months: int) -> datetime:
    month_index = value.year * 12 + value.month - 1 + months
    year, month_zero_based = divmod(month_index, 12)
    month = month_zero_based + 1
    return value.replace(year=year, month=month, day=min(value.day, monthrange(year, month)[1]))


def _bucket_index(timestamp: datetime, boundaries: list[tuple[datetime, datetime]]) -> int | None:
    value = _aware_utc(timestamp)
    for index, (start, end) in enumerate(boundaries):
        if start <= value < end:
            return index
    return None


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
    result = AccountRead.model_validate(account)
    expires_at = result.professional_plan_expires_at
    if (
        result.account_plan == AccountPlan.PROFESSIONAL
        and expires_at is not None
        and _aware_utc(expires_at) <= datetime.now(UTC)
    ):
        return result.model_copy(update={"account_plan": AccountPlan.BASIC})
    return result


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
        "detected_photo_count": 0,
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
    if row.event_type == "photo_detection":
        metrics["detected_photo_count"] += max(0, int(row.photo_count or 0))
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
    detected_photo_count = func.coalesce(
        func.sum(
            case(
                (
                    UsageEvent.event_type == "photo_detection",
                    UsageEvent.photo_count,
                ),
                else_=0,
            )
        ),
        0,
    )
    return (
        formal_task_count,
        detected_photo_count,
        *(func.coalesce(func.sum(getattr(UsageEvent, field)), 0) for field in USAGE_SUM_FIELDS),
    )


def _metrics_from_aggregate_row(row: object) -> dict[str, int]:
    formal_tasks = max(0, int(row[0] or 0))
    detected_photos = max(0, int(row[1] or 0))
    sums = {
        field: max(0, int(row[index] or 0))
        for index, field in enumerate(USAGE_SUM_FIELDS, start=2)
    }
    return {
        "task_count": formal_tasks + sums["trial_task_count"],
        "formal_task_count": formal_tasks,
        "detected_photo_count": detected_photos,
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
    """Return current-month activity and the account's photo-detection balances."""
    today = datetime.now(DISPLAY_TIMEZONE).date()
    month_start = today.replace(day=1)
    month_start_utc = _utc_boundary(month_start)
    tomorrow_utc = _utc_boundary(today + timedelta(days=1))
    metrics = _empty_usage_metrics()
    basic_trial_photo_upload_count = 0
    basic_formal_photo_upload_count = 0
    professional_formal_monthly_photo_upload_count = 0
    professional_trial_monthly_photo_upload_count = 0
    account = db.get(UserAccount, current_user.id)
    quota_reset_at = getattr(account, "quota_reset_at", None)
    aware_quota_reset_at = _aware_utc(quota_reset_at) if quota_reset_at is not None else None

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
            UsageEvent.occurred_at < tomorrow_utc,
        )
    ).all()
    for row in rows:
        is_current_month = _aware_utc(row.occurred_at) >= month_start_utc
        is_after_quota_reset = (
            aware_quota_reset_at is None
            or _aware_utc(row.occurred_at) >= aware_quota_reset_at
        )
        if is_current_month:
            _add_usage_event(metrics, row)
        if row.event_type == "photo_detection" and is_after_quota_reset:
            count = max(0, int(row.photo_count or 0))
            if row.source_type == "trial":
                basic_trial_photo_upload_count += count
                if is_current_month:
                    professional_trial_monthly_photo_upload_count += count
            elif row.source_type == "formal":
                basic_formal_photo_upload_count += count
                if is_current_month:
                    professional_formal_monthly_photo_upload_count += count

    scheduling = trial_scheduling_settings(db, get_settings())
    account_detection_quota = getattr(account, "detection_quota", None)

    def effective_limit(default_limit: int) -> int:
        return int(account_detection_quota) if account_detection_quota is not None else default_limit

    return CurrentAccountUsageResponse(
        account_id=current_user.id,
        period_start=month_start,
        period_end=today,
        usage=AccountUsageTotals(**metrics),
        trial_monthly_photo_upload_balance=_quota_balance(
            effective_limit(scheduling.monthly_photo_upload_limit),
            basic_trial_photo_upload_count,
        ),
        basic_formal_monthly_photo_upload_balance=_quota_balance(
            effective_limit(scheduling.basic_formal_monthly_photo_upload_limit),
            basic_formal_photo_upload_count,
        ),
        professional_formal_monthly_photo_upload_balance=_quota_balance(
            effective_limit(scheduling.professional_monthly_photo_upload_limit),
            professional_formal_monthly_photo_upload_count,
        ),
        professional_trial_monthly_photo_upload_balance=_quota_balance(
            effective_limit(scheduling.professional_trial_monthly_photo_upload_limit),
            professional_trial_monthly_photo_upload_count,
        ),
    )


@router.post("/me/professional-application", response_model=ProfessionalApplicationResponse)
def submit_professional_application(
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProfessionalApplicationResponse:
    if current_user.role != UserRole.CUSTOMER.value:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有客户账号可以申请专业版。")

    account = db.get(UserAccount, current_user.id)
    if account is None or account.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="账号不存在。")

    now = datetime.now(UTC)
    expires_at = account.professional_plan_expires_at
    has_active_professional_plan = (
        account.account_plan == AccountPlan.PROFESSIONAL.value
        and (expires_at is None or _aware_utc(expires_at) > now)
    )
    if has_active_professional_plan:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="当前账号已经是专业版套餐。")

    if account.professional_application_status != ProfessionalApplicationStatus.PENDING.value:
        account.professional_application_status = ProfessionalApplicationStatus.PENDING.value
        account.professional_application_requested_at = now
        account.professional_application_reviewed_at = None
        account.professional_application_duration_months = None
        account.account_plan = AccountPlan.BASIC.value
        account.professional_plan_expires_at = None
        db.commit()
        db.refresh(account)

    requested_at = account.professional_application_requested_at or now
    return ProfessionalApplicationResponse(
        status=ProfessionalApplicationStatus.PENDING,
        requested_at=requested_at,
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
            UsageEvent.photo_count,
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
        account_plan=_enum_value(payload.account_plan),
        organization=_clean_optional_text(payload.organization),
        detection_quota=payload.detection_quota,
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
    if "detection_quota" in data:
        account.detection_quota = data["detection_quota"]
    if data.get("role") is not None:
        account.role = next_role
    if data.get("account_plan") is not None:
        account.account_plan = _enum_value(data["account_plan"])
        account.professional_plan_expires_at = None
    if data.get("status") is not None:
        account.status = next_status

    db.commit()
    db.refresh(account)
    return _to_account_read(account)


@router.post(
    "/{account_id}/professional-application/review",
    response_model=AccountRead,
)
def review_professional_application(
    account_id: UUID,
    payload: ProfessionalApplicationReviewRequest,
    _: AuthenticatedUser = Depends(require_roles(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> AccountRead:
    account = _account_or_404(db, account_id)
    if account.role != UserRole.CUSTOMER.value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="只有客户账号可以申请专业版。")
    if account.professional_application_status is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该账号尚未提交专业版申请。")

    now = datetime.now(UTC)
    account.professional_application_status = payload.decision
    account.professional_application_reviewed_at = now
    account.professional_application_duration_months = payload.duration_months
    if payload.decision == ProfessionalApplicationStatus.APPROVED.value:
        account.account_plan = AccountPlan.PROFESSIONAL.value
        account.professional_plan_expires_at = _add_months(now, payload.duration_months)
    else:
        account.account_plan = AccountPlan.BASIC.value
        account.professional_plan_expires_at = None

    db.commit()
    db.refresh(account)
    return _to_account_read(account)


@router.post("/{account_id}/reset-password", response_model=AccountPasswordResetResponse)
def reset_account_password(
    account_id: UUID,
    response: Response,
    _: AuthenticatedUser = Depends(require_roles(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> AccountPasswordResetResponse:
    account = _account_or_404(db, account_id)
    temporary_password = secrets.token_urlsafe(TEMPORARY_PASSWORD_BYTES)
    account.password_hash = hash_password(temporary_password)
    db.commit()
    db.refresh(account)
    response.headers["Cache-Control"] = "no-store"
    return AccountPasswordResetResponse(
        account=_to_account_read(account),
        temporary_password=temporary_password,
    )


@router.post("/{account_id}/reset-quotas", response_model=AccountQuotaResetResponse)
def reset_account_quotas(
    account_id: UUID,
    _: AuthenticatedUser = Depends(require_roles(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> AccountQuotaResetResponse:
    account = _account_or_404(db, account_id)
    reset_at = datetime.now(UTC)
    reset_account_quota_counters(account.id)
    account.quota_reset_at = reset_at
    db.commit()
    return AccountQuotaResetResponse(reset_at=reset_at)
