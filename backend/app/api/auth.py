from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.dependencies import (
    AuthenticatedSession,
    AuthenticatedUser,
    ensure_demo_users,
    get_current_session,
    get_current_user,
    revoke_token,
)
from app.core.security import create_access_token, hash_password, verify_password
from app.db.session import get_db
from app.enums.status import UserRole, UserStatus
from app.models.tables import UserAccount
from app.schemas.auth import (
    ChangePasswordRequest,
    AuthUserRead,
    LoginRequest,
    LoginResponse,
    LogoutResponse,
    TrialApplicationRequest,
    TrialApplicationResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _to_user_read(user: AuthenticatedUser) -> AuthUserRead:
    return AuthUserRead(
        id=user.id,
        username=user.username,
        real_name=user.real_name,
        role=user.role,
        organization=user.organization,
    )


def _clean_required_text(value: str, field_name: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field_name}不能为空。")
    return cleaned


def _ensure_username_available(db: Session, username: str) -> None:
    existing_id = db.scalar(
        select(UserAccount.id).where(
            func.lower(UserAccount.username) == username.lower(),
        )
    )
    if existing_id is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="用户名已存在。")


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> LoginResponse:
    ensure_demo_users(db)
    db.flush()
    user = db.scalar(
        select(UserAccount).where(
            func.lower(UserAccount.username) == payload.username.strip().lower(),
            UserAccount.deleted_at.is_(None),
        )
    )
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误。")
    if user.status != UserStatus.ACTIVE.value:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="账号尚未开通，请等待管理员审核。")

    user.last_login_at = datetime.now(UTC)
    db.commit()
    current_user = AuthenticatedUser.from_model(user)
    access_token, expires_at, _ = create_access_token(user_id=str(user.id), role=user.role)
    return LoginResponse(access_token=access_token, expires_at=expires_at, user=_to_user_read(current_user))


@router.post(
    "/trial-application",
    response_model=TrialApplicationResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_trial_application(payload: TrialApplicationRequest, db: Session = Depends(get_db)) -> TrialApplicationResponse:
    username = _clean_required_text(payload.username, "用户名")
    _ensure_username_available(db, username)

    account = UserAccount(
        username=username,
        password_hash=hash_password(payload.password),
        real_name=_clean_required_text(payload.real_name, "姓名"),
        phone=_clean_required_text(payload.phone, "联系电话"),
        role=UserRole.CUSTOMER.value,
        organization=_clean_required_text(payload.organization, "单位名称"),
        status=UserStatus.DISABLED.value,
    )
    db.add(account)
    db.commit()
    return TrialApplicationResponse(username=username)


@router.get("/me", response_model=AuthUserRead)
def me(current_user: AuthenticatedUser = Depends(get_current_user)) -> AuthUserRead:
    return _to_user_read(current_user)


@router.post("/change-password", response_model=LogoutResponse)
def change_password(
    payload: ChangePasswordRequest,
    session: AuthenticatedSession = Depends(get_current_session),
    db: Session = Depends(get_db),
) -> LogoutResponse:
    user = db.get(UserAccount, session.user.id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录状态已失效，请重新登录。")
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前密码不正确。")
    if verify_password(payload.new_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="新密码不能与当前密码相同。")

    user.password_hash = hash_password(payload.new_password)
    db.commit()
    revoke_token(session.token_id, session.expires_at)
    return LogoutResponse()


@router.post("/logout", response_model=LogoutResponse)
def logout(session: AuthenticatedSession = Depends(get_current_session)) -> LogoutResponse:
    revoke_token(session.token_id, session.expires_at)
    return LogoutResponse()
