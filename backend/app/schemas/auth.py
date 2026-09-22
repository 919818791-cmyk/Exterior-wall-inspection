from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.enums.status import AccountPlan, ProfessionalApplicationStatus, UserRole, UserStatus


class LoginRequest(BaseModel):
    identity: str | None = Field(default=None, min_length=1, max_length=64)
    phone: str | None = Field(default=None, min_length=1, max_length=32)
    # Keep both legacy fields while clients migrate to the unified identity field.
    username: str | None = Field(default=None, min_length=1, max_length=64)
    password: str | None = Field(default=None, min_length=1, max_length=128)
    verification_code: str | None = Field(default=None, min_length=4, max_length=8, pattern=r"^[0-9]+$")


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
    account_plan: AccountPlan = AccountPlan.BASIC
    professional_application_status: ProfessionalApplicationStatus | None = None
    professional_plan_expires_at: datetime | None = None


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
    account_plan: AccountPlan = AccountPlan.BASIC
    professional_application_status: ProfessionalApplicationStatus | None = None
    professional_application_requested_at: datetime | None = None
    professional_application_reviewed_at: datetime | None = None
    professional_application_duration_months: Literal[6, 12] | None = None
    professional_plan_expires_at: datetime | None = None
    organization: str | None
    detection_quota: int | None = None
    status: UserStatus
    last_login_at: datetime | None
    created_at: datetime
    updated_at: datetime


class AccountPasswordResetResponse(BaseModel):
    account: AccountRead
    temporary_password: str


class AccountQuotaResetResponse(BaseModel):
    ok: bool = True
    reset_at: datetime


class ProfessionalApplicationResponse(BaseModel):
    ok: bool = True
    status: ProfessionalApplicationStatus
    requested_at: datetime


class ProfessionalApplicationReviewRequest(BaseModel):
    decision: Literal["approved", "rejected"]
    duration_months: Literal[6, 12]


class AccountCreateRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=8, max_length=128)
    real_name: str | None = Field(default=None, max_length=64)
    phone: str | None = Field(default=None, max_length=32)
    role: UserRole = UserRole.CUSTOMER
    account_plan: AccountPlan = AccountPlan.BASIC
    organization: str | None = Field(default=None, max_length=128)
    detection_quota: int | None = Field(default=None, ge=1, le=100_000)
    status: UserStatus = UserStatus.ACTIVE


class AccountUpdateRequest(BaseModel):
    username: str | None = Field(default=None, min_length=1, max_length=64)
    real_name: str | None = Field(default=None, max_length=64)
    phone: str | None = Field(default=None, max_length=32)
    role: UserRole | None = None
    account_plan: AccountPlan | None = None
    organization: str | None = Field(default=None, max_length=128)
    detection_quota: int | None = Field(default=None, ge=1, le=100_000)
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
