"""Resolve photo precheck through the same model catalog as defect detection."""
import copy

from fastapi import HTTPException

from app.services.detection_strategies import photo_guard_binding
from app.services.photo_guard import PhotoGuardUnavailable
from app.services.vision_models import model_config, model_runtime


def photo_guard_strategy_settings(db, settings):
    binding = photo_guard_binding(db, settings)
    kind, identifier = binding["model_kind"], binding.get("model_id")
    if kind == "unconfigured" or not identifier:
        raise PhotoGuardUnavailable("照片相关性判断尚未配置模型。")
    if kind == "yolo":
        raise PhotoGuardUnavailable("照片相关性判断绑定的 YOLO 运行服务尚未接入。")
    try:
        config = model_config(db, identifier, settings)
        if config.kind != kind:
            raise PhotoGuardUnavailable("照片相关性判断的模型来源与当前配置不匹配，请重新选择模型。")
        runtime = model_runtime(config, db, settings, identifier=identifier)
    except HTTPException as error:
        raise PhotoGuardUnavailable(str(error.detail)) from error
    if not runtime.configured:
        raise PhotoGuardUnavailable(f"{config.name}尚未配置服务地址、模型名称或 API Key。")

    resolved = copy.copy(settings)
    resolved.photo_guard_provider = "dashscope" if kind == "cloud_api" else "openai_compatible"
    resolved.photo_guard_api_base_url = runtime.base_url
    resolved.photo_guard_model = runtime.model
    resolved.photo_guard_api_key = runtime.api_key
    return resolved, binding
