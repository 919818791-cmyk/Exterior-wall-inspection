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
    headers: dict[str, str] = {}

    def __init__(self, content: str, usage: dict[str, Any] | None = None) -> None:
        self.content = content
        self.usage = usage

    def json(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"choices": [{"message": {"content": self.content}}]}
        if self.usage is not None:
            payload["usage"] = self.usage
        return payload


class RecordingAsyncClient:
    response_content = "[]"
    response_usage: dict[str, Any] | None = None
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
        encoded_image = image_url.split(",", 1)[1] if "," in image_url else image_url
        type(self).tile_images.append(base64.b64decode(encoded_image))
        type(self).active_requests += 1
        type(self).peak_active_requests = max(
            type(self).peak_active_requests,
            type(self).active_requests,
        )
        try:
            await asyncio.sleep(0.01)
            return FakeResponse(type(self).response_content, type(self).response_usage)
        finally:
            type(self).active_requests -= 1

    @classmethod
    def reset(
        cls,
        response_content: str = "[]",
        response_usage: dict[str, Any] | None = None,
    ) -> None:
        cls.response_content = response_content
        cls.response_usage = response_usage
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


def _mpo_bytes(width: int, height: int) -> bytes:
    output = BytesIO()
    with Image.new("RGB", (width, height), (12, 34, 56)) as primary:
        with Image.new("RGB", (width, height), (65, 43, 21)) as secondary:
            primary.save(output, format="MPO", save_all=True, append_images=[secondary])
    return output.getvalue()


def _run_inference(images: list[qwen.TrialQwenImageInput], **kwargs: Any):
    base_url = kwargs.pop("base_url", "https://qwen.test/compatible-mode/v1")
    return asyncio.run(
        qwen.infer_trial_images(
            images,
            api_key="test-key",
            base_url=base_url,
            **kwargs,
        )
    )


def test_qwen_rejects_image_pixel_amplification_before_api_calls(monkeypatch) -> None:
    RecordingAsyncClient.reset()
    monkeypatch.setattr(qwen.httpx, "AsyncClient", RecordingAsyncClient)

    with pytest.raises(qwen.TrialQwenInferenceError, match="exceeds 1000000 pixels"):
        _run_inference(
            [qwen.TrialQwenImageInput(filename="large.png", content=_image_bytes(1200, 1000))],
            max_image_pixels=1_000_000,
        )

    assert RecordingAsyncClient.requests == []


def test_qwen_rejects_excessive_batch_tiles_before_api_calls(monkeypatch) -> None:
    RecordingAsyncClient.reset()
    monkeypatch.setattr(qwen.httpx, "AsyncClient", RecordingAsyncClient)
    images = [
        qwen.TrialQwenImageInput(filename=f"photo-{index}.png", content=_image_bytes(2000, 1000))
        for index in range(2)
    ]

    with pytest.raises(qwen.TrialQwenInferenceError, match="too many image tiles"):
        _run_inference(images, max_tiles_per_request=7)

    assert RecordingAsyncClient.requests == []


def test_qwen_downscales_large_source_for_inference_and_maps_boxes_back(monkeypatch) -> None:
    RecordingAsyncClient.reset(
        '[{"type":"crack","confidence":0.8,"bbox":[100,100,200,200],'
        '"description":"疑似墙面裂缝"}]'
    )
    monkeypatch.setattr(qwen.httpx, "AsyncClient", RecordingAsyncClient)

    result = _run_inference(
        [qwen.TrialQwenImageInput(filename="large.png", content=_image_bytes(4000, 3000))],
        max_image_pixels=64_000_000,
        inference_max_image_pixels=3_000_000,
    )[0]

    assert result["image"] == {"width": 4000, "height": 3000}
    assert result["inference"]["processing_image_size"] == {"width": 2000, "height": 1500}
    assert result["inference"]["resized_for_inference"] is True
    assert result["detections"][0]["bbox"] == {
        "x": 256.0,
        "y": 192.0,
        "width": 256.0,
        "height": 192.0,
    }


