from app.db.base import Base
from app.enums.status import (
    DetectionTaskStatus,
    InspectionReportStatus,
    ProjectStatus,
    RecommendationOrientation,
    ReviewResultStatus,
)
from app import models  # noqa: F401


def test_phase2_tables_are_registered() -> None:
    expected_tables = {
        "user_account",
        "project",
        "building",
        "facade",
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
        "detecting",
        "pending_review",
        "reviewed",
        "completed",
        "failed",
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


def test_facade_orientation_moved_to_recommendation_input() -> None:
    facade = Base.metadata.tables["facade"]
    recommendation = Base.metadata.tables["collection_time_recommendation"]

    assert "orientation" not in facade.c
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


def test_inspection_report_uses_docx_file_fields() -> None:
    report = Base.metadata.tables["inspection_report"]

    assert "docx_bucket" in report.c
    assert "docx_object_key" in report.c
    assert "pdf_bucket" not in report.c
    assert "pdf_object_key" not in report.c
