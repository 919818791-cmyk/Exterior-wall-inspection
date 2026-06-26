from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from threading import Lock
from typing import Callable
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import decode_access_token, hash_password
from app.db.session import get_db
from app.enums.status import UserRole, UserStatus
from app.models.tables import Project, UserAccount


bearer_scheme = HTTPBearer(auto_error=False)
_revoked_tokens: dict[str, int] = {}
_revoked_tokens_lock = Lock()

DEMO_USERS = (
    {
        "id": UUID("00000000-0000-0000-0000-000000000001"),
        "username": "customer",
        "password": "Customer123!",
        "real_name": "演示客户",
        "role": UserRole.CUSTOMER.value,
        "organization": "示例委托单位",
    },
    {
        "id": UUID("00000000-0000-0000-0000-000000000002"),
        "username": "reviewer",
        "password": "Reviewer123!",
        "real_name": "演示审核员",
        "role": UserRole.REVIEWER.value,
        "organization": "内部审核组",
    },
    {
        "id": UUID("00000000-0000-0000-0000-000000000003"),
        "username": "admin",
        "password": "Admin123!",
        "real_name": "平台管理员",
        "role": UserRole.ADMIN.value,
        "organization": "平台运维组",
    },
)


@dataclass(frozen=True)
class AuthenticatedUser:
    id: UUID
    username: str
    real_name: str | None
    role: str
    organization: str | None

    @classmethod
    def from_model(cls, user: UserAccount) -> "AuthenticatedUser":
        return cls(
            id=user.id,
            username=user.username,
            real_name=user.real_name,
            role=user.role,
            organization=user.organization,
        )


@dataclass(frozen=True)
class AuthenticatedSession:
    user: AuthenticatedUser
    token_id: str
    expires_at: int


def ensure_demo_users(db: Session) -> None:
    """Seed the documented development accounts only when explicitly enabled."""
    if not get_settings().auth_seed_demo_users:
        return

    for account in DEMO_USERS:
        user = db.get(UserAccount, account["id"])
        if user is None:
            user = UserAccount(
                id=account["id"],
                username=account["username"],
                password_hash=hash_password(account["password"]),
                real_name=account["real_name"],
                role=account["role"],
                organization=account["organization"],
                status=UserStatus.ACTIVE.value,
            )
            db.add(user)
            continue

        # These identifiers belonged to pre-auth development placeholders. Upgrade them
        # to the documented demo identities while preserving existing project ownership.
        if user.username.startswith("phase"):
            user.username = account["username"]
            user.password_hash = hash_password(account["password"])
            user.real_name = account["real_name"]
            user.role = account["role"]
            user.organization = account["organization"]
            user.status = UserStatus.ACTIVE.value
            user.deleted_at = None


def _unauthorized(detail: str = "登录状态已失效，请重新登录。") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _is_token_revoked(token_id: str) -> bool:
    now = int(datetime.now(UTC).timestamp())
    with _revoked_tokens_lock:
        expired = [key for key, expiry in _revoked_tokens.items() if expiry <= now]
        for key in expired:
            _revoked_tokens.pop(key, None)
        return token_id in _revoked_tokens


def revoke_token(token_id: str, expires_at: int) -> None:
    with _revoked_tokens_lock:
        _revoked_tokens[token_id] = expires_at


def get_current_session(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> AuthenticatedSession:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _unauthorized("请先登录后再访问业务接口。")
    payload = decode_access_token(credentials.credentials)
    if payload is None or _is_token_revoked(payload["jti"]):
        raise _unauthorized()

    try:
        user_id = UUID(payload["sub"])
    except ValueError as error:
        raise _unauthorized() from error
    user = db.scalar(
        select(UserAccount).where(
            UserAccount.id == user_id,
            UserAccount.deleted_at.is_(None),
            UserAccount.status == UserStatus.ACTIVE.value,
        )
    )
    if user is None:
        raise _unauthorized()
    return AuthenticatedSession(
        user=AuthenticatedUser.from_model(user),
        token_id=payload["jti"],
        expires_at=payload["exp"],
    )


def get_current_user(session: AuthenticatedSession = Depends(get_current_session)) -> AuthenticatedUser:
    return session.user


def require_roles(*roles: UserRole | str) -> Callable[[AuthenticatedUser], AuthenticatedUser]:
    allowed_roles = {role.value if isinstance(role, UserRole) else role for role in roles}

    def dependency(current_user: AuthenticatedUser = Depends(get_current_user)) -> AuthenticatedUser:
        if current_user.role not in allowed_roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="当前账号无权访问该功能。")
        return current_user

    return dependency


def ensure_project_access(project: Project, current_user: AuthenticatedUser) -> None:
    if current_user.role == UserRole.CUSTOMER.value and project.created_by != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")