def test_qwen_keeps_images_above_twelve_megapixels_at_original_size_by_default(monkeypatch) -> None:
    RecordingAsyncClient.reset()
    monkeypatch.setattr(qwen.httpx, "AsyncClient", RecordingAsyncClient)

    result = _run_inference(
        [qwen.TrialQwenImageInput(filename="fifteen-megapixels.png", content=_image_bytes(5000, 3000))]
    )[0]

    assert result["image"] == {"width": 5000, "height": 3000}
    assert result["inference"]["processing_image_size"] == {"width": 5000, "height": 3000}
    assert result["inference"]["resized_for_inference"] is False


def test_qwen_accepts_dji_style_mpo_and_uses_primary_frame(monkeypatch) -> None:
    RecordingAsyncClient.reset()
    monkeypatch.setattr(qwen.httpx, "AsyncClient", RecordingAsyncClient)

    result = _run_inference(
        [qwen.TrialQwenImageInput(filename="DJI_photo.JPG", content=_mpo_bytes(640, 480))]
    )[0]

    assert result["image"] == {"width": 640, "height": 480}
    assert result["inference"]["tile_count"] == 1
    assert len(RecordingAsyncClient.requests) == 1


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
    assert "先排除正常构造线，再在剩余候选中识别" in qwen.TRIAL_QWEN_PROMPT
    assert "正常构造线排除具有最高优先级" in qwen.TRIAL_QWEN_PROMPT
    assert "边缘完整、没有局部破损/扩宽/错位" in qwen.TRIAL_QWEN_PROMPT
    assert "等间距重复并组成规则横竖网格" in qwen.TRIAL_QWEN_PROMPT
    assert "局部扩宽、宽度不均、边缘破损、错位" in qwen.TRIAL_QWEN_PROMPT
    assert "不能仅因靠近窗框或构件边界而排除" in qwen.TRIAL_QWEN_PROMPT
    assert "不得仅因其走向较直、靠近构件边界或沿接缝延伸就排除" in qwen.TRIAL_QWEN_PROMPT
    assert "bbox 必须覆盖从可确认起点到终点的完整可见长度" in qwen.TRIAL_QWEN_PROMPT
    assert "不得只框最宽、最明显或破损最重的一小段" in qwen.TRIAL_QWEN_PROMPT
    assert "窗框下方一条连续横向裂口" in qwen.TRIAL_QWEN_PROMPT
    assert "被规则5至6排除的正常构造线无论 confidence 多高都不得输出" in qwen.TRIAL_QWEN_PROMPT
    assert "三条等间距、等宽、笔直的竖线" in qwen.TRIAL_QWEN_PROMPT
    assert "至少一种实体材料损失证据" in qwen.TRIAL_QWEN_PROMPT
    assert "不得仅根据颜色较深、颜色较浅、纹理变化" in qwen.TRIAL_QWEN_PROMPT
    assert "修补带、补漆或腻子痕迹、矩形色差区域" in qwen.TRIAL_QWEN_PROMPT
    assert "同一候选区域先在 crack 和 spalling 中二选一" in qwen.TRIAL_QWEN_PROMPT
    assert "type：只能是 crack 或 spalling" in qwen.TRIAL_QWEN_PROMPT
    assert "低于 0.50 的目标不要输出" in qwen.TRIAL_QWEN_PROMPT
    assert "corrosion" not in qwen.TRIAL_QWEN_PROMPT

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


def test_qwen_api_request_estimate_matches_tile_count() -> None:
    images = [
        qwen.TrialQwenImageInput(
            filename="facade.png",
            content=_image_bytes(2000, 1000),
        )
    ]

    assert qwen.estimate_trial_api_request_count(images) == 4


def test_qwen3_vl_flash_disables_thinking(monkeypatch) -> None:
    RecordingAsyncClient.reset()
    monkeypatch.setattr(qwen.httpx, "AsyncClient", RecordingAsyncClient)

    result = _run_inference(
        [qwen.TrialQwenImageInput(filename="facade.png", content=_image_bytes(640, 480))],
        model="qwen3-vl-flash",
    )[0]

    _, payload = RecordingAsyncClient.requests[0]
    assert payload["model"] == "qwen3-vl-flash"
    assert payload["enable_thinking"] is False
    assert "thinking" not in payload
    assert result["provider"] == "qwen"
    assert result["model_version"] == "qwen3-vl-flash"


