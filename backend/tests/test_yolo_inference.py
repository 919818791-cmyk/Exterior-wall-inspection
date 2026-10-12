import asyncio
from io import BytesIO
import json
from uuid import uuid4

from fastapi import HTTPException
import httpx
from PIL import Image
import pytest

from app.services import yolo_inference, yolo_runtime
from app.services.trial_qwen_inference import TrialQwenImageInput, TrialQwenInferenceError


@pytest.fixture
def runtime(monkeypatch):
    monkeypatch.setattr(yolo_runtime, "runtime_url", lambda _: "http://127.0.0.1:19002")
    return yolo_inference.YoloInferenceRuntime(
        model_id=uuid4(), id=uuid4(), sha256="a" * 64, model="V1", label="Test YOLO · V1",
        base_url="http://127.0.0.1:19002", timeout_seconds=5,
    )


def image(size=(1280, 960), thermal=False):
    output = BytesIO()
    Image.new("RGB", size).save(output, format="PNG")
    return TrialQwenImageInput(filename="wall.png", content=output.getvalue(), content_type="image/png",
                               photo_id=uuid4(), thermal_imaging_available=thermal)


def payload(runtime, detections=None):
    return {"model_id": str(runtime.model_id), "version_id": str(runtime.id),
            "sha256": runtime.sha256, "model_version": runtime.model,
            "detections": [] if detections is None else detections}


def transport(monkeypatch, handler):
    client_class = httpx.AsyncClient
    monkeypatch.setattr(yolo_inference.httpx, "AsyncClient",
                        lambda **kwargs: client_class(transport=httpx.MockTransport(handler), **kwargs))


def infer(runtime, images, types=("crack",), **limits):
    return asyncio.run(yolo_inference.infer_yolo_images(images, runtime=runtime, defect_types=list(types), **limits))


def box(kind="crack", x=100, width=100):
    return {"type": kind, "class_id": 0, "class_name": kind, "confidence": 0.92,
            "bbox": {"x": x, "y": 50, "width": width, "height": 60}}


def test_multipart_prediction_keeps_identity_class_and_only_requested_types(runtime, monkeypatch):
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(200, json=payload(runtime, [box(), box("spalling"), None]))
    transport(monkeypatch, handler)
    source = image()
    result = infer(runtime, [source])[0]
    assert len(requests) == 1
    assert str(requests[0].url) == runtime.base_url + "/predict"
    assert requests[0].headers["content-type"].startswith("multipart/form-data;")
    body = requests[0].read()
    assert b'name="models"\r\n\r\n["crack"]' in body
    assert b'filename="tile.png"' in body and b"\x89PNG" in body
    assert [value["type"] for value in result["detections"]] == ["crack"]
    assert result["detections"][0]["bbox"] == box()["bbox"]
    assert result["detections"][0]["class_id"] == 0
    assert result["photo_id"] == str(source.photo_id)
    assert result["version_id"] == str(runtime.id) and result["sha256"] == runtime.sha256
    assert result["provider"] == "yolo" and result["model_version"] == "V1"
    assert result["requested_models"] == ["crack"]
    assert result["token_usage"] is None
    assert result["inference"]["bbox_coordinate_space"] == "pixels"


def test_overlap_tiles_restore_coordinates_and_merge_duplicates(runtime, monkeypatch):
    calls = []
    def handler(request):
        # A 2000px image has tile origins 0 and 960; both boxes cover the
        # same object in the overlap, and must produce one original-image box.
        detection = box(x=1000 if not calls else 40)
        calls.append(request)
        return httpx.Response(200, json=payload(runtime, [detection]))
    transport(monkeypatch, handler)
    result = infer(runtime, [image((2000, 960))])[0]
    assert len(calls) == 2
    assert result["image"] == {"width": 2000, "height": 960}
    assert len(result["detections"]) == 1
    assert result["detections"][0]["bbox"]["x"] == 1000
    assert result["inference"]["pre_merge_detection_count"] == 2
    assert result["inference"]["post_merge_detection_count"] == 1


def test_resize_restores_original_coordinates(runtime, monkeypatch):
    transport(monkeypatch, lambda _: httpx.Response(200, json=payload(runtime, [box()])))
    result = infer(runtime, [image((2560, 1920))], inference_max_image_pixels=1280 * 960)[0]
    assert result["image"] == {"width": 2560, "height": 1920}
    assert result["detections"][0]["bbox"] == {"x": 200, "y": 100, "width": 200, "height": 120}


def test_empty_and_thermal_predictions_are_valid(runtime, monkeypatch):
    transport(monkeypatch, lambda _: httpx.Response(200, json=payload(runtime)))
    result = infer(runtime, [image(thermal=True)], types=["hollow"])[0]
    assert result["detections"] == [] and result["requested_models"] == ["hollow"]


@pytest.mark.parametrize("field", ["version_id", "sha256", "model_id", "model_version"])
def test_wrong_weight_response_is_rejected(runtime, monkeypatch, field):
    response = {**payload(runtime), field: "wrong"}
    transport(monkeypatch, lambda _: httpx.Response(200, json=response))
    with pytest.raises(RuntimeError, match="权重版本不一致"):
        infer(runtime, [image()])


def test_missing_classes_keep_actionable_error(runtime, monkeypatch):
    transport(monkeypatch, lambda _: httpx.Response(422, json={"detail": "当前权重缺少所选检测类别：spalling。"}))
    with pytest.raises(HTTPException, match="缺少所选检测类别") as error:
        infer(runtime, [image()], types=["crack", "spalling"])
    assert error.value.status_code == 409


def test_timeout_cancels_tiled_request(runtime, monkeypatch):
    def handler(request):
        raise httpx.ReadTimeout("GPU timeout", request=request)
    transport(monkeypatch, handler)
    with pytest.raises(RuntimeError, match="请求失败"):
        infer(runtime, [image((2000, 960))])


def test_image_budget_rejects_before_any_http_request(runtime, monkeypatch):
    transport(monkeypatch, lambda _: pytest.fail("Must validate tile budget before inference"))
    with pytest.raises(TrialQwenInferenceError, match="too many tiles"):
        infer(runtime, [image((2000, 960))], max_tiles_per_image=1)


def test_invalid_and_padding_boxes_are_discarded(runtime, monkeypatch):
    detections = [box(), box(x=1200), box(width=-10), {**box(), "confidence": float("nan")},
                  {**box(), "bbox": {"x": "invalid"}}]
    # NaN is deliberately injected via JSON text to exercise validation of an
    # invalid upstream response, independent of httpx's JSON encoder.
    transport(monkeypatch, lambda _: httpx.Response(200, text=json.dumps(payload(runtime, detections))))
    result = infer(runtime, [image((640, 480))])[0]
    assert len(result["detections"]) == 1
    assert result["detections"][0]["bbox"] == box()["bbox"]
