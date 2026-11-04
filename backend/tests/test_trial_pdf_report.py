from __future__ import annotations

from io import BytesIO
from math import floor

import pytest
from PIL import Image
from reportlab.lib.units import mm

from app.main import app
from app.services.trial_pdf_report import (
    WATERMARK_TEXT,
    PDF_IMAGE_DPI,
    TrialPdfExportError,
    _annotated_pdf_image,
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


def _export_image(original: bytes, defects: list[dict]) -> BytesIO:
    return _annotated_pdf_image(
        original, defects, max_width=177 * mm, max_height=135 * mm,
    )


def test_annotated_export_keeps_small_images_and_annotations() -> None:
    annotated = _export_image(_source_image_bytes(), _report_data()["defects"])
    with Image.open(annotated) as image:
        assert image.size == (1200, 800)
        assert image.format == "JPEG"
        red, green, blue = image.getpixel((120, 80))
        assert red > green + 80 and red > blue + 80
        # The bottom-right watermark changes the otherwise uniform source pixels.
        assert max(image.getpixel((1100, 750))) < 200


@pytest.mark.parametrize("size", [(4032, 3024), (3024, 4032)])
@pytest.mark.parametrize("normalized", [False, True])
def test_large_export_fits_print_resolution_and_preserves_box_coordinates(
    size: tuple[int, int], normalized: bool,
) -> None:
    original = _source_image_bytes(size)
    x, y, width, height = 0.25, 0.3, 0.2, 0.25
    defect = {
        "defect_type": "crack",
        "bbox_json": {
            "x": x if normalized else x * size[0],
            "y": y if normalized else y * size[1],
            "width": width if normalized else width * size[0],
            "height": height if normalized else height * size[1],
        },
    }
    exported = _export_image(original, [defect])
    with Image.open(exported) as image:
        assert image.width <= round(177 / 25.4 * PDF_IMAGE_DPI)
        assert image.height <= round(135 / 25.4 * PDF_IMAGE_DPI)
        assert abs(image.width / image.height - size[0] / size[1]) < 0.002
        # A point just inside the left border must remain red after resampling.
        pixel = (floor(x * image.width) + 2, round((y + height / 2) * image.height))
        red, green, blue = image.getpixel(pixel)
        assert red > green + 80 and red > blue + 80
    with Image.open(BytesIO(original)) as image:
        assert image.size == size


def test_export_applies_exif_orientation_before_fitting_image() -> None:
    image = Image.new("RGB", (3000, 2000), "#D9E2EC")
    exif = Image.Exif()
    exif[274] = 6
    original = BytesIO()
    image.save(original, format="JPEG", exif=exif)
    with Image.open(_export_image(original.getvalue(), [])) as exported:
        assert exported.height == round(135 / 25.4 * PDF_IMAGE_DPI)
        assert abs(exported.width / exported.height - 2 / 3) < 0.002
        assert exported.getexif().get(274) is None


def test_export_rejects_unreadable_source() -> None:
    with pytest.raises(TrialPdfExportError, match="原始照片无法读取"):
        _export_image(b"not an image", [])


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
    assert b"/DCTDecode" in pdf
    assert WATERMARK_TEXT == "外墙智能巡检平台-快速体验"


def test_four_textured_photos_have_bounded_pdf_size() -> None:
    image = Image.effect_noise((4032, 3024), 48).convert("RGB")
    originals: dict[str, bytes] = {}
    for index in range(4):
        # Distinct photos prevent PDF image deduplication from masking growth.
        image.paste((index * 60, 30, 90), (100, 100, 500, 500))
        output = BytesIO()
        image.save(output, format="JPEG", quality=95)
        originals[f"{index}.jpg"] = output.getvalue()
    data = _report_data()
    data["photos"] = [
        {**data["photos"][0], "id": f"photo-{index}", "storage_object_key": f"{index}.jpg"}
        for index in range(4)
    ]
    data["defects"] = []
    pdf = build_trial_result_pdf(
        "体积回归", "TRY-SIZE", "2026-10-09", data,
        lambda _bucket, object_key: originals[object_key],
    )
    assert len(pdf) < 10 * 1024 * 1024
    assert pdf.count(b"/DCTDecode") == 4


def test_pdf_description_uses_the_page_defect_colors() -> None:
    description = _description([
        {"defect_type": "crack"},
        {"defect_type": "spalling"},
        {"defect_type": "hollow"},
    ])

    assert '<font color="#DC2626">疑似裂缝: 1处</font>' in description
    assert '<font color="#F97316">疑似脱落: 1处</font>' in description
    assert '<font color="#245CFF">疑似空鼓: 1处</font>' in description
