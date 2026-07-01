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


def extract_photo_metadata(file_obj: BinaryIO) -> PhotoMetadata:
    position = file_obj.tell()
    try:
        file_obj.seek(0)
        data = file_obj.read()
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


def _is_thermal_imaging_available(image_source: str | None, image_description: str | None) -> bool:
    return _normalize(image_source) == THERMAL_IMAGE_SOURCE and _normalize(image_description) == THERMAL_IMAGE_DESCRIPTION


def _normalize(value: str | None) -> str:
    return (value or "").replace("\x00", "").strip()


def _find_xmp_image_source(data: bytes) -> str | None:
    return _find_text_value(data, ("XMP-drone-dji-ImageSource", "drone-dji:ImageSource"))


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


def _escape_regex(value: str) -> str:
    special = r".*+?^${}()|[]\\"
    return "".join(f"\\{char}" if char in special else char for char in value)


def _find_ifd0_image_description(data: bytes) -> str | None:
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
        if tag != 0x010E:
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
