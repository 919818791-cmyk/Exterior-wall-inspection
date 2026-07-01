from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.dependencies import AuthenticatedUser, require_roles
from app.core.security import hash_password
from app.db.session import get_db
from app.enums.status import UserRole, UserStatus
from app.models.tables import UserAccount
from app.schemas.auth import AccountCreateRequest, AccountRead, AccountUpdateRequest

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

    account = UserAccount(
        username=username,
        password_hash=hash_password(payload.password),
        real_name=_clean_optional_text(payload.real_name),
        phone=_clean_optional_text(payload.phone),
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

    for field in ("real_name", "phone", "organization"):
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
