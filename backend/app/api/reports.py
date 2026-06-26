from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime
from io import BytesIO
from re import sub
from typing import Any
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.dependencies import AuthenticatedUser, get_current_user, require_roles
from app.db.session import get_db
from app.enums.status import (
    InspectionReportStatus,
    ProjectStatus,
    ReportPushMethod,
    ReportPushStatus,
    UserRole,
)
from app.models.tables import InspectionReport, Project, ReportPushLog
from app.schemas.phase7 import ReportDetailRead, ReportListItem, TrialReportRequest
from app.services.docx_report import build_report_docx, build_trial_report_docx
from app.services.object_storage import presigned_get_url, put_object
from app.services.report_data import build_report_data

router = APIRouter(tags=["reports"])

DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _safe_filename(value: str) -> str:
    filename = sub(r'[\\/:*?"<>|\r\n]+', "_", value).strip(" .")
    return filename or "inspection-report"


def _report_access_filter(include_generated: bool) -> object:
    allowed_report_statuses = [InspectionReportStatus.PUSHED.value]
    allowed_project_statuses = [ProjectStatus.COMPLETED.value]
    if include_generated:
        allowed_report_statuses.append(InspectionReportStatus.GENERATED.value)
        allowed_project_statuses.append(ProjectStatus.REVIEWED.value)
    return or_(
        InspectionReport.status.in_(allowed_report_statuses),
        Project.status.in_(allowed_project_statuses),
    )


def _can_manage_reports(current_user: AuthenticatedUser) -> bool:
    return current_user.role in {UserRole.REVIEWER.value, UserRole.ADMIN.value}


