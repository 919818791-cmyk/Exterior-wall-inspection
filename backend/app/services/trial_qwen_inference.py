from __future__ import annotations

import asyncio
import base64
import json
import math
import re
from dataclasses import dataclass
from io import BytesIO
from typing import Any, Sequence
from uuid import UUID

import httpx
from PIL import Image, ImageOps


TRIAL_QWEN_PROMPT = """你是建筑外墙缺陷检测助手。
当前输入是一张建筑外墙的局部切片图片，不是完整建筑立面。请只判断该切片中是否存在以下外墙缺陷：
 - crack：裂缝
 - spalling：外墙瓷砖/面砖已经掉块、缺角、破损，或局部材料脱落缺失
规则：
1. 只输出 JSON 数组，不要输出解释、Markdown、标题或其他文字。
2. 如果没有发现明显缺陷，输出 []。
3. 每个结果必须包含以下字段：
 - type：只能是 crack 或 spalling
 - confidence：0 到 1 的小数
 - bbox：格式为 [x1, y1, x2, y2]
 - description：不超过20字
4. bbox 使用 Qwen3-VL 原生归一化坐标，原点在左上角；每个坐标必须是 0 到 999 的数字，不是像素值。
5. spalling 必须具有可见的实体材料损失，例如瓷砖缺了一块、边角崩掉、出现不规则断口，或脱落后露出水泥/砂浆基层；bbox 只框住实际破损或缺失区域。
6. 完整瓷砖上的变色、污渍、阴影、反光、普通划痕，以及瓷砖缝、窗框边缘、装饰线条、正常拼缝，都不是 spalling。
7. 瓷砖整体完整、仅有裂纹时只输出 crack，不要同时输出 spalling；只有裂纹伴随明确掉块或材料缺失时才输出 spalling。
8. “空鼓”本身不可从普通照片可靠判断；没有可见掉块、破损或材料缺失时，不要输出 spalling。
9. 只有当缺陷较明显时才输出；不确定时请降低 confidence，低于 0.40 的目标不要输出。
输出示例：
[
  {
    "type": "crack",
    "confidence": 0.82,
    "bbox": [120, 80, 360, 130],
    "description": "疑似墙面裂缝"
  },
  {
    "type": "spalling",
    "confidence": 0.76,
    "bbox": [420, 210, 560, 360],
    "description": "瓷砖局部破损掉块"
  }
]"""

TILE_WIDTH = 1280
TILE_HEIGHT = 960
TILE_OVERLAP_RATIO = 0.25
NMS_IOU_THRESHOLD = 0.5
MAX_QWEN_CONCURRENCY = 5
MIN_DETECTION_CONFIDENCE = 0.40
QWEN_BBOX_COORDINATE_SCALE = 1000.0
# Qwen3-VL documents coordinates as [0, 999], but tolerate 1000 as an exact
# right/bottom edge because grounding responses commonly round to that value.
QWEN_BBOX_COORDINATE_MAX = 1000.0
DEFECT_TYPE_NAMES = {
    "crack": "裂缝",
    "spalling": "剥落",
}


class TrialQwenInferenceError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class TrialQwenImageInput:
    filename: str
    content: bytes
    content_type: str | None = None
    photo_id: UUID | str | None = None


@dataclass(frozen=True, slots=True)
class _Tile:
    x: int
    y: int
    valid_width: int
    valid_height: int


@dataclass(slots=True)
class _ImageState:
    image_input: TrialQwenImageInput
    width: int
    height: int
    tiles: list[_Tile]
    tile_detections: list[list[dict[str, Any]] | None]


@dataclass(frozen=True, slots=True)
class _TileJob:
    image_index: int
    tile_index: int
    tile: _Tile
    content: bytes


