from __future__ import annotations

from collections import Counter
from io import BytesIO
from pathlib import Path
from threading import Lock
from typing import Any, Callable
from xml.sax.saxutils import escape

from PIL import Image as PilImage
from PIL import ImageDraw, ImageFont, ImageOps
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.services.defect_annotation import (
    DEFECT_DISPLAY,
    DefectAnnotationError,
    draw_defect_annotations,
)


WATERMARK_TEXT = "外墙智能巡检平台（试用版本）"

PROJECT_ROOT = Path(__file__).resolve().parents[3]
FONT_CANDIDATES = (
    PROJECT_ROOT / "frontend/HarmonyOS-Sans/HarmonyOS_SansSC/HarmonyOS_SansSC_Regular.ttf",
    Path("/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf"),
)
FONT_BOLD_CANDIDATES = (
    PROJECT_ROOT / "frontend/HarmonyOS-Sans/HarmonyOS_SansSC/HarmonyOS_SansSC_Bold.ttf",
    Path("/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf"),
)
FONT_REGISTRATION_LOCK = Lock()


class TrialPdfExportError(RuntimeError):
    pass


def _font_path(candidates: tuple[Path, ...]) -> Path:
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise TrialPdfExportError("PDF 导出缺少中文字体文件。")


def _register_pdf_fonts() -> tuple[str, str]:
    regular_name = "HarmonyOSSansSC"
    bold_name = "HarmonyOSSansSC-Bold"
    with FONT_REGISTRATION_LOCK:
        if regular_name not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(regular_name, str(_font_path(FONT_CANDIDATES))))
        if bold_name not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(bold_name, str(_font_path(FONT_BOLD_CANDIDATES))))
    return regular_name, bold_name


