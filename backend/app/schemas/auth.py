from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.enums.status import UserRole, UserStatus


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class AuthUserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    username: str
    real_name: str | None
    role: UserRole
    organization: str | None


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
