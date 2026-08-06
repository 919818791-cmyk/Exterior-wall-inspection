from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.api.detection_tasks import (
    _formal_compatible_inference,
    _remove_rejected_project_photos,
    _validate_formal_photo_model_compatibility,
)
from app.enums.status import PhotoPrecheckStatus
from app.main import app
from app.schemas.phase5 import (
    AlgorithmResultPayload,
    AlgorithmTaskPhoto,
    DetectionStartRequest,
)


def test_phase5_routes_are_registered() -> None:
    paths = {route.path for route in app.routes}

    assert "/api/projects/{project_id}/start-detection" in paths
    assert "/api/algorithm/tasks/next" in paths
    assert "/api/algorithm/tasks/{task_id}/heartbeat" in paths
    assert "/api/algorithm/tasks/{task_id}/results" in paths
    assert "/api/algorithm/tasks/{task_id}/failed" in paths


def test_algorithm_task_next_requires_worker_credentials() -> None:
    client = TestClient(app)
    response = client.get("/api/algorithm/tasks/next", params={"model_version": "mock-test"})

    assert response.status_code == 401
    assert response.json()["message"] == "Worker credentials are required."


def test_algorithm_result_payload_accepts_fixed_json_contract() -> None:
    task_id = uuid4()
    project_id = uuid4()
    photo_id = uuid4()

    payload = AlgorithmResultPayload.model_validate(
        {
            "task_id": str(task_id),
            "project_id": str(project_id),
            "model_version": "mock-facade-detector-v1",
            "results": [
                {
                    "photo_id": str(photo_id),
                    "model_output": {
                        "image": {"width": 1000, "height": 600},
                        "detections": [],
                    },
                    "detections": [
                        {
                            "id": "mock-1",
                            "type": "crack",
                            "type_name": "裂缝",
                            "confidence": 0.91,
                            "bbox": {"x": 120, "y": 80, "width": 260, "height": 140},
                            "severity": "medium",
                            "description": "疑似外墙裂缝",
                        }
                    ],
                }
            ],
        }
    )

    assert payload.task_id == task_id
    assert payload.project_id == project_id
    assert payload.results[0].photo_id == photo_id
    assert payload.results[0].model_output["image"]["width"] == 1000
    assert payload.results[0].detections[0].type == "crack"


def test_detection_start_defaults_to_all_supported_report_types() -> None:
    payload = DetectionStartRequest.model_validate({})

    assert payload.model_types == ["crack", "spalling", "hollow"]


def test_start_detection_removes_rejected_photos_from_project_list() -> None:
    rejected_batch_id = uuid4()
    retained_batch_id = uuid4()
    removed_at = datetime.now(UTC)
    rejected_photos = [
        SimpleNamespace(
            precheck_status=PhotoPrecheckStatus.REJECTED.value,
            upload_batch_id=rejected_batch_id,
            deleted_at=None,
            updated_at=None,
        ),
        SimpleNamespace(
            precheck_status=PhotoPrecheckStatus.REJECTED.value,
            upload_batch_id=rejected_batch_id,
            deleted_at=None,
            updated_at=None,
        ),
    ]
    passed_photo = SimpleNamespace(
        precheck_status=PhotoPrecheckStatus.PASSED.value,
        upload_batch_id=retained_batch_id,
        deleted_at=None,
        updated_at=None,
    )
    batches = {
        rejected_batch_id: SimpleNamespace(photo_count=3),
        retained_batch_id: SimpleNamespace(photo_count=1),
    }

    class FakeDb:
        def get(self, _: type, upload_batch_id: object) -> object | None:
            return batches.get(upload_batch_id)

    removed = _remove_rejected_project_photos(
        FakeDb(),
        [*rejected_photos, passed_photo],
        deleted_at=removed_at,
    )

    assert removed == rejected_photos
    assert all(photo.deleted_at == removed_at for photo in rejected_photos)
    assert all(photo.updated_at == removed_at for photo in rejected_photos)
    assert passed_photo.deleted_at is None
    assert batches[rejected_batch_id].photo_count == 1
    assert batches[retained_batch_id].photo_count == 1


def test_formal_detection_routes_models_by_photo_type() -> None:
    thermal_photo = SimpleNamespace(photo_type="thermal")
    visible_photo = SimpleNamespace(photo_type="visible")
    inference = {
        "requested_models": ["crack", "spalling", "hollow"],
        "detections": [
            {"type": "crack"},
            {"type": "spalling"},
            {"type": "hollow"},
        ],
    }
    selected_models = ["crack", "spalling", "hollow"]

    thermal_result = _formal_compatible_inference(
        thermal_photo,
        inference,
        selected_models,
    )
    visible_result = _formal_compatible_inference(
        visible_photo,
        inference,
        selected_models,
    )

    assert thermal_result["requested_models"] == ["hollow"]
    assert [item["type"] for item in thermal_result["detections"]] == ["hollow"]
    assert visible_result["requested_models"] == ["crack", "spalling"]
    assert [item["type"] for item in visible_result["detections"]] == [
        "crack",
        "spalling",
    ]


@pytest.mark.parametrize(
    ("photo_type", "models", "expected_message"),
    [
        (
            "thermal",
            ["crack", "spalling"],
            "热成像图片只执行空鼓检测，请勾选空鼓或移除热成像图片。",
        ),
        (
            "visible",
            ["hollow"],
            "可见光图片只执行裂缝或剥落检测，请至少勾选其中一项或移除可见光图片。",
        ),
    ],
)
def test_formal_detection_rejects_incompatible_photo_and_model_selection(
    photo_type: str,
    models: list[str],
    expected_message: str,
) -> None:
    with pytest.raises(HTTPException) as raised:
        _validate_formal_photo_model_compatibility(
            [SimpleNamespace(photo_type=photo_type)],
            models,
        )

    assert raised.value.status_code == 400
    assert raised.value.detail == expected_message


def test_algorithm_task_photo_exposes_photo_type_to_worker() -> None:
    photo = AlgorithmTaskPhoto.model_validate(
        {
            "photo_id": str(uuid4()),
            "original_filename": "thermal.jpg",
            "download_url": "https://objects.test/thermal.jpg",
            "storage_bucket": "test",
            "storage_object_key": "photos/thermal.jpg",
            "photo_type": "thermal",
        }
    )

    assert photo.photo_type == "thermal"