async def infer_trial_images(
    images: Sequence[TrialQwenImageInput],
    *,
    api_key: str,
    base_url: str,
    model: str = "qwen3-vl-plus",
    timeout_seconds: float = 120.0,
    max_concurrency: int = MAX_QWEN_CONCURRENCY,
) -> list[dict[str, Any]]:
    """Run tiled Qwen inference and return one legacy-compatible result per image."""
    normalized_api_key = api_key.strip()
    normalized_base_url = base_url.strip().rstrip("/")
    normalized_model = model.strip()
    if not normalized_api_key:
        raise ValueError("Qwen API key is required.")
    if not normalized_base_url:
        raise ValueError("Qwen API base URL is required.")
    if not normalized_model:
        raise ValueError("Qwen model is required.")
    if not math.isfinite(timeout_seconds) or timeout_seconds <= 0:
        raise ValueError("Qwen timeout must be a positive finite number.")

    concurrency = _bounded_concurrency(max_concurrency)
    endpoint = (
        normalized_base_url
        if normalized_base_url.endswith("/chat/completions")
        else f"{normalized_base_url}/chat/completions"
    )
    limits = httpx.Limits(
        max_connections=concurrency,
        max_keepalive_connections=concurrency,
    )
    headers = {
        "Authorization": f"Bearer {normalized_api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(
        headers=headers,
        limits=limits,
        timeout=httpx.Timeout(timeout_seconds),
        trust_env=False,
    ) as client:
        states: list[_ImageState] = []
        queue: asyncio.Queue[_TileJob | None] = asyncio.Queue(maxsize=concurrency * 2)
        producer = asyncio.create_task(
            _produce_tile_jobs(images, queue=queue, states=states, worker_count=concurrency)
        )
        workers = [
            asyncio.create_task(
                _tile_worker(
                    queue=queue,
                    states=states,
                    client=client,
                    endpoint=endpoint,
                    model=normalized_model,
                )
            )
            for _ in range(concurrency)
        ]
        tasks = [producer, *workers]
        try:
            await asyncio.gather(*tasks)
        except BaseException:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            raise
        return [
            _inference_result(state, model=normalized_model, concurrency=concurrency)
            for state in states
        ]


def _bounded_concurrency(value: int) -> int:
    if isinstance(value, bool):
        raise ValueError("Qwen max concurrency must be a positive integer.")
    try:
        requested = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("Qwen max concurrency must be a positive integer.") from exc
    if requested <= 0:
        raise ValueError("Qwen max concurrency must be a positive integer.")
    return min(requested, MAX_QWEN_CONCURRENCY)


async def _produce_tile_jobs(
    images: Sequence[TrialQwenImageInput],
    *,
    queue: asyncio.Queue[_TileJob | None],
    states: list[_ImageState],
    worker_count: int,
) -> None:
    for image_input in images:
        image = _open_image(image_input)
        try:
            tiles = _image_tiles(image)
            image_index = len(states)
            states.append(
                _ImageState(
                    image_input=image_input,
                    width=image.width,
                    height=image.height,
                    tiles=tiles,
                    tile_detections=[None] * len(tiles),
                )
            )
            for tile_index, tile in enumerate(tiles):
                await queue.put(
                    _TileJob(
                        image_index=image_index,
                        tile_index=tile_index,
                        tile=tile,
                        content=_encode_tile_png(image, tile),
                    )
                )
        finally:
            image.close()

    for _ in range(worker_count):
        await queue.put(None)


async def _tile_worker(
    *,
    queue: asyncio.Queue[_TileJob | None],
    states: list[_ImageState],
    client: httpx.AsyncClient,
    endpoint: str,
    model: str,
) -> None:
    while True:
        job = await queue.get()
        if job is None:
            return
        response_payload = await _request_tile(
            client,
            endpoint=endpoint,
            model=model,
            tile_png=job.content,
        )
        raw_detections = _response_detection_array(response_payload)
        states[job.image_index].tile_detections[job.tile_index] = [
            normalized
            for item in raw_detections
            if (normalized := _normalize_detection(item, job.tile)) is not None
        ]


def _inference_result(
    state: _ImageState,
    *,
    model: str,
    concurrency: int,
) -> dict[str, Any]:
    raw_detections = [
        detection
        for tile_result in state.tile_detections
        if tile_result is not None
        for detection in tile_result
    ]
    detections = _class_aware_nms(raw_detections, iou_threshold=NMS_IOU_THRESHOLD)
    _assign_detection_ids(detections)
    return {
        "model_version": model,
        "filename": state.image_input.filename,
        "photo_id": (
            str(state.image_input.photo_id)
            if state.image_input.photo_id is not None
            else None
        ),
        "image": {"width": state.width, "height": state.height},
        "inference": {
            "mode": "tiled",
            "image_size": {"width": TILE_WIDTH, "height": TILE_HEIGHT},
            "tile_size": {"width": TILE_WIDTH, "height": TILE_HEIGHT},
            "tile_width": TILE_WIDTH,
            "tile_height": TILE_HEIGHT,
            "tile_overlap_ratio": TILE_OVERLAP_RATIO,
            "tile_count": len(state.tiles),
            "api_request_count": len(state.tiles),
            "max_concurrency": concurrency,
            "padding": "white",
            "bbox_coordinate_space": "normalized_0_999",
            "bbox_coordinate_scale": int(QWEN_BBOX_COORDINATE_SCALE),
            "nms_iou_threshold": NMS_IOU_THRESHOLD,
            "pre_nms_detection_count": len(raw_detections),
            "post_nms_detection_count": len(detections),
        },
        "requested_models": list(DEFECT_TYPE_NAMES),
        "executed_models": [model],
        "detections": detections,
    }