def test_zhipu_uses_provider_specific_multimodal_payload(monkeypatch) -> None:
    RecordingAsyncClient.reset()
    monkeypatch.setattr(qwen.httpx, "AsyncClient", RecordingAsyncClient)

    result = _run_inference(
        [qwen.TrialQwenImageInput(filename="facade.png", content=_image_bytes(640, 480))],
        provider="zhipu",
        base_url="https://open.bigmodel.cn/api/paas/v4",
        model="glm-4.6v",
    )[0]

    endpoint, payload = RecordingAsyncClient.requests[0]
    image_url = payload["messages"][0]["content"][0]["image_url"]["url"]
    prompt = payload["messages"][0]["content"][1]["text"]
    assert endpoint == "https://open.bigmodel.cn/api/paas/v4/chat/completions"
    assert payload["model"] == "glm-4.6v"
    assert payload["thinking"] == {"type": "disabled"}
    assert "enable_thinking" not in payload
    assert not image_url.startswith("data:")
    assert "Qwen3-VL" not in prompt
    assert result["provider"] == "zhipu"
    assert result["model_version"] == "glm-4.6v"


def test_zhipu_retries_transient_transport_disconnect(monkeypatch) -> None:
    class DisconnectOnceClient(RecordingAsyncClient):
        attempts = 0

        async def post(self, endpoint: str, *, json: dict[str, Any]) -> FakeResponse:
            type(self).attempts += 1
            if type(self).attempts == 1:
                raise qwen.httpx.RemoteProtocolError(
                    "Server disconnected without sending a response."
                )
            return await super().post(endpoint, json=json)

    RecordingAsyncClient.reset()
    monkeypatch.setattr(qwen.httpx, "AsyncClient", DisconnectOnceClient)
    monkeypatch.setattr(qwen.random, "uniform", lambda _start, _end: 0)

    result = _run_inference(
        [qwen.TrialQwenImageInput(filename="facade.png", content=_image_bytes(64, 64))],
        provider="zhipu",
        model="glm-4.6v",
    )[0]

    assert DisconnectOnceClient.attempts == 2
    assert result["provider"] == "zhipu"


def test_upstream_does_not_retry_permanent_client_error(monkeypatch) -> None:
    class BadRequestResponse(FakeResponse):
        status_code = 400
        is_success = False
        text = '{"error":{"message":"invalid request"}}'

        def json(self) -> dict[str, Any]:
            return {"error": {"message": "invalid request"}}

    class BadRequestClient(RecordingAsyncClient):
        attempts = 0

        async def post(self, endpoint: str, *, json: dict[str, Any]) -> FakeResponse:
            type(self).attempts += 1
            return BadRequestResponse("[]")

    monkeypatch.setattr(qwen.httpx, "AsyncClient", BadRequestClient)

    with pytest.raises(qwen.TrialQwenInferenceError, match="HTTP 400: invalid request"):
        _run_inference(
            [qwen.TrialQwenImageInput(filename="facade.png", content=_image_bytes(64, 64))],
            provider="zhipu",
            model="glm-4.6v",
        )

    assert BadRequestClient.attempts == 1


def test_custom_visible_prompt_is_sent_to_provider(monkeypatch) -> None:
    RecordingAsyncClient.reset()
    monkeypatch.setattr(qwen.httpx, "AsyncClient", RecordingAsyncClient)
    custom_prompt = "管理员自定义可见光检测提示词，只输出 JSON 数组。"

    _run_inference(
        [qwen.TrialQwenImageInput(filename="facade.png", content=_image_bytes(640, 480))],
        visible_prompt=custom_prompt,
    )

    payload = RecordingAsyncClient.requests[0][1]
    assert payload["messages"][0]["content"][1]["text"] == custom_prompt


