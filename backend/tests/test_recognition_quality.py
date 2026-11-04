from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.dependencies import AuthenticatedUser, get_current_user
from app.api.recognition_quality import overview
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.tables import (
    AiDetectionResult, AnnotationPhotoEdit, DetectionConfig, DetectionTask, DetectionTaskPhoto,
    InspectionReport, Photo, Project, QualityBaseline, QualityEvaluation, ReviewResult, UploadBatch, UserAccount,
)
from app.services.recognition_quality import aggregate, evaluate_baseline, evaluate_photo, match_boxes, metrics
from app.services.report_data import build_report_data


@compiles(JSONB, "sqlite")
def jsonb_sqlite(type_, compiler, **kwargs):
    return "JSON"


def box(identifier="a", category="crack", x=0, width=10):
    return {"id": identifier, "defect_type": category, "bbox": {"x": x, "y": 0, "width": width, "height": 10}}


@pytest.mark.parametrize("pred,truth,expected", [
    ([box()], [box("different-id")], (1, 0, 0)),
    ([box(), box("duplicate")], [box()], (1, 1, 0)),
    ([box()], [box(category="spalling")], (0, 1, 1)),
    ([box()], [box(x=40)], (0, 1, 1)),
    ([], [box()], (0, 0, 1)),
    ([box()], [], (0, 1, 0)),
    ([], [], (0, 0, 0)),
    ([box(width=20)], [box()], (1, 0, 0)),  # exact IoU threshold
])
def test_object_matching_counts(pred, truth, expected):
    result = evaluate_photo(pred, truth)
    assert tuple(result["metrics"][k] for k in ("tp", "fp", "fn")) == expected
    if not pred and not truth:
        assert result["metrics"]["score"] is None
    elif expected[0] == 0:
        assert result["metrics"]["score"] == 0


def test_matching_maximizes_cardinality_before_overlap():
    # Greedy highest-IoU chooses wide->wide and loses the second possible match.
    predictions = [box("wide", width=20), box("left", width=10)]
    truth = [box("wide-truth", width=20), box("right", x=10)]
    assert {(a, b) for a, b, _ in match_boxes(predictions, truth)} == {(0, 1), (1, 0)}


def test_matching_maximizes_overlap_and_is_deterministic():
    predictions = [box("a"), box("b", x=1)]
    truth = [box("a"), box("b", x=1)]
    expected = [(0, 0, 1.0), (1, 1, 1.0)]
    assert match_boxes(predictions, truth) == expected
    assert match_boxes(predictions, truth) == expected


def test_score_and_aggregation_use_counts_not_project_averages():
    result = metrics(80, 20, 10)
    assert result["precision"] == 80
    assert result["recall"] == pytest.approx(88.88889)
    assert result["score"] == pytest.approx(84.210526)
    result = aggregate([metrics(1, 0, 0), metrics(0, 99, 99)])
    assert result["score"] == 1


def test_only_explicitly_reviewed_photos_enter_metrics_and_exclusions_stay_visible():
    baseline = {"selected_types": ["crack"], "photos": [
        {"photo_key": str(i), "width": 100, "height": 100, "predictions": [box()]} for i in range(3)]}
    def edit(key, state):
        return SimpleNamespace(photo_key=key, review_state=state, annotations_json=[box()],
            exclusion_reason="模糊" if state == "excluded" else None, reviewed_by=None, reviewed_at=None)
    result = evaluate_baseline(baseline, [edit("0", "reviewed"), edit("1", "excluded")])["summary"]
    assert result["metrics"]["tp"] == 1
    assert result["excluded_photos"] == 1 and result["pending_photos"] == 1
    assert result["coverage"] == 50 and not result["complete"]
    all_excluded = evaluate_baseline(baseline, [edit(str(i), "excluded") for i in range(3)])["summary"]
    assert not all_excluded["complete"] and all_excluded["metrics"]["score"] is None


