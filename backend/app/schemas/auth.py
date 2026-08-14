from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.enums.status import UserRole, UserStatus


class LoginRequest(BaseModel):
    identity: str | None = Field(default=None, min_length=1, max_length=64)
    phone: str | None = Field(default=None, min_length=1, max_length=32)
    # Keep both legacy fields while clients migrate to the unified identity field.
    username: str | None = Field(default=None, min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class TrialApplicationRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=8, max_length=128)
    real_name: str | None = Field(default=None, max_length=64)
    phone: str = Field(min_length=1, max_length=32)
    verification_code: str = Field(min_length=4, max_length=8, pattern=r"^[0-9]+$")
    organization: str | None = Field(default=None, max_length=128)


class RegistrationSmsCodeRequest(BaseModel):
    phone: str = Field(min_length=1, max_length=32)


class RegistrationSmsCodeResponse(BaseModel):
    ok: bool = True
    retry_after_seconds: int


class PasswordResetSmsCodeRequest(BaseModel):
    phone: str = Field(min_length=1, max_length=32)


class PasswordResetVerifyRequest(BaseModel):
    phone: str = Field(min_length=1, max_length=32)
    verification_code: str = Field(min_length=4, max_length=8, pattern=r"^[0-9]+$")


class PasswordResetVerifyResponse(BaseModel):
    reset_token: str
    expires_in_seconds: int


class PasswordResetRequest(BaseModel):
    reset_token: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class AuthUserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    username: str
    real_name: str | None
    phone: str | None
    role: UserRole
    organization: str | None


class CurrentUserUpdateRequest(BaseModel):
    real_name: str | None = Field(default=None, max_length=64)
    phone: str | None = Field(default=None, max_length=32)
    organization: str | None = Field(default=None, max_length=128)


class AccountDeletionRequest(BaseModel):
    password: str = Field(min_length=1, max_length=128)


class AccountDeletionResponse(BaseModel):
    ok: bool = True
    deleted_at: datetime
    deleted_trial_photos: int
    deleted_trial_results: int
    retained_notice: str


class AccountRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    username: str
    real_name: str | None
    phone: str | None
    role: UserRole
    organization: str | None
    status: UserStatus
    last_login_at: datetime | None
    created_at: datetime
    updated_at: datetime


class AccountPasswordResetResponse(BaseModel):
    account: AccountRead
    temporary_password: str


class AccountCreateRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=8, max_length=128)
    real_name: str | None = Field(default=None, max_length=64)
    phone: str | None = Field(default=None, max_length=32)
    role: UserRole = UserRole.CUSTOMER
    organization: str | None = Field(default=None, max_length=128)
    status: UserStatus = UserStatus.ACTIVE


class AccountUpdateRequest(BaseModel):
    username: str | None = Field(default=None, min_length=1, max_length=64)
    real_name: str | None = Field(default=None, max_length=64)
    phone: str | None = Field(default=None, max_length=32)
    role: UserRole | None = None
    organization: str | None = Field(default=None, max_length=128)
    status: UserStatus | None = None


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: AuthUserRead


class LogoutResponse(BaseModel):
    ok: bool = True


class TrialApplicationResponse(BaseModel):
    ok: bool = True
    username: str
    status: UserStatus = UserStatus.ACTIVE


class UsernameAvailabilityResponse(BaseModel):
    username: str
    available: bool