def _get_report_or_404(
    db: Session,
    report_id: UUID,
    *,
    current_user: AuthenticatedUser,
    include_generated: bool = False,
) -> tuple[InspectionReport, Project]:
    can_manage = _can_manage_reports(current_user)
    row = db.execute(
        select(InspectionReport, Project)
        .join(Project, Project.id == InspectionReport.project_id)
        .where(
            InspectionReport.id == report_id,
            Project.deleted_at.is_(None),
            _report_access_filter(include_generated and can_manage),
            *([Project.created_by == current_user.id] if current_user.role == UserRole.CUSTOMER.value else []),
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found.")
    report, project = row
    return report, project


def _safe_presigned_url(bucket: str | None, object_key: str | None) -> str | None:
    if not bucket or not object_key:
        return None
    try:
        return presigned_get_url(bucket, object_key)
    except Exception:
        return None


def _data_with_photo_urls(data: dict[str, Any]) -> dict[str, Any]:
    enriched = deepcopy(data)
    photo_urls: dict[str, dict[str, str | None]] = {}

    for photo in enriched.get("photos") or []:
        if not isinstance(photo, dict):
            continue
        preview_url = _safe_presigned_url(photo.get("storage_bucket"), photo.get("storage_object_key"))
        thumbnail_url = _safe_presigned_url(photo.get("storage_bucket"), photo.get("thumbnail_object_key")) or preview_url
        photo["preview_url"] = preview_url
        photo["thumbnail_url"] = thumbnail_url
        if photo.get("id"):
            photo_urls[str(photo["id"])] = {
                "preview_url": preview_url,
                "thumbnail_url": thumbnail_url,
            }

    for defect in enriched.get("defects") or []:
        if not isinstance(defect, dict):
            continue
        urls = photo_urls.get(str(defect.get("photo_id")))
        if urls:
            defect["photo_preview_url"] = urls["preview_url"]
            defect["photo_thumbnail_url"] = urls["thumbnail_url"]

    return enriched


def _report_data(db: Session, report: InspectionReport, project: Project) -> dict[str, Any]:
    data = report.report_data_json or {}
    if "defects" not in data or "buildings" not in data:
        data = build_report_data(db, project, report.detection_task_id)
    return _data_with_photo_urls(data)


def _list_item(report: InspectionReport, project: Project) -> ReportListItem:
    data = report.report_data_json or {}
    project_snapshot = data.get("project") or {}
    summary = data.get("summary") or {}
    return ReportListItem(
        id=report.id,
        project_id=report.project_id,
        detection_task_id=report.detection_task_id,
        report_no=report.report_no,
        title=report.title,
        status=report.status,
        project_name=project_snapshot.get("name") or project.name,
        client_name=project_snapshot.get("client_name") or project.client_name,
        address=project_snapshot.get("address") or project.address,
        total_defects=int(summary.get("total_review_results") or 0),
        generated_at=report.generated_at,
        pushed_at=report.pushed_at,
        updated_at=report.updated_at,
    )


def _detail_item(db: Session, report: InspectionReport, project: Project) -> ReportDetailRead:
    data = _report_data(db, report, project)
    return ReportDetailRead(
        id=report.id,
        project_id=report.project_id,
        detection_task_id=report.detection_task_id,
        report_no=report.report_no,
        title=report.title,
        status=report.status,
        report_data_json=report.report_data_json,
        project=data.get("project") or {},
        buildings=data.get("buildings") or [],
        detection_config=data.get("detection_config"),
        detection_task=data.get("detection_task"),
        summary=data.get("summary") or {},
        defects=data.get("defects") or [],
        photos=data.get("photos") or [],
        docx_bucket=report.docx_bucket,
        docx_object_key=report.docx_object_key,
        generated_by=report.generated_by,
        generated_at=report.generated_at,
        pushed_at=report.pushed_at,
        created_at=report.created_at,
        updated_at=report.updated_at,
    )


@router.get("/reports", response_model=list[ReportListItem])
def list_reports(
    include_generated: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> list[ReportListItem]:
    can_manage = _can_manage_reports(current_user)
    criteria: list[object] = [Project.deleted_at.is_(None), _report_access_filter(include_generated and can_manage)]
    if current_user.role == UserRole.CUSTOMER.value:
        criteria.append(Project.created_by == current_user.id)
    rows = db.execute(
        select(InspectionReport, Project)
        .join(Project, Project.id == InspectionReport.project_id)
        .where(*criteria)
        .order_by(InspectionReport.generated_at.desc(), InspectionReport.created_at.desc())
    )
    return [_list_item(report, project) for report, project in rows.all()]


@router.post("/trial/report/docx")
def download_trial_report_docx(
    payload: TrialReportRequest,
    _: AuthenticatedUser = Depends(get_current_user),
) -> StreamingResponse:
    docx_bytes = build_trial_report_docx(payload.model_dump())
    filename = f"简易试用报告-{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}.docx"
    encoded_filename = quote(filename)
    return StreamingResponse(
        BytesIO(docx_bytes),
        media_type=DOCX_CONTENT_TYPE,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
            "Content-Length": str(len(docx_bytes)),
        },
    )


@router.get("/reports/{report_id}", response_model=ReportDetailRead)
def get_report(
    report_id: UUID,
    include_generated: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> ReportDetailRead:
    report, project = _get_report_or_404(
        db,
        report_id,
        current_user=current_user,
        include_generated=include_generated,
    )
    return _detail_item(db, report, project)


@router.post("/reports/{report_id}/push", response_model=ReportDetailRead)
def push_report(
    report_id: UUID,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_roles(UserRole.REVIEWER, UserRole.ADMIN)),
) -> ReportDetailRead:
    report, project = _get_report_or_404(db, report_id, current_user=current_user, include_generated=True)
    if report.status != InspectionReportStatus.GENERATED.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only generated reports can be pushed.",
        )

    now = datetime.now(UTC)
    report.status = InspectionReportStatus.PUSHED.value
    report.pushed_at = now
    project.status = ProjectStatus.COMPLETED.value
    project.completed_at = now
    project.current_report_id = report.id
    project.updated_at = now

    push_log = ReportPushLog(
        project_id=project.id,
        report_id=report.id,
        pushed_by=current_user.id,
        push_target_user_id=project.created_by,
        push_method=ReportPushMethod.PLATFORM.value,
        status=ReportPushStatus.SUCCESS.value,
        pushed_at=now,
    )
    db.add(push_log)
    db.commit()
    db.refresh(report)
    db.refresh(project)
    return _detail_item(db, report, project)


@router.get("/reports/{report_id}/docx")
def download_report_docx(
    report_id: UUID,
    include_generated: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> StreamingResponse:
    report, project = _get_report_or_404(
        db,
        report_id,
        current_user=current_user,
        include_generated=include_generated,
    )
    data = _report_data(db, report, project)
    docx_bytes = build_report_docx(report.title, report.report_no, data)
    filename = f"{_safe_filename(report.report_no)}-{_safe_filename(report.title)}.docx"
    object_key = f"projects/{report.project_id}/reports/{report.id}/{filename}"
    bucket = put_object(
        object_key=object_key,
        data=BytesIO(docx_bytes),
        length=len(docx_bytes),
        content_type=DOCX_CONTENT_TYPE,
    )
    report.docx_bucket = bucket
    report.docx_object_key = object_key
    db.commit()

    encoded_filename = quote(filename)
    return StreamingResponse(
        BytesIO(docx_bytes),
        media_type=DOCX_CONTENT_TYPE,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
            "Content-Length": str(len(docx_bytes)),
        },
    )
