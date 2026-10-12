from __future__ import annotations

import copy
import json
import logging
import os
import subprocess
from pathlib import Path

from dotenv import dotenv_values
from fastapi import HTTPException
from sqlalchemy import select

from app.core.config import get_settings
from app.core.model_security import ALLOWED_PHOTO_GUARD_UNITS, build_model_runtime_dir, validate_model_identifier
from app.models.tables import SystemSetting
from app.schemas.vision_models import VisionModelEdit, VisionModelRead
from app.services.local_qwen_lifecycle import LocalQwenLifecycleError, LocalQwenStatus, _is_healthy, local_qwen_status
from app.services.trial_inference_provider import TrialInferenceRuntime, trial_scheduling_settings

VISION_PREFIX = "vision_model:"
STRATEGY_PREFIX = "detection_strategy:"
logger = logging.getLogger(__name__)
BUILTINS = {
    "qwen": {"name": "云端通义千问", "kind": "cloud_api", "api_key_env": "DASHSCOPE_API_KEY"},
    "local_qwen": {"name": "本地视觉大模型", "kind": "local_vlm", "api_key_env": "LOCAL_QWEN_API_KEY"},
    "photo_guard": {"name": "照片预检视觉模型"},
}


def photo_guard_model_defaults(settings=None) -> VisionModelEdit:
    settings = settings or get_settings()
    cloud = getattr(settings, "photo_guard_provider", "dashscope") == "dashscope"
    model = getattr(settings, "photo_guard_model", "") or (getattr(settings, "qwen3_vl_flash_model", "qwen3-vl-flash") if cloud else "")
    return VisionModelEdit(
        name=f"{'云端' if cloud else '本地'}照片预检 · {model or '千问3-VL-Flash'}",
        kind="cloud_api" if cloud else "local_vlm",
        model_name=model,
        api_base_url=getattr(settings, "photo_guard_api_base_url", "") or (getattr(settings, "qwen_api_base_url", "") if cloud else ""),
        api_key_env="PHOTO_GUARD_API_KEY" if getattr(settings, "photo_guard_api_key", "") or not cloud else "DASHSCOPE_API_KEY",
    )


def model_config(db, identifier: str, settings=None) -> VisionModelEdit:
    try:
        validate_model_identifier(identifier)
    except ValueError as error:
        raise HTTPException(422, "非法模型标识。") from error
    getter = getattr(db, "get", None)
    saved = getter(SystemSetting, VISION_PREFIX + identifier) if callable(getter) else None
    if saved is not None:
        return VisionModelEdit.model_validate_json(saved.value)
    if identifier == "photo_guard":
        return photo_guard_model_defaults(settings)
    if identifier in BUILTINS:
        return VisionModelEdit(**BUILTINS[identifier])
    raise HTTPException(404, "视觉模型不存在。")


def credential(env_name: str, settings=None) -> str:
    settings = settings or get_settings()
    known = {"DASHSCOPE_API_KEY": "dashscope_api_key", "LOCAL_QWEN_API_KEY": "local_qwen_api_key", "PHOTO_GUARD_API_KEY": "photo_guard_api_key"}
    if env_name in known:
        return str(getattr(settings, known[env_name], "") or "").strip()
    if not env_name:
        return ""
    if env_name in os.environ:
        return os.environ[env_name].strip()
    value = ""
    for filename in (".env", "../.env", ".env.local", "../.env.local", ".env.sms.local", "../.env.sms.local"):
        values = dotenv_values(filename)
        if env_name in values:
            value = values[env_name] or ""
    return value.strip()


