from __future__ import annotations

import csv
import io
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session, defer

from app.api.dependencies import require_roles
from app.core.config import get_settings
from app.db.session import get_db
from app.enums.status import UserRole
from app.models.tables import AnnotationPhotoEdit, DetectionTask, InspectionReport, Project, QualityEvaluation
from app.services.object_storage import signed_object_url
from app.services.recognition_quality import RULE, RULE_VERSION, aggregate, current_evaluation

router = APIRouter(prefix="/recognition-quality", tags=["recognition-quality"],
    dependencies=[Depends(require_roles(UserRole.ADMIN))])


def version_read(evaluation: QualityEvaluation) -> dict:
    return {"id": str(evaluation.id), "version": evaluation.version,
        "rule_version": evaluation.rule_version, "summary": evaluation.summary_json,
        "created_at": evaluation.created_at, "created_by": str(evaluation.created_by),
        "input_revision": evaluation.input_revision}


def catalog(db: Session) -> list[dict]:
    rows = list(db.execute(select(Project, DetectionTask, InspectionReport, QualityEvaluation)
        .options(defer(QualityEvaluation.photos_json))
        .join(DetectionTask, DetectionTask.project_id == Project.id)
        .outerjoin(InspectionReport, InspectionReport.detection_task_id == DetectionTask.id)
        .outerjoin(QualityEvaluation, and_(QualityEvaluation.report_id == InspectionReport.id,
            QualityEvaluation.input_revision == InspectionReport.quality_revision,
            InspectionReport.quality_completed_revision == InspectionReport.quality_revision,
            InspectionReport.status.in_(["generated", "pushed"]), DetectionTask.status == "success",
            QualityEvaluation.rule_version == RULE_VERSION))
        .where(Project.deleted_at.is_(None)).order_by(Project.updated_at.desc(), Project.id)))
    report_ids = [report.id for _, _, report, _ in rows if report]
    progress = {}
    if report_ids:
        for report_id, state, count in db.execute(select(AnnotationPhotoEdit.report_id,
            AnnotationPhotoEdit.review_state, func.count()).where(AnnotationPhotoEdit.report_id.in_(report_ids))
            .group_by(AnnotationPhotoEdit.report_id, AnnotationPhotoEdit.review_state)):
            progress.setdefault(report_id, {})[state] = count
    items = []
    for project, task, report, evaluation in rows:
        counts = progress.get(report.id, {}) if report else {}
        reviewed, excluded = counts.get("reviewed", 0), counts.get("excluded", 0)
        total = task.photo_count
        items.append({"project_id": str(project.id), "project_no": project.project_no,
            "project_name": project.name, "task_id": str(task.id), "task_status": task.status,
            "total_photos": total, "reviewed_photos": reviewed, "excluded_photos": excluded,
            "pending_photos": max(0, total - reviewed - excluded),
            "coverage": 100 * reviewed / (total - excluded) if total > excluded else None,
            "evaluation": version_read(evaluation) if evaluation else None,
            "updated_at": max(project.updated_at, report.updated_at) if report else project.updated_at})
    items.sort(key=lambda item: item["updated_at"], reverse=True)
    return items


def overview(items: list[dict]) -> dict:
    official = [item["evaluation"]["summary"] for item in items if item["evaluation"]]
    categories = sorted({category for summary in official for category in summary["by_type"]})
    total = sum(item["total_photos"] for item in items)
    reviewed = sum(item["reviewed_photos"] for item in items)
    excluded = sum(item["excluded_photos"] for item in items)
    return {"total_projects": len(items), "evaluated_projects": len(official),
        "evaluated_photos": sum(s["reviewed_photos"] for s in official),
        "total_photos": total, "reviewed_photos": reviewed, "excluded_photos": excluded,
        "coverage": 100 * reviewed / (total - excluded) if total > excluded else None,
        "metrics": aggregate(s["metrics"] for s in official),
        "by_type": {category: aggregate(s["by_type"][category] for s in official if category in s["by_type"])
                    for category in categories},
        "empty_truth_photos": sum(s["empty_truth_photos"] for s in official),
        "empty_correct_photos": sum(s["empty_correct_photos"] for s in official), "rule": RULE}


@router.get("")
def list_quality_projects(
    page: int = Query(default=1, ge=1), page_size: int = Query(default=20, ge=1, le=100),
    search: str = Query(default="", max_length=128), sort: str = Query(default="recent", pattern="^(recent|score|missed)$"),
    db: Session = Depends(get_db),
) -> dict:
    items = catalog(db)
    summary = overview(items)
    if search.strip():
        items = [item for item in items if search.strip().casefold() in
                 f'{item["project_no"]} {item["project_name"]}'.casefold()]
    if sort == "score":
        items.sort(key=lambda item: (item["evaluation"] is None or item["evaluation"]["summary"]["metrics"]["score"] is None,
            item["evaluation"]["summary"]["metrics"]["score"] or 0 if item["evaluation"] else 0))
    elif sort == "missed":
        items.sort(key=lambda item: -(item["evaluation"]["summary"]["metrics"]["fn"] if item["evaluation"] else -1))
    return {"overview": summary, "items": items[(page - 1) * page_size:page * page_size],
            "total": len(items), "page": page, "page_size": page_size}


