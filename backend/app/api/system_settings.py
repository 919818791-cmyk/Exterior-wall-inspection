from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.dependencies import AuthenticatedUser, get_current_user, require_roles
from app.core.config import get_settings
from app.db.session import get_db
from app.enums.status import UserRole
from app.models.tables import SystemSetting
from app.schemas.system_settings import (
    TrialInferenceDisclosureRead,
    TrialInferenceProviderOption,
    TrialInferenceSettingRead,
    TrialInferenceSettingUpdate,
)
from app.services.formal_detection_prompts import (
    FORMAL_PROMPT_SETTING_KEYS,
    formal_prompt_values,
)
from app.services.local_qwen_lifecycle import (
    LocalQwenLifecycleError,
    local_qwen_status,
    reconcile_local_qwen,
)
from app.services.trial_inference_provider import (
    PHOTO_GUARD_PROMPT_KEY,
    TRIAL_CRACK_PROMPT_KEY,
    TRIAL_DAILY_API_REQUEST_LIMIT_KEY,
    TRIAL_GENERATE_LIMIT_PER_USER_KEY,
    TRIAL_GLOBAL_JOB_CONCURRENCY_KEY,
    TRIAL_INFERENCE_PROVIDER_KEY,
    TRIAL_REQUEST_CONCURRENCY_KEY,
    TRIAL_SPALLING_PROMPT_KEY,
    TRIAL_THERMAL_PROMPT_KEY,
    TRIAL_VISIBLE_PROMPT_KEY,
    get_trial_inference_provider,
    set_setting_value,
    set_trial_inference_provider,
    trial_inference_runtime,
    trial_prompts,
    trial_scheduling_settings,
)


router = APIRouter(prefix="/system-settings", tags=["system-settings"])

PROVIDER_DISCLOSURES = {
    "qwen": (
        "阿里云百炼（Model Studio）",
        "https://help.aliyun.com/zh/model-studio/privacy-notice",
    ),
    "qwen3_vl_flash": (
        "阿里云百炼（Model Studio）",
        "https://help.aliyun.com/zh/model-studio/privacy-notice",
    ),
    "zhipu": (
        "北京智谱华章科技股份有限公司",
        "https://docs.bigmodel.cn/cn/terms/privacy-policy",
    ),
    "local_qwen": ("平台控制的本地模型服务", None),
}


def _setting_read(db: Session) -> TrialInferenceSettingRead:
    settings = get_settings()
    local_runtime = local_qwen_status(settings)
    runtimes = [
        trial_inference_runtime("qwen", settings, db),
        trial_inference_runtime("qwen3_vl_flash", settings, db),
        trial_inference_runtime("local_qwen", settings, db),
        trial_inference_runtime("zhipu", settings, db),
    ]
    prompts = trial_prompts(db)
    scheduling = trial_scheduling_settings(db, settings)
    provider_setting = db.get(SystemSetting, TRIAL_INFERENCE_PROVIDER_KEY)
    return TrialInferenceSettingRead(
        provider=get_trial_inference_provider(db),
        global_job_concurrency=scheduling.global_job_concurrency,
        request_concurrency=scheduling.request_concurrency,
        daily_api_request_limit=scheduling.daily_api_request_limit,
        generate_limit_per_user=scheduling.generate_limit_per_user,
        visible_prompt=prompts.visible_prompt,
        crack_prompt=prompts.crack_prompt,
        spalling_prompt=prompts.spalling_prompt,
        thermal_prompt=prompts.thermal_prompt,
        photo_guard_prompt=prompts.photo_guard_prompt,
        formal_prompts=formal_prompt_values(db),
        options=[
            TrialInferenceProviderOption(
                provider=runtime.provider,
                label=runtime.label,
                model=runtime.model,
                configured=runtime.configured,
                runtime_status=(
                    local_runtime.state if runtime.provider == "local_qwen" else None
                ),
                runtime_message=(
                    local_runtime.message if runtime.provider == "local_qwen" else None
                ),
            )
            for runtime in runtimes
        ],
        updated_at=provider_setting.updated_at if provider_setting is not None else None,
    )