def model_runtime(config: VisionModelEdit, db=None, settings=None, *, identifier: str | None = None) -> TrialInferenceRuntime:
    settings = settings or get_settings()
    local = config.kind == "local_vlm"
    scheduling = trial_scheduling_settings(db, settings)
    defaults = photo_guard_model_defaults(settings) if identifier == "photo_guard" else None
    return TrialInferenceRuntime(
        provider="local_qwen" if local else "qwen", upstream_provider="qwen", label=config.name,
        api_key=credential(config.api_key_env, settings) or ("local" if local else ""),
        base_url=config.api_base_url or (defaults.api_base_url if defaults else getattr(settings, "local_qwen_api_base_url" if local else "qwen_api_base_url", "")),
        model=config.model_name or (defaults.model_name if defaults else getattr(settings, "local_qwen_model" if local else "qwen_model", "")),
        timeout_seconds=scheduling.request_timeout_seconds,
        max_concurrency=min(scheduling.request_concurrency, getattr(settings, "local_qwen_max_concurrency", 1)) if local else scheduling.request_concurrency,
    )


def local_model_settings(identifier: str, config: VisionModelEdit, settings=None):
    validate_model_identifier(identifier)
    settings = copy.copy(settings or get_settings())
    runtime = model_runtime(config, settings=settings, identifier=identifier)
    settings.local_qwen_model = runtime.model
    settings.local_qwen_api_base_url = runtime.base_url
    settings.local_qwen_api_key = credential(config.api_key_env, settings)
    settings.local_qwen_model_path = config.model_path or (settings.local_qwen_model_path if identifier == "local_qwen" else "")
    if identifier != "local_qwen":
        root = settings.local_qwen_runtime_dir or Path(__file__).resolve().parents[3] / ".runtime"
        try:
            settings.local_qwen_runtime_dir = build_model_runtime_dir(root, identifier)
        except (OSError, RuntimeError, ValueError) as error:
            raise LocalQwenLifecycleError("模型运行目录无效，请检查服务端配置。") from error
    return settings


def managed_photo_guard_service(identifier: str, config: VisionModelEdit) -> str:
    settings = get_settings()
    if identifier != "photo_guard" or config.kind != "local_vlm":
        return ""
    runtime = model_runtime(config, settings=settings, identifier=identifier)
    if runtime.base_url != settings.photo_guard_api_base_url or runtime.model != settings.photo_guard_model:
        return ""
    service = settings.photo_guard_systemd_user_service
    return _verified_managed_service(service) if service else ""


def _verified_managed_service(service: str) -> str:
    if service not in ALLOWED_PHOTO_GUARD_UNITS or service != get_settings().photo_guard_systemd_user_service:
        raise LocalQwenLifecycleError("不允许控制此服务。")
    return service


def _systemd_user_env() -> dict[str, str]:
    # A system service running as the app user does not inherit their login bus.
    env = dict(os.environ)
    runtime_dir = env.get("XDG_RUNTIME_DIR") or f"/run/user/{os.getuid()}"
    env["XDG_RUNTIME_DIR"] = runtime_dir
    env["DBUS_SESSION_BUS_ADDRESS"] = env.get("DBUS_SESSION_BUS_ADDRESS") or f"unix:path={runtime_dir}/bus"
    return env


def managed_photo_guard_status(service: str, config: VisionModelEdit) -> LocalQwenStatus:
    unit = _verified_managed_service(service)
    try:
        result = subprocess.run(["systemctl", "--user", "show", "--property=ActiveState,SubState,MainPID", "--", unit],
            shell=False, capture_output=True, text=True, timeout=5, check=True, env=_systemd_user_env())
        values = {}
        for line in result.stdout.splitlines():
            key, separator, value = line.partition("=")
            if separator and key in {"ActiveState", "SubState", "MainPID"}:
                values[key] = value
        pid = int(values.get("MainPID", "0")) or None
        if pid is not None and pid <= 1:
            raise ValueError("Invalid service PID")
        state = values.get("ActiveState")
        if state in {"inactive", "failed"}:
            return LocalQwenStatus("error" if state == "failed" else "stopped", "照片预检服务运行异常。" if state == "failed" else "照片预检服务已停止。", pid)
        if state not in {"active", "activating", "deactivating"}:
            return LocalQwenStatus("error", "无法读取照片预检服务状态。", pid)
        settings = local_model_settings("photo_guard", config)
        ready = state == "active" and _is_healthy(settings)
        return LocalQwenStatus("running" if ready else "starting", "照片预检服务正在运行（systemd 管理）。" if ready else "照片预检服务正在加载或停止，请稍候。", pid)
    except (OSError, ValueError, LocalQwenLifecycleError, subprocess.SubprocessError) as error:
        logger.warning("photo_guard_status_failed unit=%s error_type=%s", unit, type(error).__name__)
        return LocalQwenStatus("error", "无法读取照片预检服务状态，请检查服务端日志。")


