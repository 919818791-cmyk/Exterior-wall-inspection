from __future__ import annotations

from io import BytesIO

from PIL import Image

from app.main import app
from app.services.trial_pdf_report import (
    WATERMARK_TEXT,
    _annotated_original,
    _description,
    build_trial_result_pdf,
)


def _source_image_bytes(size: tuple[int, int] = (1200, 800)) -> bytes:
    image = Image.new("RGB", size, "#D9E2EC")
    output = BytesIO()
    image.save(output, format="JPEG", quality=97)
    return output.getvalue()


def _report_data() -> dict:
    return {
        "photos": [
            {
                "id": "photo-1",
                "original_filename": "东立面原图.jpg",
                "storage_bucket": "inspection",
                "storage_object_key": "originals/east.jpg",
            }
        ],
        "defects": [
            {
                "photo_id": "photo-1",
                "defect_type": "crack",
                "bbox_json": {"x": 120, "y": 80, "width": 300, "height": 200},
                "raw_result_json": {"finding": {"image_width": 1200, "image_height": 800}},
            }
        ],
    }


def test_trial_pdf_route_is_registered() -> None:
    assert "/api/reports/{report_id}/pdf" in {route.path for route in app.routes}


def test_annotated_export_keeps_original_pixel_dimensions() -> None:
    annotated = _annotated_original(_source_image_bytes(), _report_data()["defects"])
    with Image.open(annotated) as image:
        assert image.size == (1200, 800)
        assert image.format == "PNG"
        assert image.getpixel((120, 80))[0] > 180
        # The bottom-right watermark changes the otherwise uniform source pixels.
        assert image.getpixel((1100, 750)) != (217, 226, 236)


def test_pdf_uses_original_object_and_contains_three_column_labels() -> None:
    original = _source_image_bytes()
    reads: list[tuple[str, str]] = []

    def read_object(bucket: str, object_key: str) -> bytes:
        reads.append((bucket, object_key))
        return original

    pdf = build_trial_result_pdf(
        report_title="东立面检测结果",
        report_no="TRY-001",
        generated_at="2026-07-17 15:30:00",
        report_data=_report_data(),
        read_object=read_object,
    )

    assert reads == [("inspection", "originals/east.jpg")]
    assert pdf.startswith(b"%PDF-")
    assert len(pdf) > len(original)
    assert WATERMARK_TEXT == "建筑外墙巡检智能报告平台（试用版本）"


def test_pdf_description_uses_the_page_defect_colors() -> None:
    description = _description([
        {"defect_type": "crack"},
        {"defect_type": "spalling"},
        {"defect_type": "hollow"},
    ])

    assert '<font color="#DC2626">疑似裂缝: 1处</font>' in description
    assert '<font color="#F97316">疑似剥落: 1处</font>' in description
    assert '<font color="#245CFF">疑似空鼓: 1处</font>' in description
