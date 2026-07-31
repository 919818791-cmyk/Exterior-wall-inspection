from __future__ import annotations

import base64
import json
import logging
import math
import time
from dataclasses import asdict, dataclass
from io import BytesIO
from typing import BinaryIO
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException, status
from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import Settings, get_settings


logger = logging.getLogger(__name__)

PHOTO_GUARD_PROMPT = """观察整张图，严格按以下优先级分类：
1. 先检查它是否是软件/网页截图、文档、徽标、图标或地图。只要可见登录框、按钮、输入框、导航栏、网页文字面板等界面元素，立即分类为 OTHER；即使界面背景是高楼照片也必须是 OTHER。
2. 再检查是否为真实拍摄的楼房、外立面或建筑局部（外墙、墙砖、混凝土、裂缝、剥落、门窗、阳台、幕墙、屋檐）。是则 BUILDING。紫红/黑/黄伪彩热成像中可见墙面、窗户、墙砖结构，也算 BUILDING。
3. 其余全部 OTHER，包括人物、动物、车辆、食物、风景、道路桥梁、室内。
必须先执行规则1。不要因文字中出现建筑就选 BUILDING。只输出 category。"""

PHOTO_GUARD_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "category": {
            "type": "string",
            "enum": ["BUILDING", "OTHER"],
        },
    },
    "required": ["category"],
    "additionalProperties": False,
}

RETRYABLE_STATUS_CODES = frozenset({408, 429, 500, 502, 503, 504})
CATEGORY_REASONS = {
    "BUILDING": "建筑全景、外立面或建筑局部",
    "OTHER": "图片主体与建筑外墙无关",
}


class PhotoGuardError(RuntimeError):
    pass


class PhotoGuardInvalidImage(PhotoGuardError):
    pass


class PhotoGuardUnavailable(PhotoGuardError):
    pass


@dataclass(frozen=True, slots=True)
class PreparedGuardImage:
    content: bytes
    source_width: int
    source_height: int
    inference_width: int
    inference_height: int


@dataclass(frozen=True, slots=True)
class PhotoGuardResult:
    allowed: bool
    is_building: bool
    category: str
    reason: str
    source_width: int
    source_height: int
    inference_width: int
    inference_height: int
    inference_bytes: int
    latency_ms: int
    model: str

    def metadata(self) -> dict[str, object]:
        return asdict(self)


def photo_guard_enabled(settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    return bool(getattr(settings, "photo_guard_enabled", False))


def photo_guard_health(settings: Settings | None = None) -> tuple[bool, str]:
    settings = settings or get_settings()
    if not photo_guard_enabled(settings):
        return True, "disabled"
    try:
        endpoint = _photo_guard_health_endpoint(settings)
        with httpx.Client(timeout=0.75, trust_env=False) as client:
            response = client.get(endpoint)
    except (httpx.HTTPError, PhotoGuardUnavailable) as exc:
        return False, str(exc)
    if response.is_success:
        return True, "ready"
    return False, f"HTTP {response.status_code}"


def require_building_photo(
    file_obj: BinaryIO,
    *,
    filename: str,
    settings: Settings | None = None,
) -> PhotoGuardResult | None:
    settings = settings or get_settings()
    if not photo_guard_enabled(settings):
        return None

    try:
        result = classify_building_photo(
            file_obj,
            filename=filename,
            settings=settings,
        )
    except PhotoGuardInvalidImage as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"照片“{filename}”无法读取：{exc}",
        ) from exc
    except PhotoGuardUnavailable as exc:
        if settings.photo_guard_fail_open:
            logger.warning(
                "photo_guard_fail_open filename=%s error_type=%s",
                filename,
                type(exc).__name__,
            )
            return None
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="图片内容校验服务暂时不可用，本次照片未保存，请稍后重试。",
            headers={"Retry-After": "5"},
        ) from exc

    logger.info(
        "photo_guard_decision filename=%s allowed=%s category=%s "
        "source_size=%dx%d inference_size=%dx%d "
        "inference_bytes=%d latency_ms=%d",
        filename,
        result.allowed,
        result.category,
        result.source_width,
        result.source_height,
        result.inference_width,
        result.inference_height,
        result.inference_bytes,
        result.latency_ms,
    )
    if not result.allowed:
        reason = result.reason or "无法确认属于建筑外墙"
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"照片“{filename}”未通过建筑图片校验：{reason}。"
                "仅支持建筑全景、外立面或可确认的建筑局部照片。"
            ),
        )
    return result