@pytest.fixture
def records(monkeypatch):
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        user = UserAccount(id=uuid4(), username="quality-admin", password_hash="unused", role="admin")
        db.add(user)
        db.flush()
        project = Project(name="质量评估测试", project_no="Q-001", created_by=user.id, status="pending_review")
        db.add(project)
        db.flush()
        config = DetectionConfig(project_id=project.id, model_types=["crack", "spalling"], created_by=user.id)
        batch = UploadBatch(project_id=project.id, batch_no="Q-UPLOAD", upload_mode="visible", uploaded_by=user.id)
        db.add_all([config, batch])
        db.flush()
        photos = [Photo(project_id=project.id, upload_batch_id=batch.id, original_filename=f"photo-{i}.jpg",
            storage_bucket="test", storage_object_key=f"photo-{i}.jpg", image_width=100, image_height=100,
            photo_type="visible", status="detected") for i in range(2)]
        db.add_all(photos)
        task = DetectionTask(project_id=project.id, detection_config_id=config.id, task_no="Q-TASK", status="success",
            photo_count=2, created_by=user.id, result_summary={"total_detections": 1,
                "detection_config": {"model_types": ["crack", "spalling"], "generate_building_model": False}})
        db.add(task)
        db.flush()
        db.add_all([DetectionTaskPhoto(detection_task_id=task.id, photo_id=p.id, status="detected") for p in photos])
        ai = AiDetectionResult(project_id=project.id, detection_task_id=task.id, photo_id=photos[0].id,
            defect_type="crack", confidence=0.9, bbox_json=box()["bbox"], model_version="model-v1")
        db.add(ai)
        db.flush()
        reviewed = ReviewResult(project_id=project.id, detection_task_id=task.id, photo_id=photos[0].id,
            ai_result_id=ai.id, defect_type="crack", bbox_json=deepcopy(ai.bbox_json), reviewer_id=user.id)
        db.add(reviewed)
        db.flush()
        report = InspectionReport(project_id=project.id, detection_task_id=task.id, report_no="Q-REPORT", title="测试报告",
            generated_by=user.id, status="draft", report_data_json=build_report_data(db, project, task.id))
        db.add(report)
        db.flush()
        project.current_task_id, project.current_report_id = task.id, report.id
        db.commit()
        def database():
            try:
                yield db
            finally:
                # Mirror the real request-scoped Session.close rollback boundary.
                db.rollback()
        monkeypatch.setitem(app.dependency_overrides, get_db, database)
        monkeypatch.setitem(app.dependency_overrides, get_current_user, lambda: AuthenticatedUser.from_model(user))
        yield SimpleNamespace(db=db, client=TestClient(app), user=user, project=project, task=task,
            photos=photos, report=report, ai=ai, reviewed=reviewed)
    engine.dispose()


def save_photo(r, index, annotations=None, state="reviewed", reason=None):
    payload = {"photo_key": f"photo:{r.photos[index].id}", "annotations": annotations or [], "review_state": state}
    if reason is not None:
        payload["exclusion_reason"] = reason
    return r.client.put(f"/api/review/detections/{r.task.id}/annotations/photos", json=payload)


def project_url(r):
    return f"/api/recognition-quality/projects/{r.project.id}"


def test_full_review_lifecycle_freezes_versions_and_invalidates_stale_scores(records):
    r = records
    original = deepcopy(r.ai.bbox_json)
    annotation = {**box(), "source_annotation_id": str(r.reviewed.id)}
    assert save_photo(r, 0, [annotation]).status_code == 200
    draft = r.client.get(project_url(r)).json()
    assert draft["summary"]["metrics"]["tp"] == 1
    assert draft["summary"]["pending_photos"] == 1 and draft["evaluation"] is None
    assert save_photo(r, 1).status_code == 200  # explicit empty ground truth
    assert r.client.post(f"/api/review/detections/{r.task.id}/complete").status_code == 200
    first = r.client.get(project_url(r)).json()
    assert first["evaluation"]["version"] == 1
    assert first["summary"]["metrics"]["score"] == 100
    assert first["summary"]["empty_correct_photos"] == 1
    assert r.client.get("/api/recognition-quality").json()["overview"]["evaluated_projects"] == 1
    assert "storage_object_key" not in first["photos"][0]
    # Repeated completion is idempotent, with no duplicate version.
    assert r.client.post(f"/api/review/detections/{r.task.id}/complete").status_code == 200
    assert len(r.client.get(project_url(r)).json()["history"]) == 1
    # Merely saving a draft revokes confirmation and the official global score.
    assert save_photo(r, 0, [], state="pending").status_code == 200
    assert r.client.get("/api/recognition-quality").json()["overview"]["evaluated_projects"] == 0
    assert r.client.get(project_url(r)).json()["evaluation"] is None
    assert save_photo(r, 0, []).status_code == 200
    assert r.client.post(f"/api/review/detections/{r.task.id}/complete").status_code == 200
    second = r.client.get(project_url(r)).json()
    assert second["evaluation"]["version"] == 2
    assert second["summary"]["metrics"]["fp"] == 1
    assert second["summary"]["metrics"]["score"] == 0
    old = r.client.get(project_url(r) + "?version=1").json()
    assert old["summary"]["metrics"]["score"] == 100
    assert r.db.get(AiDetectionResult, r.ai.id).bbox_json == original
    assert len(list(r.db.scalars(select(QualityBaseline)))) == 1
    assert len(list(r.db.scalars(select(QualityEvaluation)))) == 2
    assert r.client.get(project_url(r) + "/export?version=1").status_code == 200
    assert "正确识别" in r.client.get("/api/recognition-quality/export").text


