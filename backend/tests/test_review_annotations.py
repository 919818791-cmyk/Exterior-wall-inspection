from uuid import uuid4

from app.api.review import _valid_photo_keys
from app.db.base import Base
from app.main import app
from app.schemas.review_annotations import AnnotationPhotoEditRequest
from app.schemas.phase7 import ReportDetailRead


def test_annotation_edits_are_available_only_through_the_review_workbench() -> None:
    paths = {route.path for route in app.routes}

    assert not any(path.startswith("/api/annotation-management") for path in paths)
    assert "/api/review/detections/{task_id}/annotations" in paths
    assert "/api/review/detections/{task_id}/annotations/photos" in paths
    assert "annotation_photo_edit" in Base.metadata.tables


def test_annotation_edit_payload_supports_move_resize_add_and_delete() -> None:
    payload = AnnotationPhotoEditRequest.model_validate(
        {
            "photo_key": "photo:11111111-1111-1111-1111-111111111111",
            "annotations": [
                {
                    "id": "manual-1",
                    "defect_type": "crack",
                    "bbox": {"x": 20, "y": 30, "width": 160, "height": 120},
                }
            ],
        }
    )

    assert payload.annotations[0].bbox.width == 160
    assert payload.annotations[0].defect_type == "crack"

    deleted = AnnotationPhotoEditRequest.model_validate(
        {"photo_key": payload.photo_key, "annotations": []}
    )
    assert deleted.annotations == []


def test_review_annotation_photo_keys_cover_report_photos_and_legacy_defects() -> None:
    result = ReportDetailRead.model_validate(
        {
            "id": str(uuid4()),
            "source_type": "formal",
            "project_id": str(uuid4()),
            "detection_task_id": str(uuid4()),
            "report_no": "RPT-1",
            "title": "test",
            "status": "generated",
            "report_data_json": {},
            "project": {},
            "detection_config": None,
            "detection_task": None,
            "summary": {},
            "defects": [{"id": "legacy", "photo_filename": "legacy.jpg"}],
            "photos": [{"id": "photo-1", "original_filename": "photo.jpg"}],
            "docx_bucket": None,
            "docx_object_key": None,
            "generated_by": str(uuid4()),
            "generated_at": "2026-07-13T00:00:00Z",
            "pushed_at": None,
            "created_at": "2026-07-13T00:00:00Z",
            "updated_at": "2026-07-13T00:00:00Z",
        }
    )

    assert _valid_photo_keys(result) == {"photo:photo-1", "filename:legacy.jpg"}
