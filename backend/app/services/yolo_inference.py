"""Adapt version-scoped YOLO prediction to the shared tiled detection pipeline."""
import asyncio
from dataclasses import dataclass
import json
import math
from uuid import UUID

from fastapi import HTTPException
import httpx

from app.services import trial_qwen_inference as tiling, yolo_runtime
from app.services.trial_inference_provider import trial_scheduling_settings


@dataclass(frozen=True)
class YoloInferenceRuntime:
    model_id: UUID
    id: UUID
    sha256: str
    model: str
    label: str
    base_url: str
    timeout_seconds: float
    max_concurrency: int = 1
    provider: str = "yolo"
    upstream_provider: str = "yolo"
    api_key: str = ""

    @property
    def configured(self):
        return bool(self.id and self.model_id and self.sha256)


def model_runtime(model, version, db):
    try:
        url = yolo_runtime.runtime_url(version)
    except HTTPException as error:
        raise HTTPException(error.status_code, f"{model.name} · {version.version}：{error.detail}") from error
    return YoloInferenceRuntime(
        model_id=model.id, id=version.id, sha256=version.sha256,
        model=version.version, label=f"{model.name} · {version.version}", base_url=url,
        timeout_seconds=trial_scheduling_settings(db).request_timeout_seconds,
    )


def restore_runtime(snapshot):
    # Resolve the live port at execution time: Docker can reassign it while
    # the task waits. Keep the original version/checksum, never current bindings.
    return YoloInferenceRuntime(
        model_id=UUID(snapshot["model_id"]), id=UUID(snapshot["version_id"]),
        sha256=snapshot["sha256"], model=snapshot["model_name"],
        label=snapshot["model_label"], base_url=snapshot["api_base_url"],
        timeout_seconds=snapshot["timeout_seconds"],
        max_concurrency=snapshot["request_concurrency"],
    )


def _normalize_detection(item, tile, selected):
    if not isinstance(item, dict) or item.get("type") not in selected:
        return None
    bbox = item.get("bbox")
    if not isinstance(bbox, dict):
        return None
    try:
        confidence = float(item["confidence"])
        x, y, width, height = (float(bbox[key]) for key in ("x", "y", "width", "height"))
    except (KeyError, TypeError, ValueError):
        return None
    if not all(math.isfinite(value) for value in (confidence, x, y, width, height)):
        return None
    if not 0 <= confidence <= 1 or width <= 0 or height <= 0:
        return None
    x1, y1 = max(0.0, x), max(0.0, y)
    x2, y2 = min(tile.valid_width, x + width), min(tile.valid_height, y + height)
    if x2 <= x1 or y2 <= y1:
        return None
    return {**item, "type_name": tiling.DEFECT_TYPE_NAMES[item["type"]],
            "bbox": {"x": x1 + tile.x, "y": y1 + tile.y, "width": x2 - x1, "height": y2 - y1},
            "_source_tile": tile}


async def infer_yolo_images(images, *, runtime, defect_types, **limits):
    image_limits = {
        "max_image_pixels": tiling.DEFAULT_MAX_IMAGE_PIXELS,
        "inference_max_image_pixels": tiling.DEFAULT_INFERENCE_MAX_IMAGE_PIXELS,
        "max_tiles_per_image": tiling.DEFAULT_MAX_TILES_PER_IMAGE,
        "max_tiles_per_request": tiling.DEFAULT_MAX_TILES_PER_REQUEST,
        **limits,
    }
    tiling._validate_image_batch(images, **image_limits)
    url = await asyncio.to_thread(yolo_runtime.runtime_url, runtime)
    concurrency = tiling._bounded_concurrency(runtime.max_concurrency)
    states = []
    queue = asyncio.Queue(maxsize=concurrency * 2)
    selected = frozenset(defect_types)

    async with httpx.AsyncClient(timeout=runtime.timeout_seconds, trust_env=False,
                                follow_redirects=False) as client:
        async def worker():
            while True:
                job = await queue.get()
                if job is None:
                    return
                try:
                    response = await client.post(
                        url + "/predict", files={"file": ("tile.png", job.content, "image/png")},
                        data={"models": json.dumps(defect_types), "image_size": str(tiling.TILE_WIDTH)},
                    )
                    if not response.is_success:
                        if response.status_code in {409, 422, 503}:
                            detail = response.json().get("detail", "模型服务未就绪。")
                            raise HTTPException(409, f"{runtime.label}：{detail}")
                        raise RuntimeError(f"{runtime.label} 检测失败（HTTP {response.status_code}）。")
                    payload = response.json()
                    if (not isinstance(payload, dict)
                            or payload.get("model_id") != str(runtime.model_id)
                            or payload.get("version_id") != str(runtime.id)
                            or payload.get("sha256") != runtime.sha256
                            or payload.get("model_version") != runtime.model):
                        raise RuntimeError("YOLO 推理响应与指定权重版本不一致。")
                    if not isinstance(payload.get("detections"), list):
                        raise RuntimeError("YOLO 推理响应缺少检测结果。")
                    states[job.image_index].tile_detections[job.tile_index] = [
                        value for item in payload["detections"]
                        if (value := _normalize_detection(item, job.tile, selected)) is not None
                    ]
                except (httpx.HTTPError, ValueError) as error:
                    raise RuntimeError(f"{runtime.label} 检测请求失败。") from error

        # Share EXIF orientation, resize budgets, bounded tile production,
        # coordinate restoration and cross-tile deduplication with VLM inference.
        tasks = [asyncio.create_task(tiling._produce_tile_jobs(
            images, queue=queue, states=states, worker_count=concurrency,
            max_image_pixels=image_limits["max_image_pixels"],
            inference_max_image_pixels=image_limits["inference_max_image_pixels"],
        )), *[asyncio.create_task(worker()) for _ in range(concurrency)]]
        try:
            await asyncio.gather(*tasks)
        except BaseException:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            raise

    results = []
    for state in states:
        result = tiling._inference_result(state, model=runtime.model, provider="yolo",
                                         concurrency=concurrency, visible_requested_models=selected)
        result.update(model_id=str(runtime.model_id), version_id=str(runtime.id), sha256=runtime.sha256,
                      token_usage=None, tile_token_usages=[])
        result["inference"].update(bbox_coordinate_space="pixels", bbox_coordinate_scale=1)
        results.append(result)
    return results
