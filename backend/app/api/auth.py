from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.api.dependencies import (
    AuthenticatedSession,
    AuthenticatedUser,
    ensure_demo_users,
    get_current_session,
    get_current_user,
    revoke_token,
)
from app.core.config import get_settings
from app.core.security import create_access_token, hash_password, verify_password
from app.db.session import get_db
from app.enums.status import UserRole, UserStatus
from app.models.tables import QuickDetectionPhoto, TrialDetectionResult, UsageEvent, UserAccount
from app.schemas.auth import (
    AccountDeletionRequest,
    AccountDeletionResponse,
    ChangePasswordRequest,
    AuthUserRead,
    CurrentUserUpdateRequest,
    LoginRequest,
    LoginResponse,
    LogoutResponse,
    TrialApplicationRequest,
    TrialApplicationResponse,
)
from app.services.object_storage import remove_object
from app.services.usage_control import SecurityStoreUnavailable, enforce_limit, get_usage_store

router = APIRouter(prefix="/auth", tags=["auth"])

CHINA_MOBILE_PHONE_PATTERN = re.compile(r"^1[3-9][0-9]{9}$")


def _to_user_read(user: AuthenticatedUser) -> AuthUserRead:
    return AuthUserRead(
        id=user.id,
        username=user.username,
        real_name=user.real_name,
        phone=user.phone,
        role=user.role,
        organization=user.organization,
    )


def _clean_required_text(value: str, field_name: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field_name}不能为空。")
    return cleaned


def _clean_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _ensure_username_available(db: Session, username: str) -> None:
    existing_id = db.scalar(
        select(UserAccount.id).where(
            func.lower(UserAccount.username) == username.lower(),
        )
    )
    if existing_id is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="用户名已存在。")


def _ensure_phone_available(db: Session, phone: str, *, exclude_user_id: object | None = None) -> None:
    statement = select(UserAccount.id).where(UserAccount.phone == phone)
    if exclude_user_id is not None:
        statement = statement.where(UserAccount.id != exclude_user_id)
    existing_id = db.scalar(statement)
    if existing_id is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="手机号已被使用。")


