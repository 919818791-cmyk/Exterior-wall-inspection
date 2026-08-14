from __future__ import annotations

import hashlib
import json
import re
import secrets
from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
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
    PasswordResetRequest,
    PasswordResetSmsCodeRequest,
    PasswordResetVerifyRequest,
    PasswordResetVerifyResponse,
    RegistrationSmsCodeRequest,
    RegistrationSmsCodeResponse,
    TrialApplicationRequest,
    TrialApplicationResponse,
    UsernameAvailabilityResponse,
)
from app.services.object_storage import remove_object
from app.services.sms_verification import (
    SmsVerificationConfigurationError,
    SmsVerificationProviderError,
    SmsVerificationService,
    get_sms_verification_service,
)
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
    if not _is_username_available(db, username):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="用户名已存在。")


def _is_username_available(db: Session, username: str) -> bool:
    existing_id = db.scalar(
        select(UserAccount.id).where(
            func.lower(UserAccount.username) == username.lower(),
        )
    )
    return existing_id is None


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


def _request_ip(request: Request) -> str:
    return request.client.host if request.client is not None else "unknown"


def _raise_sms_provider_error(
    exc: SmsVerificationProviderError,
    *,
    retry_after_seconds: int,
) -> None:
    if exc.code in {"FREQUENCY_FAIL", "BUSINESS_LIMIT_CONTROL", "LimitExceeded.SmsCode"}:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="验证码发送过于频繁，请稍后重试。",
            headers={"Retry-After": str(retry_after_seconds)},
        ) from exc
    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="短信验证码服务暂时不可用，请稍后重试。",
    ) from exc


def _find_active_user_by_phone(db: Session, phone: str) -> UserAccount | None:
    return db.scalar(
        select(UserAccount).where(
            UserAccount.phone == phone,
            UserAccount.status == UserStatus.ACTIVE.value,
            UserAccount.deleted_at.is_(None),
        )
    )


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


@router.get(
    "/registration/username-availability",
    response_model=UsernameAvailabilityResponse,
)
def get_username_availability(
    username: str = Query(min_length=1, max_length=64),
    db: Session = Depends(get_db),
) -> UsernameAvailabilityResponse:
    cleaned_username = _clean_required_text(username, "用户名")
    return UsernameAvailabilityResponse(
        username=cleaned_username,
        available=_is_username_available(db, cleaned_username),
    )


@router.post(
    "/registration/sms-code",
    response_model=RegistrationSmsCodeResponse,
)
def send_registration_sms_code(
    payload: RegistrationSmsCodeRequest,
    request: Request,
    db: Session = Depends(get_db),
    sms_service: SmsVerificationService = Depends(get_sms_verification_service),
) -> RegistrationSmsCodeResponse:
    settings = get_settings()
    phone = _validate_china_mobile_phone(payload.phone)
    _ensure_phone_available(db, phone)
    store = get_usage_store()
    client_ip = _request_ip(request)
    limits = (
        (
            "registration-sms:phone:cooldown",
            phone,
            1,
            settings.sms_verification_send_interval_seconds,
        ),
        (
            "registration-sms:phone:hour",
            phone,
            settings.sms_verification_send_limit_per_phone_hour,
            3600,
        ),
        (
            "registration-sms:ip:hour",
            client_ip,
            settings.sms_verification_send_limit_per_ip_hour,
            3600,
        ),
    )
    consumed_limits: list[tuple[str, str]] = []
    try:
        for scope, identity, limit, ttl_seconds in limits:
            enforce_limit(
                store,
                scope,
                identity,
                limit=limit,
                ttl_seconds=ttl_seconds,
                detail="验证码发送过于频繁，请稍后重试。",
            )
            consumed_limits.append((scope, identity))
    except HTTPException:
        for scope, identity in consumed_limits:
            store.refund(scope, identity, amount=1)
        raise

    try:
        sms_service.send_code(phone)
    except SmsVerificationConfigurationError as exc:
        for scope, identity in consumed_limits:
            store.refund(scope, identity, amount=1)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="短信验证码服务尚未配置，请联系管理员。",
        ) from exc
    except SmsVerificationProviderError as exc:
        for scope, identity in consumed_limits:
            store.refund(scope, identity, amount=1)
        _raise_sms_provider_error(
            exc,
            retry_after_seconds=settings.sms_verification_send_interval_seconds,
        )

    return RegistrationSmsCodeResponse(
        retry_after_seconds=settings.sms_verification_send_interval_seconds,
    )


