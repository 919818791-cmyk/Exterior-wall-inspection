from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime
from io import BytesIO
from json import JSONDecodeError, loads
from pathlib import Path
from re import sub
from typing import Any
from urllib.parse import quote
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import ValidationError
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
from app.models.tables import InspectionReport, Project, ReportPushLog, TrialDetectionResult
from app.schemas.phase7 import (
    ReportDetailRead,
    ReportListItem,
    TrialGenerateRequest,
    TrialGeneratedResult,
    TrialReportRequest,
)
from app.schemas.projects import DeleteResponse
from app.services.docx_report import build_report_docx
from app.services.object_storage import presigned_get_url, put_object, remove_object
from app.services.photo_metadata import extract_photo_metadata
from app.services.report_data import build_report_data

router = APIRouter(tags=["reports"])

DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
TRIAL_RESULT_TITLE = "AI检测体验结果"
TRIAL_RESULT_SOURCE_NAME = "AI检测体验"
TRIAL_MODEL_TO_DEFECT_TYPE = {
    "裂缝": "crack",
    "开裂": "crack",
    "剥落": "spalling",
}
TRIAL_DEFAULT_MODELS = ["裂缝", "剥落"]
TRIAL_ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png"}
TRIAL_MAX_FILE_COUNT = 20
TRIAL_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024
JPEG_MAGIC_PREFIX = b"\xff\xd8\xff"
PNG_MAGIC_PREFIX = b"\x89PNG\r\n\x1a\n"


def _safe_filename(value: str) -> str:
    filename = sub(r'[\\/:*?"<>|\r\n]+', "_", value).strip(" .")
    return filename or "inspection-report"


def _trial_result_no() -> str:
    timestamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S%f")
    return f"TRY-{timestamp}-{uuid4().hex[:6].upper()}"


def _trial_model_to_defect_type(model: str | None) -> str:
    if not model:
        return "crack"
    return TRIAL_MODEL_TO_DEFECT_TYPE.get(model, model)


def _trial_report_title(report_name: str | None) -> str:
    title = (report_name or "").strip()
    return title or TRIAL_RESULT_TITLE


def _trial_generated_at(value: str) -> datetime:
    normalized = value.strip().replace("Z", "+00:00")
    try:
        generated_at = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid generated_at value.",
        ) from exc
    if generated_at.tzinfo is None:
        return generated_at.replace(tzinfo=UTC)
    return generated_at.astimezone(UTC)


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


def _trial_access_criteria(current_user: AuthenticatedUser) -> list[object]:
    if _can_manage_reports(current_user):
        return []
    return [TrialDetectionResult.generated_by == current_user.id]


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


def _get_trial_result_or_404(
    db: Session,
    result_id: UUID,
    *,
    current_user: AuthenticatedUser,
) -> TrialDetectionResult:
    result = db.scalar(
        select(TrialDetectionResult).where(
            TrialDetectionResult.id == result_id,
            *_trial_access_criteria(current_user),
        )
    )
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Detection result not found.")
    return result


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


def _trial_data_with_photo_urls(data: dict[str, Any]) -> dict[str, Any]:
    enriched = deepcopy(data)
    photo_urls: dict[str, dict[str, str | None]] = {}

    for photo in enriched.get("photos") or []:
        if not isinstance(photo, dict):
            continue
        preview_url = _safe_presigned_url(photo.get("storage_bucket"), photo.get("storage_object_key"))
        photo["preview_url"] = preview_url
        photo["thumbnail_url"] = preview_url
        if photo.get("id"):
            photo_urls[str(photo["id"])] = {
                "preview_url": preview_url,
                "thumbnail_url": preview_url,
            }

    for defect in enriched.get("defects") or []:
        if not isinstance(defect, dict):
            continue
        urls = photo_urls.get(str(defect.get("photo_id")))
        if urls:
            defect["photo_preview_url"] = urls["preview_url"]
            defect["photo_thumbnail_url"] = urls["thumbnail_url"]

    return enriched


