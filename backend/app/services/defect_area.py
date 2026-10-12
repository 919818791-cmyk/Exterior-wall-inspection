from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from math import hypot, radians, tan
from re import sub
from typing import Any, Mapping

FULL_FRAME_DIAGONAL_MM = hypot(36.0, 24.0)
AREA_PRECISION_M2 = Decimal("0.000001")
LENGTH_PRECISION_M = Decimal("0.000001")

# Diagonal fields of view used only when a photo has neither calibrated nor
# 35 mm-equivalent focal length metadata.
CAMERA_DIAGONAL_FOV_DEGREES = {
    ("m4t", "widecamera"): 82.0,
    ("djimatrice4t", "widecamera"): 82.0,
    ("m4e", "widecamera"): 84.0,
    ("djimatrice4e", "widecamera"): 84.0,
}


def _value(source: object, key: str) -> Any:
    if isinstance(source, Mapping):
        return source.get(key)
    return getattr(source, key, None)


def _positive_decimal(value: Any) -> Decimal | None:
    try:
        number = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None
    return number if number.is_finite() and number > 0 else None


def _normalized(value: Any) -> str:
    return sub(r"[^a-z0-9]+", "", str(value or "").lower())


def focal_length_pixels(photo: object) -> Decimal | None:
    calibrated = _positive_decimal(_value(photo, "calibrated_focal_length"))
    if calibrated is not None:
        return calibrated

    image_width = _positive_decimal(_value(photo, "image_width"))
    image_height = _positive_decimal(_value(photo, "image_height"))
    if image_width is None or image_height is None:
        return None
    image_diagonal = Decimal(str(hypot(float(image_width), float(image_height))))

    equivalent_focal_length = _positive_decimal(_value(photo, "focal_length_35mm"))
    if equivalent_focal_length is not None:
        return image_diagonal * equivalent_focal_length / Decimal(str(FULL_FRAME_DIAGONAL_MM))

    image_source = _normalized(_value(photo, "camera_image_source"))
    for model_key in ("camera_model", "drone_model", "camera_product_name"):
        model = _normalized(_value(photo, model_key))
        diagonal_fov = CAMERA_DIAGONAL_FOV_DEGREES.get((model, image_source))
        if diagonal_fov is None:
            continue
        denominator = Decimal(str(2.0 * tan(radians(diagonal_fov / 2.0))))
        return image_diagonal / denominator if denominator > 0 else None
    return None


def meters_per_pixel(photo: object) -> Decimal | None:
    distance_m = _positive_decimal(_value(photo, "lrf_target_distance"))
    focal_pixels = focal_length_pixels(photo)
    if distance_m is None or focal_pixels is None:
        return None
    return distance_m / focal_pixels


def approximate_bbox_area_m2(photo: object, bbox: object) -> Decimal | None:
    """Estimate a fronto-parallel bounding rectangle's physical area in m²."""
    if not isinstance(bbox, Mapping):
        return None
    width = _positive_decimal(bbox.get("width"))
    height = _positive_decimal(bbox.get("height"))
    pixel_length_m = meters_per_pixel(photo)
    if width is None or height is None or pixel_length_m is None:
        return None

    area = width * height * pixel_length_m * pixel_length_m
    return area.quantize(AREA_PRECISION_M2, rounding=ROUND_HALF_UP)


def approximate_bbox_length_m(photo: object, bbox: object) -> Decimal | None:
    """Estimate a crack's length from its bounding-box diagonal in metres."""
    if not isinstance(bbox, Mapping):
        return None
    width = _positive_decimal(bbox.get("width"))
    height = _positive_decimal(bbox.get("height"))
    pixel_length_m = meters_per_pixel(photo)
    if width is None or height is None or pixel_length_m is None:
        return None

    diagonal_pixels = (width * width + height * height).sqrt()
    length = diagonal_pixels * pixel_length_m
    return length.quantize(LENGTH_PRECISION_M, rounding=ROUND_HALF_UP)