def _open_image(image_input: TrialQwenImageInput) -> Image.Image:
    if not isinstance(image_input.content, bytes) or not image_input.content:
        raise TrialQwenInferenceError(f"Image is empty: {image_input.filename}")
    try:
        with Image.open(BytesIO(image_input.content)) as source:
            oriented = ImageOps.exif_transpose(source)
            try:
                image = oriented.convert("RGB")
                image.load()
            finally:
                if oriented is not source:
                    oriented.close()
    except Exception as exc:
        raise TrialQwenInferenceError(f"Invalid image file: {image_input.filename}") from exc
    if image.width <= 0 or image.height <= 0:
        image.close()
        raise TrialQwenInferenceError(f"Invalid image dimensions: {image_input.filename}")
    return image


def _image_tiles(image: Image.Image) -> list[_Tile]:
    return [
        _Tile(
            x=x,
            y=y,
            valid_width=min(TILE_WIDTH, image.width - x),
            valid_height=min(TILE_HEIGHT, image.height - y),
        )
        for y in _tile_starts(image.height, TILE_HEIGHT)
        for x in _tile_starts(image.width, TILE_WIDTH)
    ]


def _tile_starts(length: int, tile_size: int) -> list[int]:
    if length <= tile_size:
        return [0]
    step = max(1, int(round(tile_size * (1.0 - TILE_OVERLAP_RATIO))))
    starts: list[int] = []
    start = 0
    while True:
        starts.append(start)
        if start + tile_size >= length:
            return starts
        start += step


def _encode_tile_png(image: Image.Image, tile: _Tile) -> bytes:
    crop = image.crop(
        (
            tile.x,
            tile.y,
            tile.x + tile.valid_width,
            tile.y + tile.valid_height,
        )
    )
    canvas = Image.new("RGB", (TILE_WIDTH, TILE_HEIGHT), "white")
    canvas.paste(crop, (0, 0))
    output = BytesIO()
    try:
        canvas.save(output, format="PNG")
        return output.getvalue()
    finally:
        output.close()
        canvas.close()
        crop.close()


async def _request_tile(
    client: httpx.AsyncClient,
    *,
    endpoint: str,
    model: str,
    tile_png: bytes,
) -> dict[str, Any]:
    image_url = f"data:image/png;base64,{base64.b64encode(tile_png).decode('ascii')}"
    request_payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": image_url},
                    },
                    {
                        "type": "text",
                        "text": TRIAL_QWEN_PROMPT,
                    },
                ],
            }
        ],
        "enable_thinking": False,
        "stream": False,
    }
    try:
        response = await client.post(endpoint, json=request_payload)
    except httpx.HTTPError as exc:
        raise TrialQwenInferenceError(f"Qwen request failed: {exc}") from exc

    if not response.is_success:
        detail = _response_error_detail(response)
        raise TrialQwenInferenceError(
            f"Qwen request failed with HTTP {response.status_code}: {detail}"
        )
    try:
        payload = response.json()
    except ValueError as exc:
        raise TrialQwenInferenceError("Qwen returned a non-JSON API response.") from exc
    if not isinstance(payload, dict):
        raise TrialQwenInferenceError("Qwen returned an invalid API response object.")
    return payload


def _response_error_detail(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        payload = None
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict) and error.get("message"):
            return str(error["message"])[:500]
        if payload.get("message"):
            return str(payload["message"])[:500]
    detail = response.text.strip().replace("\r", " ").replace("\n", " ")
    return detail[:500] or "Unknown upstream error"


def _response_detection_array(payload: dict[str, Any]) -> list[Any]:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise TrialQwenInferenceError("Qwen response does not contain choices[0].")
    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise TrialQwenInferenceError("Qwen response does not contain choices[0].message.")
    content = _message_content_text(message.get("content"))
    return _parse_json_array(content)


def _message_content_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        fragments = [
            str(item["text"])
            for item in content
            if isinstance(item, dict) and isinstance(item.get("text"), str)
        ]
        if fragments:
            return "".join(fragments)
    raise TrialQwenInferenceError("Qwen response message content is not text.")


def _parse_json_array(content: str) -> list[Any]:
    text = content.strip()
    if not text:
        raise TrialQwenInferenceError("Qwen returned empty message content.")

    candidates = [text]
    fenced_match = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, flags=re.IGNORECASE | re.DOTALL)
    if fenced_match:
        candidates.insert(0, fenced_match.group(1).strip())
    for candidate in candidates:
        try:
            decoded = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(decoded, list):
            return decoded
        raise TrialQwenInferenceError("Qwen message JSON must be an array.")

    decoder = json.JSONDecoder()
    empty_array: list[Any] | None = None
    for index, character in enumerate(text):
        if character != "[":
            continue
        try:
            decoded, _ = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue
        if not isinstance(decoded, list):
            continue
        if decoded and all(isinstance(item, dict) for item in decoded):
            return decoded
        if not decoded and empty_array is None:
            empty_array = decoded
    if empty_array is not None:
        return empty_array
    raise TrialQwenInferenceError("Qwen message content does not contain a JSON array.")


