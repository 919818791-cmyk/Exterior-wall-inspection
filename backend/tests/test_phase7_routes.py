from io import BytesIO
from uuid import UUID
from zipfile import ZipFile

from fastapi.testclient import TestClient

from app.api.dependencies import AuthenticatedUser, get_current_user
from app.enums.status import UserRole
from app.main import app
from app.schemas.phase7 import ReportListItem, TrialGeneratedResult, TrialReportRequest
from app.services.docx_report import build_report_docx
from app.services.photo_metadata import extract_photo_metadata_from_bytes

client = TestClient(app)
TRIAL_JPEG_BYTES = b"\xff\xd8\xff\xe0fake-image\xff\xd9"
TRIAL_PNG_BYTES = b"\x89PNG\r\n\x1a\nfake-image"


def _trial_customer() -> AuthenticatedUser:
    return AuthenticatedUser(
        id=UUID("00000000-0000-0000-0000-000000000001"),
        username="customer",
        real_name="演示客户",
        role=UserRole.CUSTOMER.value,
        organization="示例委托单位",
    )


def _post_trial_generate(files: list[tuple[str, tuple[str, bytes, str]]]):
    app.dependency_overrides[get_current_user] = _trial_customer
    try:
        return client.post(
            "/api/trial/generate",
            data={"payload": '{"report_name":"东立面体验结果","models":["裂缝","剥落"]}'},
            files=files,
        )
    finally:
        app.dependency_overrides.clear()


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
        }
    )

    archive_payload = TrialReportRequest.model_validate(generated.model_dump())

    assert archive_payload.generated_at == generated.generated_at
    assert archive_payload.findings[0].model == "裂缝"


def test_trial_generate_endpoint_returns_preview_payload() -> None:
    response = _post_trial_generate(
        [("files", ("trial-001.jpg", TRIAL_JPEG_BYTES, "image/jpeg"))]
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["report_name"] == "东立面体验结果"
    assert payload["models"] == ["裂缝", "剥落"]
    assert payload["files"] == [{"filename": "trial-001.jpg", "size": len(TRIAL_JPEG_BYTES)}]
    assert payload["findings"][0]["filename"] == "trial-001.jpg"
    assert "confidence" not in payload["findings"][0]


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


def test_trial_photo_metadata_detects_hollow_thermal_available() -> None:
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