def _trial_archive_data(
    *,
    result_no: str,
    generated_at: datetime,
    models: list[str],
    photos: list[dict[str, Any]],
    findings: list[dict[str, Any]],
) -> dict[str, Any]:
    photo_by_name = {photo.get("original_filename"): photo for photo in photos}
    defects: list[dict[str, Any]] = []
    defect_summary: dict[str, int] = {}

    for finding in findings:
        model = str(finding.get("model") or "")
        defect_type = _trial_model_to_defect_type(model)
        defect_summary[defect_type] = defect_summary.get(defect_type, 0) + 1
        filename = finding.get("filename")
        photo = photo_by_name.get(filename)
        defects.append(
            {
                "id": str(uuid4()),
                "photo_id": photo.get("id") if photo else None,
                "photo_filename": filename,
                "building_name": TRIAL_RESULT_SOURCE_NAME,
                "facade_name": "上传照片",
                "defect_type": defect_type,
                "model": model,
                "bbox_json": {},
                "status": "generated",
                "model_version": "trial-standard",
                "review_note": "AI检测体验自动生成，未进入人工审核。",
            }
        )

    return {
        "source_type": "trial",
        "project": {
            "project_no": result_no,
            "name": TRIAL_RESULT_SOURCE_NAME,
            "client_name": "体验用户",
            "created_at": generated_at.isoformat(),
        },
        "summary": {
            "total_review_results": len(defects),
            "by_defect_type": defect_summary,
            "by_status": {"generated": len(defects)},
            "photo_count": len(photos),
            "thermal_available_photo_count": sum(
                1 for photo in photos if photo.get("thermal_imaging_available")
            ),
            "building_count": 0,
            "facade_count": 0,
        },
        "detection_config": {
            "model_types": models,
            "high_precision": False,
            "config_json": {"source": "trial_experience"},
        },
        "detection_task": {
            "task_no": result_no,
            "model_version": "trial-standard",
            "finished_at": generated_at.isoformat(),
        },
        "photos": photos,
        "defects": defects,
    }


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
        source_type="formal",
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


def _trial_list_item(result: TrialDetectionResult) -> ReportListItem:
    data = result.report_data_json or {}
    summary = data.get("summary") or {}
    project_snapshot = data.get("project") or {}
    return ReportListItem(
        id=result.id,
        source_type="trial",
        project_id=None,
        detection_task_id=None,
        report_no=result.result_no,
        title=result.title,
        status=result.status,
        project_name=project_snapshot.get("name") or TRIAL_RESULT_SOURCE_NAME,
        client_name=project_snapshot.get("client_name"),
        address="体验归档",
        total_defects=int(summary.get("total_review_results") or result.finding_count or 0),
        generated_at=result.generated_at,
        pushed_at=None,
        updated_at=result.updated_at,
    )


