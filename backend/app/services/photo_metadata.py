from __future__ import annotations

from re import IGNORECASE, search
from typing import BinaryIO, TypedDict

THERMAL_IMAGE_SOURCE = "InfraredCamera"
THERMAL_IMAGE_DESCRIPTION = "IronRed"
XMP_SCAN_LIMIT = 3_000_000


class PhotoMetadata(TypedDict):
    xmp_drone_dji_image_source: str | None
    ifd0_image_description: str | None
    thermal_imaging_available: bool


class FormalPhotoMetadata(PhotoMetadata):
    camera_make: str | None
    camera_model: str | None
    drone_metadata_available: bool
    professional_drone_photo: bool
    relative_altitude: float | None
    gimbal_yaw_degree: float | None
    facade_orientation: str | None


def extract_photo_metadata(file_obj: BinaryIO) -> PhotoMetadata:
    reader = getattr(file_obj, "read", None)
    if not callable(reader):
        return {
            "xmp_drone_dji_image_source": None,
            "ifd0_image_description": None,
            "thermal_imaging_available": False,
        }
    position = file_obj.tell()
    try:
        file_obj.seek(0)
        data = reader(XMP_SCAN_LIMIT)
    finally:
        file_obj.seek(position)
    return extract_photo_metadata_from_bytes(data)


def extract_photo_metadata_from_bytes(data: bytes) -> PhotoMetadata:
    image_source = _find_xmp_image_source(data)
    image_description = _find_ifd0_image_description(data) or _find_text_value(
        data,
        ("IFD0-ImageDescription", "ImageDescription"),
    )
    return {
        "xmp_drone_dji_image_source": image_source,
        "ifd0_image_description": image_description,
        "thermal_imaging_available": _is_thermal_imaging_available(image_source, image_description),
    }


def extract_formal_photo_metadata(file_obj: BinaryIO) -> FormalPhotoMetadata:
    reader = getattr(file_obj, "read", None)
    if not callable(reader):
        return {
            "xmp_drone_dji_image_source": None,
            "ifd0_image_description": None,
            "thermal_imaging_available": False,
            "camera_make": None,
            "camera_model": None,
            "drone_metadata_available": False,
            "professional_drone_photo": False,
            "relative_altitude": None,
            "gimbal_yaw_degree": None,
            "facade_orientation": None,
        }
    position = file_obj.tell()
    try:
        file_obj.seek(0)
        data = reader(XMP_SCAN_LIMIT)
    finally:
        file_obj.seek(position)
    return extract_formal_photo_metadata_from_bytes(data)


def extract_formal_photo_metadata_from_bytes(data: bytes) -> FormalPhotoMetadata:
    metadata = extract_photo_metadata_from_bytes(data)
    camera_make = _find_camera_make(data)
    camera_model = _find_camera_model(data)
    relative_altitude = _find_float_value(
        data,
        ("XMP-drone-dji-RelativeAltitude", "drone-dji:RelativeAltitude", "RelativeAltitude"),
    )
    gimbal_yaw_degree = _find_float_value(
        data,
        ("XMP-drone-dji-GimbalYawDegree", "drone-dji:GimbalYawDegree", "GimbalYawDegree"),
    )
    drone_metadata_available = (
        _has_drone_metadata(data)
        or relative_altitude is not None
        or gimbal_yaw_degree is not None
    )
    return {
        **metadata,
        "camera_make": camera_make,
        "camera_model": camera_model,
        "drone_metadata_available": drone_metadata_available,
        "professional_drone_photo": bool(camera_model and drone_metadata_available),
        "relative_altitude": relative_altitude,
        "gimbal_yaw_degree": gimbal_yaw_degree,
        "facade_orientation": facade_orientation_from_yaw(gimbal_yaw_degree),
    }


def facade_orientation_from_yaw(yaw: float | None) -> str | None:
    """Convert DJI gimbal heading to the facade that faces the camera."""
    if yaw is None:
        return None
    normalized_yaw = yaw % 360
    if normalized_yaw > 337.5 or normalized_yaw <= 22.5:
        return "南立面"
    if normalized_yaw <= 67.5:
        return "西南立面"
    if normalized_yaw <= 112.5:
        return "西立面"
    if normalized_yaw <= 157.5:
        return "西北立面"
    if normalized_yaw <= 202.5:
        return "北立面"
    if normalized_yaw <= 247.5:
        return "东北立面"
    if normalized_yaw <= 292.5:
        return "东立面"
    return "东南立面"


def _is_thermal_imaging_available(image_source: str | None, image_description: str | None) -> bool:
    return _normalize(image_source) == THERMAL_IMAGE_SOURCE and _normalize(image_description) == THERMAL_IMAGE_DESCRIPTION


def _normalize(value: str | None) -> str:
    return (value or "").replace("\x00", "").strip()


def _find_xmp_image_source(data: bytes) -> str | None:
    return _find_text_value(data, ("XMP-drone-dji-ImageSource", "drone-dji:ImageSource"))


