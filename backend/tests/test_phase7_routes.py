from asyncio import run
from io import BytesIO
from json import dumps
from types import SimpleNamespace
from uuid import UUID
from zipfile import ZipFile

from fastapi.testclient import TestClient

from app.api.dependencies import AuthenticatedUser, get_current_user
from app.api.reports import create_trial_result, list_reports
from app.db.session import get_db
from app.enums.status import UserRole
from app.main import app
from app.models.tables import QuickDetectionPhoto
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

    def scalars(self, statement: object) -> UploadedPhotoScalars:
        return UploadedPhotoScalars(self.photos)


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
    app.dependency_overrides[get_current_user] = _trial_customer
    try:
        return client.post(
            "/api/trial/generate",
            data={"payload": '{"report_name":"东立面体验结果","models":["裂缝","面砖剥落"]}'},
            files=files,
        )
    finally:
        app.dependency_overrides.clear()


class FakeInferenceResponse:
    def __init__(self, payload: dict) -> None:
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def read(self) -> bytes:
        return dumps(self.payload).encode("utf-8")


def _mock_trial_inference(monkeypatch, payload: dict | None = None) -> None:
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
            trial_algorithm_inference_url="http://trial-model.local",
            trial_algorithm_inference_timeout_seconds=120,
        ),
    )
    monkeypatch.setattr(
        "app.api.reports.urlopen",
        lambda request, timeout: FakeInferenceResponse(inference_payload),
    )


def _uploaded_photo(photo_id: UUID, *, filename: str = "quick-001.jpg") -> QuickDetectionPhoto:
    return QuickDetectionPhoto(
        id=photo_id,
        original_filename=filename,
        file_size=1200,
        mime_type="image/jpeg",
        storage_bucket="building-exterior",
        storage_object_key=f"quick-detection/{photo_id}.jpg",
        metadata_json={"thermal_imaging_available": False},
        thermal_imaging_available=False,
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
    assert "/api/reports/{report_id}" in paths
    assert "/api/reports/{report_id}/push" in paths
    assert "/api/reports/{report_id}/docx" in paths
    assert "/api/trial/photos" in paths
    assert "/api/trial/photos/{photo_id}" in paths
    assert "/api/trial/generate" in paths
    assert "/api/trial/results" in paths
    assert "/api/trial/report/docx" not in paths
    assert "DELETE" in report_detail_methods


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
            "generated_at": "2026-06-26T10:00:00Z",
            "pushed_at": "2026-06-26T10:30:00Z",
            "updated_at": "2026-06-26T10:30:00Z",
        }
    )

    assert payload.status == "pushed"
    assert payload.total_defects == 3
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
            "generated_at": "2026-06-30T10:00:00Z",
            "pushed_at": None,
            "updated_at": "2026-06-30T10:00:00Z",
        }
    )

    assert payload.source_type == "trial"
    assert payload.project_id is None


def test_customer_report_list_is_limited_to_own_formal_and_trial_results() -> None:
    fake_db = CapturingReportDb()

    list_reports(db=fake_db, current_user=_trial_customer())

    formal_report_query, trial_result_query = [str(statement) for statement in fake_db.statements]
    assert "project.created_by = :created_by_1" in formal_report_query
    assert "trial_detection_result.generated_by = :generated_by_1" in trial_result_query


def test_reviewer_and_admin_report_list_can_include_cross_user_results() -> None:
    for user in (_reviewer(), _admin()):
        fake_db = CapturingReportDb()

        list_reports(db=fake_db, current_user=user)

        formal_report_query, trial_result_query = [str(statement) for statement in fake_db.statements]
        assert "project.created_by =" not in formal_report_query
        assert "trial_detection_result.generated_by =" not in trial_result_query


def test_trial_report_request_accepts_optional_report_name() -> None:
    payload = TrialReportRequest.model_validate(
        {
            "report_name": "东立面体验结果",
            "generated_at": "2026-06-30 10:00",
            "models": ["裂缝", "面砖剥落"],
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
            "models": ["裂缝", "面砖剥落"],
            "files": [{"filename": "trial-001.jpg", "size": 1200}],
            "findings": [{"filename": "trial-001.jpg", "model": "裂缝"}],
        }
    )

    archive_payload = TrialReportRequest.model_validate(generated.model_dump())

    assert archive_payload.generated_at == generated.generated_at
    assert archive_payload.findings[0].model == "裂缝"