def test_visible_defect_types_limit_model_output(monkeypatch) -> None:
    RecordingAsyncClient.reset(
        """[
          {"type":"crack","confidence":0.91,"bbox":[100,100,300,200],"description":"墙面不规则裂缝"},
          {"type":"spalling","confidence":0.88,"bbox":[400,300,600,500],"description":"面砖剥落"}
        ]"""
    )
    monkeypatch.setattr(qwen.httpx, "AsyncClient", RecordingAsyncClient)

    result = _run_inference(
        [qwen.TrialQwenImageInput(filename="facade.png", content=_image_bytes(640, 480))],
        visible_prompt=qwen.TRIAL_QWEN_CRACK_PROMPT,
        visible_defect_types=("crack",),
    )[0]

    assert [item["type"] for item in result["detections"]] == ["crack"]
    assert result["requested_models"] == ["crack"]
    payload = RecordingAsyncClient.requests[0][1]
    assert payload["messages"][0]["content"][1]["text"] == qwen.TRIAL_QWEN_CRACK_PROMPT
    assert "不能仅因靠近窗框或构件边界而排除" in qwen.TRIAL_QWEN_CRACK_PROMPT
    assert "bbox 必须覆盖从可确认起点到终点的完整可见长度" in qwen.TRIAL_QWEN_CRACK_PROMPT
    assert "不得只框最宽、最明显或破损最重的一小段" in qwen.TRIAL_QWEN_CRACK_PROMPT


def test_qwen_collects_and_aggregates_token_usage_per_tile(monkeypatch) -> None:
    RecordingAsyncClient.reset(
        response_usage={
            "prompt_tokens": 1200,
            "completion_tokens": 20,
            "total_tokens": 1220,
            "prompt_tokens_details": {
                "image_tokens": 1000,
                "text_tokens": 200,
                "cached_tokens": 0,
            },
            "completion_tokens_details": {"text_tokens": 20},
        }
    )
    monkeypatch.setattr(qwen.httpx, "AsyncClient", RecordingAsyncClient)

    result = _run_inference(
        [qwen.TrialQwenImageInput(filename="facade.png", content=_image_bytes(2000, 1000))]
    )[0]

    assert result["token_usage"] == {
        "request_count": 4,
        "reported_request_count": 4,
        "prompt_tokens": 4800,
        "completion_tokens": 80,
        "total_tokens": 4880,
        "prompt_tokens_details": {
            "image_tokens": 4000,
            "text_tokens": 800,
            "cached_tokens": 0,
        },
        "completion_tokens_details": {"text_tokens": 80},
    }
    assert len(result["tile_token_usages"]) == 4
    assert result["tile_token_usages"][0] == {
        "tile_index": 1,
        "x": 0,
        "y": 0,
        "valid_width": 1280,
        "valid_height": 960,
        "token_usage": {
            "prompt_tokens": 1200,
            "completion_tokens": 20,
            "total_tokens": 1220,
            "prompt_tokens_details": {
                "image_tokens": 1000,
                "text_tokens": 200,
                "cached_tokens": 0,
            },
            "completion_tokens_details": {"text_tokens": 20},
        },
    }


def test_qwen_uses_thermal_only_prompt_and_type_filter_for_thermal_images(monkeypatch) -> None:
    RecordingAsyncClient.reset(
        """[
          {"type":"crack","confidence":0.91,"bbox":[100,100,200,200],"description":"墙面裂缝"},
          {"type":"spalling","confidence":0.88,"bbox":[350,350,450,450],"description":"墙面剥落"},
          {"type":"hollow","confidence":0.86,"bbox":[300,200,500,400],"description":"疑似墙面空鼓"}
        ]"""
    )
    monkeypatch.setattr(qwen.httpx, "AsyncClient", RecordingAsyncClient)

    results = _run_inference(
        [
            qwen.TrialQwenImageInput(
                filename="visible.png",
                content=_image_bytes(640, 640),
            ),
            qwen.TrialQwenImageInput(
                filename="thermal.png",
                content=_image_bytes(640, 640),
                thermal_imaging_available=True,
            ),
        ]
    )

    assert [item["type"] for item in results[0]["detections"]] == ["crack", "spalling"]
    assert results[0]["requested_models"] == ["crack", "spalling"]
    assert [item["type"] for item in results[1]["detections"]] == ["hollow"]
    assert results[1]["requested_models"] == ["hollow"]

    prompts = [
        payload["messages"][0]["content"][1]["text"]
        for _, payload in RecordingAsyncClient.requests
    ]
    assert prompts == [qwen.TRIAL_QWEN_PROMPT, qwen.TRIAL_QWEN_THERMAL_PROMPT]
    assert "该图片只用于识别空鼓" in qwen.TRIAL_QWEN_THERMAL_PROMPT
    assert "type：只能是 hollow" in qwen.TRIAL_QWEN_THERMAL_PROMPT
    assert "很小的黑点、零散噪点、孤立像素、细小斑点不是空鼓" in qwen.TRIAL_QWEN_THERMAL_PROMPT
    assert "颜色相对均匀的紫红色墙面背景包围" in qwen.TRIAL_QWEN_THERMAL_PROMPT
    assert "不要输出 crack、spalling、corrosion" in qwen.TRIAL_QWEN_THERMAL_PROMPT