def _detail_item(db: Session, report: InspectionReport, project: Project) -> ReportDetailRead:
    data = _report_data(db, report, project)
    return ReportDetailRead(
        id=report.id,
        source_type="formal",
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


def _trial_detail_item(result: TrialDetectionResult) -> ReportDetailRead:
    data = _trial_data_with_photo_urls(result.report_data_json or {})
    return ReportDetailRead(
        id=result.id,
        source_type="trial",
        project_id=None,
        detection_task_id=None,
        report_no=result.result_no,
        title=result.title,
        status=result.status,
        report_data_json=result.report_data_json,
        project=data.get("project") or {},
        buildings=[],
        detection_config=data.get("detection_config"),
        detection_task=data.get("detection_task"),
        summary=data.get("summary") or {},
        defects=data.get("defects") or [],
        photos=data.get("photos") or [],
        docx_bucket=None,
        docx_object_key=None,
        generated_by=result.generated_by,
        generated_at=result.generated_at,
        pushed_at=None,
        created_at=result.created_at,
        updated_at=result.updated_at,
    )


def _remove_trial_photo_objects(result: TrialDetectionResult) -> None:
    for photo in (result.report_data_json or {}).get("photos") or []:
        if not isinstance(photo, dict):
            continue
        bucket = photo.get("storage_bucket")
        object_key = photo.get("storage_object_key")
        if bucket and object_key:
            remove_object(bucket, object_key)


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
    items = [_list_item(report, project) for report, project in rows.all()]
    trial_results = db.scalars(
        select(TrialDetectionResult)
        .where(*_trial_access_criteria(current_user))
        .order_by(TrialDetectionResult.generated_at.desc(), TrialDetectionResult.created_at.desc())
    )
    items.extend(_trial_list_item(result) for result in trial_results)
    return sorted(items, key=lambda item: (item.generated_at, item.updated_at), reverse=True)


def _trial_payload_from_form(payload: str) -> dict[str, Any]:
    try:
        payload_data = loads(payload)
    except JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid trial payload JSON.") from exc
    if not isinstance(payload_data, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid trial payload.")
    return payload_data


def _trial_file_entries(uploaded_files: list[UploadFile]) -> list[dict[str, Any]]:
    if not uploaded_files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请先上传照片。")
    if len(uploaded_files) > TRIAL_MAX_FILE_COUNT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"单次最多上传 {TRIAL_MAX_FILE_COUNT} 张照片。",
        )

    file_entries: list[dict[str, Any]] = []
    for uploaded_file in uploaded_files:
        content_type = (uploaded_file.content_type or "").split(";")[0].strip().lower()
        if content_type not in TRIAL_ALLOWED_CONTENT_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="仅支持 JPG、PNG 图片。",
            )

        uploaded_file.file.seek(0, 2)
        file_size = uploaded_file.file.tell()
        uploaded_file.file.seek(0)
        if file_size <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty.")
        if file_size > TRIAL_MAX_FILE_SIZE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="单张图片最大 20MB。",
            )

        header = uploaded_file.file.read(8)
        uploaded_file.file.seek(0)
        is_jpeg = content_type == "image/jpeg" and header.startswith(JPEG_MAGIC_PREFIX)
        is_png = content_type == "image/png" and header.startswith(PNG_MAGIC_PREFIX)
        if not is_jpeg and not is_png:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="图片格式与文件内容不匹配。",
            )

        file_entries.append({"filename": uploaded_file.filename or "trial-photo", "size": file_size})
    return file_entries


def _trial_generate_request_from_form(payload: str, uploaded_files: list[UploadFile]) -> tuple[TrialGenerateRequest, list[dict[str, Any]]]:
    payload_data = _trial_payload_from_form(payload)
    file_entries = _trial_file_entries(uploaded_files)
    try:
        request = TrialGenerateRequest.model_validate(payload_data)
    except ValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=exc.errors()) from exc
    return request, file_entries


def _trial_request_from_form(payload: str, uploaded_files: list[UploadFile]) -> tuple[TrialReportRequest, list[dict[str, Any]]]:
    payload_data = _trial_payload_from_form(payload)
    file_entries = _trial_file_entries(uploaded_files)
    payload_data["files"] = file_entries
    try:
        request = TrialReportRequest.model_validate(payload_data)
    except ValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=exc.errors()) from exc
    return request, file_entries


def _trial_findings_for_files(file_entries: list[dict[str, Any]], models: list[str]) -> list[dict[str, str]]:
    selected_models = [model for model in models if model] or TRIAL_DEFAULT_MODELS
    return [
        {
            "filename": str(entry["filename"]),
            "model": selected_models[index % len(selected_models)],
        }
        for index, entry in enumerate(file_entries)
    ]


