from uuid import uuid4

from app.main import app
from app.schemas.phase6 import ReviewResultCreateRequest, ReviewResultUpdateRequest


def test_phase6_review_routes_are_registered() -> None:
    paths = {route.path for route in app.routes}

    assert "/api/review/projects" in paths
    assert "/api/review/projects/{project_id}" in paths
    assert "/api/review/projects/{project_id}/results" in paths
    assert "/api/review/results/{result_id}" in paths
    assert "/api/review/results" in paths
    assert "/api/review/projects/{project_id}/complete" in paths


def test_review_result_create_payload_supports_manual_added_defect() -> None:
    payload = ReviewResultCreateRequest.model_validate(
        {
            "project_id": str(uuid4()),
            "photo_id": str(uuid4()),
            "defect_type": "crack",
            "bbox": {"x": 120, "y": 80, "width": 260, "height": 140},
            "severity": "medium",
            "status": "added",
            "review_note": "人工新增漏检裂缝",
        }
    )

    assert payload.ai_result_id is None
    assert payload.status == "added"
    assert payload.bbox.width == 260


def test_review_result_update_payload_supports_bbox_status_changes() -> None:
    payload = ReviewResultUpdateRequest.model_validate(
        {
            "defect_type": "spalling",
            "bbox": {"x": 20, "y": 30, "width": 160, "height": 120},
            "status": "modified",
        }
    )

    assert payload.defect_type == "spalling"
    assert payload.status == "modified"
    assert payload.bbox is not None
    assert payload.bbox.height == 120