def project_context(db: Session, project_id: UUID):
    project = db.get(Project, project_id)
    if project is None or project.deleted_at is not None:
        raise HTTPException(status_code=404, detail="项目不存在。")
    task = db.scalar(select(DetectionTask).where(DetectionTask.project_id == project_id))
    report = db.scalar(select(InspectionReport).where(InspectionReport.detection_task_id == task.id)) if task else None
    if not task or not report:
        raise HTTPException(status_code=409, detail="项目检测结果尚未就绪。")
    return project, task, report


def detail(db: Session, project_id: UUID, version: int | None) -> dict:
    project, task, report = project_context(db, project_id)
    versions = list(db.scalars(select(QualityEvaluation).options(defer(QualityEvaluation.photos_json)).where(QualityEvaluation.project_id == project_id)
                              .order_by(QualityEvaluation.version.desc())))
    chosen = next((v for v in versions if v.version == version), None) if version else next((v for v in versions
        if v.input_revision == report.quality_revision and report.quality_completed_revision == report.quality_revision
        and v.rule_version == RULE_VERSION and report.status in ("generated", "pushed")), None)
    if version and chosen is None:
        raise HTTPException(status_code=404, detail="评估版本不存在。")
    unavailable_reason = None
    if chosen:
        result = {"summary": chosen.summary_json, "photos": chosen.photos_json}
    else:
        try:
            _, result = current_evaluation(db, task, report)
        except ValueError as exc:
            result = {"summary": None, "photos": []}
            unavailable_reason = str(exc)
    # Signed image URLs are generated at read time; they are never frozen into history.
    photos = []
    for photo in result["photos"]:
        public = {k: v for k, v in photo.items() if k not in ("storage_bucket", "storage_object_key")}
        public["image_url"] = signed_object_url(get_settings().api_prefix, photo["storage_bucket"], photo["storage_object_key"])
        photos.append(public)
    return {"project_id": str(project.id), "project_name": project.name, "project_no": project.project_no,
        "task_id": str(task.id), "evaluation": version_read(chosen) if chosen else None,
        "history": [version_read(v) for v in versions], "summary": result["summary"], "photos": photos,
        "unavailable_reason": unavailable_reason, "rule": chosen.summary_json["rule"] if chosen else RULE,
        "needs_completion": chosen is None and bool(result["summary"] and result["summary"]["complete"])}


@router.get("/projects/{project_id}")
def get_quality_project(project_id: UUID, version: int | None = Query(default=None, ge=1), db: Session = Depends(get_db)) -> dict:
    return detail(db, project_id, version)


def csv_response(rows: list[list], filename: str) -> Response:
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer)
    for row in rows:
        # Spreadsheet exports must not execute formulas from user-controlled names.
        writer.writerow(["'" + cell if isinstance(cell, str) and cell.lstrip().startswith(("=", "+", "-", "@")) else cell for cell in row])
    return Response(content="\ufeff" + buffer.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"})


@router.get("/export")
def export_quality_projects(db: Session = Depends(get_db)) -> Response:
    items = catalog(db)
    rows = [["项目编号", "项目名称", "评估版本", "规则版本", "评估时间", "送检照片", "已复核", "排除照片", "复核覆盖率%", "正确识别", "误检", "漏检", "准确率%", "召回率%", "综合评分"]]
    for item in items:
        evaluation = item["evaluation"]
        m = evaluation["summary"]["metrics"] if evaluation else {}
        rows.append([item["project_no"], item["project_name"], evaluation["version"] if evaluation else "待评估",
            RULE_VERSION, evaluation["created_at"].isoformat() if evaluation else "", item["total_photos"],
            item["reviewed_photos"], item["excluded_photos"], item["coverage"],
            *[m.get(key) for key in ("tp", "fp", "fn", "precision", "recall", "score")]])
    return csv_response(rows, "recognition-quality.csv")


@router.get("/projects/{project_id}/export")
def export_quality_project(project_id: UUID, version: int | None = Query(default=None, ge=1), db: Session = Depends(get_db)) -> Response:
    result = detail(db, project_id, version)
    rows = [["项目编号", "版本", "规则", "照片", "复核状态", "排除原因", "复核人", "复核时间", "结果", "AI 类别", "人工类别", "AI 框", "人工框", "IoU"]]
    label = result["evaluation"]["version"] if result["evaluation"] else "阶段性结果"
    for photo in result["photos"]:
        for item in photo["details"] or [{}]:
            pred, truth = item.get("prediction") or {}, item.get("truth") or {}
            rows.append([result["project_no"], label, result["rule"]["version"], photo["filename"],
                photo["review_state"], photo["exclusion_reason"], photo["reviewed_by"], photo["reviewed_at"], item.get("kind"),
                pred.get("defect_type"), truth.get("defect_type"), str(pred.get("bbox", "")), str(truth.get("bbox", "")), item.get("iou")])
    return csv_response(rows, "recognition-quality-details.csv")
