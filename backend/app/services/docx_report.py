from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile


DEFECT_LABELS = {
    "crack": "裂缝",
    "spalling": "剥落",
    "hollowing": "空鼓",
    "leakage": "渗漏",
    "corrosion": "锈蚀",
}

STATUS_LABELS = {
    "confirmed": "已确认",
    "modified": "已修改",
    "added": "人工新增",
    "deleted": "已删除",
}

PROJECT_ROOT = Path(__file__).resolve().parents[3]
FORMAL_TEMPLATE = PROJECT_ROOT / "正式报告示例.docx"
TRIAL_TEMPLATE = PROJECT_ROOT / "试用报告示例.docx"


def _text(value: Any) -> str:
    if value is None or value == "":
        return "-"
    return str(value)


def _paragraph(text: str, *, bold: bool = False) -> str:
    bold_xml = "<w:b/>" if bold else ""
    return (
        "<w:p><w:r><w:rPr>"
        f"{bold_xml}"
        "</w:rPr>"
        f"<w:t xml:space=\"preserve\">{escape(text)}</w:t>"
        "</w:r></w:p>"
    )


def _table(rows: list[list[str]]) -> str:
    row_xml = []
    for row in rows:
        cells = []
        for cell in row:
            cells.append(
                "<w:tc><w:tcPr><w:tcW w:w=\"2400\" w:type=\"dxa\"/></w:tcPr>"
                f"{_paragraph(cell)}"
                "</w:tc>"
            )
        row_xml.append("<w:tr>" + "".join(cells) + "</w:tr>")
    return (
        "<w:tbl>"
        "<w:tblPr><w:tblW w:w=\"0\" w:type=\"auto\"/>"
        "<w:tblBorders>"
        "<w:top w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"B8C2CC\"/>"
        "<w:left w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"B8C2CC\"/>"
        "<w:bottom w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"B8C2CC\"/>"
        "<w:right w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"B8C2CC\"/>"
        "<w:insideH w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"B8C2CC\"/>"
        "<w:insideV w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"B8C2CC\"/>"
        "</w:tblBorders></w:tblPr>"
        + "".join(row_xml)
        + "</w:tbl>"
    )


def _content_types_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"""


def _rels_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""


def _document_xml(lines: list[tuple[str, bool]]) -> str:
    body_parts = []
    for item in lines:
        if len(item) == 3 and item[2] == "table":
            body_parts.append(_table(item[0]))  # type: ignore[arg-type]
        else:
            text, bold = item[:2]
            body_parts.append(_paragraph(str(text), bold=bool(bold)))
    body = "".join(body_parts)
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    {body}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>"""


def _package_document(document_xml: str, template_path: Path | None = None) -> bytes:
    buffer = BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as package:
        if template_path and template_path.exists():
            with ZipFile(template_path) as template:
                for entry in template.infolist():
                    if entry.filename == "word/document.xml":
                        continue
                    package.writestr(entry, template.read(entry.filename))
                package.writestr("word/document.xml", document_xml)
        else:
            package.writestr("[Content_Types].xml", _content_types_xml())
            package.writestr("_rels/.rels", _rels_xml())
            package.writestr("word/document.xml", document_xml)
    return buffer.getvalue()


def _summary_lines(summary: dict[str, Any]) -> list[str]:
    defect_summary = summary.get("by_defect_type") or {}
    status_summary = summary.get("by_status") or {}
    defect_text = "，".join(
        f"{DEFECT_LABELS.get(key, key)} {value} 处" for key, value in defect_summary.items()
    ) or "暂无"
    status_text = "，".join(
        f"{STATUS_LABELS.get(key, key)} {value} 处" for key, value in status_summary.items()
    ) or "暂无"
    return [
        f"照片数量：{_text(summary.get('photo_count'))}",
        f"建筑数量：{_text(summary.get('building_count'))}",
        f"立面数量：{_text(summary.get('facade_count'))}",
        f"缺陷总数：{_text(summary.get('total_review_results'))}",
        f"缺陷类型统计：{defect_text}",
        f"审核状态统计：{status_text}",
    ]


