from decimal import Decimal

import pytest

from app.services.defect_area import (
    approximate_bbox_area_m2,
    approximate_bbox_length_m,
    focal_length_pixels,
)


def test_bbox_area_uses_calibrated_pixel_focal_length() -> None:
    photo = {
        "image_width": 4000,
        "image_height": 3000,
        "calibrated_focal_length": 3000,
        "lrf_target_distance": 6,
    }

    area = approximate_bbox_area_m2(
        photo,
        {"x": 10, "y": 20, "width": 100, "height": 50},
    )

    assert area == Decimal("0.020000")


def test_crack_length_uses_bbox_diagonal_times_length_per_pixel() -> None:
    photo = {
        "image_width": 4000,
        "image_height": 3000,
        "calibrated_focal_length": 3000,
        "lrf_target_distance": 6,
    }

    length = approximate_bbox_length_m(
        photo,
        {"x": 10, "y": 20, "width": 100, "height": 50},
    )

    assert length == Decimal("0.223607")


def test_bbox_area_uses_35mm_equivalent_focal_length_when_calibration_is_missing() -> None:
    photo = {
        "image_width": 4032,
        "image_height": 3024,
        "calibrated_focal_length": None,
        "focal_length_35mm": 24,
        "lrf_target_distance": 6.182,
    }

    focal_pixels = focal_length_pixels(photo)
    area = approximate_bbox_area_m2(photo, {"width": 100, "height": 100})

    assert float(focal_pixels or 0) == pytest.approx(2795.62, rel=1e-4)
    assert float(area or 0) == pytest.approx(0.0489, rel=2e-3)


def test_bbox_area_falls_back_to_known_camera_field_of_view() -> None:
    photo = {
        "image_width": 4032,
        "image_height": 3024,
        "camera_model": "M4T",
        "camera_image_source": "WideCamera",
        "lrf_target_distance": 5.024,
    }

    area = approximate_bbox_area_m2(photo, {"width": 100, "height": 100})

    assert float(area or 0) == pytest.approx(0.030035, rel=1e-4)


@pytest.mark.parametrize(
    "photo,bbox",
    [
        ({"image_width": 4032, "image_height": 3024}, {"width": 100, "height": 100}),
        (
            {"image_width": 4032, "image_height": 3024, "focal_length_35mm": 24},
            {"width": 0, "height": 100},
        ),
    ],
)
def test_bbox_area_returns_none_without_required_measurement_data(
    photo: dict,
    bbox: dict,
) -> None:
    assert approximate_bbox_area_m2(photo, bbox) is None


def test_bbox_length_returns_none_without_required_measurement_data() -> None:
    assert approximate_bbox_length_m(
        {"image_width": 4032, "image_height": 3024},
        {"width": 100, "height": 100},
    ) is None