def classify_building_photo(
    file_obj: BinaryIO,
    *,
    filename: str,
    settings: Settings | None = None,
    prompt: str = PHOTO_GUARD_PROMPT,
) -> PhotoGuardResult:
    settings = settings or get_settings()
    prepared = prepare_guard_image(file_obj, settings=settings)
    started_at = time.perf_counter()
    payload = _request_classification(
        prepared.content,
        settings=settings,
        prompt=prompt,
    )
    latency_ms = max(0, round((time.perf_counter() - started_at) * 1000))

    category = payload.get("category")
    if not isinstance(category, str) or category not in CATEGORY_REASONS:
        raise PhotoGuardUnavailable("模型返回的 category 字段无效。")
    is_building = category == "BUILDING"
    return PhotoGuardResult(
        allowed=is_building,
        is_building=is_building,
        category=category,
        reason=CATEGORY_REASONS[category],
        source_width=prepared.source_width,
        source_height=prepared.source_height,
        inference_width=prepared.inference_width,
        inference_height=prepared.inference_height,
        inference_bytes=len(prepared.content),
        latency_ms=latency_ms,
        model=settings.photo_guard_model,
    )


def prepare_guard_image(
    file_obj: BinaryIO,
    *,
    settings: Settings | None = None,
) -> PreparedGuardImage:
    settings = settings or get_settings()
    try:
        position = file_obj.tell()
    except (AttributeError, OSError) as exc:
        raise PhotoGuardInvalidImage("图片流不支持读取。") from exc

    try:
        file_obj.seek(0)
        with Image.open(file_obj) as opened:
            if getattr(opened, "n_frames", 1) > 1:
                opened.seek(0)
            source_width, source_height = opened.size
            if source_width <= 0 or source_height <= 0:
                raise PhotoGuardInvalidImage("图片尺寸无效。")
            if source_width * source_height > settings.photo_guard_max_source_pixels:
                raise PhotoGuardInvalidImage(
                    "图片像素过大，最大支持 "
                    f"{settings.photo_guard_max_source_pixels:,} 像素。"
                )
            opened.load()
            image = ImageOps.exif_transpose(opened)
            image = _to_rgb(image)
    except PhotoGuardInvalidImage:
        raise
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError) as exc:
        raise PhotoGuardInvalidImage("文件不是有效的 JPG、PNG 或 MPO 图片。") from exc
    finally:
        try:
            file_obj.seek(position)
        except (AttributeError, OSError):
            pass

    inference_width, inference_height = _scaled_dimensions(
        source_width,
        source_height,
        max_edge=settings.photo_guard_max_edge,
        max_pixels=settings.photo_guard_max_inference_pixels,
    )
    if (inference_width, inference_height) != image.size:
        image = image.resize(
            (inference_width, inference_height),
            Image.Resampling.LANCZOS,
        )

    output = BytesIO()
    image.save(
        output,
        format="JPEG",
        quality=settings.photo_guard_jpeg_quality,
        subsampling=2,
    )
    return PreparedGuardImage(
        content=output.getvalue(),
        source_width=source_width,
        source_height=source_height,
        inference_width=inference_width,
        inference_height=inference_height,
    )


def _to_rgb(image: Image.Image) -> Image.Image:
    if image.mode == "RGB":
        return image.copy()
    if image.mode in {"RGBA", "LA"} or (
        image.mode == "P" and "transparency" in image.info
    ):
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, "white")
        return Image.alpha_composite(background, rgba).convert("RGB")
    return image.convert("RGB")