def build_report_docx(report_title: str, report_no: str, report_data: dict[str, Any] | None) -> bytes:
    data = report_data or {}
    project = data.get("project") or {}
    buildings = data.get("buildings") or []
    detection_config = data.get("detection_config") or {}
    detection_task = data.get("detection_task") or {}
    summary = data.get("summary") or {}
    defects = data.get("defects") or []

    lines: list[tuple[Any, bool] | tuple[Any, bool, str]] = [
        (report_title, True),
        (f"报告编号：{report_no}", False),
        ("", False),
        ("一、项目基本信息", True),
        (f"项目名称：{_text(project.get('name'))}", False),
        (f"项目编号：{_text(project.get('project_no'))}", False),
        (f"委托单位：{_text(project.get('client_name'))}", False),
        (f"联系人：{_text(project.get('contact_name'))}", False),
        (
            "项目地址："
            f"{_text(project.get('province'))} {_text(project.get('city'))} "
            f"{_text(project.get('district'))} {_text(project.get('address'))}",
            False,
        ),
        ("", False),
        ("二、建筑与立面信息", True),
    ]

    if buildings:
        for building in buildings:
            lines.append((f"建筑：{_text(building.get('name'))}，楼层：{_text(building.get('floors'))}，高度：{_text(building.get('height'))}", False))
            for facade in building.get("facades") or []:
                lines.append((f"  立面：{_text(facade.get('name'))}，楼层范围：{_text(facade.get('floors_range'))}，面积：{_text(facade.get('area'))}", False))
    else:
        lines.append(("暂无建筑与立面信息。", False))

    lines.extend(
        [
            ("", False),
            ("三、检测模型配置", True),
            (f"检测模型：{', '.join(detection_config.get('model_types') or []) or '-'}", False),
            (f"高精度检测：{'是' if detection_config.get('high_precision') else '否'}", False),
            (f"任务编号：{_text(detection_task.get('task_no'))}", False),
            (f"模型版本：{_text(detection_task.get('model_version'))}", False),
            ("", False),
            ("四、缺陷统计", True),
        ]
    )
    lines.extend((line, False) for line in _summary_lines(summary))

    lines.extend([("", False), ("五、缺陷明细", True)])
    if defects:
        table_rows = [["序号", "图片", "缺陷类型", "位置", "说明"]]
        for index, defect in enumerate(defects, start=1):
            bbox = defect.get("bbox_json") or {}
            table_rows.append(
                [
                    str(index),
                    _text(defect.get("photo_filename")),
                    DEFECT_LABELS.get(defect.get("defect_type"), _text(defect.get("defect_type"))),
                    f"{defect.get('building_name') or '-'} / {defect.get('facade_name') or '-'}",
                    (
                        f"{STATUS_LABELS.get(defect.get('status'), _text(defect.get('status')))}；"
                        f"标注框 x={_text(bbox.get('x'))}, y={_text(bbox.get('y'))}, "
                        f"w={_text(bbox.get('width'))}, h={_text(bbox.get('height'))}；"
                        f"备注：{_text(defect.get('review_note'))}"
                    ),
                ]
            )
        lines.append((table_rows, False, "table"))
    else:
        lines.append(("暂无缺陷明细。", False))

    lines.extend(
        [
            ("", False),
            ("六、审核结论", True),
            (_text(data.get("review_conclusion")), False),
        ]
    )

    return _package_document(_document_xml(lines), FORMAL_TEMPLATE)


def build_trial_report_docx(report_data: dict[str, Any]) -> bytes:
    files = report_data.get("files") or []
    models = report_data.get("models") or []
    findings = report_data.get("findings") or []
    generated_at = report_data.get("generated_at")
    model_text = " / ".join(str(model) for model in models) or "-"

    lines: list[tuple[Any, bool] | tuple[Any, bool, str]] = [
        ("外立面表观病害筛查简报", True),
        (f"报告类型：简易试用报告", False),
        (f"生成时间：{_text(generated_at)}", False),
        (f"检测模式：标准检测", False),
        (f"检测类型：{model_text}", False),
        (f"照片数量：{len(files)}", False),
        ("", False),
        (
            "经过对上传照片进行检测算法初筛，发现疑似表观损伤。"
            "本报告为体验结果，不存档、不进入人工审核、不触发正式检测任务。",
            False,
        ),
        ("", False),
        ("检测明细", True),
    ]

    if findings:
        table_rows = [["序号", "可见光图像", "说明"]]
        for index, finding in enumerate(findings, start=1):
            table_rows.append(
                [
                    str(index),
                    _text(finding.get("filename")),
                    f"疑似{_text(finding.get('model'))}：1处；置信度：{_text(finding.get('confidence'))}",
                ]
            )
        lines.append((table_rows, False, "table"))
    else:
        lines.append(("暂无检测明细。", False))

    return _package_document(_document_xml(lines), TRIAL_TEMPLATE)
