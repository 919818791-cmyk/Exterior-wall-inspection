from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

from app.api.review import (
    _apply_review_annotation_edits,
    _review_preview_result,
    _valid_photo_keys,
)
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


def test_review_preview_uses_saved_annotation_edits() -> None:
    result = ReportDetailRead.model_validate(
        {
            "id": str(uuid4()),
            "source_type": "formal",
            "project_id": str(uuid4()),
            "detection_task_id": str(uuid4()),
            "report_no": "RPT-preview",
            "title": "preview",
            "status": "draft",
            "report_data_json": {},
            "project": {},
            "detection_config": None,
            "detection_task": None,
            "summary": {"total_review_results": 1},
            "defects": [
                {
                    "id": "source-1",
                    "photo_id": "photo-1",
                    "defect_type": "crack",
                    "bbox_json": {"x": 1, "y": 2, "width": 3, "height": 4},
                }
            ],
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
    edit = SimpleNamespace(
        photo_key="photo:photo-1",
        annotations_json=[
            {
                "id": "source:source-1",
                "source_annotation_id": "source-1",
                "defect_type": "spalling",
                "bbox": {"x": 20, "y": 30, "width": 160, "height": 120},
                "confidence": 0.9,
            }
        ],
    )

    preview = _review_preview_result(result, [edit])

    assert len(preview.defects) == 1
    assert preview.defects[0]["defect_type"] == "spalling"
    assert preview.defects[0]["bbox_json"]["width"] == 160
    assert preview.summary["by_defect_type"] == {"spalling": 1}


def test_repeat_review_reuses_existing_manual_annotation(monkeypatch) -> None:
    project_id = uuid4()
    task_id = uuid4()
    photo_id = uuid4()
    result_id = uuid4()
    reviewer_id = uuid4()
    bbox = {"x": 20, "y": 30, "width": 160, "height": 120}
    photo = SimpleNamespace(id=photo_id, original_filename="photo.jpg")
    existing = SimpleNamespace(
        id=result_id,
        project_id=project_id,
        detection_task_id=task_id,
        photo_id=photo_id,
        ai_result_id=None,
        defect_type="crack",
        bbox_json=bbox,
        polygon_json=None,
        severity=None,
        area=None,
        length=None,
        status="added",
        reviewer_id=reviewer_id,
        review_note="审核工作台新增标注",
        reviewed_at=datetime.now(UTC),
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    edit = SimpleNamespace(
        photo_key=f"photo:{photo_id}",
        annotations_json=[
            {
                "id": "manual-1",
                "source_annotation_id": None,
                "defect_type": "crack",
                "bbox": bbox,
                "confidence": None,
            }
        ],
    )
    db = SimpleNamespace(
        scalars=Mock(
            side_effect=[
                iter([photo]),
                iter([existing]),
                iter([edit]),
            ]
        )
    )
    monkeypatch.setattr("app.api.review._write_operation_log", lambda *args, **kwargs: None)

    results = _apply_review_annotation_edits(
        db,
        task=SimpleNamespace(id=task_id, project_id=project_id),
        report=SimpleNamespace(id=uuid4()),
        reviewer=SimpleNamespace(id=reviewer_id),
        reviewed_at=datetime.now(UTC),
    )

    assert results == [existing]
    assert existing.status == "added"
    assert edit.annotations_json[0]["source_annotation_id"] == str(result_id)
