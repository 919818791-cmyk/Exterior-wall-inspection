from __future__ import annotations

from math import isfinite
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont


DEFECT_DISPLAY = {
    "crack": ("裂缝", "#DC2626"),
    "missing": ("剥落", "#F97316"),
    "spalling": ("剥落", "#F97316"),
    "moisture": ("潮湿", "#0EA5E9"),
    "corrosion": ("锈蚀", "#A16207"),
    "hollow": ("空鼓", "#245CFF"),
}

PROJECT_ROOT = Path(__file__).resolve().parents[3]
FONT_CANDIDATES = (
    PROJECT_ROOT
    / "frontend"
    / "HarmonyOS-Sans"
    / "HarmonyOS_SansSC"
    / "HarmonyOS_SansSC_Bold.ttf",
    Path("/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf"),
)


class DefectAnnotationError(RuntimeError):
    pass


def defect_label(defect_type: Any) -> str:
    raw_type = str(defect_type or "")
    return DEFECT_DISPLAY.get(raw_type, (raw_type or "缺陷", "#245CFF"))[0]


def finite_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if isfinite(number) else None


def bbox_pixels(
    defect: dict[str, Any],
    image_size: tuple[int, int],
) -> tuple[int, int, int, int] | None:
    bbox = defect.get("bbox_json") or {}
    if not isinstance(bbox, dict):
        return None
    x = finite_number(bbox.get("x"))
    y = finite_number(bbox.get("y"))
    width = finite_number(bbox.get("width"))
    height = finite_number(bbox.get("height"))
    if None in (x, y, width, height) or width <= 0 or height <= 0:
        return None

    image_width, image_height = image_size
    if x <= 1 and y <= 1 and width <= 1 and height <= 1:
        x, width = x * image_width, width * image_width
        y, height = y * image_height, height * image_height
    else:
        raw_result = defect.get("raw_result_json") or {}
        finding = (raw_result.get("finding") or {}) if isinstance(raw_result, dict) else {}
        source_width = (
            finite_number(finding.get("image_width"))
            if isinstance(finding, dict)
            else None
        )
        source_height = (
            finite_number(finding.get("image_height"))
            if isinstance(finding, dict)
            else None
        )
        if source_width and source_height:
            x, width = x * image_width / source_width, width * image_width / source_width
            y, height = y * image_height / source_height, height * image_height / source_height

    left = max(0, min(image_width - 1, round(x)))
    top = max(0, min(image_height - 1, round(y)))
    right = max(left + 1, min(image_width, round(x + width)))
    bottom = max(top + 1, min(image_height, round(y + height)))
    return left, top, right, bottom


def _annotation_font(size: int) -> ImageFont.FreeTypeFont:
    for candidate in FONT_CANDIDATES:
        if candidate.is_file():
            return ImageFont.truetype(str(candidate), size=size)
    raise DefectAnnotationError("缺陷标注缺少中文字体。")


def draw_defect_annotations(
    image: Image.Image,
    defects: list[dict[str, Any]],
    *,
    numbered_labels: bool = False,
    line_width_ratio: float = 0.004,
    min_line_width: int = 3,
    font_size_ratio: float = 0.026,
    min_font_size: int = 22,
    max_font_size: int = 72,
) -> None:
    if not defects:
        return
    draw = ImageDraw.Draw(image, "RGBA")
    short_edge = min(image.size)
    line_width = max(min_line_width, round(short_edge * line_width_ratio))
    font_size = max(min_font_size, min(max_font_size, round(short_edge * font_size_ratio)))
    font = _annotation_font(font_size)

    for defect in defects:
        box = bbox_pixels(defect, image.size)
        if box is None:
            continue
        defect_type = str(defect.get("defect_type") or "")
        type_label, color = DEFECT_DISPLAY.get(defect_type, (defect_type or "缺陷", "#245CFF"))
        label = str(defect.get("defect_no") or type_label) if numbered_labels else type_label
        rgb = tuple(bytes.fromhex(color.removeprefix("#")))
        draw.rectangle(box, outline=(*rgb, 255), width=line_width)

        text_box = draw.textbbox((0, 0), label, font=font)
        text_width = text_box[2] - text_box[0]
        text_height = text_box[3] - text_box[1]
        padding_x = max(8, font_size // 3)
        padding_y = max(5, font_size // 6)
        label_height = text_height + padding_y * 2
        label_left = box[0]
        label_top = box[1] - label_height if box[1] >= label_height else box[1]
        label_right = min(image.width, label_left + text_width + padding_x * 2)
        label_bottom = min(image.height, label_top + label_height)
        draw.rectangle(
            (label_left, label_top, label_right, label_bottom),
            fill=(*rgb, 235),
        )
        draw.text(
            (label_left + padding_x, label_top + padding_y - text_box[1]),
            label,
            font=font,
            fill=(255, 255, 255, 255),
        )