@router.post(
    "/password-reset/sms-code",
    response_model=RegistrationSmsCodeResponse,
)
def send_password_reset_sms_code(
    payload: PasswordResetSmsCodeRequest,
    request: Request,
    db: Session = Depends(get_db),
    sms_service: SmsVerificationService = Depends(get_sms_verification_service),
) -> RegistrationSmsCodeResponse:
    """Send a reset code without revealing whether a phone owns an account."""
    settings = get_settings()
    phone = _validate_china_mobile_phone(payload.phone)
    ensure_demo_users(db)
    db.flush()
    store = get_usage_store()
    client_ip = _request_ip(request)
    limits = (
        (
            "password-reset-sms:phone:cooldown",
            phone,
            1,
            settings.sms_verification_send_interval_seconds,
        ),
        (
            "password-reset-sms:phone:hour",
            phone,
            settings.sms_verification_send_limit_per_phone_hour,
            3600,
        ),
        (
            "password-reset-sms:ip:hour",
            client_ip,
            settings.sms_verification_send_limit_per_ip_hour,
            3600,
        ),
    )
    consumed_limits: list[tuple[str, str]] = []
    try:
        for scope, identity, limit, ttl_seconds in limits:
            enforce_limit(
                store,
                scope,
                identity,
                limit=limit,
                ttl_seconds=ttl_seconds,
                detail="验证码发送过于频繁，请稍后重试。",
            )
            consumed_limits.append((scope, identity))
    except HTTPException:
        for scope, identity in consumed_limits:
            store.refund(scope, identity, amount=1)
        raise

    # Keep the response deliberately generic, but do not spend an SMS on an
    # unknown or disabled account. Verification will fail with the same
    # generic message if the phone is not registered.
    if _find_active_user_by_phone(db, phone) is None:
        return RegistrationSmsCodeResponse(
            retry_after_seconds=settings.sms_verification_send_interval_seconds,
        )

    try:
        sms_service.send_code(phone)
    except SmsVerificationConfigurationError as exc:
        for scope, identity in consumed_limits:
            store.refund(scope, identity, amount=1)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="短信验证码服务尚未配置，请联系管理员。",
        ) from exc
    except SmsVerificationProviderError as exc:
        for scope, identity in consumed_limits:
            store.refund(scope, identity, amount=1)
        _raise_sms_provider_error(
            exc,
            retry_after_seconds=settings.sms_verification_send_interval_seconds,
        )

    return RegistrationSmsCodeResponse(
        retry_after_seconds=settings.sms_verification_send_interval_seconds,
    )