def test_trial_generate_endpoint_returns_preview_payload(monkeypatch) -> None:
    _mock_trial_inference(monkeypatch)
    response = _post_trial_generate(
        [("files", ("trial-001.jpg", TRIAL_JPEG_BYTES, "image/jpeg"))]
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["report_name"] == "东立面体验结果"
    assert payload["models"] == ["裂缝", "面砖剥落"]
    assert payload["files"] == [{"filename": "trial-001.jpg", "size": len(TRIAL_JPEG_BYTES)}]
    assert payload["findings"] == [
        {
            "filename": "trial-001.jpg",
            "model": "面砖剥落",
            "confidence": 0.67,
            "bbox": {"x": 100, "y": 50, "width": 240, "height": 80},
            "image_width": 1000,
            "image_height": 500,
            "detection_id": "det-1",
        }
    ]


def test_trial_generate_endpoint_hides_low_confidence_findings(monkeypatch) -> None:
    _mock_trial_inference(
        monkeypatch,
        {
            "image": {"width": 1000, "height": 500},
            "detections": [
                {
                    "id": "det-low",
                    "type": "missing",
                    "confidence": 0.59,
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
            "type": "missing",
            "type_name": None,
            "model": "面砖剥落",
            "confidence": 0.59,
            "bbox": {"x": 100, "y": 50, "width": 240, "height": 80},
            "severity": None,
            "description": None,
            "visible": False,
        }
    ]


def test_trial_generate_endpoint_accepts_uploaded_photo_ids(monkeypatch) -> None:
    _mock_trial_inference(monkeypatch)
    monkeypatch.setattr(
        "app.api.reports.get_object_bytes",
        lambda bucket, object_key: TRIAL_JPEG_BYTES,
    )
    photo_id = UUID("00000000-0000-0000-0000-000000000901")
    app.dependency_overrides[get_current_user] = _trial_customer
    app.dependency_overrides[get_db] = lambda: UploadedPhotoDb([_uploaded_photo(photo_id)])
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
    assert payload["files"] == [{"photo_id": str(photo_id), "filename": "quick-001.jpg", "size": 1200}]
    assert payload["findings"] == [
        {
            "photo_id": str(photo_id),
            "filename": "quick-001.jpg",
            "model": "面砖剥落",
            "confidence": 0.67,
            "bbox": {"x": 100, "y": 50, "width": 240, "height": 80},
            "image_width": 1000,
            "image_height": 500,
            "detection_id": "det-1",
        }
    ]


def test_trial_generate_endpoint_requires_configured_inference_service(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.api.reports.get_settings",
        lambda: SimpleNamespace(
            trial_algorithm_inference_url="",
            trial_algorithm_inference_timeout_seconds=120,
        ),
    )

    response = _post_trial_generate(
        [("files", ("trial-001.jpg", TRIAL_JPEG_BYTES, "image/jpeg"))]
    )

    assert response.status_code == 503
    assert "TRIAL_ALGORITHM_INFERENCE_URL" in response.json()["message"]


def test_trial_result_archive_accepts_generated_photo_ids() -> None:
    photo_id = UUID("00000000-0000-0000-0000-000000000902")
    payload = {
        "report_name": "东立面简易检测结果",
        "generated_at": "2026-06-30T10:00:00+00:00",
        "models": ["裂缝"],
        "files": [{"photo_id": str(photo_id), "filename": "quick-001.jpg", "size": 1200}],
        "findings": [{"photo_id": str(photo_id), "filename": "quick-001.jpg", "model": "裂缝"}],
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
    assert result.defects[0]["raw_result_json"]["finding"]["photo_id"] == str(photo_id)


def test_trial_generate_requires_login() -> None:
    response = client.post(
        "/api/trial/generate",
        data={"payload": '{"models":["裂缝"]}'},
        files=[("files", ("trial-001.jpg", TRIAL_JPEG_BYTES, "image/jpeg"))],
    )

    assert response.status_code == 401


def test_trial_generate_rejects_non_jpeg_or_png_uploads() -> None:
    response = _post_trial_generate(
        [("files", ("trial-001.webp", b"RIFFfake-webp", "image/webp"))]
    )

    assert response.status_code == 400
    assert response.json()["message"] == "仅支持 JPG、PNG 图片。"


def test_trial_generate_rejects_mismatched_image_content() -> None:
    response = _post_trial_generate(
        [("files", ("trial-001.jpg", b"fake-image", "image/jpeg"))]
    )

    assert response.status_code == 400
    assert response.json()["message"] == "图片格式与文件内容不匹配。"


def test_trial_generate_rejects_more_than_twenty_files() -> None:
    response = _post_trial_generate(
        [
            ("files", (f"trial-{index:03d}.png", TRIAL_PNG_BYTES, "image/png"))
            for index in range(21)
        ]
    )

    assert response.status_code == 400
    assert response.json()["message"] == "单次最多上传 20 张照片。"


def test_trial_generate_rejects_files_larger_than_twenty_mb() -> None:
    oversized_jpeg = b"\xff\xd8\xff" + (b"0" * (20 * 1024 * 1024 - 2))
    response = _post_trial_generate(
        [("files", ("trial-oversized.jpg", oversized_jpeg, "image/jpeg"))]
    )

    assert response.status_code == 400
    assert response.json()["message"] == "单张图片最大 20MB。"


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
            "summary": {"total_review_results": 1, "by_defect_type": {"crack": 1}},
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
        document = package.read("word/document.xml").decode("utf-8")

    assert "示例外墙检测报告" in document
    assert "RPT-202606260001" in document
    assert "facade-001.jpg" in document


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