def _pil_font(size: int, *, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(
        str(_font_path(FONT_BOLD_CANDIDATES if bold else FONT_CANDIDATES)),
        size=size,
    )


def _photo_key(item: dict[str, Any]) -> str:
    if item.get("photo_id"):
        return f"photo:{item['photo_id']}"
    if item.get("id"):
        return f"photo:{item['id']}"
    filename = item.get("photo_filename") or item.get("original_filename")
    return f"filename:{filename}" if filename else ""


def _photo_rows(data: dict[str, Any]) -> list[tuple[dict[str, Any], list[dict[str, Any]]]]:
    photos = [photo for photo in data.get("photos") or [] if isinstance(photo, dict)]
    photo_key_by_id = {
        str(photo["id"]): _photo_key(photo)
        for photo in photos
        if photo.get("id")
    }
    photo_key_by_filename = {
        str(photo["original_filename"]): _photo_key(photo)
        for photo in photos
        if photo.get("original_filename")
    }
    defects_by_photo: dict[str, list[dict[str, Any]]] = {}
    for defect in data.get("defects") or []:
        if not isinstance(defect, dict):
            continue
        key = (
            photo_key_by_id.get(str(defect.get("photo_id")))
            or photo_key_by_filename.get(str(defect.get("photo_filename")))
            or _photo_key(defect)
        )
        if key:
            defects_by_photo.setdefault(key, []).append(defect)

    return [(photo, defects_by_photo.get(_photo_key(photo), [])) for photo in photos]


def _annotated_original(original_bytes: bytes, defects: list[dict[str, Any]]) -> BytesIO:
    try:
        with PilImage.open(BytesIO(original_bytes)) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
    except Exception as exc:
        raise TrialPdfExportError("原始照片无法读取，PDF 导出已终止。") from exc

    try:
        draw_defect_annotations(image, defects)
    except DefectAnnotationError as exc:
        raise TrialPdfExportError(str(exc)) from exc

    draw = ImageDraw.Draw(image, "RGBA")
    short_edge = min(image.size)
    watermark_font_size = max(28, min(104, round(short_edge * 0.032)))
    watermark_font = _pil_font(watermark_font_size, bold=True)
    watermark_box = draw.textbbox((0, 0), WATERMARK_TEXT, font=watermark_font)
    watermark_width = watermark_box[2] - watermark_box[0]
    watermark_height = watermark_box[3] - watermark_box[1]
    padding_x = max(12, watermark_font_size // 2)
    padding_y = max(8, watermark_font_size // 3)
    margin = max(12, round(short_edge * 0.012))
    right = image.width - margin
    bottom = image.height - margin
    left = max(margin, right - watermark_width - padding_x * 2)
    top = max(margin, bottom - watermark_height - padding_y * 2)
    draw.rounded_rectangle((left, top, right, bottom), radius=padding_y, fill=(8, 20, 40, 150))
    draw.text(
        (right - watermark_width - padding_x, top + padding_y - watermark_box[1]),
        WATERMARK_TEXT,
        font=watermark_font,
        fill=(255, 255, 255, 230),
    )

    output = BytesIO()
    image.save(output, format="PNG", compress_level=6, optimize=False)
    output.seek(0)
    return output


def _description(defects: list[dict[str, Any]]) -> str:
    counts = Counter(str(defect.get("defect_type") or "") for defect in defects)
    if not counts:
        return "未检出明显缺陷"
    descriptions = []
    for defect_type, count in counts.items():
        label, color = DEFECT_DISPLAY.get(defect_type, ("缺陷", "#245CFF"))
        descriptions.append(f'<font color="{color}">疑似{label}: {count}处</font>')
    return "<br/>".join(descriptions)


def _pdf_image(image_data: BytesIO, max_width: float, max_height: float) -> Image:
    with PilImage.open(image_data) as image:
        width, height = image.size
    scale = min(max_width / width, max_height / height)
    flowable = Image(image_data, width=width * scale, height=height * scale)
    flowable.hAlign = "CENTER"
    return flowable


def build_trial_result_pdf(
    report_title: str,
    report_no: str,
    generated_at: str,
    report_data: dict[str, Any],
    read_object: Callable[[str, str], bytes],
) -> bytes:
    regular_font, bold_font = _register_pdf_fonts()
    output = BytesIO()
    page_width, _ = landscape(A4)
    margin = 10 * mm
    document = SimpleDocTemplate(
        output,
        pagesize=landscape(A4),
        leftMargin=margin,
        rightMargin=margin,
        topMargin=10 * mm,
        bottomMargin=10 * mm,
        title=report_title,
        author=WATERMARK_TEXT,
        pageCompression=1,
    )

    title_style = ParagraphStyle(
        "TrialPdfTitle", fontName=bold_font, fontSize=18, leading=24, textColor=colors.HexColor("#10213D")
    )
    meta_style = ParagraphStyle(
        "TrialPdfMeta", fontName=regular_font, fontSize=9, leading=14, textColor=colors.HexColor("#526174")
    )
    header_style = ParagraphStyle(
        "TrialPdfHeader", fontName=bold_font, fontSize=10, leading=14, alignment=TA_CENTER, textColor=colors.white
    )
    cell_style = ParagraphStyle(
        "TrialPdfCell",
        fontName=regular_font,
        fontSize=10,
        leading=17,
        alignment=TA_LEFT,
        textColor=colors.HexColor("#26364D"),
    )
    sequence_style = ParagraphStyle(
        "TrialPdfSequence",
        fontName=bold_font,
        fontSize=10,
        leading=14,
        alignment=TA_CENTER,
        textColor=colors.HexColor("#245CFF"),
    )

    story: list[Any] = [
        Paragraph(escape(report_title or report_no), title_style),
        Spacer(1, 2 * mm),
        Paragraph(f"结果编号：{escape(report_no)}　生成时间：{escape(generated_at)}", meta_style),
        Spacer(1, 5 * mm),
    ]

    rows = _photo_rows(report_data)
    if not rows:
        story.append(Paragraph("暂无检测结果。", cell_style))
    else:
        available_width = page_width - margin * 2
        column_widths = [18 * mm, 185 * mm, available_width - 203 * mm]
        table_data: list[list[Any]] = [[
            Paragraph("序号", header_style),
            Paragraph("含标注的照片", header_style),
            Paragraph("检测说明", header_style),
        ]]

        for index, (photo, defects) in enumerate(rows, start=1):
            bucket = photo.get("storage_bucket")
            object_key = photo.get("storage_object_key")
            if not bucket or not object_key:
                raise TrialPdfExportError(f"第 {index} 张照片缺少原图存储信息，无法导出 PDF。")
            try:
                original_bytes = read_object(str(bucket), str(object_key))
            except Exception as exc:
                raise TrialPdfExportError(f"第 {index} 张原始照片读取失败，无法导出 PDF。") from exc

            annotated = _annotated_original(original_bytes, defects)
            photo_flowable = _pdf_image(annotated, column_widths[1] - 8 * mm, 135 * mm)
            filename = escape(str(photo.get("original_filename") or "检测结果照片"))
            photo_cell = [
                photo_flowable,
                Spacer(1, 2 * mm),
                Paragraph(filename, meta_style),
            ]
            table_data.append([
                Paragraph(str(index).zfill(2), sequence_style),
                photo_cell,
                Paragraph(_description(defects), cell_style),
            ])

        table = Table(table_data, colWidths=column_widths, repeatRows=1)
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#245CFF")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (0, 0), (1, -1), "CENTER"),
            ("LEFTPADDING", (0, 1), (-1, -1), 4 * mm),
            ("RIGHTPADDING", (0, 1), (-1, -1), 4 * mm),
            ("TOPPADDING", (0, 1), (-1, -1), 4 * mm),
            ("BOTTOMPADDING", (0, 1), (-1, -1), 4 * mm),
            ("TOPPADDING", (0, 0), (-1, 0), 3 * mm),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 3 * mm),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#B8C8E0")),
            ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#B8C8E0")),
        ]))
        story.append(table)

    document.build(story)
    return output.getvalue()