@router.get("/trial-inference", response_model=TrialInferenceSettingRead)
def read_trial_inference_setting(
    _: AuthenticatedUser = Depends(require_roles(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> TrialInferenceSettingRead:
    return _setting_read(db)


@router.get("/trial-inference-disclosure", response_model=TrialInferenceDisclosureRead)
def read_trial_inference_disclosure(
    _: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TrialInferenceDisclosureRead:
    provider = get_trial_inference_provider(db)
    runtime = trial_inference_runtime(provider, db=db)
    recipient, policy_url = PROVIDER_DISCLOSURES[provider]
    return TrialInferenceDisclosureRead(
        provider=provider,
        label=runtime.label,
        is_cloud=provider != "local_qwen",
        recipient=recipient,
        privacy_policy_url=policy_url,
    )


@router.put("/trial-inference", response_model=TrialInferenceSettingRead)
def update_trial_inference_setting(
    payload: TrialInferenceSettingUpdate,
    current_user: AuthenticatedUser = Depends(require_roles(UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> TrialInferenceSettingRead:
    numeric_settings = (
        ("global_job_concurrency", TRIAL_GLOBAL_JOB_CONCURRENCY_KEY),
        ("request_concurrency", TRIAL_REQUEST_CONCURRENCY_KEY),
        ("daily_api_request_limit", TRIAL_DAILY_API_REQUEST_LIMIT_KEY),
        ("generate_limit_per_user", TRIAL_GENERATE_LIMIT_PER_USER_KEY),
    )
    for field_name, setting_key in numeric_settings:
        value = getattr(payload, field_name)
        if value is not None:
            set_setting_value(db, setting_key, str(value), updated_by=current_user.id)
    if payload.visible_prompt is not None:
        set_setting_value(db, TRIAL_VISIBLE_PROMPT_KEY, payload.visible_prompt.strip(), updated_by=current_user.id)
    if payload.crack_prompt is not None:
        set_setting_value(db, TRIAL_CRACK_PROMPT_KEY, payload.crack_prompt.strip(), updated_by=current_user.id)
    if payload.spalling_prompt is not None:
        set_setting_value(db, TRIAL_SPALLING_PROMPT_KEY, payload.spalling_prompt.strip(), updated_by=current_user.id)
    if payload.thermal_prompt is not None:
        set_setting_value(db, TRIAL_THERMAL_PROMPT_KEY, payload.thermal_prompt.strip(), updated_by=current_user.id)
    if payload.photo_guard_prompt is not None:
        set_setting_value(db, PHOTO_GUARD_PROMPT_KEY, payload.photo_guard_prompt.strip(), updated_by=current_user.id)
    if payload.formal_prompts is not None:
        for field_name, value in payload.formal_prompts.model_dump(exclude_none=True).items():
            set_setting_value(
                db,
                FORMAL_PROMPT_SETTING_KEYS[field_name],
                value.strip(),
                updated_by=current_user.id,
            )
    if payload.provider is not None:
        set_trial_inference_provider(db, payload.provider, updated_by=current_user.id)

    flush = getattr(db, "flush", None)
    if callable(flush):
        flush()
    selected_provider = payload.provider or get_trial_inference_provider(db)
    runtime = trial_inference_runtime(selected_provider, db=db)
    if not runtime.configured:
        rollback = getattr(db, "rollback", None)
        if callable(rollback):
            rollback()
        detail = (
            f"{runtime.label} 尚未配置服务地址或模型名称。"
            if runtime.provider == "local_qwen"
            else f"{runtime.label} 尚未配置有效的 API Key。"
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=detail,
        )
    try:
        reconcile_local_qwen(selected_provider, get_settings())
    except LocalQwenLifecycleError as exc:
        rollback = getattr(db, "rollback", None)
        if callable(rollback):
            rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    provider_setting = set_trial_inference_provider(db, selected_provider, updated_by=current_user.id)
    provider_setting.updated_at = datetime.now(UTC)
    db.commit()
    return _setting_read(db)
