from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from typing import Any
from uuid import UUID

from fastapi import HTTPException

from app.models.tables import SystemSetting, YoloModel, YoloModelVersion
from app.schemas.detection_strategies import DetectionStrategyEdit, DetectionStrategyRead
from app.schemas.vision_models import VisionModelEdit
from app.services.formal_detection_prompts import FACADE_TYPE_NAMES, FORMAL_PROMPT_SETTING_KEYS, formal_prompt_values
from app.services.trial_inference_provider import set_setting_value, setting_value, trial_prompts
from app.services.vision_models import STRATEGY_PREFIX, model_config, model_runtime

DEFECT_LABELS = {"crack": "裂缝", "spalling": "脱落", "peeling": "起皮", "damage": "面板破损", "hollow": "空鼓（热成像）"}
DEFINITIONS: dict[str, tuple[str, str, list[str]]] = {
    "visible_prompt": ("general", "裂缝 + 脱落", ["crack", "spalling"]),
    "crack_prompt": ("general", "裂缝", ["crack"]),
    "spalling_prompt": ("general", "脱落", ["spalling"]),
    "thermal_prompt": ("general", "空鼓（热成像）", ["hollow"]),
    "photo_guard_prompt": ("general", "照片相关性判断", []),
}
for key in FORMAL_PROMPT_SETTING_KEYS:
    facade = next(value for value in FACADE_TYPE_NAMES if key.startswith(value + "_"))
    variant = key[len(facade) + 1:]
    kinds = {"visible_prompt": ["crack", "spalling"], "crack_peeling_prompt": ["crack", "peeling"], "damage_spalling_prompt": ["damage", "spalling"], "thermal_prompt": ["hollow"]}.get(variant)
    if kinds is None:
        kinds = [variant.removesuffix("_prompt")]
    DEFINITIONS[key] = (facade, " + ".join(DEFECT_LABELS[kind] for kind in kinds), kinds)

PROMPT_KEYS = {"visible_prompt": "trial_visible_prompt", "crack_prompt": "trial_crack_prompt", "spalling_prompt": "trial_spalling_prompt", "thermal_prompt": "trial_thermal_prompt", "photo_guard_prompt": "photo_guard_prompt", **FORMAL_PROMPT_SETTING_KEYS}


def binding(db, key: str) -> dict[str, Any] | None:
    value = setting_value(db, STRATEGY_PREFIX + key)
    return json.loads(value) if value is not None else None


def photo_guard_binding(db, settings=None) -> dict[str, Any]:
    saved = binding(db, "photo_guard_prompt")
    if saved is not None:
        return saved
    config = model_config(db, "photo_guard", settings)
    return {"model_kind": config.kind, "model_id": "photo_guard", "version_id": None}


def read_strategies(db) -> list[DetectionStrategyRead]:
    prompts = {**asdict(trial_prompts(db)), **formal_prompt_values(db)}
    legacy = setting_value(db, "trial_inference_provider")
    provider = "local_qwen" if legacy == "local_qwen" else "qwen"
    defaults = {"model_kind": "local_vlm" if provider == "local_qwen" else "cloud_api", "model_id": provider, "version_id": None}
    return [DetectionStrategyRead(key=key, facade_type=facade, facade_label=FACADE_TYPE_NAMES.get(facade, "通用设置"),
        label=label, defect_types=kinds, prompt=prompts[key], routing_supported=True,
        **(photo_guard_binding(db) if key == "photo_guard_prompt" else binding(db, key) or defaults))
        for key, (facade, label, kinds) in DEFINITIONS.items()]


def validate_strategy(db, item: DetectionStrategyEdit):
    if item.key not in DEFINITIONS:
        raise HTTPException(422, "未知检测策略。")
    if item.model_kind == "unconfigured":
        if item.model_id or item.version_id:
            raise HTTPException(422, "未配置策略不能绑定模型或版本。")
        return
    if not item.model_id:
        raise HTTPException(422, "请选择具体模型。")
    if item.model_kind != "yolo":
        config = model_config(db, item.model_id)
        if config.kind != item.model_kind or item.version_id:
            raise HTTPException(422, "模型来源或版本配置不匹配。")
        if len(item.prompt.strip()) < 20:
            raise HTTPException(422, "视觉大模型提示词至少需要 20 个字符。")
        return
    try:
        identifier = UUID(item.model_id)
    except ValueError as error:
        raise HTTPException(422, "YOLO 模型 ID 无效。") from error
    model = db.get(YoloModel, identifier)
    if model is None or model.deleted_at is not None:
        raise HTTPException(422, "YOLO 模型不存在或已删除。")
    if not item.version_id:
        raise HTTPException(422, "请选择具体 YOLO 权重版本。")
    version = db.get(YoloModelVersion, item.version_id)
    if version is None or version.model_id != identifier:
        raise HTTPException(422, "模型版本不属于所选 YOLO 模型。")


def save_strategies(db, items, actor_id):
    if len({item.key for item in items}) != len(items):
        raise HTTPException(422, "同一检测项不能重复提交。")
    for item in items:
        try:
            validate_strategy(db, item)
        except HTTPException as error:
            facade, label, _ = DEFINITIONS.get(item.key, ("general", item.key, []))
            raise HTTPException(error.status_code, f"{FACADE_TYPE_NAMES.get(facade, '通用设置')} · {label}：{error.detail}") from error
    for item in items:
        set_setting_value(db, PROMPT_KEYS[item.key], item.prompt.strip(), updated_by=actor_id)
        value = item.model_dump(mode="json", include={"model_kind", "model_id", "version_id"})
        set_setting_value(db, STRATEGY_PREFIX + item.key, json.dumps(value), updated_by=actor_id)
    db.commit()


