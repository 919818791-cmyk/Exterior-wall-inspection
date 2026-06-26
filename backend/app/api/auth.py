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
from app.core.security import create_access_token, verify_password
from app.db.session import get_db
from app.enums.status import UserStatus
from app.models.tables import UserAccount
from app.schemas.auth import AuthUserRead, LoginRequest, LoginResponse, LogoutResponse

router = APIRouter(prefix="/auth", tags=["auth"])


def _to_user_read(user: AuthenticatedUser) -> AuthUserRead:
    return AuthUserRead(
        id=user.id,
        username=user.username,
        real_name=user.real_name,
        role=user.role,
        organization=user.organization,
    )


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
    if user is None or user.status != UserStatus.ACTIVE.value or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误。")

    user.last_login_at = datetime.now(UTC)
    db.commit()
    current_user = AuthenticatedUser.from_model(user)
    access_token, expires_at, _ = create_access_token(user_id=str(user.id), role=user.role)
    return LoginResponse(access_token=access_token, expires_at=expires_at, user=_to_user_read(current_user))


@router.get("/me", response_model=AuthUserRead)
def me(current_user: AuthenticatedUser = Depends(get_current_user)) -> AuthUserRead:
    return _to_user_read(current_user)


@router.post("/logout", response_model=LogoutResponse)
def logout(session: AuthenticatedSession = Depends(get_current_session)) -> LogoutResponse:
    revoke_token(session.token_id, session.expires_at)
    return LogoutResponse()
