from asyncio import run
from datetime import UTC, datetime
from io import BytesIO
from json import dumps
from types import SimpleNamespace
from unittest.mock import patch
from uuid import UUID
from zipfile import ZipFile

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pytest import raises

from app.api import reports
from app.api.dependencies import AuthenticatedUser, get_current_user
from app.api.reports import (
    _append_trial_detection_result,
    _enforce_trial_upload_limit,
    _project_reviewed_result_visible,
    _report_access_filter,
    _reserve_trial_usage,
    create_trial_result,
    list_reports,
)
from app.db.session import get_db
from app.enums.status import InspectionReportStatus, UserRole
from app.main import app
from app.models.tables import (
    InspectionReport,
    Project,
    QuickDetectionPhoto,
    TrialDetectionResult,
    UsageEvent,
)
from app.schemas.phase7 import ReportListItem, TrialGeneratedResult, TrialReportRequest
from app.services.docx_report import build_report_docx
from app.services.photo_metadata import extract_photo_metadata_from_bytes

client = TestClient(app)
TRIAL_JPEG_BYTES = b"\xff\xd8\xff\xe0fake-image\xff\xd9"
TRIAL_PNG_BYTES = b"\x89PNG\r\n\x1a\nfake-image"


class EmptyReportRows:
    def all(self) -> list[object]:
        return []


class EmptyReportScalars:
    def __iter__(self):
        return iter([])


class CapturingReportDb:
    def __init__(self) -> None:
        self.statements: list[object] = []

    def execute(self, statement: object) -> EmptyReportRows:
        self.statements.append(statement)
        return EmptyReportRows()

    def scalars(self, statement: object) -> EmptyReportScalars:
        self.statements.append(statement)
        return EmptyReportScalars()


class UploadedPhotoScalars:
    def __init__(self, photos: list[QuickDetectionPhoto]) -> None:
        self.photos = photos

    def all(self) -> list[QuickDetectionPhoto]:
        return self.photos


class UploadedPhotoDb:
    def __init__(self, photos: list[QuickDetectionPhoto]) -> None:
        self.photos = photos
        self.result_numbers: list[str] = []
        self.execute_count = 0
        self.usage_events: list[UsageEvent] = []
        self.trial_results: list[TrialDetectionResult] = []

    def scalars(self, statement: object) -> UploadedPhotoScalars:
        if "trial_detection_result.result_no" in str(statement):
            return UploadedPhotoScalars(self.result_numbers)
        return UploadedPhotoScalars(self.photos)

    def execute(self, _: object) -> None:
        self.execute_count += 1

    def add(self, item: object) -> None:
        if isinstance(item, QuickDetectionPhoto):
            now = datetime.now(UTC)
            item.created_at = now
            item.updated_at = now
            self.photos.append(item)
        elif isinstance(item, UsageEvent):
            self.usage_events.append(item)
        elif isinstance(item, TrialDetectionResult):
            self.trial_results.append(item)

    def flush(self) -> None:
        for result in self.trial_results:
            result.created_at = result.generated_at
            result.updated_at = result.generated_at

    def commit(self) -> None:
        self.flush()

    def rollback(self) -> None:
        return None

    def refresh(self, _: object) -> None:
        return None


class AppendingTrialDb(UploadedPhotoDb):
    def __init__(self, photos: list[QuickDetectionPhoto], result: TrialDetectionResult) -> None:
        super().__init__(photos)
        self.result = result

    def scalar(self, _: object) -> TrialDetectionResult:
        return self.result


class JsonTrialRequest:
    headers = {"content-type": "application/json"}

    def __init__(self, payload: dict) -> None:
        self.payload = payload

    async def json(self) -> dict:
        return self.payload


class ArchivingTrialDb(UploadedPhotoDb):
    def __init__(self, photos: list[QuickDetectionPhoto]) -> None:
        super().__init__(photos)
        self.added_result = None
        self.flushed = False

    def add(self, result: object) -> None:
        self.added_result = result

    def flush(self) -> None:
        assert self.added_result is not None
        dumps(self.added_result.report_data_json)
        self.flushed = True
        self.added_result.created_at = self.added_result.generated_at
        self.added_result.updated_at = self.added_result.generated_at

    def commit(self) -> None:
        assert self.added_result is not None
        assert self.flushed
        dumps(self.added_result.report_data_json)
        self.added_result.created_at = self.added_result.generated_at
        self.added_result.updated_at = self.added_result.generated_at

    def refresh(self, result: object) -> None:
        return None


class RenamingTrialDb:
    def __init__(self, result: TrialDetectionResult) -> None:
        self.result = result

    def scalar(self, _: object) -> TrialDetectionResult:
        return self.result

    def commit(self) -> None:
        self.result.updated_at = datetime.now(UTC)

    def refresh(self, _: object) -> None:
        return None


class ProjectResultVisibilityDb:
    def __init__(self, project: object, report: object | None = None) -> None:
        self.project = project
        self.report = report

    def get(self, model: type, _: object) -> object | None:
        if model is Project:
            return self.project
        if model is InspectionReport:
            return self.report
        return None


class TrackingUploadedPhoto:
    def __init__(self, photo_id: UUID, db: ArchivingTrialDb) -> None:
        self.id = photo_id
        self.original_filename = "quick-001.jpg"
        self.file_size = 1200
        self.mime_type = "image/jpeg"
        self.storage_bucket = "building-exterior"
        self.storage_object_key = f"quick-detection/{photo_id}.jpg"
        self.metadata_json = {"thermal_imaging_available": False}
        self.thermal_imaging_available = False
        self.precheck_status = "passed"
        self.precheck_category = "BUILDING"
        self.uploaded_by = _trial_customer().id
        self._db = db
        self._generated_result_id = None

    @property
    def generated_result_id(self):
        return self._generated_result_id

    @generated_result_id.setter
    def generated_result_id(self, value):
        assert self._db.flushed
        self._generated_result_id = value