def test_draft_import_and_implicit_confirmation_never_become_ground_truth(records):
    r = records
    assert save_photo(r, 0, [box()], state="pending").status_code == 200
    assert r.client.post(f"/api/review/detections/{r.task.id}/complete").status_code == 200
    result = r.client.get(project_url(r)).json()
    assert result["evaluation"] is None
    assert result["summary"]["reviewed_photos"] == 0
    assert result["summary"]["metrics"]["score"] is None


def test_exclusions_require_reason_and_are_not_counted_as_success(records):
    r = records
    assert save_photo(r, 0, state="excluded").status_code == 422
    assert save_photo(r, 0, state="excluded", reason="照片模糊").status_code == 200
    assert save_photo(r, 1).status_code == 200
    assert r.client.post(f"/api/review/detections/{r.task.id}/complete").status_code == 200
    result = r.client.get(project_url(r)).json()
    assert result["summary"]["excluded_photos"] == 1
    assert result["summary"]["metrics"]["score"] is None
    assert any(photo["exclusion_reason"] == "照片模糊" for photo in result["photos"])


@pytest.mark.parametrize("state", ["pending", "reviewed", "excluded"])
def test_quality_endpoints_are_admin_only_but_reviewers_can_confirm(records, monkeypatch, state):
    r = records
    viewer = AuthenticatedUser(id=r.user.id, username="reviewer", real_name=None, role="reviewer", organization=None)
    monkeypatch.setitem(app.dependency_overrides, get_current_user, lambda: viewer)
    for path in ("/api/recognition-quality", "/api/recognition-quality/export", project_url(r), project_url(r) + "/export"):
        assert r.client.get(path).status_code == 403
    assert save_photo(r, 0, state=state, reason="遮挡" if state == "excluded" else None).status_code == 200


def test_out_of_bounds_and_missing_baselines_cannot_produce_official_scores(records):
    r = records
    assert save_photo(r, 0, [box(x=95)]).status_code == 409
    assert save_photo(r, 0, [box(), box()]).status_code == 422
    r.task.result_summary = {"total_detections": 2, "detection_config": {"model_types": ["crack"]}}
    r.db.commit()
    result = r.client.get(project_url(r)).json()
    assert result["summary"] is None and "AI 原始结果" in result["unavailable_reason"]
    assert save_photo(r, 0).status_code == 409


def test_nonfinite_coordinates_return_validation_errors(records):
    r = records
    payload = {"photo_key": f"photo:{r.photos[0].id}", "annotations": [box()]}
    import json
    for invalid in (float("nan"), float("inf")):
        payload["annotations"][0]["bbox"]["x"] = invalid
        response = r.client.put(f"/api/review/detections/{r.task.id}/annotations/photos",
            content=json.dumps(payload), headers={"Content-Type": "application/json"})
        assert response.status_code == 422


def test_exclusion_allows_invalid_original_photo_without_hiding_the_reason(records):
    r = records
    r.ai.bbox_json = box(x=95)["bbox"]
    r.db.commit()
    assert save_photo(r, 0, [box()]).status_code == 409
    assert save_photo(r, 0, state="excluded", reason="原始坐标无法用于评估").status_code == 200
    assert save_photo(r, 1).status_code == 200
    result = r.client.get(project_url(r)).json()
    assert result["summary"]["excluded_photos"] == 1
    assert result["summary"]["metrics"]["fp"] == 0


def test_reset_revokes_confirmation_and_customer_cannot_read_quality(records, monkeypatch):
    r = records
    assert save_photo(r, 0).status_code == 200
    response = r.client.delete(f"/api/review/detections/{r.task.id}/annotations/photos",
        params={"photo_key": f"photo:{r.photos[0].id}"})
    assert response.status_code == 200
    assert r.client.get(project_url(r)).json()["summary"]["reviewed_photos"] == 0
    customer = AuthenticatedUser(id=r.user.id, username="customer", real_name=None, role="customer", organization=None)
    monkeypatch.setitem(app.dependency_overrides, get_current_user, lambda: customer)
    assert r.client.get(project_url(r)).status_code == 403
    assert save_photo(r, 0).status_code == 403


def test_overview_aggregates_latest_official_counts_only():
    common = {"total_photos": 1, "reviewed_photos": 1, "excluded_photos": 0}
    def official(m):
        return {**common, "evaluation": {"summary": {"metrics": m, "by_type": {"crack": m},
            "reviewed_photos": 1, "empty_truth_photos": 0, "empty_correct_photos": 0}}}
    result = overview([official(metrics(1)), official(metrics(0, 99, 99)), {**common, "evaluation": None}])
    assert result["metrics"]["score"] == 1
    assert result["evaluated_projects"] == 2 and result["total_projects"] == 3