def control_managed_photo_guard(service: str, config: VisionModelEdit, action: str) -> LocalQwenStatus:
    if action not in {"start", "stop"}:
        raise LocalQwenLifecycleError("未知模型管理操作。")
    unit = _verified_managed_service(service)
    try:
        subprocess.run(["systemctl", "--user", action, "--", unit], shell=False, capture_output=True, text=True, timeout=50, check=True, env=_systemd_user_env())
    except (OSError, subprocess.SubprocessError) as error:
        logger.warning("photo_guard_control_failed unit=%s action=%s error_type=%s", unit, action, type(error).__name__)
        raise LocalQwenLifecycleError("照片预检服务启停失败，请检查服务端日志。") from error
    return managed_photo_guard_status(unit, config)


def model_read(db, identifier: str) -> VisionModelRead:
    config = model_config(db, identifier)
    runtime = model_runtime(config, db, identifier=identifier)
    supported = False
    active = False
    if config.kind == "cloud_api":
        state, message = ("configured", "云端 API 已配置。") if runtime.configured else ("unconfigured", "请配置服务地址、模型名称和服务端 API Key。")
    elif os.name != "posix":
        state, message = "disabled", "当前系统不支持本地 vLLM 启停，请在 Linux 模型服务器配置。"
    elif service := managed_photo_guard_service(identifier, config):
        status = managed_photo_guard_status(service, config)
        state, message = status.state, status.message
        active = status.pid is not None
        supported = True
    else:
        try:
            local_settings = local_model_settings(identifier, config)
        except LocalQwenLifecycleError as error:
            raise HTTPException(422, "模型运行目录无效，请检查服务端配置。") from error
        status = local_qwen_status(local_settings)
        state = status.state
        message = "本地模型运行异常，请检查服务端日志。" if state == "error" else status.message
        active = status.pid is not None or status.state in {"running", "starting", "stopping"}
        supported = local_settings.local_qwen_control_enabled and local_settings.app_env != "test"
        if supported and not local_settings.local_qwen_model_path:
            supported = False
            state, message = "disabled", "请填写服务器模型目录后使用本地启停；已启动的服务仍可通过 API 调用。"
    return VisionModelRead(**config.model_dump(), id=identifier, builtin=identifier in BUILTINS,
        effective_model_name=runtime.model, effective_api_base_url=runtime.base_url, configured=runtime.configured,
        runtime_status=state, runtime_active=active, runtime_message=message, control_supported=supported)


def model_catalog(db) -> list[VisionModelRead]:
    identifiers = list(BUILTINS)
    for key in db.scalars(select(SystemSetting.key).where(SystemSetting.key.startswith(VISION_PREFIX)).order_by(SystemSetting.key)):
        identifier = key[len(VISION_PREFIX):]
        if identifier not in identifiers:
            identifiers.append(identifier)
    return [model_read(db, identifier) for identifier in identifiers]


def ensure_model_unbound(db, identifier: str, *, version_id: str | None = None):
    for setting in db.scalars(select(SystemSetting).where(SystemSetting.key.startswith(STRATEGY_PREFIX))):
        value = json.loads(setting.value)
        if value.get("model_id") == identifier and (version_id is None or value.get("version_id") == version_id):
            raise HTTPException(409, "该模型或版本已被检测策略引用，请先调整对应策略。")