def _auth_user(user_id: str, username: str, role: UserRole) -> AuthenticatedUser:
    return AuthenticatedUser(
        id=UUID(user_id),
        username=username,
        real_name=username,
        role=role.value,
        organization=None,
    )


def _trial_customer() -> AuthenticatedUser:
    return _auth_user("00000000-0000-0000-0000-000000000001", "customer", UserRole.CUSTOMER)


def _reviewer() -> AuthenticatedUser:
    return _auth_user("00000000-0000-0000-0000-000000000002", "reviewer", UserRole.REVIEWER)


def _admin() -> AuthenticatedUser:
    return _auth_user("00000000-0000-0000-0000-000000000003", "admin", UserRole.ADMIN)


def _post_trial_generate(files: list[tuple[str, tuple[str, bytes, str]]]):
    stored_photos: list[QuickDetectionPhoto] = []
    content_by_key: dict[str, bytes] = {}
    for index, (_, (filename, content, content_type)) in enumerate(files, start=1):
        photo_id = UUID(int=10_000 + index)
        photo = _uploaded_photo(photo_id, filename=filename)
        photo.file_size = len(content)
        photo.mime_type = content_type
        stored_photos.append(photo)
        content_by_key[photo.storage_object_key] = content

    app.dependency_overrides[get_current_user] = _trial_customer
    app.dependency_overrides[get_db] = lambda: UploadedPhotoDb(stored_photos)
    try:
        with patch.object(
            reports,
            "get_object_bytes",
            side_effect=lambda _bucket, object_key: content_by_key[object_key],
        ):
            return client.post(
                "/api/trial/generate",
                json={
                    "report_name": "东立面体验结果",
                    "models": ["裂缝", "剥落"],
                    "photo_ids": [str(photo.id) for photo in stored_photos],
                },
            )
    finally:
        app.dependency_overrides.clear()


def _post_trial_photo(filename: str, content: bytes, content_type: str):
    app.dependency_overrides[get_current_user] = _trial_customer
    app.dependency_overrides[get_db] = lambda: UploadedPhotoDb([])
    try:
        return client.post(
            "/api/trial/photos",
            files={"file": (filename, content, content_type)},
        )
    finally:
        app.dependency_overrides.clear()


def _mock_trial_inference(
    monkeypatch,
    payload: dict | None = None,
    captured_kwargs: dict | None = None,
) -> None:
    inference_payload = payload or {
        "image": {"width": 1000, "height": 500},
        "detections": [
            {
                "id": "det-1",
                "type": "missing",
                "confidence": 0.67,
                "bbox": {"x": 100, "y": 50, "width": 240, "height": 80},
            }
        ],
    }
    monkeypatch.setattr(
        "app.api.reports.get_settings",
        lambda: SimpleNamespace(
            dashscope_api_key="test-key",
            qwen_api_base_url="https://qwen.test/compatible-mode/v1",
            qwen_model="qwen3-vl-plus",
            qwen_request_timeout_seconds=120,
            qwen_max_concurrency=5,
        ),
    )

    async def fake_infer_trial_images(images, **kwargs):
        if captured_kwargs is not None:
            captured_kwargs.update(kwargs)
        return [inference_payload for _ in images]

    monkeypatch.setattr(
        "app.api.reports.infer_trial_images",
        fake_infer_trial_images,
    )
    inference = inference_payload.get("inference") if isinstance(inference_payload.get("inference"), dict) else {}
    per_image_requests = int(inference.get("api_request_count") or inference.get("tile_count") or 1)
    monkeypatch.setattr(
        "app.api.reports.estimate_trial_api_request_count",
        lambda images, **kwargs: len(images) * per_image_requests,
    )


def _uploaded_photo(
    photo_id: UUID,
    *,
    filename: str = "quick-001.jpg",
    thermal_imaging_available: bool = False,
) -> QuickDetectionPhoto:
    return QuickDetectionPhoto(
        id=photo_id,
        original_filename=filename,
        file_size=1200,
        mime_type="image/jpeg",
        storage_bucket="building-exterior",
        storage_object_key=f"quick-detection/{photo_id}.jpg",
        metadata_json={"thermal_imaging_available": thermal_imaging_available},
        thermal_imaging_available=thermal_imaging_available,
        precheck_status="passed",
        precheck_category="BUILDING",
        precheck_reason="建筑照片",
        precheck_model="guard-test",
        precheck_attempts=1,
        prechecked_at=datetime.now(UTC),
        uploaded_by=_trial_customer().id,
    )


def test_phase7_report_routes_are_registered() -> None:
    paths = {route.path for route in app.routes}
    report_detail_methods = {
        method
        for route in app.routes
        if route.path == "/api/reports/{report_id}"
        for method in getattr(route, "methods", set())
    }

    assert "/api/reports" in paths
    assert "/api/projects/{project_id}/reviewed-result" in paths
    assert "/api/reports/{report_id}" in paths
    assert "/api/reports/{report_id}/push" not in paths
    assert "/api/reports/{report_id}/docx" in paths
    assert "/api/trial/photos" in paths
    assert "/api/trial/photos/{photo_id}" in paths
    assert "/api/trial/photos/{photo_id}/precheck" not in paths
    assert "/api/trial/generate" in paths
    assert "/api/trial/results" in paths
    assert "/api/trial/report/docx" not in paths
    assert "DELETE" in report_detail_methods
    assert "PATCH" in report_detail_methods


def test_generated_reports_are_visible_without_a_push_step() -> None:
    params = _report_access_filter(False).compile().params
    allowed_values = {
        value
        for values in params.values()
        for value in (values if isinstance(values, list) else [values])
    }

    assert InspectionReportStatus.GENERATED.value in allowed_values
    assert "reviewed" in allowed_values


@pytest.mark.parametrize(
    ("project_status", "visible"),
    [
        ("draft", False),
        ("detecting", False),
        ("pending_review", False),
        ("reviewed", True),
        ("completed", True),
    ],
)
def test_project_results_become_visible_only_after_review(
    project_status: str,
    visible: bool,
) -> None:
    project = SimpleNamespace(status=project_status)

    assert _project_reviewed_result_visible(project) is visible