def _normalize_detection(item: object, tile: _Tile) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None

    raw_type = item.get("type")
    if not isinstance(raw_type, str):
        return None
    defect_type = raw_type.strip().lower()
    if defect_type == "missing":
        defect_type = "spalling"
    if defect_type not in DEFECT_TYPE_NAMES:
        return None

    confidence = _finite_float(item.get("confidence"))
    if confidence is None or not 0.0 <= confidence <= 1.0:
        return None
    if confidence < MIN_DETECTION_CONFIDENCE:
        return None

    description = item.get("description")
    if not isinstance(description, str):
        return None
    description = description.strip()
    if len(description) > 20:
        return None

    bbox = item.get("bbox")
    if not isinstance(bbox, list) or len(bbox) != 4:
        return None
    coordinates = [_finite_float(value) for value in bbox]
    if any(value is None for value in coordinates):
        return None
    normalized_x1, normalized_y1, normalized_x2, normalized_y2 = (
        float(value) for value in coordinates
    )
    if not all(
        0.0 <= value <= QWEN_BBOX_COORDINATE_MAX
        for value in (normalized_x1, normalized_y1, normalized_x2, normalized_y2)
    ):
        return None
    if normalized_x2 <= normalized_x1 or normalized_y2 <= normalized_y1:
        return None

    x1 = normalized_x1 / QWEN_BBOX_COORDINATE_SCALE * TILE_WIDTH
    y1 = normalized_y1 / QWEN_BBOX_COORDINATE_SCALE * TILE_HEIGHT
    x2 = normalized_x2 / QWEN_BBOX_COORDINATE_SCALE * TILE_WIDTH
    y2 = normalized_y2 / QWEN_BBOX_COORDINATE_SCALE * TILE_HEIGHT
    x1 = min(float(tile.valid_width), max(0.0, x1))
    y1 = min(float(tile.valid_height), max(0.0, y1))
    x2 = min(float(tile.valid_width), max(0.0, x2))
    y2 = min(float(tile.valid_height), max(0.0, y2))
    if x2 <= x1 or y2 <= y1:
        return None

    return {
        "id": None,
        "type": defect_type,
        "type_name": DEFECT_TYPE_NAMES[defect_type],
        "confidence": confidence,
        "bbox": {
            "x": x1 + tile.x,
            "y": y1 + tile.y,
            "width": x2 - x1,
            "height": y2 - y1,
        },
        "mask": None,
        "severity": None,
        "description": description,
    }


def _finite_float(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _class_aware_nms(
    detections: list[dict[str, Any]],
    *,
    iou_threshold: float,
) -> list[dict[str, Any]]:
    kept: list[dict[str, Any]] = []
    for candidate in sorted(
        detections,
        key=lambda item: float(item.get("confidence") or 0.0),
        reverse=True,
    ):
        if all(
            candidate.get("type") != current.get("type")
            or _bbox_iou(candidate.get("bbox"), current.get("bbox")) <= iou_threshold
            for current in kept
        ):
            kept.append(candidate)
    return kept


def _bbox_iou(left: object, right: object) -> float:
    if not isinstance(left, dict) or not isinstance(right, dict):
        return 0.0
    left_x = _finite_float(left.get("x"))
    left_y = _finite_float(left.get("y"))
    left_width = _finite_float(left.get("width"))
    left_height = _finite_float(left.get("height"))
    right_x = _finite_float(right.get("x"))
    right_y = _finite_float(right.get("y"))
    right_width = _finite_float(right.get("width"))
    right_height = _finite_float(right.get("height"))
    values = (left_x, left_y, left_width, left_height, right_x, right_y, right_width, right_height)
    if any(value is None for value in values):
        return 0.0
    assert left_x is not None and left_y is not None and left_width is not None and left_height is not None
    assert right_x is not None and right_y is not None and right_width is not None and right_height is not None
    if left_width <= 0 or left_height <= 0 or right_width <= 0 or right_height <= 0:
        return 0.0

    intersection_width = max(0.0, min(left_x + left_width, right_x + right_width) - max(left_x, right_x))
    intersection_height = max(0.0, min(left_y + left_height, right_y + right_height) - max(left_y, right_y))
    intersection = intersection_width * intersection_height
    union = left_width * left_height + right_width * right_height - intersection
    return intersection / union if union > 0 else 0.0


def _assign_detection_ids(detections: list[dict[str, Any]]) -> None:
    counters: dict[str, int] = {}
    for detection in detections:
        defect_type = str(detection["type"])
        counters[defect_type] = counters.get(defect_type, 0) + 1
        detection["id"] = f"{defect_type}-{counters[defect_type]}"