@dataclass
class StrategyExecution:
    key: str
    defect_types: list[str]
    runtime: Any
    prompt: str
    snapshot: dict[str, Any]


def selected_keys(facade: str, kinds: list[str]) -> list[str]:
    visible = set(kinds).difference({"hollow"})
    matching = [key for key, (wall, _, defects) in DEFINITIONS.items() if wall == facade and set(defects) == visible and defects and "hollow" not in defects]
    keys = matching[:1] if visible else []
    if visible and not keys:
        if len(visible) > 1:
            raise HTTPException(409, "该墙面的检测组合尚未定义，请配置对应检测策略。")
        keys = [key for key, (wall, _, defects) in DEFINITIONS.items() if wall == facade and len(defects) == 1 and defects[0] in visible]
        if {kind for key in keys for kind in DEFINITIONS[key][2]} != visible:
            raise HTTPException(409, "该墙面的检测组合尚未定义，请配置对应检测策略。")
    if "hollow" in kinds:
        keys.append("thermal_prompt" if facade == "general" else f"{facade}_thermal_prompt")
    return keys


def resolve_plan(db, facade: str, kinds: list[str], *, legacy_runtime=None) -> list[StrategyExecution]:
    rows = {item.key: item for item in read_strategies(db)}
    plan = []
    for key in selected_keys(facade, kinds):
        item = rows[key]
        if item.model_kind == "unconfigured":
            raise HTTPException(409, f"{item.facade_label} · {item.label}尚未配置模型。")
        if item.model_kind == "yolo":
            validate_strategy(db, item)
            raise HTTPException(409, f"{item.facade_label} · {item.label}已绑定 YOLO，但 YOLO 运行服务尚未接入，请在模型服务器完成接入后检测。")
        config = model_config(db, item.model_id)
        runtime = legacy_runtime if binding(db, key) is None and legacy_runtime is not None else model_runtime(config, db, identifier=item.model_id)
        if not runtime.configured:
            raise HTTPException(409, f"{config.name}尚未配置服务地址、模型名称或 API Key。")
        snapshot = {"key": key, "defect_types": item.defect_types, "model_kind": item.model_kind, "model_id": item.model_id,
            "model_name": runtime.model, "model_label": runtime.label, "api_base_url": runtime.base_url,
            "api_key_env": config.api_key_env, "prompt": item.prompt,
            "request_concurrency": runtime.max_concurrency, "timeout_seconds": runtime.timeout_seconds}
        plan.append(StrategyExecution(key, item.defect_types, runtime, item.prompt, snapshot))
    return plan


def restore_plan(snapshots: list[dict[str, Any]], db=None) -> list[StrategyExecution]:
    from dataclasses import replace
    plan = []
    for snapshot in snapshots:
        config = VisionModelEdit(name=snapshot["model_label"], kind=snapshot["model_kind"], model_name=snapshot["model_name"],
            api_base_url=snapshot["api_base_url"], api_key_env=snapshot["api_key_env"])
        runtime = replace(model_runtime(config, db), max_concurrency=snapshot["request_concurrency"], timeout_seconds=snapshot["timeout_seconds"])
        plan.append(StrategyExecution(snapshot["key"], snapshot["defect_types"], runtime, snapshot["prompt"], snapshot))
    return plan


def merge_results(results: list[dict[str, Any]]) -> dict[str, Any]:
    merged = dict(results[0])
    for field in ("requested_models", "executed_models"):
        merged[field] = list(dict.fromkeys(value for result in results for value in result.get(field) or []))
    merged["detections"] = [value for result in results for value in result.get("detections") or []]
    details = dict(merged.get("inference") or {})
    for field in ("tile_count", "api_request_count", "pre_merge_detection_count", "post_merge_detection_count", "pre_nms_detection_count", "post_nms_detection_count"):
        details[field] = sum(int((result.get("inference") or {}).get(field) or 0) for result in results)
    merged["inference"] = details
    from app.services.trial_qwen_inference import _aggregate_token_usages
    merged["token_usage"] = _aggregate_token_usages([result.get("token_usage") for result in results])
    merged["tile_token_usages"] = [usage for result in results for usage in result.get("tile_token_usages") or []]
    merged["strategy_models"] = [model for result in results for model in result.get("strategy_models") or []]
    return merged


async def execute_plan(plan, images, *, infer, **limits):
    per_image: list[list[dict[str, Any]]] = [[] for _ in images]
    for execution in plan:
        thermal = execution.defect_types == ["hollow"]
        indices = [i for i, image in enumerate(images) if bool(image.thermal_imaging_available) == thermal]
        if not indices:
            continue
        runtime = execution.runtime
        if not runtime.configured:
            raise RuntimeError(f"{runtime.label} 未配置 API Key 或服务地址。")
        values = await infer([images[i] for i in indices], api_key=runtime.api_key, base_url=runtime.base_url, model=runtime.model,
            provider=runtime.upstream_provider, visible_prompt=execution.prompt, thermal_prompt=execution.prompt,
            visible_defect_types=[] if thermal else execution.defect_types, timeout_seconds=runtime.timeout_seconds,
            max_concurrency=runtime.max_concurrency, **limits)
        for i, result in zip(indices, values, strict=True):
            result = dict(result)
            result["strategy_models"] = [{key: value for key, value in execution.snapshot.items() if key not in {"prompt", "api_base_url", "api_key_env"}}]
            result["detections"] = [{**detection, "strategy_key": execution.key, "model_version": runtime.model, "model_provider": runtime.provider} for detection in result.get("detections") or []]
            per_image[i].append(result)
    if any(not values for values in per_image):
        raise RuntimeError("照片类型与已配置检测策略不匹配。")
    return [merge_results(values) if len(values) > 1 else values[0] for values in per_image]