def test_qwen_accepts_hollow_only_for_thermal_image(monkeypatch) -> None:
    RecordingAsyncClient.reset(
        """[
          {"type":"hollow","confidence":0.86,"bbox":[300,200,500,400],"description":"疑似墙面空鼓"}
        ]"""
    )
    monkeypatch.setattr(qwen.httpx, "AsyncClient", RecordingAsyncClient)

    result = _run_inference(
        [
            qwen.TrialQwenImageInput(
                filename="thermal.png",
                content=_image_bytes(640, 640),
                thermal_imaging_available=True,
            )
        ],
        visible_defect_types=(),
    )[0]

    assert [item["type"] for item in result["detections"]] == ["hollow"]
    assert result["requested_models"] == ["hollow"]
    payload = RecordingAsyncClient.requests[0][1]
    assert payload["messages"][0]["content"][1]["text"] == qwen.TRIAL_QWEN_THERMAL_PROMPT


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
          {"type":"crack","confidence":0.4,"bbox":[1,2,101,102],"description":"明显裂缝"},
          {"type":"missing","confidence":0.75,"bbox":[50,60,90,100],"description":"局部脱落"},
          {"type":"corrosion","confidence":0.8,"bbox":[120,130,180,240],"description":"金属连接件锈蚀"},
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
    assert [item["id"] for item in result["detections"]] == [
        "spalling-1",
        "crack-1",
    ]


@pytest.mark.parametrize(
    "description",
    [
        "墙体竖向分格缝",
        "墙体横向拼缝裂纹",
        "墙体水平分缝线属正常构造缝",
        "墙体竖向分格缝非缺陷",
        "墙板接缝处细长裂纹",
    ],
)
def test_qwen_rejects_normal_seam_crack_descriptions(description: str) -> None:
    detection = qwen._normalize_detection(
        {
            "type": "crack",
            "confidence": 0.9,
            "bbox": [100, 100, 200, 300],
            "description": description,
        },
        qwen._Tile(x=0, y=0, valid_width=1280, valid_height=960),
    )

    assert detection is None


@pytest.mark.parametrize(
    "description",
    [
        "不规则裂口横跨面砖",
        "分格缝局部扩宽并错位",
        "接缝边缘破损并延伸进入板面",
        "接缝沿缝破损且偏离接缝",
    ],
)
def test_qwen_keeps_cracks_with_abnormal_evidence(description: str) -> None:
    detection = qwen._normalize_detection(
        {
            "type": "crack",
            "confidence": 0.9,
            "bbox": [100, 100, 200, 300],
            "description": description,
        },
        qwen._Tile(x=0, y=0, valid_width=1280, valid_height=960),
    )

    assert detection is not None


def test_qwen_rejects_short_small_crack_box() -> None:
    detection = qwen._normalize_detection(
        {
            "type": "crack",
            "confidence": 0.9,
            # 23.04 x 48 pixels in the 1280 x 960 tile, matching the
            # false positive observed in Tile 11.
            "bbox": [100, 100, 118, 150],
            "description": "局部短小裂纹",
        },
        qwen._Tile(x=0, y=0, valid_width=1280, valid_height=960),
    )

    assert detection is None


