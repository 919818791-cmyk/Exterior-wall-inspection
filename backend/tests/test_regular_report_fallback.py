from copy import deepcopy
from datetime import UTC, datetime
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from docx import Document
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.api import review
from app.api.dependencies import AuthenticatedUser, get_current_user
from app.main import app
from app.schemas.phase7 import ReportDetailRead
from app.services.docx_report import _building_model_report_requested, build_report_docx
from app.services.report_data import build_report_data


@pytest.fixture
def fallback_context(monkeypatch):
    now = datetime.now(UTC)
    config = SimpleNamespace(
        model_types=["crack"], high_precision=True,
        config_json={"generate_building_model": True, "model_types": ["crack"]},
    )
    task = SimpleNamespace(
        id=uuid4(), project_id=uuid4(), status="success", detection_config_id=uuid4(),
        task_no="TASK-fallback", model_version="test", finished_at=now,
        result_summary={"detection_config": {
            **config.config_json,
            "config_json": {"generate_building_model": True},
        }, "raw_model_outputs": [{"filename": "facade.jpg"}]}, updated_at=now,
    )
    project = SimpleNamespace(
        id=task.project_id, is_example=False, status="pending_review", updated_at=now,
        current_task_id=task.id,
        project_no="PROJECT-fallback", name="测试建筑", client_name=None,
        province=None, city=None, district=None, address=None,
        created_at=now, started_at=now, completed_at=None,
    )
    report = SimpleNamespace(
        id=uuid4(), project_id=project.id, detection_task_id=task.id,
        report_no="RPT-fallback", title="测试报告", status="draft",
        report_data_json={
            "project": {"name": project.name}, "photos": [], "defects": [],
            "detection_config": {"generate_building_model": True,
                "config_json": deepcopy(task.result_summary["detection_config"])},
        }, generated_by=uuid4(), generated_at=now, created_at=now, updated_at=now,
        docx_bucket="cached", docx_object_key="old-model.docx", pushed_at=None,
    )
    reviewer = AuthenticatedUser(
        id=uuid4(), username="reviewer", real_name="审核员", role="reviewer", organization=None,
    )
    db = Mock()
    db.get.side_effect = lambda model, key: task if key == task.id else config
    db.scalar.return_value = config
    db.scalars.return_value = []
    monkeypatch.setattr(review, "_review_annotation_report", lambda *_: (task, report))
    monkeypatch.setattr(review, "_get_project_or_404", lambda *_: project)
    monkeypatch.setattr(review, "_review_detection_item", lambda *_: SimpleNamespace(
        generate_building_model=review._building_model_requested(
            task.result_summary.get("detection_config", {}), config),
    ))
    monkeypatch.setattr(review, "_ensure_task_reviewable", lambda *_: review._ensure_report_reviewable(report))
    monkeypatch.setattr(review, "_building_model_exists", lambda *_: False)
    monkeypatch.setattr(review, "has_complete_building_model_images", lambda *_: False)
    return SimpleNamespace(task=task, project=project, report=report, config=config, db=db, reviewer=reviewer)


def test_switch_persists_task_scope_clears_docx_and_records_reason(fallback_context):
    ctx = fallback_context
    result = review.use_regular_detection_report(ctx.task.id, ctx.db, ctx.reviewer)

    assert result.generate_building_model is False
    assert ctx.config.config_json["generate_building_model"] is False
    assert ctx.task.result_summary["raw_model_outputs"] == [{"filename": "facade.jpg"}]
    assert not _building_model_report_requested(ctx.report.report_data_json)
    assert ctx.report.docx_bucket is None and ctx.report.docx_object_key is None
    fallback = ctx.task.result_summary["detection_config"]["building_model_fallback"]
    assert fallback["reason"] == "photo_quality"
    assert fallback["changed_by"] == str(ctx.reviewer.id)
    assert fallback == ctx.report.report_data_json["detection_config"]["config_json"]["building_model_fallback"]
    ctx.db.commit.assert_called_once()
    assert ctx.db.add.call_args.args[0].note == "因照片质量问题，将三维模型报告替换为常规检测报告"

    review.use_regular_detection_report(ctx.task.id, ctx.db, ctx.reviewer)
    ctx.db.commit.assert_called_once()


def test_fallback_survives_preview_completion_and_regular_docx_export(fallback_context, monkeypatch):
    ctx = fallback_context
    ctx.project.current_task_id = uuid4()
    original_config = deepcopy(ctx.config.config_json)
    with pytest.raises(HTTPException) as error:
        review.get_review_detection_preview(Mock(), ctx.task.id, ctx.db, ctx.reviewer)
    assert error.value.status_code == 409

    review.use_regular_detection_report(ctx.task.id, ctx.db, ctx.reviewer)
    assert ctx.config.config_json == original_config
    # Exercise the real report rebuild, so the configuration cannot revert at
    # the review completion boundary even when the project still requests 3D.
    rebuilt = build_report_data(ctx.db, ctx.project, ctx.task.id, [])
    assert not _building_model_report_requested(rebuilt)
    assert rebuilt["detection_config"]["config_json"]["building_model_fallback"]["reason"] == "photo_quality"
    preview_result = ReportDetailRead.model_validate({**vars(ctx.report), **rebuilt})
    monkeypatch.setattr(review, "_review_result_detail", lambda *_: preview_result)
    preview = review.get_review_detection_preview(Mock(), ctx.task.id, ctx.db, ctx.reviewer)
    assert preview.detection_config == preview_result.detection_config

    monkeypatch.setattr(review, "_apply_review_annotation_edits", lambda *_, **__: [])
    result = review.complete_detection_review(ctx.task.id, ctx.db, ctx.reviewer)
    assert result.status == "generated"
    assert ctx.project.status == "completed"
    assert result.report_data_json["detection_config"]["config_json"]["building_model_fallback"]["message"] == (
        "因照片质量问题，无法生成三维模型，已替换为常规检测报告。"
    )
    content = build_report_docx(result.title, result.report_no, result.report_data_json)
    document = Document(BytesIO(content))
    assert len(document.tables) == 1


@pytest.mark.parametrize("change, status_code", [
    ("failed", 409), ("revoked", 409), ("example", 403),
])
def test_fallback_rejects_uneditable_projects(fallback_context, change, status_code):
    ctx = fallback_context
    if change == "failed":
        ctx.task.status = "failed"
    elif change == "revoked":
        ctx.report.status = "revoked"
    else:
        ctx.project.is_example = True
    with pytest.raises(HTTPException) as error:
        review.use_regular_detection_report(ctx.task.id, ctx.db, ctx.reviewer)
    assert error.value.status_code == status_code
    ctx.db.commit.assert_not_called()


def test_fallback_route_rejects_customer():
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        id=uuid4(), username="customer", real_name="客户", role="customer", organization=None,
    )
    try:
        response = TestClient(app).post(f"/api/review/detections/{uuid4()}/regular-report")
        assert response.status_code == 403
    finally:
        app.dependency_overrides.pop(get_current_user, None)
