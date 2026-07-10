import asyncio
import base64
from io import BytesIO
from typing import Any

import pytest
from PIL import Image

from app.services import trial_qwen_inference as qwen


class FakeResponse:
    status_code = 200
    is_success = True
    text = ""

    def __init__(self, content: str) -> None:
        self.content = content

    def json(self) -> dict[str, Any]:
        return {"choices": [{"message": {"content": self.content}}]}


class RecordingAsyncClient:
    response_content = "[]"
    requests: list[tuple[str, dict[str, Any]]] = []
    tile_images: list[bytes] = []
    active_requests = 0
    peak_active_requests = 0

    def __init__(self, **kwargs: Any) -> None:
        self.kwargs = kwargs

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args: object) -> None:
        return None

    async def post(self, endpoint: str, *, json: dict[str, Any]) -> FakeResponse:
        type(self).requests.append((endpoint, json))
        image_url = json["messages"][0]["content"][0]["image_url"]["url"]
        type(self).tile_images.append(base64.b64decode(image_url.split(",", 1)[1]))
        type(self).active_requests += 1
        type(self).peak_active_requests = max(
            type(self).peak_active_requests,
            type(self).active_requests,
        )
        try:
            await asyncio.sleep(0.01)
            return FakeResponse(type(self).response_content)
        finally:
            type(self).active_requests -= 1

    @classmethod
    def reset(cls, response_content: str = "[]") -> None:
        cls.response_content = response_content
        cls.requests = []
        cls.tile_images = []
        cls.active_requests = 0
        cls.peak_active_requests = 0


def _image_bytes(width: int, height: int, color: tuple[int, int, int] = (12, 34, 56)) -> bytes:
    output = BytesIO()
    with Image.new("RGB", (width, height), color) as image:
        image.save(output, format="PNG")
    return output.getvalue()


def _oriented_jpeg_bytes(width: int, height: int, orientation: int) -> bytes:
    output = BytesIO()
    exif = Image.Exif()
    exif[274] = orientation
    with Image.new("RGB", (width, height), (12, 34, 56)) as image:
        image.save(output, format="JPEG", exif=exif)
    return output.getvalue()


def _run_inference(images: list[qwen.TrialQwenImageInput], **kwargs: Any):
    return asyncio.run(
        qwen.infer_trial_images(
            images,
            api_key="test-key",
            base_url="https://qwen.test/compatible-mode/v1",
            **kwargs,
        )
    )


def test_qwen_tiles_image_and_sends_one_stateless_request_per_tile(monkeypatch) -> None:
    RecordingAsyncClient.reset()
    monkeypatch.setattr(qwen.httpx, "AsyncClient", RecordingAsyncClient)

    results = _run_inference(
        [qwen.TrialQwenImageInput(filename="facade.png", content=_image_bytes(2000, 1000))]
    )

    assert len(RecordingAsyncClient.requests) == 4
    assert results[0]["image"] == {"width": 2000, "height": 1000}
    assert results[0]["inference"]["tile_count"] == 4
    assert results[0]["inference"]["api_request_count"] == 4
    assert results[0]["inference"]["tile_size"] == {"width": 1280, "height": 960}
    assert results[0]["inference"]["tile_width"] == 1280
    assert results[0]["inference"]["tile_height"] == 960
    assert results[0]["inference"]["tile_overlap_ratio"] == 0.25
    assert results[0]["inference"]["bbox_coordinate_space"] == "normalized_0_999"
    assert results[0]["inference"]["bbox_coordinate_scale"] == 1000
    assert results[0]["inference"]["nms_iou_threshold"] == 0.5
    assert "0 到 999" in qwen.TRIAL_QWEN_PROMPT
    assert "不是像素值" in qwen.TRIAL_QWEN_PROMPT
    assert "瓷砖/面砖已经掉块、缺角、破损" in qwen.TRIAL_QWEN_PROMPT
    assert "露出水泥/砂浆基层" in qwen.TRIAL_QWEN_PROMPT
    assert "没有可见掉块、破损或材料缺失时，不要输出 spalling" in qwen.TRIAL_QWEN_PROMPT

    for endpoint, payload in RecordingAsyncClient.requests:
        assert endpoint == "https://qwen.test/compatible-mode/v1/chat/completions"
        assert payload["model"] == "qwen3-vl-plus"
        assert payload["enable_thinking"] is False
        assert "response_format" not in payload
        assert len(payload["messages"]) == 1
        assert payload["messages"][0]["role"] == "user"
        assert len(payload["messages"][0]["content"]) == 2
        assert payload["messages"][0]["content"][1] == {
            "type": "text",
            "text": qwen.TRIAL_QWEN_PROMPT,
        }

    decoded_tiles = []
    for tile_bytes in RecordingAsyncClient.tile_images:
        with Image.open(BytesIO(tile_bytes)) as tile:
            assert tile.size == (1280, 960)
            decoded_tiles.append(tile.convert("RGB").copy())
    try:
        white_bottom_right = sum(
            tile.getpixel((1279, 959)) == (255, 255, 255)
            for tile in decoded_tiles
        )
        assert white_bottom_right == 3
    finally:
        for tile in decoded_tiles:
            tile.close()