@router.post(
    "/password-reset/verify",
    response_model=PasswordResetVerifyResponse,
)
def verify_password_reset_code(
    payload: PasswordResetVerifyRequest,
    request: Request,
    db: Session = Depends(get_db),
    sms_service: SmsVerificationService = Depends(get_sms_verification_service),
) -> PasswordResetVerifyResponse:
    settings = get_settings()
    phone = _validate_china_mobile_phone(payload.phone)
    user = _find_active_user_by_phone(db, phone)
    if user is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="手机号或验证码错误。")

    store = get_usage_store()
    verification_limits = (
        (
            "password-reset-sms-check:phone",
            phone,
            settings.sms_verification_check_limit_per_phone,
        ),
        (
            "password-reset-sms-check:ip",
            _request_ip(request),
            settings.sms_verification_check_limit_per_ip,
        ),
    )
    consumed_limits: list[tuple[str, str]] = []
    try:
        for scope, identity, limit in verification_limits:
            enforce_limit(
                store,
                scope,
                identity,
                limit=limit,
                ttl_seconds=settings.sms_verification_check_window_seconds,
                detail="验证码核验尝试过于频繁，请稍后重试。",
            )
            consumed_limits.append((scope, identity))
    except HTTPException:
        for scope, identity in consumed_limits:
            store.refund(scope, identity, amount=1)
        raise

    try:
        verification_passed = sms_service.verify_code(phone, payload.verification_code)
    except SmsVerificationConfigurationError as exc:
        for scope, identity in consumed_limits:
            store.refund(scope, identity, amount=1)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="短信验证码服务尚未配置，请联系管理员。",
        ) from exc
    except SmsVerificationProviderError as exc:
        for scope, identity in consumed_limits:
            store.refund(scope, identity, amount=1)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="短信验证码服务暂时不可用，请稍后重试。",
        ) from exc
    if not verification_passed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="验证码错误或已过期。")

    reset_token = secrets.token_urlsafe(32)
    try:
        store.cache_set(
            "password-reset",
            reset_token,
            {"user_id": str(user.id), "phone": phone},
            ttl_seconds=settings.sms_verification_valid_seconds,
        )
    except SecurityStoreUnavailable as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    return PasswordResetVerifyResponse(
        reset_token=reset_token,
        expires_in_seconds=settings.sms_verification_valid_seconds,
    )


@router.post("/password-reset", response_model=LogoutResponse)
def reset_password(
    payload: PasswordResetRequest,
    db: Session = Depends(get_db),
) -> LogoutResponse:
    store = get_usage_store()
    try:
        reset_data = store.cache_pop("password-reset", payload.reset_token)
    except SecurityStoreUnavailable as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    if not reset_data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="重置凭证无效或已过期，请重新验证。")

    try:
        user_id = UUID(str(reset_data["user_id"]))
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="重置凭证无效或已过期，请重新验证。") from exc
    user = db.get(UserAccount, user_id)
    if user is None or user.deleted_at is not None or user.status != UserStatus.ACTIVE.value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="重置凭证无效或已过期，请重新验证。")
    if verify_password(payload.new_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="新密码不能与原密码相同。")

    user.password_hash = hash_password(payload.new_password)
    db.commit()
    return LogoutResponse()


@router.post(
    "/trial-application",
    response_model=TrialApplicationResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_trial_application(
    payload: TrialApplicationRequest,
    request: Request,
    db: Session = Depends(get_db),
    sms_service: SmsVerificationService = Depends(get_sms_verification_service),
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
            "verification_code": payload.verification_code,
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

    _ensure_username_available(db, username)
    _ensure_phone_available(db, phone)

    verification_limits = (
        (
            "registration-sms-check:phone",
            phone,
            settings.sms_verification_check_limit_per_phone,
        ),
        (
            "registration-sms-check:ip",
            _request_ip(request),
            settings.sms_verification_check_limit_per_ip,
        ),
    )
    consumed_verification_limits: list[tuple[str, str]] = []
    try:
        for scope, identity, limit in verification_limits:
            enforce_limit(
                store,
                scope,
                identity,
                limit=limit,
                ttl_seconds=settings.sms_verification_check_window_seconds,
                detail="验证码核验尝试过于频繁，请稍后重试。",
            )
            consumed_verification_limits.append((scope, identity))
    except HTTPException:
        for scope, identity in consumed_verification_limits:
            store.refund(scope, identity, amount=1)
        raise
    try:
        verification_passed = sms_service.verify_code(phone, payload.verification_code)
    except SmsVerificationConfigurationError as exc:
        for scope, identity in consumed_verification_limits:
            store.refund(scope, identity, amount=1)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="短信验证码服务尚未配置，请联系管理员。",
        ) from exc
    except SmsVerificationProviderError as exc:
        for scope, identity in consumed_verification_limits:
            store.refund(scope, identity, amount=1)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="短信验证码服务暂时不可用，请稍后重试。",
        ) from exc
    if not verification_passed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证码错误或已过期。",
        )

    enforce_limit(
        store,
        "trial-application:identity",
        normalized_username,
        limit=settings.trial_application_limit_per_identity,
        ttl_seconds=settings.trial_application_window_seconds,
        detail="账号创建过于频繁，请明天再试。",
    )

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
