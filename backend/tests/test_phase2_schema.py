from app.db.base import Base
from app.enums.status import (
    DefectType,
    DetectionTaskStatus,
    InspectionReportStatus,
    PhotoPrecheckStatus,
    ProjectStatus,
    RecommendationOrientation,
    ReviewResultStatus,
)
from app import models  # noqa: F401


def test_phase2_tables_are_registered() -> None:
    expected_tables = {
        "user_account",
        "project",
        "collection_time_recommendation",
        "detection_config",
        "upload_batch",
        "photo",
        "detection_task",
        "detection_task_photo",
        "ai_detection_result",
        "review_result",
        "review_operation_log",
        "inspection_report",
        "report_push_log",
    }

    assert expected_tables.issubset(Base.metadata.tables.keys())


def test_phase2_required_status_values_are_centralized() -> None:
    assert {item.value for item in ProjectStatus} == {
        "draft",
        "queued",
        "detecting",
        "pending_review",
        "reviewed",
        "completed",
    }
    assert {item.value for item in DetectionTaskStatus} == {
        "pending",
        "running",
        "success",
        "failed",
        "canceled",
    }
    assert {item.value for item in InspectionReportStatus} == {
        "draft",
        "generated",
        "pushed",
        "revoked",
    }
    assert {item.value for item in ReviewResultStatus} == {
        "pending",
        "confirmed",
        "modified",
        "deleted",
        "added",
    }
    assert {item.value for item in DefectType} == {
        "crack",
        "spalling",
        "moisture",
        "hollow",
    }
    assert DefectType("missing") is DefectType.SPALLING
    assert {item.value for item in PhotoPrecheckStatus} == {
        "pending",
        "running",
        "passed",
        "rejected",
        "error",
    }


def test_photo_precheck_state_is_persisted_for_formal_and_trial_photos() -> None:
    required_columns = {
        "precheck_status",
        "precheck_category",
        "precheck_reason",
        "precheck_model",
        "precheck_error",
        "precheck_attempts",
        "prechecked_at",
    }

    assert required_columns.issubset(Base.metadata.tables["photo"].c.keys())
    assert required_columns.issubset(
        Base.metadata.tables["quick_detection_photo"].c.keys()
    )


def test_project_photos_have_no_building_or_facade_dimension() -> None:
    recommendation = Base.metadata.tables["collection_time_recommendation"]
    upload_batch = Base.metadata.tables["upload_batch"]
    photo = Base.metadata.tables["photo"]
    detection_task = Base.metadata.tables["detection_task"]
    inspection_report = Base.metadata.tables["inspection_report"]

    assert "building" not in Base.metadata.tables
    assert "facade" not in Base.metadata.tables
    assert "facade_id" not in recommendation.c
    assert "facade_id" not in upload_batch.c
    assert "facade_id" not in photo.c
    assert "building_id" not in recommendation.c
    assert "building_id" not in upload_batch.c
    assert "building_id" not in photo.c
    assert "building_id" not in detection_task.c
    assert "run_id" not in detection_task.c
    assert any(
        constraint.name == "uq_detection_task_project_id"
        for constraint in detection_task.constraints
    )
    assert any(
        constraint.name == "uq_inspection_report_project_id"
        for constraint in inspection_report.constraints
    )
    assert "orientation" in recommendation.c
    assert not recommendation.c.orientation.nullable
    assert {item.value for item in RecommendationOrientation} == {
        "east",
        "south",
        "west",
        "north",
        "southeast",
        "southwest",
        "northeast",
        "northwest",
    }


def test_project_persists_coordinates() -> None:
    project = Base.metadata.tables["project"]

    assert "longitude" in project.c
    assert "latitude" in project.c
    assert project.c.longitude.type.precision == 10
    assert project.c.longitude.type.scale == 7
    assert project.c.latitude.type.precision == 10
    assert project.c.latitude.type.scale == 7


def test_project_supports_idempotent_draft_creation() -> None:
    project = Base.metadata.tables["project"]

    assert "client_draft_key" in project.c
    assert project.c.client_draft_key.nullable
    assert any(
        index.name == "uq_project_created_by_client_draft_key" and index.unique
        for index in project.indexes
    )


def test_user_account_does_not_persist_email() -> None:
    user_account = Base.metadata.tables["user_account"]

    assert "email" not in user_account.c


def test_inspection_report_uses_docx_file_fields() -> None:
    report = Base.metadata.tables["inspection_report"]

    assert "docx_bucket" in report.c
    assert "docx_object_key" in report.c
    assert "pdf_bucket" not in report.c
    assert "pdf_object_key" not in report.c