def test_qwen_maps_and_clips_tile_bboxes_to_original_image(monkeypatch) -> None:
    RecordingAsyncClient.reset(
        '[{"type":"crack","confidence":0.4,"bbox":[100,100,200,200],'
        '"description":"疑似墙面裂缝"}]'
    )
    monkeypatch.setattr(qwen.httpx, "AsyncClient", RecordingAsyncClient)

    result = _run_inference(
        [qwen.TrialQwenImageInput(filename="facade.png", content=_image_bytes(2000, 1000))]
    )[0]

    assert [item["bbox"] for item in result["detections"]] == [
        {"x": 128.0, "y": 96.0, "width": 128.0, "height": 96.0},
        {"x": 1088.0, "y": 96.0, "width": 128.0, "height": 96.0},
        {"x": 128.0, "y": 816.0, "width": 128.0, "height": 96.0},
        {"x": 1088.0, "y": 816.0, "width": 128.0, "height": 96.0},
    ]
    assert all(item["confidence"] == 0.4 for item in result["detections"])


def test_qwen_converts_normalized_bbox_before_clipping_tile_padding() -> None:
    tile = qwen._Tile(x=960, y=720, valid_width=1040, valid_height=280)

    detection = qwen._normalize_detection(
        {
            "type": "crack",
            "confidence": 0.8,
            "bbox": [750, 250, 1000, 500],
            "description": "疑似墙面裂缝",
        },
        tile,
    )

    assert detection is not None
    assert detection["bbox"] == {
        "x": 1920.0,
        "y": 960.0,
        "width": 80.0,
        "height": 40.0,
    }


def test_qwen_validates_detection_contract_and_normalizes_missing(monkeypatch) -> None:
    RecordingAsyncClient.reset(
        """[
          {"type":"crack","confidence":0.4,"bbox":[1,2,30,40],"description":"明显裂缝"},
          {"type":"missing","confidence":0.75,"bbox":[50,60,90,100],"description":"局部脱落"},
          {"type":"spalling","confidence":0.39,"bbox":[1,2,30,40],"description":"低置信度"},
          {"type":"other","confidence":0.9,"bbox":[1,2,30,40],"description":"错误类型"},
          {"type":"crack","confidence":0.9,"bbox":[30,40,1,2],"description":"错误坐标"},
          {"type":"crack","confidence":0.9,"bbox":[-1,2,30,40],"description":"负数坐标"},
          {"type":"crack","confidence":0.9,"bbox":[1,2,1001,40],"description":"超出归一化范围"},
          {"type":"crack","confidence":0.9,"bbox":[1,2,30,40],"description":"这是一个超过二十个汉字长度限制的无效缺陷说明文本"}
        ]"""
    )
    monkeypatch.setattr(qwen.httpx, "AsyncClient", RecordingAsyncClient)

    result = _run_inference(
        [qwen.TrialQwenImageInput(filename="facade.png", content=_image_bytes(640, 640))]
    )[0]

    assert [(item["type"], item["confidence"]) for item in result["detections"]] == [
        ("spalling", 0.75),
        ("crack", 0.4),
    ]
    assert [item["id"] for item in result["detections"]] == ["spalling-1", "crack-1"]


