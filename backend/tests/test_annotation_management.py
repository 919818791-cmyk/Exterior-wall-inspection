from uuid import UUID, uuid4

from fastapi import HTTPException
from pytest import raises

from app.api.annotation_management import (
    _annotation_list_item,
    _result_photo_count,
    _valid_photo_keys,
)
from app.api.dependencies import AuthenticatedUser, require_roles
from app.db.base import Base
from app.enums.status import UserRole
from app.main import app
from app.schemas.annotation_management import AnnotationPhotoEditRequest
from app.schemas.phase7 import ReportDetailRead, ReportListItem


def test_annotation_management_routes_and_table_are_registered() -> None:
    paths = {route.path for route in app.routes}

    assert "/api/annotation-management/results" in paths
    assert "/api/annotation-management/results/{result_id}" in paths
    assert "/api/annotation-management/results/{result_id}/photos" in paths
    assert "annotation_photo_edit" in Base.metadata.tables


def test_annotation_edit_payload_supports_move_resize_add_and_delete() -> None:
    payload = AnnotationPhotoEditRequest.model_validate(
        {
            "photo_key": "photo:11111111-1111-1111-1111-111111111111",
            "annotations": [
                {
                    "id": "manual-1",
                    "defect_type": "corrosion",
                    "bbox": {"x": 20, "y": 30, "width": 160, "height": 120},
                }
            ],
        }
    )

    assert payload.annotations[0].bbox.width == 160
    assert payload.annotations[0].defect_type == "corrosion"

    deleted = AnnotationPhotoEditRequest.model_validate(
        {"photo_key": payload.photo_key, "annotations": []}
    )
    assert deleted.annotations == []


def test_annotation_photo_keys_cover_report_photos_and_legacy_defects() -> None:
    result = ReportDetailRead.model_validate(
        {
            "id": str(uuid4()),
            "source_type": "trial",
            "project_id": None,
            "detection_task_id": None,
            "report_no": "TRY-1",
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


def test_annotation_result_photo_count_uses_summary_and_legacy_photo_fallback() -> None:
    assert _result_photo_count({"summary": {"photo_count": 3}, "photos": [{}]}) == 3
    assert _result_photo_count({"summary": {}, "photos": [{}, {}]}) == 2


def test_annotation_list_item_replaces_existing_photo_count() -> None:
    item = ReportListItem.model_validate(
        {
            "id": str(uuid4()),
            "source_type": "trial",
            "project_id": None,
            "detection_task_id": None,
            "report_no": "TRY-1",
            "title": "test",
            "status": "generated",
            "project_name": "简易AI检测",
            "client_name": "平台用户",
            "address": "简易检测归档",
            "total_defects": 0,
            "photo_count": 99,
            "generated_by": str(uuid4()),
            "generated_at": "2026-07-13T00:00:00Z",
            "pushed_at": None,
            "created_at": "2026-07-13T00:00:00Z",
            "updated_at": "2026-07-13T00:00:00Z",
        }
    )

    result = _annotation_list_item(item, {"summary": {"photo_count": 3}})

    assert result.photo_count == 3


def test_reviewer_is_rejected_from_admin_annotation_boundary() -> None:
    reviewer = AuthenticatedUser(
        id=UUID("00000000-0000-0000-0000-000000000002"),
        username="reviewer",
        real_name="审核员",
        role=UserRole.REVIEWER.value,
        organization=None,
    )

    with raises(HTTPException) as raised:
        require_roles(UserRole.ADMIN)(reviewer)

    assert raised.value.status_code == 403
