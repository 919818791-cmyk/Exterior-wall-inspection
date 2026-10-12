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
from app.services.local_qwen_lifecycle import local_qwen_status
from app.services.trial_inference_provider import (
    FORMAL_PHOTO_DETECTION_LIMIT_KEY,
    PHOTO_GUARD_PROMPT_KEY,
    TRIAL_CRACK_PROMPT_KEY,
    TRIAL_PHOTO_DETECTION_LIMIT_KEY,
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


def _setting_read(db: Session) -> TrialInferenceSettingRead:
    settings = get_settings()
    local_runtime = local_qwen_status(settings)
    runtimes = [
        trial_inference_runtime("qwen", settings, db),
        trial_inference_runtime("local_qwen", settings, db),
    ]
    prompts = trial_prompts(db)
    scheduling = trial_scheduling_settings(db, settings)
    provider_setting = db.get(SystemSetting, TRIAL_INFERENCE_PROVIDER_KEY)
    return TrialInferenceSettingRead(
        provider=get_trial_inference_provider(db),
        global_job_concurrency=scheduling.global_job_concurrency,
        request_concurrency=scheduling.request_concurrency,
        trial_photo_detection_limit=scheduling.trial_photo_detection_limit,
        formal_photo_detection_limit=scheduling.formal_photo_detection_limit,
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
        ] + [
            TrialInferenceProviderOption(
                provider="yolo",
                label="YOLO模型",
                model="",
                configured=False,
                runtime_message="YOLO模型待接入。",
            )
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
    from app.services.detection_strategies import read_strategies
    from app.services.vision_models import model_config

    rows = [item for item in read_strategies(db) if item.facade_type == "general" and item.routing_supported]
    clouds = list(dict.fromkeys(item.model_id for item in rows if item.model_kind == "cloud_api"))
    models = [model_config(db, identifier) for identifier in clouds]
    provider = "qwen" if clouds else "local_qwen"
    label = "、".join(model.name for model in models) if models else "平台本地检测模型"
    recipient = label if models else "平台控制的本地模型服务"
    policy_url = (
        get_settings().qwen_privacy_policy_url or None
        if clouds == ["qwen"] and not models[0].api_base_url
        else None
    )
    return TrialInferenceDisclosureRead(
        provider=provider,
        label=label,
        is_cloud=bool(clouds),
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
        ("trial_photo_detection_limit", TRIAL_PHOTO_DETECTION_LIMIT_KEY),
        ("formal_photo_detection_limit", FORMAL_PHOTO_DETECTION_LIMIT_KEY),
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
    if payload.provider is not None and not runtime.configured:
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
    provider_setting = set_trial_inference_provider(db, selected_provider, updated_by=current_user.id)
    provider_setting.updated_at = datetime.now(UTC)
    db.commit()
    return _setting_read(db)
