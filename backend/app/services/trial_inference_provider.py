from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, cast
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.models.tables import SystemSetting


TrialInferenceProvider = Literal["qwen", "qwen3_vl_flash", "zhipu", "local_qwen"]
UpstreamInferenceProvider = Literal["qwen", "zhipu"]
TRIAL_INFERENCE_PROVIDER_KEY = "trial_inference_provider"
TRIAL_GLOBAL_JOB_CONCURRENCY_KEY = "trial_global_job_concurrency"
TRIAL_REQUEST_CONCURRENCY_KEY = "trial_request_concurrency"
TRIAL_DAILY_API_REQUEST_LIMIT_KEY = "trial_daily_api_request_limit"
TRIAL_GENERATE_LIMIT_PER_USER_KEY = "trial_generate_limit_per_user"
TRIAL_VISIBLE_PROMPT_KEY = "trial_visible_prompt"
TRIAL_CRACK_PROMPT_KEY = "trial_crack_prompt"
TRIAL_SPALLING_PROMPT_KEY = "trial_spalling_prompt"
TRIAL_THERMAL_PROMPT_KEY = "trial_thermal_prompt"
PHOTO_GUARD_PROMPT_KEY = "photo_guard_prompt"
DEFAULT_TRIAL_INFERENCE_PROVIDER: TrialInferenceProvider = "qwen"


@dataclass(frozen=True, slots=True)
class TrialInferenceRuntime:
    provider: TrialInferenceProvider
    upstream_provider: UpstreamInferenceProvider
    label: str
    api_key: str
    base_url: str
    model: str
    timeout_seconds: float
    max_concurrency: int

    @property
    def configured(self) -> bool:
        return bool(
            self.api_key.strip()
            and self.base_url.strip()
            and self.model.strip()
        )


@dataclass(frozen=True, slots=True)
class TrialSchedulingSettings:
    global_job_concurrency: int
    request_concurrency: int
    daily_api_request_limit: int
    generate_limit_per_user: int
    generate_window_seconds: int
    upload_limit_per_user: int
    upload_window_seconds: int
    request_timeout_seconds: int
    job_lock_seconds: int


@dataclass(frozen=True, slots=True)
class TrialPromptSettings:
    visible_prompt: str
    crack_prompt: str
    spalling_prompt: str
    thermal_prompt: str
    photo_guard_prompt: str

    def visible_prompt_for_models(self, models: list[str]) -> str:
        selected = {model for model in models if model in {"裂缝", "剥落"}}
        if selected == {"裂缝"}:
            return self.crack_prompt
        if selected == {"剥落"}:
            return self.spalling_prompt
        return self.visible_prompt


def _get_setting(db: Session | None, key: str) -> SystemSetting | None:
    if db is None:
        return None
    getter = getattr(db, "get", None)
    return getter(SystemSetting, key) if callable(getter) else None


def setting_value(db: Session | None, key: str) -> str | None:
    setting = _get_setting(db, key)
    return setting.value if setting is not None else None


def set_setting_value(db: Session, key: str, value: str, *, updated_by: UUID) -> SystemSetting:
    setting = _get_setting(db, key)
    if setting is None:
        setting = SystemSetting(key=key, value=value, updated_by=updated_by)
        db.add(setting)
    else:
        setting.value = value
        setting.updated_by = updated_by
    return setting


def _bounded_int_setting(
    db: Session | None,
    key: str,
    default: int | float,
    *,
    minimum: int,
    maximum: int,
) -> int:
    value = setting_value(db, key)
    try:
        parsed = int(value) if value is not None else int(default)
    except (TypeError, ValueError):
        parsed = int(default)
    return _bounded_int_value(parsed, minimum=minimum, maximum=maximum)