def _stored_trial_photos(result_id: UUID, uploaded_files: list[UploadFile], file_entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    stored_photos: list[dict[str, Any]] = []
    for index, uploaded_file in enumerate(uploaded_files):
        entry = file_entries[index]
        suffix = Path(uploaded_file.filename or "").suffix.lower()
        object_id = uuid4()
        object_key = f"trial-results/{result_id}/photos/{index + 1:03d}-{object_id}{suffix or '.bin'}"
        metadata = extract_photo_metadata(uploaded_file.file)
        bucket = put_object(
            object_key=object_key,
            data=uploaded_file.file,
            length=int(entry["size"]),
            content_type=uploaded_file.content_type,
        )
        stored_photos.append(
            {
                "id": str(uuid4()),
                "original_filename": entry["filename"],
                "file_size": entry["size"],
                "mime_type": uploaded_file.content_type,
                "photo_type": "trial",
                "metadata_json": metadata,
                "thermal_imaging_available": metadata["thermal_imaging_available"],
                "storage_bucket": bucket,
                "storage_object_key": object_key,
            }
        )
    return stored_photos


@router.post("/trial/generate", response_model=TrialGeneratedResult)
def generate_trial_result(
    payload: str = Form("{}"),
    files: list[UploadFile] = File(...),
    _current_user: AuthenticatedUser = Depends(get_current_user),
) -> TrialGeneratedResult:
    trial_request, file_entries = _trial_generate_request_from_form(payload, files)
    models = [model for model in trial_request.models if model] or TRIAL_DEFAULT_MODELS
    return TrialGeneratedResult(
        report_name=trial_request.report_name,
        generated_at=datetime.now(UTC).isoformat(),
        models=models,
        files=file_entries,
        findings=_trial_findings_for_files(file_entries, models),
    )


@router.post("/trial/results", response_model=ReportDetailRead, status_code=status.HTTP_201_CREATED)
def create_trial_result(
    payload: str = Form(...),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> ReportDetailRead:
    trial_request, file_entries = _trial_request_from_form(payload, files)
    result_id = uuid4()
    request_data = trial_request.model_dump()
    generated_at = _trial_generated_at(request_data["generated_at"])
    result_no = _trial_result_no()
    stored_photos = _stored_trial_photos(result_id, files, file_entries)
    report_title = _trial_report_title(request_data.get("report_name"))
    archive_data = _trial_archive_data(
        result_no=result_no,
        generated_at=generated_at,
        models=request_data["models"],
        photos=stored_photos,
        findings=request_data["findings"],
    )
    result = TrialDetectionResult(
        id=result_id,
        result_no=result_no,
        title=report_title,
        status=InspectionReportStatus.GENERATED.value,
        report_data_json=archive_data,
        photo_count=len(stored_photos),
        finding_count=len(request_data["findings"]),
        thermal_available_photo_count=sum(
            1 for photo in stored_photos if photo.get("thermal_imaging_available")
        ),
        generated_by=current_user.id,
        generated_at=generated_at,
    )
    db.add(result)
    db.commit()
    db.refresh(result)
    return _trial_detail_item(result)


@router.get("/reports/{report_id}", response_model=ReportDetailRead)
def get_report(
    report_id: UUID,
    include_generated: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> ReportDetailRead:
    try:
        report, project = _get_report_or_404(
            db,
            report_id,
            current_user=current_user,
            include_generated=include_generated,
        )
        return _detail_item(db, report, project)
    except HTTPException as exc:
        if exc.status_code != status.HTTP_404_NOT_FOUND:
            raise
    return _trial_detail_item(_get_trial_result_or_404(db, report_id, current_user=current_user))


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


@router.delete("/reports/{report_id}", response_model=DeleteResponse)
def delete_report(
    report_id: UUID,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> DeleteResponse:
    try:
        report, project = _get_report_or_404(
            db,
            report_id,
            current_user=current_user,
            include_generated=_can_manage_reports(current_user),
        )
    except HTTPException as exc:
        if exc.status_code != status.HTTP_404_NOT_FOUND:
            raise
        trial_result = _get_trial_result_or_404(db, report_id, current_user=current_user)
        _remove_trial_photo_objects(trial_result)
        db.delete(trial_result)
        db.commit()
        return DeleteResponse()

    if report.docx_bucket and report.docx_object_key:
        remove_object(report.docx_bucket, report.docx_object_key)
    if project.current_report_id == report.id:
        project.current_report_id = None
        project.updated_at = datetime.now(UTC)
    db.delete(report)
    db.commit()
    return DeleteResponse()


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