@pytest.mark.parametrize(
    ("project_status", "expected_status"),
    [
        ("pending_review", 404),
        ("reviewed", 200),
    ],
)
def test_project_reviewed_results_endpoint_enforces_review_boundary(
    project_status: str,
    expected_status: int,
) -> None:
    project_id = UUID("00000000-0000-0000-0000-000000000701")
    report_id = UUID("00000000-0000-0000-0000-000000000702")
    generated_at = datetime.now(UTC)
    report = InspectionReport(
        id=report_id,
        project_id=project_id,
        detection_task_id=None,
        report_no="RPT-SINGLE-RESULT",
        title="单项目检测报告",
        status=InspectionReportStatus.GENERATED.value,
        report_data_json={
            "project": {"id": str(project_id), "name": "单项目"},
            "summary": {"photo_count": 0, "total_review_results": 0},
            "photos": [],
            "defects": [],
        },
        generated_by=_trial_customer().id,
        generated_at=generated_at,
    )
    report.created_at = generated_at
    report.updated_at = generated_at
    project = SimpleNamespace(
        id=project_id,
        created_by=_trial_customer().id,
        current_task_id=None,
        current_report_id=report_id,
        deleted_at=None,
        status=project_status,
    )
    app.dependency_overrides[get_current_user] = _trial_customer
    app.dependency_overrides[get_db] = lambda: ProjectResultVisibilityDb(project, report)
    try:
        response = client.get(f"/api/projects/{project_id}/reviewed-result")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == expected_status
    if expected_status == 200:
        assert response.json()["id"] == str(report_id)


def test_trial_photo_precheck_rejection_keeps_stored_original(monkeypatch) -> None:
    file = SimpleNamespace(
        file=BytesIO(TRIAL_JPEG_BYTES),
        filename="cat.jpg",
        content_type="image/jpeg",
    )
    stored = False

    def put(**kwargs) -> str:
        nonlocal stored
        stored = True
        return "test-bucket"

    def reject_after_storage(db, photo) -> None:
        assert stored is True
        photo.precheck_status = "rejected"
        photo.precheck_category = "OTHER"
        photo.precheck_reason = "图片主体与建筑外墙无关"
        photo.precheck_model = "guard-test"
        photo.precheck_error = None
        photo.precheck_attempts = 1
        photo.prechecked_at = datetime.now(UTC)

    monkeypatch.setattr(reports, "_enforce_trial_upload_limit", lambda *args: None)
    monkeypatch.setattr(reports, "run_stored_photo_precheck", reject_after_storage)
    monkeypatch.setattr(reports, "put_object", put)

    fake_db = UploadedPhotoDb([])
    uploaded = reports.upload_trial_photo(
        file=file,
        db=fake_db,
        current_user=_trial_customer(),
    )

    assert stored is True
    assert uploaded.precheck_status == "rejected"
    assert len(fake_db.photos) == 1


def test_trial_detection_rejects_request_containing_non_building_photo() -> None:
    passed = _uploaded_photo(UUID(int=30_001), filename="building.jpg")
    rejected = _uploaded_photo(UUID(int=30_002), filename="cat.jpg")
    rejected.precheck_status = "rejected"
    rejected.precheck_category = "OTHER"

    with pytest.raises(HTTPException) as raised:
        reports._quick_detection_photos_for_user(
            UploadedPhotoDb([passed, rejected]),
            _trial_customer(),
            [passed.id, rejected.id],
        )

    assert raised.value.status_code == 422
    assert "未执行检测" in raised.value.detail
    assert "cat.jpg" in raised.value.detail


def test_trial_detection_blocks_precheck_errors() -> None:
    failed = _uploaded_photo(UUID(int=30_003), filename="timeout.jpg")
    failed.precheck_status = "error"
    failed.precheck_error = "timeout"

    with pytest.raises(HTTPException) as raised:
        reports._quick_detection_photos_for_user(
            UploadedPhotoDb([failed]),
            _trial_customer(),
            [failed.id],
        )

    assert raised.value.status_code == 409
    assert "预检失败 1 张" in raised.value.detail


@pytest.mark.parametrize(
    ("existing_numbers", "expected"),
    [
        ([], "TRY-20260729-001"),
        (
            ["TRY-20260729-001", "TRY-20260729-009"],
            "TRY-20260729-010",
        ),
    ],
)
def test_trial_result_numbers_use_a_daily_three_digit_sequence(
    monkeypatch,
    existing_numbers: list[str],
    expected: str,
) -> None:
    db = UploadedPhotoDb([])
    db.result_numbers = existing_numbers
    monkeypatch.setattr(
        "app.api.reports._trial_result_number_date",
        lambda: "20260729",
    )

    assert reports._trial_result_no(db) == expected
    assert db.execute_count == 1


def test_trial_result_defaults_title_to_project_number() -> None:
    project_no = "TRY-20260729-001"

    assert reports._trial_report_title(None, project_no) == project_no
    assert reports._trial_report_title("  ", project_no) == project_no
    assert reports._trial_report_title(" 东立面检测结果 ", project_no) == "东立面检测结果"