def test_qwen_tile_origins_use_twenty_five_percent_overlap() -> None:
    with Image.new("RGB", (2000, 1000)) as image:
        tiles = qwen._image_tiles(image)

    assert [(tile.x, tile.y, tile.valid_width, tile.valid_height) for tile in tiles] == [
        (0, 0, 1280, 960),
        (960, 0, 1040, 960),
        (0, 720, 1280, 280),
        (960, 720, 1040, 280),
    ]


def test_qwen_class_aware_nms_removes_duplicate_boxes() -> None:
    detections = [
        _detection("crack", 0.92, 100, 100, 200, 100),
        _detection("crack", 0.71, 110, 105, 200, 100),
        _detection("spalling", 0.83, 110, 105, 200, 100),
        _detection("crack", 0.64, 700, 500, 80, 60),
    ]

    kept = qwen._class_aware_nms(detections, iou_threshold=0.5)

    assert [(item["type"], item["confidence"]) for item in kept] == [
        ("crack", 0.92),
        ("spalling", 0.83),
        ("crack", 0.64),
    ]


def _detection(
    defect_type: str,
    confidence: float,
    x: float,
    y: float,
    width: float,
    height: float,
) -> dict[str, Any]:
    return {
        "type": defect_type,
        "confidence": confidence,
        "bbox": {"x": x, "y": y, "width": width, "height": height},
    }


def test_qwen_limits_all_images_in_one_task_to_five_concurrent_requests(monkeypatch) -> None:
    RecordingAsyncClient.reset()
    monkeypatch.setattr(qwen.httpx, "AsyncClient", RecordingAsyncClient)
    images = [
        qwen.TrialQwenImageInput(filename=f"facade-{index}.png", content=_image_bytes(32, 32))
        for index in range(10)
    ]

    results = _run_inference(images, max_concurrency=5)

    assert len(results) == 10
    assert [result["filename"] for result in results] == [
        f"facade-{index}.png" for index in range(10)
    ]
    assert len(RecordingAsyncClient.requests) == 10
    assert RecordingAsyncClient.peak_active_requests == 5


def test_qwen_caps_configured_concurrency_at_five(monkeypatch) -> None:
    RecordingAsyncClient.reset()
    monkeypatch.setattr(qwen.httpx, "AsyncClient", RecordingAsyncClient)
    images = [
        qwen.TrialQwenImageInput(filename=f"facade-{index}.png", content=_image_bytes(32, 32))
        for index in range(10)
    ]

    _run_inference(images, max_concurrency=20)

    assert RecordingAsyncClient.peak_active_requests == 5


def test_qwen_accepts_fenced_json_array_response(monkeypatch) -> None:
    RecordingAsyncClient.reset("```json\n[]\n```")
    monkeypatch.setattr(qwen.httpx, "AsyncClient", RecordingAsyncClient)

    result = _run_inference(
        [qwen.TrialQwenImageInput(filename="facade.png", content=_image_bytes(32, 32))]
    )[0]

    assert result["detections"] == []


def test_qwen_applies_exif_orientation_before_tiling(monkeypatch) -> None:
    RecordingAsyncClient.reset()
    monkeypatch.setattr(qwen.httpx, "AsyncClient", RecordingAsyncClient)

    result = _run_inference(
        [
            qwen.TrialQwenImageInput(
                filename="rotated.jpg",
                content=_oriented_jpeg_bytes(12, 20, orientation=6),
            )
        ]
    )[0]

    assert result["image"] == {"width": 20, "height": 12}
    assert result["inference"]["tile_count"] == 1


def test_qwen_rejects_non_array_message_json(monkeypatch) -> None:
    RecordingAsyncClient.reset('{"detections": []}')
    monkeypatch.setattr(qwen.httpx, "AsyncClient", RecordingAsyncClient)

    with pytest.raises(qwen.TrialQwenInferenceError, match="Qwen message JSON must be an array"):
        _run_inference(
            [qwen.TrialQwenImageInput(filename="facade.png", content=_image_bytes(32, 32))]
        )