def _scaled_dimensions(
    width: int,
    height: int,
    *,
    max_edge: int,
    max_pixels: int,
) -> tuple[int, int]:
    scale = min(
        1.0,
        max_edge / max(width, height),
        math.sqrt(max_pixels / (width * height)),
    )
    return max(1, round(width * scale)), max(1, round(height * scale))


def _request_classification(
    image_bytes: bytes,
    *,
    settings: Settings,
    prompt: str,
) -> dict[str, object]:
    endpoint = _photo_guard_chat_endpoint(settings)
    encoded_image = base64.b64encode(image_bytes).decode("ascii")
    request_payload = {
        "model": settings.photo_guard_model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{encoded_image}"
                        },
                    },
                    {"type": "text", "text": prompt},
                ],
            }
        ],
        "temperature": 0,
        "max_tokens": 24,
        "seed": 0,
        "stream": False,
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "building_photo_gate",
                "strict": True,
                "schema": PHOTO_GUARD_RESPONSE_SCHEMA,
            },
        },
    }
    headers = {"Content-Type": "application/json"}
    api_key = settings.photo_guard_api_key.strip()
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    response: httpx.Response | None = None
    timeout = httpx.Timeout(
        settings.photo_guard_request_timeout_seconds,
        connect=min(5.0, settings.photo_guard_request_timeout_seconds),
    )
    try:
        with httpx.Client(
            timeout=timeout,
            headers=headers,
            trust_env=False,
        ) as client:
            for attempt in range(2):
                try:
                    response = client.post(endpoint, json=request_payload)
                except httpx.TransportError:
                    if attempt:
                        raise
                    time.sleep(0.2)
                    continue
                if response.is_success:
                    break
                if response.status_code not in RETRYABLE_STATUS_CODES or attempt:
                    break
                time.sleep(0.2)
    except httpx.HTTPError as exc:
        raise PhotoGuardUnavailable(f"无法连接图片内容校验服务：{exc}") from exc

    if response is None:
        raise PhotoGuardUnavailable("图片内容校验服务没有返回响应。")
    if not response.is_success:
        raise PhotoGuardUnavailable(
            f"图片内容校验服务返回 HTTP {response.status_code}。"
        )
    try:
        response_payload = response.json()
        content = response_payload["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise PhotoGuardUnavailable("图片内容校验服务返回格式无效。") from exc
    return _parse_model_json(content)


def _parse_model_json(content: object) -> dict[str, object]:
    if isinstance(content, list):
        content = "".join(
            str(item.get("text") or "")
            for item in content
            if isinstance(item, dict)
        )
    if not isinstance(content, str):
        raise PhotoGuardUnavailable("模型回答不是文本。")
    text = content.strip()
    if text.startswith("```") and text.endswith("```"):
        text = text.removeprefix("```json").removeprefix("```")
        text = text.removesuffix("```").strip()
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise PhotoGuardUnavailable("模型回答不是有效 JSON。") from exc
    if not isinstance(payload, dict):
        raise PhotoGuardUnavailable("模型回答必须是 JSON 对象。")
    return payload


def _photo_guard_chat_endpoint(settings: Settings) -> str:
    return f"{_validated_api_base_url(settings)}/chat/completions"


def _photo_guard_health_endpoint(settings: Settings) -> str:
    parsed = urlsplit(_validated_api_base_url(settings))
    return f"{parsed.scheme}://{parsed.netloc}/health"


def _validated_api_base_url(settings: Settings) -> str:
    base_url = settings.photo_guard_api_base_url.strip().rstrip("/")
    parsed = urlsplit(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise PhotoGuardUnavailable("PHOTO_GUARD_API_BASE_URL 配置无效。")
    if not settings.photo_guard_model.strip():
        raise PhotoGuardUnavailable("PHOTO_GUARD_MODEL 未配置。")
    return base_url
