from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


TrialInferenceProvider = Literal["qwen", "qwen3_vl_flash", "zhipu", "local_qwen"]
LocalQwenRuntimeStatus = Literal["running", "starting", "stopped", "disabled", "error"]


class TrialInferenceProviderOption(BaseModel):
    provider: TrialInferenceProvider
    label: str
    model: str
    configured: bool
    runtime_status: LocalQwenRuntimeStatus | None = None
    runtime_message: str | None = None


class TrialInferenceDisclosureRead(BaseModel):
    provider: TrialInferenceProvider
    label: str
    is_cloud: bool
    recipient: str
    privacy_policy_url: str | None = None


class TrialInferenceSettingRead(BaseModel):
    provider: TrialInferenceProvider
    global_job_concurrency: int
    request_concurrency: int
    daily_api_request_limit: int
    generate_limit_per_user: int
    visible_prompt: str
    crack_prompt: str
    spalling_prompt: str
    thermal_prompt: str
    photo_guard_prompt: str
    options: list[TrialInferenceProviderOption]
    updated_at: datetime | None = None


class TrialInferenceSettingUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: TrialInferenceProvider | None = None
    global_job_concurrency: int | None = Field(default=None, ge=1, le=10)
    request_concurrency: int | None = Field(default=None, ge=1, le=10)
    daily_api_request_limit: int | None = Field(default=None, ge=1, le=1_000_000)
    generate_limit_per_user: int | None = Field(default=None, ge=1, le=10_000)
    visible_prompt: str | None = Field(default=None, min_length=20, max_length=20_000)
    crack_prompt: str | None = Field(default=None, min_length=20, max_length=20_000)
    spalling_prompt: str | None = Field(default=None, min_length=20, max_length=20_000)
    thermal_prompt: str | None = Field(default=None, min_length=20, max_length=20_000)
    photo_guard_prompt: str | None = Field(default=None, min_length=20, max_length=20_000)