def _bounded_int_value(value: str | int | float, *, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = minimum
    return min(maximum, max(minimum, parsed))


def trial_scheduling_settings(
    db: Session | None,
    settings: Settings | None = None,
) -> TrialSchedulingSettings:
    settings = settings or get_settings()
    return TrialSchedulingSettings(
        global_job_concurrency=_bounded_int_setting(
            db,
            TRIAL_GLOBAL_JOB_CONCURRENCY_KEY,
            getattr(settings, "trial_global_job_concurrency", 4),
            minimum=1,
            maximum=10,
        ),
        request_concurrency=_bounded_int_setting(
            db,
            TRIAL_REQUEST_CONCURRENCY_KEY,
            getattr(settings, "trial_request_concurrency", 5),
            minimum=1,
            maximum=10,
        ),
        daily_api_request_limit=_bounded_int_setting(
            db,
            TRIAL_DAILY_API_REQUEST_LIMIT_KEY,
            getattr(settings, "trial_daily_api_request_limit", 800),
            minimum=1,
            maximum=1_000_000,
        ),
        generate_limit_per_user=_bounded_int_setting(
            db,
            TRIAL_GENERATE_LIMIT_PER_USER_KEY,
            getattr(settings, "trial_generate_limit_per_user", 5),
            minimum=1,
            maximum=10_000,
        ),
        generate_window_seconds=_bounded_int_value(
            getattr(settings, "trial_generate_window_seconds", 600),
            minimum=60,
            maximum=86_400,
        ),
        upload_limit_per_user=_bounded_int_value(
            getattr(settings, "trial_upload_limit_per_user", 30),
            minimum=1,
            maximum=100_000,
        ),
        upload_window_seconds=_bounded_int_value(
            getattr(settings, "trial_upload_window_seconds", 600),
            minimum=60,
            maximum=86_400,
        ),
        request_timeout_seconds=_bounded_int_value(
            getattr(settings, "trial_request_timeout_seconds", 300),
            minimum=5,
            maximum=600,
        ),
        job_lock_seconds=_bounded_int_value(
            getattr(settings, "trial_job_lock_seconds", 900),
            minimum=60,
            maximum=86_400,
        ),
    )


def get_trial_inference_provider(db: Session) -> TrialInferenceProvider:
    value = setting_value(db, TRIAL_INFERENCE_PROVIDER_KEY)
    # Preserve an existing administrator selection when upgrading from the
    # Qwen-VL-Max option that Qwen3-VL-Flash replaces.
    if value == "qwen_vl_max":
        return "qwen3_vl_flash"
    if value not in ("qwen", "qwen3_vl_flash", "zhipu", "local_qwen"):
        return DEFAULT_TRIAL_INFERENCE_PROVIDER
    return cast(TrialInferenceProvider, value)


def set_trial_inference_provider(db: Session, provider: TrialInferenceProvider, *, updated_by: UUID) -> SystemSetting:
    return set_setting_value(db, TRIAL_INFERENCE_PROVIDER_KEY, provider, updated_by=updated_by)


def trial_global_job_concurrency(db: Session, settings: Settings | None = None) -> int:
    return trial_scheduling_settings(db, settings).global_job_concurrency


def trial_prompts(db: Session) -> TrialPromptSettings:
    from app.services.photo_guard import PHOTO_GUARD_PROMPT
    from app.services.trial_qwen_inference import (
        TRIAL_QWEN_CRACK_PROMPT,
        TRIAL_QWEN_PROMPT,
        TRIAL_QWEN_SPALLING_PROMPT,
        TRIAL_QWEN_THERMAL_PROMPT,
    )

    return TrialPromptSettings(
        visible_prompt=setting_value(db, TRIAL_VISIBLE_PROMPT_KEY) or TRIAL_QWEN_PROMPT,
        crack_prompt=setting_value(db, TRIAL_CRACK_PROMPT_KEY) or TRIAL_QWEN_CRACK_PROMPT,
        spalling_prompt=setting_value(db, TRIAL_SPALLING_PROMPT_KEY) or TRIAL_QWEN_SPALLING_PROMPT,
        thermal_prompt=setting_value(db, TRIAL_THERMAL_PROMPT_KEY) or TRIAL_QWEN_THERMAL_PROMPT,
        photo_guard_prompt=setting_value(db, PHOTO_GUARD_PROMPT_KEY) or PHOTO_GUARD_PROMPT,
    )


def trial_inference_runtime(
    provider: TrialInferenceProvider,
    settings: Settings | None = None,
    db: Session | None = None,
) -> TrialInferenceRuntime:
    settings = settings or get_settings()
    if provider == "local_qwen":
        label = "本地 Qwen3-VL-32B"
        upstream_provider = "qwen"
        # vLLM accepts an arbitrary bearer token when API-key authentication is
        # disabled. Keeping one in the request lets the shared Qwen client stay
        # compatible with both authenticated and unauthenticated local servers.
        env_key = settings.local_qwen_api_key.strip() or "local"
        env_base_url = settings.local_qwen_api_base_url
        env_model = settings.local_qwen_model
    elif provider == "zhipu":
        label = "智谱GLM-4.6V"
        upstream_provider: UpstreamInferenceProvider = "zhipu"
        env_key = settings.zhipu_api_key
        env_base_url = settings.zhipu_api_base_url
        env_model = settings.zhipu_model
    else:
        upstream_provider = "qwen"
        label = "通义千问 Qwen3-VL-Flash" if provider == "qwen3_vl_flash" else "通义千问 Qwen3-VL-Plus"
        env_key = settings.dashscope_api_key
        env_base_url = settings.qwen_api_base_url
        env_model = (
            getattr(settings, "qwen3_vl_flash_model", "qwen3-vl-flash")
            if provider == "qwen3_vl_flash"
            else settings.qwen_model
        )
    scheduling = trial_scheduling_settings(db, settings)
    timeout_seconds = scheduling.request_timeout_seconds
    max_concurrency = scheduling.request_concurrency
    if provider == "local_qwen":
        # A large local VL model needs substantially more activation memory per
        # image than cloud endpoints expose to this client. Keep both the HTTP
        # fan-out and vLLM's active sequence count within the host's configured
        # memory-safe limit; vLLM otherwise treats a burst of image tiles as one
        # batch and may terminate the engine on CUDA OOM.
        max_concurrency = min(
            max_concurrency,
            getattr(settings, "local_qwen_max_concurrency", 1),
        )
    return TrialInferenceRuntime(
        provider=provider,
        upstream_provider=upstream_provider,
        label=label,
        api_key=env_key,
        base_url=env_base_url,
        model=env_model,
        timeout_seconds=min(600.0, max(5.0, timeout_seconds)),
        max_concurrency=min(10, max(1, max_concurrency)),
    )


def active_trial_inference_runtime(db: Session) -> TrialInferenceRuntime:
    return trial_inference_runtime(get_trial_inference_provider(db), db=db)
