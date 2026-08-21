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


class FormalDetectionPromptSettingRead(BaseModel):
    tile_crack_prompt: str
    tile_spalling_prompt: str
    tile_visible_prompt: str
    tile_thermal_prompt: str
    coating_crack_prompt: str
    coating_spalling_prompt: str
    coating_visible_prompt: str
    coating_thermal_prompt: str
    stone_crack_prompt: str
    stone_spalling_prompt: str
    stone_visible_prompt: str
    stone_thermal_prompt: str


class FormalDetectionPromptSettingUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tile_crack_prompt: str | None = Field(default=None, min_length=20, max_length=20_000)
    tile_spalling_prompt: str | None = Field(default=None, min_length=20, max_length=20_000)
    tile_visible_prompt: str | None = Field(default=None, min_length=20, max_length=20_000)
    tile_thermal_prompt: str | None = Field(default=None, min_length=20, max_length=20_000)
    coating_crack_prompt: str | None = Field(default=None, min_length=20, max_length=20_000)
    coating_spalling_prompt: str | None = Field(default=None, min_length=20, max_length=20_000)
    coating_visible_prompt: str | None = Field(default=None, min_length=20, max_length=20_000)
    coating_thermal_prompt: str | None = Field(default=None, min_length=20, max_length=20_000)
    stone_crack_prompt: str | None = Field(default=None, min_length=20, max_length=20_000)
    stone_spalling_prompt: str | None = Field(default=None, min_length=20, max_length=20_000)
    stone_visible_prompt: str | None = Field(default=None, min_length=20, max_length=20_000)
    stone_thermal_prompt: str | None = Field(default=None, min_length=20, max_length=20_000)


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
    formal_prompts: FormalDetectionPromptSettingRead
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
    formal_prompts: FormalDetectionPromptSettingUpdate | None = None