def _validate_china_mobile_phone(phone: str) -> str:
    cleaned = _clean_required_text(phone, "手机号")
    if CHINA_MOBILE_PHONE_PATTERN.fullmatch(cleaned) is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请输入正确的中国大陆11位手机号码。",
        )
    return cleaned


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> LoginResponse:
    settings = get_settings()
    store = get_usage_store()
    login_identity = payload.identity.strip() if payload.identity else None
    login_phone = payload.phone.strip() if payload.phone else None
    legacy_username = payload.username.strip() if payload.username else None
    if not login_identity and not login_phone and not legacy_username:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="用户名或手机号不能为空。")
    normalized_identity = (login_identity or login_phone or legacy_username or "").lower()
    enforce_limit(
        store,
        "login:identity",
        normalized_identity,
        limit=settings.login_rate_limit_per_identity,
        ttl_seconds=settings.login_rate_window_seconds,
        detail="该账号登录尝试过于频繁，请稍后重试。",
    )
    ensure_demo_users(db)
    db.flush()
    if login_identity is not None:
        user = db.scalar(
            select(UserAccount).where(
                UserAccount.phone == login_identity,
                UserAccount.deleted_at.is_(None),
            )
        )
        if user is None:
            user = db.scalar(
                select(UserAccount).where(
                    func.lower(UserAccount.username) == login_identity.lower(),
                    UserAccount.deleted_at.is_(None),
                )
            )
    else:
        identity_filter = (
            UserAccount.phone == login_phone
            if login_phone is not None
            else func.lower(UserAccount.username) == (legacy_username or "").lower()
        )
        user = db.scalar(
            select(UserAccount).where(
                identity_filter,
                UserAccount.deleted_at.is_(None),
            )
        )
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名、手机号或密码错误。")
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
def create_trial_application(
    payload: TrialApplicationRequest,
    db: Session = Depends(get_db),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> TrialApplicationResponse:
    settings = get_settings()
    username = _clean_required_text(payload.username, "用户名")
    real_name = _clean_optional_text(payload.real_name)
    phone = _validate_china_mobile_phone(payload.phone)
    organization = _clean_optional_text(payload.organization)
    normalized_username = username.lower()
    store = get_usage_store()
    normalized_idempotency_key = idempotency_key.strip() if idempotency_key else None
    fingerprint = hashlib.sha256(json.dumps(
        {
            "username": normalized_username,
            "password": payload.password,
            "real_name": real_name,
            "phone": phone,
            "organization": organization,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")).hexdigest()
    cache_identity = f"{normalized_username}:{normalized_idempotency_key}" if normalized_idempotency_key else None
    if cache_identity:
        try:
            cached = store.cache_get("trial-application-idempotency", cache_identity)
        except SecurityStoreUnavailable as exc:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
        if cached:
            if cached.get("fingerprint") != fingerprint:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="该注册请求标识已用于其他内容，请刷新后重试。",
                )
            return TrialApplicationResponse(username=str(cached["username"]))

    enforce_limit(
        store,
        "trial-application:identity",
        normalized_username,
        limit=settings.trial_application_limit_per_identity,
        ttl_seconds=settings.trial_application_window_seconds,
        detail="账号创建过于频繁，请明天再试。",
    )
    _ensure_username_available(db, username)
    _ensure_phone_available(db, phone)

    account = UserAccount(
        username=username,
        password_hash=hash_password(payload.password),
        real_name=real_name,
        phone=phone,
        role=UserRole.CUSTOMER.value,
        organization=organization,
        status=UserStatus.ACTIVE.value,
    )
    db.add(account)
    db.commit()
    if cache_identity:
        try:
            store.cache_set(
                "trial-application-idempotency",
                cache_identity,
                {"fingerprint": fingerprint, "username": username},
                ttl_seconds=24 * 60 * 60,
            )
        except SecurityStoreUnavailable:
            # The account already exists; do not turn a committed registration
            # into a client-visible failure that invites a duplicate retry.
            pass
    return TrialApplicationResponse(username=username)


@router.get("/me", response_model=AuthUserRead)
def me(current_user: AuthenticatedUser = Depends(get_current_user)) -> AuthUserRead:
    return _to_user_read(current_user)


@router.patch("/me", response_model=AuthUserRead)
def update_me(
    payload: CurrentUserUpdateRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AuthUserRead:
    user = db.get(UserAccount, current_user.id)
    if user is None or user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录状态已失效，请重新登录。")

    data = payload.model_dump(exclude_unset=True)
    if "phone" in data:
        phone = _clean_optional_text(data.pop("phone"))
        if phone is not None:
            phone = _validate_china_mobile_phone(phone)
            _ensure_phone_available(db, phone, exclude_user_id=user.id)
        user.phone = phone
    for field in ("real_name", "organization"):
        if field in data:
            setattr(user, field, _clean_optional_text(data[field]))

    db.commit()
    db.refresh(user)
    return _to_user_read(AuthenticatedUser.from_model(user))


@router.delete("/me", response_model=AccountDeletionResponse)
def delete_current_account(
    payload: AccountDeletionRequest,
    session: AuthenticatedSession = Depends(get_current_session),
    db: Session = Depends(get_db),
) -> AccountDeletionResponse:
    user = db.get(UserAccount, session.user.id)
    if user is None or user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录状态已失效，请重新登录。")
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前密码不正确。")

    if user.role == UserRole.ADMIN.value:
        active_admin_count = int(
            db.scalar(
                select(func.count())
                .select_from(UserAccount)
                .where(
                    UserAccount.role == UserRole.ADMIN.value,
                    UserAccount.status == UserStatus.ACTIVE.value,
                    UserAccount.deleted_at.is_(None),
                    UserAccount.id != user.id,
                )
            )
            or 0
        )
        if active_admin_count == 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="当前账号是最后一个有效管理员，请先指定其他管理员后再注销。",
            )

    trial_photos = list(
        db.scalars(select(QuickDetectionPhoto).where(QuickDetectionPhoto.uploaded_by == user.id))
    )
    trial_results = list(
        db.scalars(select(TrialDetectionResult).where(TrialDetectionResult.generated_by == user.id))
    )
    stored_trial_objects = {
        (photo.storage_bucket, object_key)
        for photo in trial_photos
        for object_key in (
            photo.storage_object_key,
            getattr(photo, "thumbnail_object_key", None),
        )
        if object_key
    }
    for bucket, object_key in stored_trial_objects:
        remove_object(bucket, object_key)
    for photo in trial_photos:
        db.delete(photo)
    for result in trial_results:
        db.delete(result)

    db.execute(
        update(UsageEvent)
        .where(UsageEvent.actor_id == user.id)
        .values(actor_id=None)
    )
    deleted_at = datetime.now(UTC)
    user.username = f"deleted-{user.id.hex}"
    user.password_hash = hash_password(f"{uuid4().hex}{uuid4().hex}")
    user.real_name = None
    user.phone = None
    user.organization = None
    user.status = UserStatus.DISABLED.value
    user.last_login_at = None
    user.deleted_at = deleted_at
    db.commit()
    return AccountDeletionResponse(
        deleted_at=deleted_at,
        deleted_trial_photos=len(trial_photos),
        deleted_trial_results=len(trial_results),
        retained_notice="账号资料已匿名化，体验照片和体验结果已删除。正式项目、审核记录与交付报告因工程履约和质量追溯需要继续受限保存。",
    )


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