def test_qwen_keeps_thin_crack_when_long_side_reaches_minimum() -> None:
    detection = qwen._normalize_detection(
        {
            "type": "crack",
            "confidence": 0.9,
            # 5.12 x 96 pixels: thin, but not short.
            "bbox": [100, 100, 104, 200],
            "description": "墙面细长裂纹",
        },
        qwen._Tile(x=0, y=0, valid_width=1280, valid_height=960),
    )

    assert detection is not None


def test_qwen_rejects_description_that_explicitly_says_not_a_crack() -> None:
    detection = qwen._normalize_detection(
        {
            "type": "crack",
            "confidence": 0.9,
            "bbox": [100, 100, 900, 200],
            "description": "纵向污渍带非裂口",
        },
        qwen._Tile(x=0, y=0, valid_width=1280, valid_height=960),
    )

    assert detection is None


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


def test_qwen_merges_partial_duplicate_boxes_from_overlapping_tiles() -> None:
    tile_7 = qwen._Tile(x=1920, y=720, valid_width=1280, valid_height=960)
    tile_8 = qwen._Tile(x=2880, y=720, valid_width=1152, valid_height=960)
    large = qwen._normalize_detection(
        {
            "type": "crack",
            "confidence": 0.85,
            "bbox": [77, 530, 785, 560],
            "description": "水平细裂口贯穿墙板接缝上方",
        },
        tile_8,
    )
    partial = qwen._normalize_detection(
        {
            "type": "crack",
            "confidence": 0.75,
            "bbox": [830, 520, 999, 550],
            "description": "水平细裂口贯穿墙板",
        },
        tile_7,
    )
    assert large is not None
    assert partial is not None

    merged = qwen._merge_cross_tile_duplicate_boxes(
        [large, partial],
        ios_threshold=qwen.CROSS_TILE_MERGE_IOS_THRESHOLD,
    )

    assert len(merged) == 1
    assert merged[0]["confidence"] == 0.85
    assert merged[0]["description"] == "水平细裂口贯穿墙板接缝上方"
    assert merged[0]["bbox"] == pytest.approx(
        {"x": 2978.56, "y": 1219.2, "width": 906.24, "height": 38.4}
    )
    assert "_source_tile" not in qwen._public_detection(merged[0])


def test_qwen_does_not_union_overlapping_boxes_from_the_same_tile() -> None:
    tile = qwen._Tile(x=1920, y=720, valid_width=1280, valid_height=960)
    detections = [
        {
            **_detection("crack", 0.85, 2978.56, 1228.8, 906.24, 28.8),
            "_source_tile": tile,
        },
        {
            **_detection("crack", 0.75, 2982.4, 1219.2, 216.32, 28.8),
            "_source_tile": tile,
        },
    ]

    merged = qwen._merge_cross_tile_duplicate_boxes(
        detections,
        ios_threshold=qwen.CROSS_TILE_MERGE_IOS_THRESHOLD,
    )

    assert merged == detections


def test_qwen_does_not_union_cross_tile_boxes_with_low_containment() -> None:
    tile_7 = qwen._Tile(x=1920, y=720, valid_width=1280, valid_height=960)
    tile_8 = qwen._Tile(x=2880, y=720, valid_width=1152, valid_height=960)
    detections = [
        {
            **_detection("crack", 0.85, 2900, 1200, 280, 30),
            "_source_tile": tile_7,
        },
        {
            **_detection("crack", 0.82, 3000, 1220, 600, 30),
            "_source_tile": tile_8,
        },
    ]

    merged = qwen._merge_cross_tile_duplicate_boxes(
        detections,
        ios_threshold=qwen.CROSS_TILE_MERGE_IOS_THRESHOLD,
    )

    assert merged == detections


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


def test_qwen_caps_configured_concurrency_at_ten(monkeypatch) -> None:
    RecordingAsyncClient.reset()
    monkeypatch.setattr(qwen.httpx, "AsyncClient", RecordingAsyncClient)
    images = [
        qwen.TrialQwenImageInput(filename=f"facade-{index}.png", content=_image_bytes(32, 32))
        for index in range(10)
    ]

    _run_inference(images, max_concurrency=20)

    assert RecordingAsyncClient.peak_active_requests == 10


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