def test_trial_result_title_can_be_updated_after_archiving() -> None:
    now = datetime.now(UTC)
    result = TrialDetectionResult(
        id=UUID("00000000-0000-0000-0000-000000000401"),
        result_no="TRY-202607150001",
        title="原报告名称",
        status="generated",
        report_data_json={
            "project": {},
            "summary": {},
            "photos": [],
            "defects": [],
            "raw_model_outputs": [],
        },
        photo_count=0,
        finding_count=0,
        thermal_available_photo_count=0,
        generated_by=_trial_customer().id,
        generated_at=now,
        created_at=now,
        updated_at=now,
    )
    app.dependency_overrides[get_current_user] = _trial_customer
    app.dependency_overrides[get_db] = lambda: RenamingTrialDb(result)
    try:
        response = client.patch(
            f"/api/reports/{result.id}",
            json={"title": "  修改后的报告名称  "},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["title"] == "修改后的报告名称"
    assert result.title == "修改后的报告名称"


def test_report_list_item_accepts_docx_phase_contract() -> None:
    payload = ReportListItem.model_validate(
        {
            "id": "00000000-0000-0000-0000-000000000101",
            "source_type": "formal",
            "project_id": "00000000-0000-0000-0000-000000000201",
            "detection_task_id": None,
            "report_no": "RPT-202606260001",
            "title": "外墙检测报告",
            "status": "pushed",
            "project_name": "科技园 A 座",
            "client_name": "示例委托单位",
            "address": "广州市天河区",
            "total_defects": 3,
            "photo_count": 8,
            "generated_at": "2026-06-26T10:00:00Z",
            "pushed_at": "2026-06-26T10:30:00Z",
            "updated_at": "2026-06-26T10:30:00Z",
        }
    )

    assert payload.status == "pushed"
    assert payload.total_defects == 3
    assert payload.photo_count == 8
    assert payload.source_type == "formal"


def test_report_list_item_accepts_trial_result_contract() -> None:
    payload = ReportListItem.model_validate(
        {
            "id": "00000000-0000-0000-0000-000000000301",
            "source_type": "trial",
            "project_id": None,
            "detection_task_id": None,
            "report_no": "TRY-202606300001",
            "title": "AI检测体验结果",
            "status": "generated",
            "project_name": "AI检测体验",
            "client_name": "体验用户",
            "address": "体验归档",
            "total_defects": 2,
            "photo_count": 2,
            "generated_at": "2026-06-30T10:00:00Z",
            "pushed_at": None,
            "updated_at": "2026-06-30T10:00:00Z",
        }
    )

    assert payload.source_type == "trial"
    assert payload.project_id is None
    assert payload.photo_count == 2


def test_customer_trial_report_list_is_limited_to_own_results() -> None:
    fake_db = CapturingReportDb()

    list_reports(db=fake_db, current_user=_trial_customer())

    assert len(fake_db.statements) == 1
    trial_result_query = str(fake_db.statements[0])
    assert "trial_detection_result.generated_by = :generated_by_1" in trial_result_query
    assert "inspection_report" not in trial_result_query


def test_reviewer_trial_report_list_is_limited_to_own_results() -> None:
    fake_db = CapturingReportDb()

    list_reports(db=fake_db, current_user=_reviewer())

    assert len(fake_db.statements) == 1
    trial_result_query = str(fake_db.statements[0])
    assert "trial_detection_result.generated_by = :generated_by_1" in trial_result_query
    assert "inspection_report" not in trial_result_query


def test_admin_trial_report_list_can_include_cross_user_results() -> None:
    fake_db = CapturingReportDb()

    list_reports(db=fake_db, current_user=_admin())

    assert len(fake_db.statements) == 1
    trial_result_query = str(fake_db.statements[0])
    assert "trial_detection_result.generated_by =" not in trial_result_query
    assert "inspection_report" not in trial_result_query


def test_trial_report_request_accepts_optional_report_name() -> None:
    payload = TrialReportRequest.model_validate(
        {
            "report_name": "东立面体验结果",
            "generated_at": "2026-06-30 10:00",
            "models": ["裂缝", "剥落"],
            "files": [{"filename": "trial-001.jpg", "size": 1200}],
            "findings": [{"filename": "trial-001.jpg", "model": "裂缝"}],
        }
    )

    assert payload.report_name == "东立面体验结果"


def test_trial_generated_result_can_feed_archive_contract() -> None:
    generated = TrialGeneratedResult.model_validate(
        {
            "report_name": "东立面体验结果",
            "generated_at": "2026-06-30T10:00:00+00:00",
            "models": ["裂缝", "剥落"],
            "files": [{"filename": "trial-001.jpg", "size": 1200}],
            "findings": [{"filename": "trial-001.jpg", "model": "裂缝"}],
            "raw_model_outputs": [
                {"filename": "trial-001.jpg", "task_duration_seconds": 12.345}
            ],
        }
    )

    archive_payload = TrialReportRequest.model_validate(generated.model_dump())

    assert archive_payload.generated_at == generated.generated_at
    assert archive_payload.findings[0].model == "裂缝"
    assert archive_payload.raw_model_outputs[0]["task_duration_seconds"] == 12.345


def test_trial_detection_result_can_append_a_later_detection_round() -> None:
    now = datetime.now(UTC)
    original_photo_id = UUID("00000000-0000-0000-0000-000000000911")
    added_photo_id = UUID("00000000-0000-0000-0000-000000000912")
    result = TrialDetectionResult(
        id=UUID("00000000-0000-0000-0000-000000000913"),
        result_no="TRY-202607160001",
        title="东立面检测结果",
        status="generated",
        report_data_json={
            "project": {},
            "summary": {
                "total_review_results": 1,
                "by_defect_type": {"crack": 1},
                "by_status": {"generated": 1},
                "photo_count": 1,
                "thermal_available_photo_count": 0,
            },
            "detection_config": {},
            "detection_task": {},
            "photos": [
                {
                    "id": str(original_photo_id),
                    "original_filename": "first.jpg",
                    "thermal_imaging_available": False,
                }
            ],
            "defects": [
                {
                    "id": "existing-defect",
                    "photo_id": str(original_photo_id),
                    "defect_type": "crack",
                    "status": "generated",
                }
            ],
            "raw_model_outputs": [{"photo_id": str(original_photo_id)}],
        },
        photo_count=1,
        finding_count=1,
        thermal_available_photo_count=0,
        generated_by=_trial_customer().id,
        generated_at=now,
        created_at=now,
        updated_at=now,
    )
    added_photo = _uploaded_photo(
        added_photo_id,
        filename="second.jpg",
        thermal_imaging_available=True,
    )
    request = TrialReportRequest.model_validate(
        {
            "report_name": "东立面检测结果",
            "generated_at": now.isoformat(),
            "models": ["裂缝", "剥落", "空鼓"],
            "files": [
                {"photo_id": str(added_photo_id), "filename": "second.jpg", "size": 1200}
            ],
            "findings": [
                {
                    "photo_id": str(added_photo_id),
                    "filename": "second.jpg",
                    "model": "空鼓",
                    "confidence": 0.87,
                    "bbox": {"x": 10, "y": 20, "width": 30, "height": 40},
                }
            ],
            "raw_model_outputs": [{"photo_id": str(added_photo_id)}],
        }
    )

    appended = _append_trial_detection_result(
        result=result,
        trial_request=request,
        stored_photos_source=[added_photo],
    )

    assert appended.id == result.id
    assert appended.photo_count == 2
    assert appended.finding_count == 2
    assert appended.thermal_available_photo_count == 1
    assert added_photo.generated_result_id == result.id
    assert [photo["id"] for photo in appended.report_data_json["photos"]] == [
        str(original_photo_id),
        str(added_photo_id),
    ]
    assert appended.report_data_json["defects"][0]["id"] == "existing-defect"
    assert appended.report_data_json["defects"][1]["photo_id"] == str(added_photo_id)
    assert appended.report_data_json["summary"]["by_defect_type"] == {"crack": 1, "hollow": 1}
    assert len(appended.report_data_json["raw_model_outputs"]) == 2


def test_trial_generate_endpoint_returns_preview_payload(monkeypatch) -> None:
    _mock_trial_inference(monkeypatch)
    response = _post_trial_generate(
        [("files", ("trial-001.jpg", TRIAL_JPEG_BYTES, "image/jpeg"))]
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["report_name"] == "东立面体验结果"
    assert payload["models"] == ["裂缝", "剥落"]
    assert payload["files"] == [{
        "photo_id": str(UUID(int=10_001)),
        "filename": "trial-001.jpg",
        "size": len(TRIAL_JPEG_BYTES),
    }]
    assert payload["findings"] == [
        {
            "photo_id": str(UUID(int=10_001)),
            "filename": "trial-001.jpg",
            "model": "剥落",
            "confidence": 0.67,
            "bbox": {"x": 100, "y": 50, "width": 240, "height": 80},
            "image_width": 1000,
            "image_height": 500,
            "detection_id": "det-1",
        }
    ]


def test_trial_generate_records_inference_usage_for_stored_photos(monkeypatch) -> None:
    _mock_trial_inference(
        monkeypatch,
        {
            "image": {"width": 1000, "height": 500},
            "inference": {"api_request_count": 3, "tile_count": 3},
            "token_usage": {
                "prompt_tokens": 1200,
                "completion_tokens": 45,
                "total_tokens": 1245,
            },
            "detections": [],
        },
    )
    photo = _uploaded_photo(UUID(int=20_001))
    photo.file_size = len(TRIAL_JPEG_BYTES)
    fake_db = UploadedPhotoDb([photo])
    app.dependency_overrides[get_current_user] = _trial_customer
    app.dependency_overrides[get_db] = lambda: fake_db
    monkeypatch.setattr(
        reports,
        "get_object_bytes",
        lambda *_: TRIAL_JPEG_BYTES,
    )
    try:
        response = client.post(
            "/api/trial/generate",
            json={
                "report_name": "存储原图结果",
                "models": ["裂缝"],
                "photo_ids": [str(photo.id)],
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert len(fake_db.usage_events) == 1
    event = fake_db.usage_events[0]
    assert event.event_type == "inference"
    assert event.source_type == "trial"
    assert event.photo_count == 1
    assert event.storage_bytes == 0
    assert event.api_request_count == 3
    assert event.input_token_count == 1200
    assert event.output_token_count == 45
    assert event.token_count == 1245
    assert event.trial_task_count == 1


def test_trial_generate_endpoint_preserves_legacy_corrosion_label(monkeypatch) -> None:
    _mock_trial_inference(
        monkeypatch,
        {
            "image": {"width": 1000, "height": 500},
            "inference": {"tile_count": 1},
            "token_usage": {
                "request_count": 1,
                "reported_request_count": 1,
                "prompt_tokens": 1100,
                "completion_tokens": 24,
                "total_tokens": 1124,
            },
            "tile_token_usages": [
                {
                    "tile_index": 1,
                    "x": 0,
                    "y": 0,
                    "valid_width": 1000,
                    "valid_height": 500,
                    "token_usage": {
                        "prompt_tokens": 1100,
                        "completion_tokens": 24,
                        "total_tokens": 1124,
                    },
                }
            ],
            "detections": [
                {
                    "id": "corrosion-1",
                    "type": "corrosion",
                    "type_name": "锈蚀",
                    "confidence": 0.81,
                    "bbox": {"x": 120, "y": 60, "width": 80, "height": 160},
                    "description": "金属连接件明显锈蚀",
                }
            ],
        },
    )

    response = _post_trial_generate(
        [("files", ("trial-rust.jpg", TRIAL_JPEG_BYTES, "image/jpeg"))]
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["findings"] == [
        {
            "photo_id": str(UUID(int=10_001)),
            "filename": "trial-rust.jpg",
            "model": "锈蚀",
            "confidence": 0.81,
            "bbox": {"x": 120, "y": 60, "width": 80, "height": 160},
            "image_width": 1000,
            "image_height": 500,
            "detection_id": "corrosion-1",
            "description": "金属连接件明显锈蚀",
        }
    ]
    assert payload["raw_model_outputs"][0]["detections"][0]["type"] == "corrosion"
    assert payload["raw_model_outputs"][0]["detections"][0]["model"] == "锈蚀"
    assert payload["raw_model_outputs"][0]["task_duration_seconds"] >= 0
    assert payload["raw_model_outputs"][0]["token_usage"]["total_tokens"] == 1124
    assert payload["raw_model_outputs"][0]["tile_token_usages"][0]["tile_index"] == 1


def test_trial_generate_endpoint_hides_findings_at_point_six(monkeypatch) -> None:
    _mock_trial_inference(
        monkeypatch,
        {
            "image": {"width": 1000, "height": 500},
            "detections": [
                {
                    "id": "det-low",
                    "type": "missing",
                    "confidence": 0.6,
                    "bbox": {"x": 100, "y": 50, "width": 240, "height": 80},
                }
            ],
        },
    )
    response = _post_trial_generate(
        [("files", ("trial-001.jpg", TRIAL_JPEG_BYTES, "image/jpeg"))]
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["findings"] == []
    assert payload["raw_model_outputs"][0]["detections"] == [
        {
            "detection_id": "det-low",
            "type": "spalling",
            "type_name": None,
            "model": "剥落",
            "confidence": 0.6,
            "bbox": {"x": 100, "y": 50, "width": 240, "height": 80},
            "severity": None,
            "description": None,
            "visible": False,
        }
    ]


def test_trial_generate_endpoint_accepts_uploaded_photo_ids(monkeypatch) -> None:
    captured_kwargs: dict = {}
    _mock_trial_inference(monkeypatch, captured_kwargs=captured_kwargs)
    monkeypatch.setattr(
        "app.api.reports.get_object_bytes",
        lambda bucket, object_key: TRIAL_JPEG_BYTES,
    )
    photo_id = UUID("00000000-0000-0000-0000-000000000901")
    photo = _uploaded_photo(photo_id)
    fake_db = UploadedPhotoDb([photo])
    app.dependency_overrides[get_current_user] = _trial_customer
    app.dependency_overrides[get_db] = lambda: fake_db
    try:
        response = client.post(
            "/api/trial/generate",
            json={
                "report_name": "东立面简易检测结果",
                "models": ["裂缝"],
                "photo_ids": [str(photo_id)],
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["archived_report_id"] == str(fake_db.trial_results[0].id)
    assert payload["archived_report_title"] == "东立面简易检测结果"
    assert photo.generated_result_id == fake_db.trial_results[0].id
    assert payload["models"] == ["裂缝"]
    assert captured_kwargs["visible_defect_types"] == ["crack"]
    assert "type：只能是 crack" in captured_kwargs["visible_prompt"]
    assert payload["files"] == [{"photo_id": str(photo_id), "filename": "quick-001.jpg", "size": 1200}]
    assert payload["findings"] == [
        {
            "photo_id": str(photo_id),
            "filename": "quick-001.jpg",
            "model": "剥落",
            "confidence": 0.67,
            "bbox": {"x": 100, "y": 50, "width": 240, "height": 80},
            "image_width": 1000,
            "image_height": 500,
            "detection_id": "det-1",
        }
    ]


def test_trial_generate_endpoint_appends_to_archived_result(monkeypatch) -> None:
    _mock_trial_inference(monkeypatch)
    monkeypatch.setattr(
        "app.api.reports.get_object_bytes",
        lambda bucket, object_key: TRIAL_JPEG_BYTES,
    )
    now = datetime.now(UTC)
    result = TrialDetectionResult(
        id=UUID("00000000-0000-0000-0000-000000000921"),
        result_no="TRY-202607160002",
        title="东立面简易检测结果",
        status="generated",
        report_data_json={
            "project": {},
            "summary": {"photo_count": 1, "total_review_results": 0},
            "detection_config": {},
            "detection_task": {},
            "photos": [
                {
                    "id": "00000000-0000-0000-0000-000000000922",
                    "original_filename": "first.jpg",
                    "thermal_imaging_available": False,
                }
            ],
            "defects": [],
            "raw_model_outputs": [],
        },
        photo_count=1,
        finding_count=0,
        thermal_available_photo_count=0,
        generated_by=_trial_customer().id,
        generated_at=now,
        created_at=now,
        updated_at=now,
    )
    photo_id = UUID("00000000-0000-0000-0000-000000000923")
    photo = _uploaded_photo(photo_id, filename="second.jpg")
    fake_db = AppendingTrialDb([photo], result)
    app.dependency_overrides[get_current_user] = _trial_customer
    app.dependency_overrides[get_db] = lambda: fake_db
    try:
        response = client.post(
            "/api/trial/generate",
            json={
                "report_name": result.title,
                "photo_ids": [str(photo_id)],
                "archived_report_id": str(result.id),
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["archived_report_id"] == str(result.id)
    assert fake_db.trial_results == []
    assert result.photo_count == 2
    assert result.finding_count == 1
    assert photo.generated_result_id == result.id
    assert [item["original_filename"] for item in result.report_data_json["photos"]] == [
        "first.jpg",
        "second.jpg",
    ]


@pytest.mark.parametrize(
    "selected_models",
    [
        ["空鼓"],
        ["裂缝", "剥落", "空鼓"],
    ],
    ids=["hollow-only", "all-selected"],
)
def test_trial_generate_routes_thermal_photo_to_hollow_only_inference(
    monkeypatch,
    selected_models: list[str],
) -> None:
    _mock_trial_inference(monkeypatch)
    monkeypatch.setattr(
        "app.api.reports.get_object_bytes",
        lambda bucket, object_key: TRIAL_JPEG_BYTES,
    )
    captured_images = []

    async def fake_thermal_inference(images, **kwargs):
        captured_images.extend(images)
        return [
            {
                "image": {"width": 1280, "height": 1024},
                "requested_models": ["hollow"],
                "executed_models": ["qwen3-vl-plus"],
                "detections": [
                    {
                        "id": "crack-ignored",
                        "type": "crack",
                        "confidence": 0.91,
                        "bbox": {"x": 100, "y": 100, "width": 100, "height": 80},
                        "description": "不应保留的裂缝",
                    },
                    {
                        "id": "spalling-ignored",
                        "type": "spalling",
                        "confidence": 0.89,
                        "bbox": {"x": 300, "y": 100, "width": 120, "height": 90},
                        "description": "不应保留的剥落",
                    },
                    {
                        "id": "hollow-1",
                        "type": "hollow",
                        "type_name": "空鼓",
                        "confidence": 0.86,
                        "bbox": {"x": 555, "y": 188, "width": 145, "height": 86},
                        "description": "疑似墙面空鼓",
                    }
                ],
            }
            for _ in images
        ]

    monkeypatch.setattr("app.api.reports.infer_trial_images", fake_thermal_inference)
    photo_id = UUID("00000000-0000-0000-0000-000000000902")
    app.dependency_overrides[get_current_user] = _trial_customer
    app.dependency_overrides[get_db] = lambda: UploadedPhotoDb(
        [_uploaded_photo(photo_id, filename="thermal.JPG", thermal_imaging_available=True)]
    )
    try:
        response = client.post(
            "/api/trial/generate",
            json={
                "models": selected_models,
                "photo_ids": [str(photo_id)],
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert len(captured_images) == 1
    assert captured_images[0].thermal_imaging_available is True
    payload = response.json()
    assert payload["models"] == selected_models
    assert payload["findings"] == [
        {
            "photo_id": str(photo_id),
            "filename": "thermal.JPG",
            "model": "空鼓",
            "confidence": 0.86,
            "bbox": {"x": 555, "y": 188, "width": 145, "height": 86},
            "image_width": 1280,
            "image_height": 1024,
            "detection_id": "hollow-1",
            "description": "疑似墙面空鼓",
        }
    ]
    assert payload["raw_model_outputs"][0]["requested_models"] == ["空鼓"]
    assert [item["type"] for item in payload["raw_model_outputs"][0]["detections"]] == ["hollow"]
    assert payload["raw_model_outputs"][0]["detections"][0]["model"] == "空鼓"


@pytest.mark.parametrize(
    ("thermal_imaging_available", "models", "expected_message"),
    [
        (
            True,
            ["裂缝", "剥落"],
            "热成像图片只执行空鼓检测，请勾选空鼓或移除热成像图片。",
        ),
        (
            False,
            ["空鼓"],
            "可见光图片只执行裂缝或剥落检测，请至少勾选其中一项或移除可见光图片。",
        ),
    ],
    ids=["thermal-without-hollow", "visible-with-hollow-only"],
)
def test_trial_generate_rejects_incompatible_photo_and_model_selection(
    thermal_imaging_available: bool,
    models: list[str],
    expected_message: str,
) -> None:
    photo_id = UUID("00000000-0000-0000-0000-000000000903")
    app.dependency_overrides[get_current_user] = _trial_customer
    app.dependency_overrides[get_db] = lambda: UploadedPhotoDb(
        [
            _uploaded_photo(
                photo_id,
                filename="thermal.JPG" if thermal_imaging_available else "visible.jpg",
                thermal_imaging_available=thermal_imaging_available,
            )
        ]
    )
    try:
        response = client.post(
            "/api/trial/generate",
            json={
                "models": models,
                "photo_ids": [str(photo_id)],
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400
    assert response.json()["message"] == expected_message


def test_trial_generate_endpoint_requires_configured_inference_service(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.api.reports.get_settings",
        lambda: SimpleNamespace(
            dashscope_api_key="",
            qwen_api_base_url="https://qwen.test/compatible-mode/v1",
            qwen_model="qwen3-vl-plus",
            qwen_request_timeout_seconds=120,
            qwen_max_concurrency=5,
        ),
    )

    response = _post_trial_generate(
        [("files", ("trial-001.jpg", TRIAL_JPEG_BYTES, "image/jpeg"))]
    )

    assert response.status_code == 503
    assert response.json()["message"] == "视觉检测服务暂时不可用，请稍后重试。"


def test_trial_result_archive_accepts_generated_photo_ids() -> None:
    photo_id = UUID("00000000-0000-0000-0000-000000000902")
    payload = {
        "report_name": "东立面简易检测结果",
        "generated_at": "2026-06-30T10:00:00+00:00",
        "models": ["裂缝"],
        "files": [{"photo_id": str(photo_id), "filename": "quick-001.jpg", "size": 1200}],
        "findings": [
            {
                "photo_id": str(photo_id),
                "filename": "quick-001.jpg",
                "model": "裂缝",
                "confidence": 0.67,
            },
            {
                "photo_id": str(photo_id),
                "filename": "quick-001.jpg",
                "model": "剥落",
                "confidence": 0.6,
            },
        ],
    }
    fake_db = ArchivingTrialDb([])
    fake_db.photos = [TrackingUploadedPhoto(photo_id, fake_db)]

    result = run(
        create_trial_result(
            JsonTrialRequest(payload),
            db=fake_db,
            current_user=_trial_customer(),
        )
    )

    assert result.source_type == "trial"
    assert result.photos[0]["id"] == str(photo_id)
    assert len(result.defects) == 1
    assert result.defects[0]["raw_result_json"]["finding"]["photo_id"] == str(photo_id)


def test_trial_generate_requires_login() -> None:
    response = client.post(
        "/api/trial/generate",
        data={"payload": '{"models":["裂缝"]}'},
        files=[("files", ("trial-001.jpg", TRIAL_JPEG_BYTES, "image/jpeg"))],
    )

    assert response.status_code == 401


def test_trial_generate_rejects_non_jpeg_or_png_uploads() -> None:
    response = _post_trial_photo("trial-001.webp", b"RIFFfake-webp", "image/webp")

    assert response.status_code == 400
    assert response.json()["message"] == "仅支持 JPG、PNG 图片。"


def test_trial_generate_rejects_mismatched_image_content() -> None:
    response = _post_trial_photo("trial-001.jpg", b"fake-image", "image/jpeg")

    assert response.status_code == 400
    assert response.json()["message"] == "图片格式与文件内容不匹配。"


def test_trial_generate_rejects_more_than_thirty_files() -> None:
    response = _post_trial_generate(
        [
            ("files", (f"trial-{index:03d}.png", TRIAL_PNG_BYTES, "image/png"))
            for index in range(31)
        ]
    )

    assert response.status_code == 400
    assert response.json()["message"] == "单次最多上传 30 张照片。"


def test_trial_generate_rejects_more_than_thirty_uploaded_photo_ids() -> None:
    app.dependency_overrides[get_current_user] = _trial_customer
    app.dependency_overrides[get_db] = lambda: UploadedPhotoDb([])
    try:
        response = client.post(
            "/api/trial/generate",
            json={
                "models": ["裂缝", "剥落"],
                "photo_ids": [str(UUID(int=index + 1)) for index in range(31)],
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400
    assert response.json()["message"] == "单次最多上传 30 张照片。"


def test_trial_upload_rate_limit_allows_thirty_per_ten_minutes(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.api.reports.get_settings",
        lambda: SimpleNamespace(
            trial_upload_limit_per_user=30,
            trial_upload_window_seconds=600,
        ),
    )

    for _ in range(30):
        _enforce_trial_upload_limit(_trial_customer())

    with raises(HTTPException) as raised:
        _enforce_trial_upload_limit(_trial_customer())

    assert raised.value.status_code == 429
    assert raised.value.detail == "照片上传过于频繁，请稍后重试。"


def test_trial_generate_rate_limit_allows_five_per_ten_minutes(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.api.reports.get_settings",
        lambda: SimpleNamespace(
            trial_generate_limit_per_user=5,
            trial_generate_window_seconds=600,
            trial_daily_api_request_limit=800,
            trial_job_lock_seconds=900,
            trial_global_job_concurrency=4,
        ),
    )

    for _ in range(5):
        reservation = _reserve_trial_usage(_trial_customer(), api_request_count=1)
        reservation.release(successful=True, actual_api_request_count=1)

    with raises(HTTPException) as raised:
        _reserve_trial_usage(_trial_customer(), api_request_count=1)

    assert raised.value.status_code == 429
    assert raised.value.detail == "免费版每 10 分钟最多可试用 3 次，请 10 分钟后再试。"


def test_trial_daily_api_request_limit_is_reserved_and_reconciled() -> None:
    first = _reserve_trial_usage(_trial_customer(), api_request_count=800)
    first.release(successful=True, actual_api_request_count=400)

    second = _reserve_trial_usage(_trial_customer(), api_request_count=400)
    second.release(successful=True, actual_api_request_count=400)

    with raises(HTTPException) as raised:
        _reserve_trial_usage(_trial_customer(), api_request_count=1)

    assert raised.value.status_code == 429
    assert raised.value.detail == "每位用户每天最多使用 800 次模型 API 请求。"


def test_trial_failed_inference_refunds_reserved_api_requests() -> None:
    failed = _reserve_trial_usage(_trial_customer(), api_request_count=800)
    failed.release(successful=False)

    retried = _reserve_trial_usage(_trial_customer(), api_request_count=800)
    retried.release(successful=True, actual_api_request_count=800)


def test_trial_generate_rejects_files_larger_than_five_mb() -> None:
    oversized_jpeg = b"\xff\xd8\xff" + (b"0" * (5 * 1024 * 1024))
    response = _post_trial_photo("trial-oversized.jpg", oversized_jpeg, "image/jpeg")

    assert response.status_code == 400
    assert response.json()["message"] == "单张图片最大 5MB。"


def test_trial_photo_metadata_detects_thermal_available() -> None:
    metadata = extract_photo_metadata_from_bytes(
        _jpeg_with_metadata(image_source="InfraredCamera", image_description="IronRed")
    )

    assert metadata["xmp_drone_dji_image_source"] == "InfraredCamera"
    assert metadata["ifd0_image_description"] == "IronRed"
    assert metadata["thermal_imaging_available"] is True


def test_trial_photo_metadata_requires_both_thermal_markers() -> None:
    metadata = extract_photo_metadata_from_bytes(
        _jpeg_with_metadata(image_source="InfraredCamera", image_description="Visible")
    )

    assert metadata["thermal_imaging_available"] is False


def test_docx_report_builder_creates_valid_package() -> None:
    content = build_report_docx(
        "示例外墙检测报告",
        "RPT-202606260001",
        {
            "project": {"name": "科技园 A 座", "client_name": "示例委托单位"},
            "summary": {
                "total_review_results": 2,
                "by_defect_type": {"crack": 1, "corrosion": 1},
            },
            "defects": [
                {
                    "defect_type": "crack",
                    "status": "confirmed",
                    "photo_filename": "facade-001.jpg",
                    "bbox_json": {"x": 10, "y": 20, "width": 100, "height": 80},
                }
            ],
        },
    )

    with ZipFile(BytesIO(content)) as package:
        assert "[Content_Types].xml" in package.namelist()
        assert "word/document.xml" in package.namelist()
        assert "word/media/image1.png" in package.namelist()
        document = package.read("word/document.xml").decode("utf-8")
        core_properties = package.read("docProps/core.xml").decode("utf-8")

    assert "科技园 A 座-外立面表观病害筛查简报" in document
    assert "RPT-202606260001" in core_properties
    assert "经对巡检结果进行空间定位与尺度估算" in document
    assert "与面积" not in document
    assert "可见光图像" in document
    assert "热红外图像" in document
    assert "facade-001.jpg" in document
    assert "疑似裂缝: 1处" in document


def _jpeg_with_metadata(*, image_source: str, image_description: str) -> bytes:
    xmp = (
        b"http://ns.adobe.com/xap/1.0/\x00"
        + f'<rdf:Description drone-dji:ImageSource="{image_source}" />'.encode()
    )
    return b"\xff\xd8" + _app1_segment(b"Exif\x00\x00" + _tiff_with_image_description(image_description)) + _app1_segment(xmp) + b"\xff\xd9"


def _app1_segment(payload: bytes) -> bytes:
    return b"\xff\xe1" + (len(payload) + 2).to_bytes(2, "big") + payload


def _tiff_with_image_description(value: str) -> bytes:
    description = value.encode() + b"\x00"
    value_offset = 8 + 2 + 12 + 4
    entry = (
        (0x010E).to_bytes(2, "little")
        + (2).to_bytes(2, "little")
        + len(description).to_bytes(4, "little")
        + value_offset.to_bytes(4, "little")
    )
    return b"II*\x00\x08\x00\x00\x00" + (1).to_bytes(2, "little") + entry + b"\x00\x00\x00\x00" + description
