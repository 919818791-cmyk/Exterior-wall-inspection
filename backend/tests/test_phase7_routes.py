from io import BytesIO
from zipfile import ZipFile

from app.main import app
from app.schemas.phase7 import ReportListItem
from app.services.docx_report import build_report_docx, build_trial_report_docx


def test_phase7_report_routes_are_registered() -> None:
    paths = {route.path for route in app.routes}

    assert "/api/reports" in paths
    assert "/api/reports/{report_id}" in paths
    assert "/api/reports/{report_id}/push" in paths
    assert "/api/reports/{report_id}/docx" in paths
    assert "/api/trial/report/docx" in paths


def test_report_list_item_accepts_docx_phase_contract() -> None:
    payload = ReportListItem.model_validate(
        {
            "id": "00000000-0000-0000-0000-000000000101",
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


def test_trial_docx_report_builder_uses_simple_contract() -> None:
    content = build_trial_report_docx(
        {
            "generated_at": "2026-06-26 12:00",
            "models": ["裂缝", "剥落"],
            "files": [{"filename": "trial-001.jpg", "size": 1200}],
            "findings": [{"filename": "trial-001.jpg", "model": "裂缝", "confidence": "88%"}],
        }
    )

    with ZipFile(BytesIO(content)) as package:
        assert "word/document.xml" in package.namelist()
        document = package.read("word/document.xml").decode("utf-8")

    assert "简易试用报告" in document
    assert "trial-001.jpg" in document
    assert "裂缝" in document
