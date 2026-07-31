import base64
from io import BytesIO
from typing import Any

import pytest
from fastapi import HTTPException
from PIL import Image

from app.core.config import Settings
from app.services import photo_guard


def _settings(**overrides: Any) -> Settings:
    values = {
        "_env_file": None,
        "app_env": "test",
        "photo_guard_enabled": True,
        "photo_guard_api_base_url": "http://127.0.0.1:19006/v1",
        "photo_guard_model": "guard-test",
        "photo_guard_max_source_pixels": 64_000_000,
        "photo_guard_max_inference_pixels": 1_500_000,
        "photo_guard_max_edge": 1280,
        "photo_guard_jpeg_quality": 82,
    }
    values.update(overrides)
    return Settings(**values)


def _png(width: int, height: int, *, mode: str = "RGB") -> BytesIO:
    output = BytesIO()
    color = (12, 34, 56, 128) if mode == "RGBA" else (12, 34, 56)
    with Image.new(mode, (width, height), color) as image:
        image.save(output, format="PNG")
    output.seek(0)
    return output


def _result(*, allowed: bool) -> photo_guard.PhotoGuardResult:
    return photo_guard.PhotoGuardResult(
        allowed=allowed,
        is_building=allowed,
        category="BUILDING" if allowed else "OTHER",
        reason="建筑外墙" if allowed else "人物照片",
        source_width=100,
        source_height=80,
        inference_width=100,
        inference_height=80,
        inference_bytes=1000,
        latency_ms=20,
        model="guard-test",
    )


def test_guard_resizes_and_converts_to_compact_jpeg() -> None:
    prepared = photo_guard.prepare_guard_image(
        _png(4000, 3000, mode="RGBA"),
        settings=_settings(),
    )

    assert (prepared.source_width, prepared.source_height) == (4000, 3000)
    assert (prepared.inference_width, prepared.inference_height) == (1280, 960)
    assert prepared.content.startswith(b"\xff\xd8\xff")
    with Image.open(BytesIO(prepared.content)) as image:
        assert image.mode == "RGB"
        assert image.size == (1280, 960)


def test_guard_rejects_source_pixel_amplification_before_loading() -> None:
    with pytest.raises(photo_guard.PhotoGuardInvalidImage, match="图片像素过大"):
        photo_guard.prepare_guard_image(
            _png(2000, 1000),
            settings=_settings(photo_guard_max_source_pixels=1_000_000),
        )


def test_guard_uses_short_structured_vllm_request(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    class Response:
        is_success = True
        status_code = 200

        def json(self) -> dict[str, Any]:
            return {
                "choices": [
                    {
                        "message": {
                            "content": (
                                '{"category":"BUILDING"}'
                            )
                        }
                    }
                ]
            }

    class Client:
        def __init__(self, **kwargs: Any) -> None:
            captured["client_kwargs"] = kwargs

        def __enter__(self):
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def post(self, endpoint: str, *, json: dict[str, Any]) -> Response:
            captured["endpoint"] = endpoint
            captured["payload"] = json
            return Response()

    monkeypatch.setattr(photo_guard.httpx, "Client", Client)
    result = photo_guard.classify_building_photo(
        _png(640, 480),
        filename="facade.png",
        settings=_settings(),
        prompt="自定义建筑照片相关性判断提示词，只输出 category 字段。",
    )

    payload = captured["payload"]
    assert result.allowed is True
    assert payload["max_tokens"] == 24
    assert payload["temperature"] == 0
    assert payload["response_format"]["json_schema"]["schema"] == (
        photo_guard.PHOTO_GUARD_RESPONSE_SCHEMA
    )
    image_url = payload["messages"][0]["content"][0]["image_url"]["url"]
    assert base64.b64decode(image_url.split(",", 1)[1]).startswith(b"\xff\xd8\xff")
    assert payload["messages"][0]["content"][1]["text"].startswith("自定义建筑照片")
    assert captured["endpoint"] == "http://127.0.0.1:19006/v1/chat/completions"


def test_guard_rejects_non_building_without_saving(monkeypatch) -> None:
    monkeypatch.setattr(
        photo_guard,
        "classify_building_photo",
        lambda *args, **kwargs: _result(allowed=False),
    )

    with pytest.raises(HTTPException) as raised:
        photo_guard.require_building_photo(
            _png(100, 80),
            filename="portrait.png",
            settings=_settings(),
        )

    assert raised.value.status_code == 422
    assert "未通过建筑图片校验" in raised.value.detail


def test_guard_is_fail_closed_when_model_is_unavailable(monkeypatch) -> None:
    def unavailable(*args: object, **kwargs: object) -> None:
        raise photo_guard.PhotoGuardUnavailable("offline")

    monkeypatch.setattr(photo_guard, "classify_building_photo", unavailable)

    with pytest.raises(HTTPException) as raised:
        photo_guard.require_building_photo(
            _png(100, 80),
            filename="facade.png",
            settings=_settings(),
        )

    assert raised.value.status_code == 503
    assert raised.value.headers == {"Retry-After": "5"}


def test_guard_can_be_explicitly_disabled() -> None:
    assert (
        photo_guard.require_building_photo(
            _png(100, 80),
            filename="anything.png",
            settings=_settings(photo_guard_enabled=False),
        )
        is None
    )