def _find_camera_make(data: bytes) -> str | None:
    return _find_tiff_ascii_value(data, 0x010F) or _find_text_value(
        data,
        ("IFD0-Make", "XMP-tiff-Make", "tiff:Make"),
    )


def _find_camera_model(data: bytes) -> str | None:
    return _find_tiff_ascii_value(data, 0x0110) or _find_text_value(
        data,
        ("IFD0-Model", "XMP-tiff-Model", "tiff:Model", "CameraModelName"),
    )


def _has_drone_metadata(data: bytes) -> bool:
    text = data[:XMP_SCAN_LIMIT].decode("utf-8", errors="ignore")
    return bool(search(r"(?:XMP-)?drone-[a-z0-9_-]+[-:]", text, IGNORECASE))


def _find_text_value(data: bytes, keys: tuple[str, ...]) -> str | None:
    text = data[:XMP_SCAN_LIMIT].decode("utf-8", errors="ignore")
    for key in keys:
        escaped_key = _escape_regex(key)
        attribute_match = search(rf"{escaped_key}\s*=\s*[\"']([^\"']+)[\"']", text, IGNORECASE)
        if attribute_match:
            return _normalize(attribute_match.group(1))

        assignment_match = search(rf"{escaped_key}\s*[:=]\s*[\"']?([^\"'<> \r\n]+)", text, IGNORECASE)
        if assignment_match:
            return _normalize(assignment_match.group(1))

        element_key = key if ":" in key else rf"[^:<>]*:?{escaped_key}"
        element_match = search(rf"<{element_key}[^>]*>([^<]+)</{element_key}>", text, IGNORECASE)
        if element_match:
            return _normalize(element_match.group(1))
    return None


def _find_float_value(data: bytes, keys: tuple[str, ...]) -> float | None:
    value = _find_text_value(data, keys)
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _escape_regex(value: str) -> str:
    special = r".*+?^${}()|[]\\"
    return "".join(f"\\{char}" if char in special else char for char in value)


def _find_ifd0_image_description(data: bytes) -> str | None:
    return _find_tiff_ascii_value(data, 0x010E)


def _find_tiff_ascii_value(data: bytes, expected_tag: int) -> str | None:
    tiff_start = _find_tiff_start(data)
    if tiff_start is None or tiff_start + 8 > len(data):
        return None

    byte_order = data[tiff_start : tiff_start + 2]
    if byte_order == b"II":
        endian = "little"
    elif byte_order == b"MM":
        endian = "big"
    else:
        return None

    if _read_uint16(data, tiff_start + 2, endian) != 0x2A:
        return None

    first_ifd_offset = _read_uint32(data, tiff_start + 4, endian)
    ifd_start = tiff_start + first_ifd_offset
    if ifd_start + 2 > len(data):
        return None

    entry_count = _read_uint16(data, ifd_start, endian)
    for index in range(entry_count):
        entry_start = ifd_start + 2 + index * 12
        if entry_start + 12 > len(data):
            return None

        tag = _read_uint16(data, entry_start, endian)
        if tag != expected_tag:
            continue

        value_type = _read_uint16(data, entry_start + 2, endian)
        count = _read_uint32(data, entry_start + 4, endian)
        type_size = _tiff_type_size(value_type)
        if not type_size or count <= 0:
            return None

        byte_count = count * type_size
        value_start = entry_start + 8 if byte_count <= 4 else tiff_start + _read_uint32(data, entry_start + 8, endian)
        if value_start < 0 or value_start >= len(data):
            return None

        value = data[value_start : value_start + byte_count].decode("utf-8", errors="ignore")
        return _normalize(value)

    return None


def _find_tiff_start(data: bytes) -> int | None:
    if len(data) >= 4 and data[:2] in {b"II", b"MM"}:
        return 0
    if len(data) < 4 or data[:2] != b"\xff\xd8":
        return None

    offset = 2
    while offset + 4 <= len(data):
        if data[offset] != 0xFF:
            offset += 1
            continue

        marker = data[offset + 1]
        if marker in {0xDA, 0xD9}:
            break

        segment_length = int.from_bytes(data[offset + 2 : offset + 4], "big")
        if segment_length < 2:
            return None

        segment_start = offset + 4
        segment_end = offset + 2 + segment_length
        if segment_end > len(data):
            return None

        if marker == 0xE1 and data[segment_start : segment_start + 6] == b"Exif\x00\x00":
            return segment_start + 6

        offset = segment_end

    return None


def _read_uint16(data: bytes, offset: int, endian: str) -> int:
    return int.from_bytes(data[offset : offset + 2], endian)


def _read_uint32(data: bytes, offset: int, endian: str) -> int:
    return int.from_bytes(data[offset : offset + 4], endian)


def _tiff_type_size(value_type: int) -> int:
    if value_type in {1, 2, 6, 7}:
        return 1
    if value_type in {3, 8}:
        return 2
    if value_type in {4, 9, 11}:
        return 4
    if value_type in {5, 10, 12}:
        return 8
    return 0
