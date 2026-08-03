from __future__ import annotations

import asyncio
import hashlib
import logging
from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, datetime
from io import BytesIO
from json import JSONDecodeError, dumps, loads
from pathlib import Path
from re import sub
from time import perf_counter
from typing import Any
from urllib.parse import quote
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import ValidationError
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.dependencies import (
    AuthenticatedUser,
    ensure_project_access,
    get_current_user,
    require_roles,
)
from app.core.config import get_settings
from app.db.session import get_db
from app.enums.status import (
    InspectionReportStatus,
    PhotoPrecheckStatus,
    ProjectStatus,
    ReportPushMethod,
    ReportPushStatus,
    UserRole,
)
from app.models.tables import InspectionReport, Project, QuickDetectionPhoto, ReportPushLog, TrialDetectionResult
from app.schemas.phase7 import (
    ReportDetailRead,
    ReportListItem,
    ReportTitleUpdate,
    TrialGenerateRequest,
    TrialGeneratedResult,
    TrialReportRequest,
    TrialUploadedPhotoRead,
)
from app.schemas.projects import DeleteResponse
from app.services.docx_report import build_report_docx
from app.services.inference_scheduling import (
    InferenceUsageReservation,
    reserve_inference_usage,
)
from app.services.local_qwen_lifecycle import start_local_qwen
from app.services.object_storage import get_object_bytes, presigned_get_url, put_object, remove_object, signed_object_url
from app.services.photo_metadata import extract_photo_metadata
from app.services.photo_precheck import run_stored_photo_precheck
from app.services.report_data import build_report_data
from app.services.trial_qwen_inference import (
    DEFAULT_MAX_IMAGE_PIXELS,
    DEFAULT_INFERENCE_MAX_IMAGE_PIXELS,
    DEFAULT_MAX_TILES_PER_IMAGE,
    DEFAULT_MAX_TILES_PER_REQUEST,
    NMS_IOU_THRESHOLD,
    TILE_HEIGHT,
    TILE_OVERLAP_RATIO,
    TILE_WIDTH,
    TrialQwenImageInput,
    estimate_trial_api_request_count,
    infer_trial_images,
)
from app.services.trial_inference_provider import (
    active_trial_inference_runtime,
    trial_prompts,
    trial_scheduling_settings,
)
from app.services.trial_pdf_report import TrialPdfExportError, build_trial_result_pdf
from app.services.usage_control import (
    SecurityStoreUnavailable,
    enforce_limit,
    get_usage_store,
)
from app.services.usage_tracking import add_inference_usage_event, add_photo_upload_event

router = APIRouter(tags=["reports"])
logger = logging.getLogger(__name__)

DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
PDF_CONTENT_TYPE = "application/pdf"
TRIAL_RESULT_SOURCE_NAME = "简易AI检测"
TRIAL_RESULT_ARCHIVE_ADDRESS = "简易检测归档"
TRIAL_RESULT_CLIENT_NAME = "平台用户"
TRIAL_MODEL_VERSION = "exterior-wall-vision-1280x960-overlap-fusion-nms-v3"
TRIAL_MODEL_TO_DEFECT_TYPE = {
    "裂缝": "crack",
    "开裂": "crack",
    "missing": "spalling",
    "面砖剥落": "spalling",
    "瓷砖剥落": "spalling",
    "面砖缺失": "spalling",
    "剥落": "spalling",
    "潮湿": "moisture",
    "锈蚀": "corrosion",
    "空鼓": "hollow",
    "hollow": "hollow",
}
TRIAL_DEFECT_TYPE_TO_MODEL = {
    "crack": "裂缝",
    "spalling": "剥落",
    "moisture": "潮湿",
    "corrosion": "锈蚀",
    "hollow": "空鼓",
}
TRIAL_DEFAULT_MODELS = ["裂缝", "剥落", "空鼓"]
TRIAL_RESULT_CONFIDENCE_THRESHOLD = 0.6
TRIAL_ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png"}
TRIAL_MAX_FILE_COUNT = 10
TRIAL_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024
TRIAL_REQUEST_CACHE_TTL_SECONDS = 24 * 60 * 60
TRIAL_RESULT_TIMEZONE = ZoneInfo("Asia/Shanghai")
TRIAL_RESULT_DAILY_LIMIT = 999
JPEG_MAGIC_PREFIX = b"\xff\xd8\xff"
PNG_MAGIC_PREFIX = b"\x89PNG\r\n\x1a\n"


@dataclass(frozen=True, slots=True)
class _TrialStoredPhotoSource:
    photo_id: UUID
    filename: str
    content_type: str | None
    storage_bucket: str
    storage_object_key: str
    thermal_imaging_available: bool = False


def _reserve_trial_usage(
    current_user: AuthenticatedUser,
    api_request_count: int,
    *,
    db: Session | None = None,
    generate_limit_detail: str = "简易检测请求过于频繁，请稍后重试。",
) -> InferenceUsageReservation:
    return reserve_inference_usage(
        current_user.id,
        api_request_count,
        db=db,
        generate_limit_detail=generate_limit_detail,
        settings=get_settings(),
    )


def _enforce_trial_upload_limit(
    current_user: AuthenticatedUser,
    db: Session | None = None,
) -> None:
    settings = get_settings()
    scheduling = trial_scheduling_settings(db, settings)
    store = get_usage_store()
    user_identity = str(current_user.id)
    enforce_limit(
        store,
        "trial:upload:user",
        user_identity,
        limit=scheduling.upload_limit_per_user,
        ttl_seconds=scheduling.upload_window_seconds,
        detail="照片上传过于频繁，请稍后重试。",
    )


def _safe_filename(value: str) -> str:
    filename = sub(r'[\\/:*?"<>|\r\n]+', "_", value).strip(" .")
    return filename or "inspection-report"


def _trial_result_number_date() -> str:
    return datetime.now(TRIAL_RESULT_TIMEZONE).strftime("%Y%m%d")


def _trial_result_no(db: Session) -> str:
    result_date = _trial_result_number_date()
    prefix = f"TRY-{result_date}-"

    # Trial and formal project numbers use separate transaction lock spaces.
    # This keeps daily sequence allocation safe under concurrent archiving.
    db.execute(select(func.pg_advisory_xact_lock(2, int(result_date))))
    existing_numbers = db.scalars(
        select(TrialDetectionResult.result_no).where(
            TrialDetectionResult.result_no.like(f"{prefix}___")
        )
    ).all()
    last_sequence = max(
        (
            int(result_no.removeprefix(prefix))
            for result_no in existing_numbers
            if result_no.removeprefix(prefix).isdigit()
        ),
        default=0,
    )
    next_sequence = last_sequence + 1
    if next_sequence > TRIAL_RESULT_DAILY_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The daily trial result number limit has been reached.",
        )
    return f"{prefix}{next_sequence:03d}"


def _trial_request_cache_identity(current_user: AuthenticatedUser, request_id: str) -> str:
    return f"{current_user.id}:{request_id}"


def _trial_request_cache_get(current_user: AuthenticatedUser, request_id: str) -> dict[str, Any] | None:
    try:
        return get_usage_store().cache_get(
            "trial-generation-request",
            _trial_request_cache_identity(current_user, request_id),
        )
    except SecurityStoreUnavailable as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


def _trial_request_cache_set(
    current_user: AuthenticatedUser,
    request_id: str,
    value: dict[str, Any],
) -> None:
    try:
        get_usage_store().cache_set(
            "trial-generation-request",
            _trial_request_cache_identity(current_user, request_id),
            value,
            ttl_seconds=TRIAL_REQUEST_CACHE_TTL_SECONDS,
        )
    except SecurityStoreUnavailable as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


def _trial_model_to_defect_type(model: str | None) -> str:
    if not model:
        return "crack"
    return TRIAL_MODEL_TO_DEFECT_TYPE.get(model, model)


def _trial_report_title(report_name: str | None, project_no: str) -> str:
    title = (report_name or "").strip()
    return title or project_no


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


def _project_reviewed_result_visible(project: Project) -> bool:
    return project.status in {
        ProjectStatus.REVIEWED.value,
        ProjectStatus.COMPLETED.value,
    }


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
    include_deleted: bool = False,
) -> TrialDetectionResult:
    criteria: list[object] = [
        TrialDetectionResult.id == result_id,
        *_trial_access_criteria(current_user),
    ]
    if not include_deleted:
        criteria.append(TrialDetectionResult.deleted_at.is_(None))
    result = db.scalar(
        select(TrialDetectionResult).where(*criteria)
    )
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Detection result not found.")
    return result


def _api_base_url(request: Request) -> str:
    headers = getattr(request, "headers", {})
    request_url = getattr(request, "url", None)
    scheme = headers.get("x-forwarded-proto") or getattr(request_url, "scheme", "http")
    host = headers.get("x-forwarded-host") or headers.get("host") or getattr(request_url, "netloc", "testserver")
    prefix = get_settings().api_prefix.strip("/")
    return f"{scheme}://{host}/{prefix}" if prefix else f"{scheme}://{host}"


def _safe_photo_url(request: Request | None, bucket: str | None, object_key: str | None) -> str | None:
    if not bucket or not object_key:
        return None
    try:
        if request is not None:
            return signed_object_url(_api_base_url(request), bucket, object_key)
        return presigned_get_url(bucket, object_key)
    except Exception:
        return None


def _first_photo_url(data: dict[str, Any], request: Request | None = None) -> str | None:
    photos = data.get("photos") or []
    if not photos or not isinstance(photos[0], dict):
        return None
    photo = photos[0]
    return (
        _safe_photo_url(request, photo.get("storage_bucket"), photo.get("thumbnail_object_key"))
        or _safe_photo_url(request, photo.get("storage_bucket"), photo.get("storage_object_key"))
        or photo.get("thumbnail_url")
        or photo.get("preview_url")
    )


def _data_with_photo_urls(data: dict[str, Any], request: Request | None = None) -> dict[str, Any]:
    enriched = deepcopy(data)
    photo_urls: dict[str, dict[str, str | None]] = {}

    for photo in enriched.get("photos") or []:
        if not isinstance(photo, dict):
            continue
        preview_url = _safe_photo_url(request, photo.get("storage_bucket"), photo.get("storage_object_key"))
        thumbnail_url = _safe_photo_url(request, photo.get("storage_bucket"), photo.get("thumbnail_object_key")) or preview_url
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


def _trial_data_with_photo_urls(data: dict[str, Any], request: Request | None = None) -> dict[str, Any]:
    enriched = deepcopy(data)
    photo_urls: dict[str, dict[str, str | None]] = {}

    for photo in enriched.get("photos") or []:
        if not isinstance(photo, dict):
            continue
        preview_url = _safe_photo_url(request, photo.get("storage_bucket"), photo.get("storage_object_key"))
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
    raw_model_outputs: list[dict[str, Any]],
) -> dict[str, Any]:
    photo_by_id = {str(photo.get("id")): photo for photo in photos if photo.get("id")}
    photo_by_name = {photo.get("original_filename"): photo for photo in photos}
    defects: list[dict[str, Any]] = []
    defect_summary: dict[str, int] = {}

    for finding in findings:
        model = str(finding.get("model") or "")
        defect_type = _trial_model_to_defect_type(model)
        defect_summary[defect_type] = defect_summary.get(defect_type, 0) + 1
        filename = finding.get("filename")
        photo = photo_by_id.get(str(finding.get("photo_id"))) or photo_by_name.get(filename)
        defects.append(
            {
                "id": str(uuid4()),
                "photo_id": photo.get("id") if photo else None,
                "photo_filename": filename,
                "defect_type": defect_type,
                "model": model,
                "confidence": finding.get("confidence"),
                "bbox_json": finding.get("bbox") if isinstance(finding.get("bbox"), dict) else {},
                "status": "generated",
                "model_version": TRIAL_MODEL_VERSION,
                "raw_result_json": {
                    "detection_id": finding.get("detection_id"),
                    "finding": finding,
                },
                "review_note": "简易AI检测自动生成，未进入人工审核。",
            }
        )

    return {
        "source_type": "trial",
        "project": {
            "project_no": result_no,
            "name": TRIAL_RESULT_SOURCE_NAME,
            "client_name": TRIAL_RESULT_CLIENT_NAME,
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
        },
        "detection_config": {
            "model_types": models,
            "high_precision": False,
            "config_json": {"source": "quick_detection"},
        },
        "detection_task": {
            "task_no": result_no,
            "model_version": TRIAL_MODEL_VERSION,
            "finished_at": generated_at.isoformat(),
        },
        "photos": photos,
        "defects": defects,
        "raw_model_outputs": raw_model_outputs,
    }


def _report_data(db: Session, report: InspectionReport, project: Project, request: Request | None = None) -> dict[str, Any]:
    data = report.report_data_json or {}
    if "defects" not in data or "photos" not in data:
        data = build_report_data(db, project, report.detection_task_id)
    return _data_with_photo_urls(data, request)


def _list_item(
    report: InspectionReport,
    project: Project,
    request: Request | None = None,
) -> ReportListItem:
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
        photo_count=int(summary.get("photo_count") or len(data.get("photos") or [])),
        first_photo_url=_first_photo_url(data, request),
        generated_at=report.generated_at,
        pushed_at=report.pushed_at,
        updated_at=report.updated_at,
    )


def _trial_list_item(
    result: TrialDetectionResult,
    request: Request | None = None,
) -> ReportListItem:
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
        address=TRIAL_RESULT_ARCHIVE_ADDRESS,
        total_defects=int(summary.get("total_review_results") or result.finding_count or 0),
        photo_count=int(summary.get("photo_count") or len(data.get("photos") or [])),
        first_photo_url=_first_photo_url(data, request),
        generated_at=result.generated_at,
        pushed_at=None,
        updated_at=result.updated_at,
    )


def _detail_item(db: Session, report: InspectionReport, project: Project, request: Request | None = None) -> ReportDetailRead:
    data = _report_data(db, report, project, request)
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
        detection_config=data.get("detection_config"),
        detection_task=data.get("detection_task"),
        summary=data.get("summary") or {},
        defects=data.get("defects") or [],
        photos=data.get("photos") or [],
        raw_model_outputs=data.get("raw_model_outputs") or [],
        docx_bucket=report.docx_bucket,
        docx_object_key=report.docx_object_key,
        generated_by=report.generated_by,
        generated_at=report.generated_at,
        pushed_at=report.pushed_at,
        created_at=report.created_at,
        updated_at=report.updated_at,
    )


def _trial_detail_item(result: TrialDetectionResult, request: Request | None = None) -> ReportDetailRead:
    data = _trial_data_with_photo_urls(result.report_data_json or {}, request)
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
        detection_config=data.get("detection_config"),
        detection_task=data.get("detection_task"),
        summary=data.get("summary") or {},
        defects=data.get("defects") or [],
        photos=data.get("photos") or [],
        raw_model_outputs=data.get("raw_model_outputs") or [],
        docx_bucket=None,
        docx_object_key=None,
        generated_by=result.generated_by,
        generated_at=result.generated_at,
        pushed_at=None,
        created_at=result.created_at,
        updated_at=result.updated_at,
    )


@router.get("/reports", response_model=list[ReportListItem])
def list_reports(
    request: Request = None,
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
    items = [_list_item(report, project, request) for report, project in rows.all()]
    trial_results = db.scalars(
        select(TrialDetectionResult)
        .where(
            TrialDetectionResult.deleted_at.is_(None),
            *_trial_access_criteria(current_user),
        )
        .order_by(TrialDetectionResult.generated_at.desc(), TrialDetectionResult.created_at.desc())
    )
    items.extend(_trial_list_item(result, request) for result in trial_results)
    return sorted(items, key=lambda item: (item.generated_at, item.updated_at), reverse=True)


@router.get(
    "/projects/{project_id}/reviewed-result",
    response_model=ReportDetailRead,
)
def get_project_reviewed_result(
    request: Request,
    project_id: UUID,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> ReportDetailRead:
    """Return the project's single result after review is complete.

    Reviewers can inspect draft results through the review endpoints.  This
    endpoint is used by the detection-workbench detail page, so it deliberately
    keeps AI output hidden until review is complete.
    """
    project = db.get(Project, project_id)
    if project is None or project.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found.",
        )
    ensure_project_access(project, current_user)
    if not _project_reviewed_result_visible(project):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reviewed detection result not found.",
        )

    report = (
        db.get(InspectionReport, project.current_report_id)
        if project.current_report_id is not None
        else None
    )
    if report is None or report.status not in {
        InspectionReportStatus.GENERATED.value,
        InspectionReportStatus.PUSHED.value,
    }:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reviewed detection result not found.",
        )
    return _detail_item(db, report, project, request)


def _trial_payload_from_form(payload: str) -> dict[str, Any]:
    try:
        payload_data = loads(payload)
    except JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid trial payload JSON.") from exc
    if not isinstance(payload_data, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid trial payload.")
    return payload_data


def _trial_file_entries(uploaded_files: list[UploadFile]) -> list[dict[str, Any]]:
    max_file_size = getattr(get_settings(), "trial_max_file_size_bytes", TRIAL_MAX_FILE_SIZE_BYTES)
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
        if file_size > max_file_size:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"单张图片最大 {max_file_size // (1024 * 1024)}MB。",
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


async def _trial_form_payload_and_files(request: Request) -> tuple[str, list[UploadFile]]:
    form = await request.form()
    payload = str(form.get("payload") or "{}")
    uploaded_files = [
        value
        for key, value in form.multi_items()
        if key == "files" and hasattr(value, "file") and hasattr(value, "filename")
    ]
    return payload, uploaded_files


async def _trial_payload_from_json_request(request: Request) -> dict[str, Any]:
    try:
        payload_data = await request.json()
    except JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid trial payload JSON.") from exc
    if not isinstance(payload_data, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid trial payload.")
    return payload_data


def _is_multipart_request(request: Request) -> bool:
    return "multipart/form-data" in (request.headers.get("content-type") or "").lower()


def _trial_generate_request_from_payload(payload_data: dict[str, Any]) -> TrialGenerateRequest:
    try:
        return TrialGenerateRequest.model_validate(payload_data)
    except ValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=exc.errors()) from exc


def _trial_report_request_from_payload(payload_data: dict[str, Any]) -> TrialReportRequest:
    try:
        return TrialReportRequest.model_validate(payload_data)
    except ValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=exc.errors()) from exc


def _trial_generate_request_from_form(payload: str, uploaded_files: list[UploadFile]) -> tuple[TrialGenerateRequest, list[dict[str, Any]]]:
    payload_data = _trial_payload_from_form(payload)
    file_entries = _trial_file_entries(uploaded_files)
    return _trial_generate_request_from_payload(payload_data), file_entries


def _trial_request_from_form(payload: str, uploaded_files: list[UploadFile]) -> tuple[TrialReportRequest, list[dict[str, Any]]]:
    payload_data = _trial_payload_from_form(payload)
    file_entries = _trial_file_entries(uploaded_files)
    payload_data["files"] = file_entries
    return _trial_report_request_from_payload(payload_data), file_entries


def _quick_detection_photos_for_user(
    db: Session,
    current_user: AuthenticatedUser,
    photo_ids: list[UUID],
) -> list[QuickDetectionPhoto]:
    if not photo_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请先上传照片。")
    if len(photo_ids) > TRIAL_MAX_FILE_COUNT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"单次最多上传 {TRIAL_MAX_FILE_COUNT} 张照片。",
        )

    unique_photo_ids = list(dict.fromkeys(photo_ids))
    photos = db.scalars(
        select(QuickDetectionPhoto).where(
            QuickDetectionPhoto.id.in_(unique_photo_ids),
            QuickDetectionPhoto.uploaded_by == current_user.id,
            QuickDetectionPhoto.generated_result_id.is_(None),
        )
    ).all()
    photo_by_id = {photo.id: photo for photo in photos}
    if len(photo_by_id) != len(unique_photo_ids):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Uploaded photo not found.")
    ordered_photos = [photo_by_id[photo_id] for photo_id in photo_ids]
    incomplete = [
        photo
        for photo in ordered_photos
        if (getattr(photo, "precheck_status", None) or PhotoPrecheckStatus.PASSED.value)
        in {
            PhotoPrecheckStatus.PENDING.value,
            PhotoPrecheckStatus.RUNNING.value,
            PhotoPrecheckStatus.ERROR.value,
        }
    ]
    if incomplete:
        status_counts = {
            value: sum(
                1
                for photo in incomplete
                if getattr(photo, "precheck_status", None) == value
            )
            for value in (
                PhotoPrecheckStatus.PENDING.value,
                PhotoPrecheckStatus.RUNNING.value,
                PhotoPrecheckStatus.ERROR.value,
            )
        }
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "照片预检尚未全部完成："
                f"待处理 {status_counts['pending']} 张、"
                f"处理中 {status_counts['running']} 张、"
                f"预检失败 {status_counts['error']} 张。"
                "请等待正在处理的照片；预检失败照片请删除后重新上传。"
            ),
        )
    qualified = [
        photo
        for photo in ordered_photos
        if (getattr(photo, "precheck_status", None) or PhotoPrecheckStatus.PASSED.value)
        == PhotoPrecheckStatus.PASSED.value
    ]
    if not qualified:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="没有通过建筑照片预检的照片，无法开始检测。",
        )
    return qualified


def _trial_file_entries_for_quick_photos(photos: list[QuickDetectionPhoto]) -> list[dict[str, Any]]:
    return [
        {
            "photo_id": photo.id,
            "filename": photo.original_filename,
            "size": photo.file_size,
        }
        for photo in photos
    ]


def _validate_trial_photo_model_compatibility(
    photos: list[QuickDetectionPhoto],
    models: list[str],
) -> None:
    selected_models = set(models)
    thermal_photo_count = sum(
        1 for photo in photos if photo.thermal_imaging_available
    )
    visible_photo_count = len(photos) - thermal_photo_count
    if thermal_photo_count and "空鼓" not in selected_models:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="热成像图片只执行空鼓检测，请勾选空鼓或移除热成像图片。",
        )
    if visible_photo_count and not selected_models.intersection({"裂缝", "剥落"}):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="可见光图片只执行裂缝或剥落检测，请至少勾选其中一项或移除可见光图片。",
        )


async def _trial_inference_requests(
    images: list[TrialQwenImageInput],
    db: Session,
    models: list[str],
) -> list[dict[str, Any]]:
    settings = get_settings()
    runtime = active_trial_inference_runtime(db)
    prompts = trial_prompts(db)
    visible_defect_types = [
        TRIAL_MODEL_TO_DEFECT_TYPE[model]
        for model in models
        if model in {"裂缝", "剥落"}
    ]
    if runtime.provider == "local_qwen":
        local_status = start_local_qwen(settings)
        if local_status.state != "running":
            raise RuntimeError(local_status.message)
    if not runtime.configured:
        if runtime.provider == "local_qwen":
            raise RuntimeError("LOCAL_QWEN_API_BASE_URL or LOCAL_QWEN_MODEL is not configured.")
        variable = "ZHIPU_API_KEY" if runtime.provider == "zhipu" else "DASHSCOPE_API_KEY"
        raise RuntimeError(f"{variable} is not configured.")
    return await infer_trial_images(
        images,
        api_key=runtime.api_key,
        base_url=runtime.base_url,
        model=runtime.model,
        provider=runtime.upstream_provider,
        visible_prompt=prompts.visible_prompt_for_models(models),
        thermal_prompt=prompts.thermal_prompt,
        visible_defect_types=visible_defect_types,
        timeout_seconds=runtime.timeout_seconds,
        max_concurrency=runtime.max_concurrency,
        max_image_pixels=getattr(settings, "trial_max_image_pixels", DEFAULT_MAX_IMAGE_PIXELS),
        inference_max_image_pixels=getattr(
            settings,
            "trial_inference_max_image_pixels",
            DEFAULT_INFERENCE_MAX_IMAGE_PIXELS,
        ),
        max_tiles_per_image=getattr(
            settings,
            "trial_max_tiles_per_image",
            DEFAULT_MAX_TILES_PER_IMAGE,
        ),
        max_tiles_per_request=getattr(
            settings,
            "trial_max_tiles_per_request",
            DEFAULT_MAX_TILES_PER_REQUEST,
        ),
    )


def _trial_findings_from_inference(
    *,
    entry: dict[str, Any],
    inference: dict[str, Any],
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    image = inference.get("image") if isinstance(inference.get("image"), dict) else {}
    for index, detection in enumerate(inference.get("detections") or []):
        defect_type = _trial_model_to_defect_type(str(detection.get("type") or ""))
        model = TRIAL_DEFECT_TYPE_TO_MODEL.get(defect_type)
        bbox = detection.get("bbox")
        if model is None or not isinstance(bbox, dict):
            continue
        try:
            confidence = float(detection.get("confidence"))
        except (TypeError, ValueError):
            continue
        if confidence <= TRIAL_RESULT_CONFIDENCE_THRESHOLD:
            continue
        findings.append(
            {
                "photo_id": entry.get("photo_id"),
                "filename": str(entry["filename"]),
                "model": model,
                "confidence": confidence,
                "bbox": bbox,
                "image_width": image.get("width"),
                "image_height": image.get("height"),
                "detection_id": detection.get("id") or f"trial-{index + 1}",
                "description": detection.get("description"),
            }
        )
    return findings


def _trial_confidence(value: object) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _trial_result_findings(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        finding
        for finding in findings
        if (
            (confidence := _trial_confidence(finding.get("confidence"))) is not None
            and confidence > TRIAL_RESULT_CONFIDENCE_THRESHOLD
        )
    ]


def _trial_model_output_from_inference(
    *,
    entry: dict[str, Any],
    inference: dict[str, Any],
) -> dict[str, Any]:
    image = inference.get("image") if isinstance(inference.get("image"), dict) else {}
    detections: list[dict[str, Any]] = []
    for index, detection in enumerate(inference.get("detections") or []):
        if not isinstance(detection, dict):
            continue
        defect_type = _trial_model_to_defect_type(str(detection.get("type") or ""))
        model = TRIAL_DEFECT_TYPE_TO_MODEL.get(defect_type, defect_type)
        confidence = _trial_confidence(detection.get("confidence"))
        detections.append(
            {
                "detection_id": detection.get("id") or f"trial-{index + 1}",
                "type": defect_type,
                "type_name": detection.get("type_name"),
                "model": model,
                "confidence": confidence,
                "bbox": detection.get("bbox") if isinstance(detection.get("bbox"), dict) else None,
                "severity": detection.get("severity"),
                "description": detection.get("description"),
                "visible": confidence is not None and confidence > TRIAL_RESULT_CONFIDENCE_THRESHOLD,
            }
        )
    inference_config = inference.get("inference") if isinstance(inference.get("inference"), dict) else {}
    requested_models = [
        TRIAL_DEFECT_TYPE_TO_MODEL.get(str(model), str(model))
        for model in inference.get("requested_models") or []
    ]
    return {
        "photo_id": entry.get("photo_id"),
        "filename": str(entry["filename"]),
        "image_width": image.get("width"),
        "image_height": image.get("height"),
        "upstream_provider": inference.get("provider") or "qwen",
        "upstream_model": inference.get("model_version"),
        "model_version": TRIAL_MODEL_VERSION,
        "requested_models": requested_models or TRIAL_DEFAULT_MODELS,
        "executed_models": inference.get("executed_models") or [],
        "tile_width": inference_config.get("tile_width", TILE_WIDTH),
        "tile_height": inference_config.get("tile_height", TILE_HEIGHT),
        "tile_overlap_ratio": inference_config.get("tile_overlap_ratio", TILE_OVERLAP_RATIO),
        "tile_count": inference_config.get("tile_count"),
        "token_usage": inference.get("token_usage"),
        "tile_token_usages": inference.get("tile_token_usages") or [],
        "deduplication_method": "cross_tile_union+nms",
        "cross_tile_merge_method": inference_config.get("cross_tile_merge_method"),
        "cross_tile_merge_ios_threshold": inference_config.get(
            "cross_tile_merge_ios_threshold"
        ),
        "pre_merge_detection_count": inference_config.get(
            "pre_merge_detection_count"
        ),
        "post_merge_detection_count": inference_config.get(
            "post_merge_detection_count"
        ),
        "nms_iou_threshold": inference_config.get("nms_iou_threshold", NMS_IOU_THRESHOLD),
        "detections": detections,
    }


def _trial_inference_unavailable(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="视觉检测服务暂时不可用，请稍后重试。",
    )


async def _trial_images_for_quick_photos(
    photos: list[_TrialStoredPhotoSource],
) -> list[TrialQwenImageInput]:
    try:
        images: list[TrialQwenImageInput] = []
        for photo in photos:
            content = await asyncio.to_thread(
                get_object_bytes,
                photo.storage_bucket,
                photo.storage_object_key,
            )
            images.append(
                TrialQwenImageInput(
                    filename=photo.filename,
                    content=content,
                    content_type=photo.content_type,
                    photo_id=photo.photo_id,
                    thermal_imaging_available=photo.thermal_imaging_available,
                )
            )
    except Exception as exc:
        logger.exception("trial_image_prepare_failed source=object_storage error_type=%s", type(exc).__name__)
        raise _trial_inference_unavailable(exc) from exc
    return images


def _trial_estimated_api_request_count(images: list[TrialQwenImageInput]) -> int:
    settings = get_settings()
    try:
        return estimate_trial_api_request_count(
            images,
            max_image_pixels=getattr(settings, "trial_max_image_pixels", DEFAULT_MAX_IMAGE_PIXELS),
            inference_max_image_pixels=getattr(
                settings,
                "trial_inference_max_image_pixels",
                DEFAULT_INFERENCE_MAX_IMAGE_PIXELS,
            ),
            max_tiles_per_image=getattr(
                settings,
                "trial_max_tiles_per_image",
                DEFAULT_MAX_TILES_PER_IMAGE,
            ),
            max_tiles_per_request=getattr(
                settings,
                "trial_max_tiles_per_request",
                DEFAULT_MAX_TILES_PER_REQUEST,
            ),
        )
    except Exception as exc:
        logger.exception("trial_image_preflight_failed error_type=%s", type(exc).__name__)
        raise _trial_inference_unavailable(exc) from exc


async def _trial_outputs_for_images(
    images: list[TrialQwenImageInput],
    file_entries: list[dict[str, Any]],
    *,
    db: Session,
    source: str,
    models: list[str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    findings: list[dict[str, Any]] = []
    raw_model_outputs: list[dict[str, Any]] = []
    try:
        inferences = await _trial_inference_requests(images, db, models)
        for image, entry, inference in zip(images, file_entries, inferences, strict=True):
            compatible_inference = inference
            if image.thermal_imaging_available:
                compatible_inference = {
                    **inference,
                    "requested_models": ["hollow"],
                    "detections": [
                        detection
                        for detection in inference.get("detections") or []
                        if (
                            isinstance(detection, dict)
                            and _trial_model_to_defect_type(str(detection.get("type") or ""))
                            == "hollow"
                        )
                    ],
                }
            raw_model_outputs.append(
                _trial_model_output_from_inference(
                    entry=entry,
                    inference=compatible_inference,
                )
            )
            findings.extend(
                _trial_findings_from_inference(
                    entry=entry,
                    inference=compatible_inference,
                )
            )
    except Exception as exc:
        logger.exception("trial_inference_failed source=%s error_type=%s", source, type(exc).__name__)
        raise _trial_inference_unavailable(exc) from exc
    return findings, raw_model_outputs


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


def _stored_quick_detection_photos(photos: list[QuickDetectionPhoto]) -> list[dict[str, Any]]:
    return [
        {
            "id": str(photo.id),
            "original_filename": photo.original_filename,
            "file_size": photo.file_size,
            "mime_type": photo.mime_type,
            "photo_type": "quick_detection",
            "metadata_json": photo.metadata_json,
            "thermal_imaging_available": photo.thermal_imaging_available,
            "storage_bucket": photo.storage_bucket,
            "storage_object_key": photo.storage_object_key,
        }
        for photo in photos
    ]


def _trial_generated_result(
    trial_request: TrialGenerateRequest,
    file_entries: list[dict[str, Any]],
    findings: list[dict[str, Any]],
    raw_model_outputs: list[dict[str, Any]],
) -> TrialGeneratedResult:
    return TrialGeneratedResult(
        report_name=trial_request.report_name,
        generated_at=datetime.now(UTC).isoformat(),
        models=list(trial_request.models),
        files=file_entries,
        findings=findings,
        raw_model_outputs=raw_model_outputs,
    )


def _stage_trial_detection_result(
    *,
    trial_request: TrialReportRequest,
    stored_photos_source: list[QuickDetectionPhoto],
    db: Session,
    current_user: AuthenticatedUser,
) -> TrialDetectionResult:
    result_id = uuid4()
    request_data = trial_request.model_dump(mode="json")
    result_findings = _trial_result_findings(request_data["findings"])
    generated_at = _trial_generated_at(request_data["generated_at"])
    result_no = _trial_result_no(db)
    stored_photos = _stored_quick_detection_photos(stored_photos_source)
    report_title = _trial_report_title(request_data.get("report_name"), result_no)
    archive_data = _trial_archive_data(
        result_no=result_no,
        generated_at=generated_at,
        models=request_data["models"],
        photos=stored_photos,
        findings=result_findings,
        raw_model_outputs=request_data.get("raw_model_outputs") or [],
    )
    result = TrialDetectionResult(
        id=result_id,
        result_no=result_no,
        title=report_title,
        status=InspectionReportStatus.GENERATED.value,
        report_data_json=archive_data,
        photo_count=len(stored_photos),
        finding_count=len(result_findings),
        thermal_available_photo_count=sum(
            1 for photo in stored_photos if photo.get("thermal_imaging_available")
        ),
        generated_by=current_user.id,
        generated_at=generated_at,
    )
    db.add(result)
    db.flush()
    for photo in stored_photos_source:
        photo.generated_result_id = result_id
    return result


def _append_trial_detection_result(
    *,
    result: TrialDetectionResult,
    trial_request: TrialReportRequest,
    stored_photos_source: list[QuickDetectionPhoto],
) -> TrialDetectionResult:
    request_data = trial_request.model_dump(mode="json")
    new_findings = _trial_result_findings(request_data["findings"])
    new_photos = _stored_quick_detection_photos(stored_photos_source)
    generated_at = _trial_generated_at(request_data["generated_at"])
    appended_data = _trial_archive_data(
        result_no=result.result_no,
        generated_at=generated_at,
        models=request_data["models"],
        photos=new_photos,
        findings=new_findings,
        raw_model_outputs=request_data.get("raw_model_outputs") or [],
    )

    archive_data = deepcopy(result.report_data_json or {})
    photos = [*(archive_data.get("photos") or []), *new_photos]
    defects = [*(archive_data.get("defects") or []), *(appended_data.get("defects") or [])]
    raw_model_outputs = [
        *(archive_data.get("raw_model_outputs") or []),
        *(request_data.get("raw_model_outputs") or []),
    ]
    defect_summary: dict[str, int] = {}
    status_summary: dict[str, int] = {}
    for defect in defects:
        if not isinstance(defect, dict):
            continue
        defect_type = str(defect.get("defect_type") or "")
        if defect_type:
            defect_summary[defect_type] = defect_summary.get(defect_type, 0) + 1
        defect_status = str(defect.get("status") or "generated")
        status_summary[defect_status] = status_summary.get(defect_status, 0) + 1

    archive_data["photos"] = photos
    archive_data["defects"] = defects
    archive_data["raw_model_outputs"] = raw_model_outputs
    archive_data["summary"] = {
        **(archive_data.get("summary") or {}),
        "total_review_results": len(defects),
        "by_defect_type": defect_summary,
        "by_status": status_summary,
        "photo_count": len(photos),
        "thermal_available_photo_count": sum(
            1
            for photo in photos
            if isinstance(photo, dict) and photo.get("thermal_imaging_available")
        ),
    }
    archive_data["detection_config"] = appended_data["detection_config"]
    archive_data["detection_task"] = {
        **(archive_data.get("detection_task") or {}),
        "model_version": TRIAL_MODEL_VERSION,
        "finished_at": generated_at.isoformat(),
    }

    result.report_data_json = archive_data
    result.photo_count = len(photos)
    result.finding_count = len(defects)
    result.thermal_available_photo_count = int(
        archive_data["summary"]["thermal_available_photo_count"]
    )
    if request_data.get("report_name"):
        result.title = _trial_report_title(request_data["report_name"], result.result_no)
    for photo in stored_photos_source:
        photo.generated_result_id = result.id
    return result


@router.post("/trial/photos", response_model=TrialUploadedPhotoRead, status_code=status.HTTP_201_CREATED)
def upload_trial_photo(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> TrialUploadedPhotoRead:
    file_entry = _trial_file_entries([file])[0]
    _enforce_trial_upload_limit(current_user, db)
    photo_id = uuid4()
    suffix = Path(file.filename or "").suffix.lower()
    object_key = f"quick-detection/{current_user.id}/photos/{photo_id}{suffix or '.bin'}"
    bucket: str | None = None
    committed = False
    try:
        metadata: dict[str, Any] = dict(extract_photo_metadata(file.file))
        bucket = put_object(
            object_key=object_key,
            data=file.file,
            length=int(file_entry["size"]),
            content_type=file.content_type,
        )
        photo = QuickDetectionPhoto(
            id=photo_id,
            original_filename=str(file_entry["filename"]),
            file_size=int(file_entry["size"]),
            mime_type=file.content_type,
            storage_bucket=bucket,
            storage_object_key=object_key,
            metadata_json=metadata,
            thermal_imaging_available=metadata["thermal_imaging_available"],
            precheck_status=PhotoPrecheckStatus.PENDING.value,
            precheck_attempts=0,
            uploaded_by=current_user.id,
        )
        db.add(photo)
        add_photo_upload_event(
            db,
            source_type="trial",
            photo_id=photo_id,
            actor_id=current_user.id,
            storage_bytes=int(file_entry["size"]),
        )
        db.commit()
        committed = True
        db.refresh(photo)
    except Exception:
        if bucket is not None and not committed:
            remove_object(bucket, object_key)
        raise
    run_stored_photo_precheck(db, photo)
    return TrialUploadedPhotoRead.model_validate(photo)


@router.delete("/trial/photos/{photo_id}", response_model=DeleteResponse)
def delete_trial_photo(
    photo_id: UUID,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> DeleteResponse:
    photo = db.scalar(
        select(QuickDetectionPhoto).where(
            QuickDetectionPhoto.id == photo_id,
            QuickDetectionPhoto.uploaded_by == current_user.id,
        )
    )
    if photo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Uploaded photo not found.")
    if photo.generated_result_id is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="已归档的照片不能删除。")
    remove_object(photo.storage_bucket, photo.storage_object_key)
    db.delete(photo)
    db.commit()
    return DeleteResponse()


@router.get("/trial/requests/{request_id}")
def get_trial_request_status(
    request_id: str,
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    normalized_request_id = request_id.strip()
    if not normalized_request_id or len(normalized_request_id) > 200:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="检测请求标识无效。")
    cached = _trial_request_cache_get(current_user, normalized_request_id)
    if cached is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到该检测请求。")
    return {
        "request_id": normalized_request_id,
        "status": cached.get("status", "failed"),
        "result": cached.get("result"),
        "error": cached.get("error"),
    }


@router.post("/trial/generate", response_model=TrialGeneratedResult, response_model_exclude_none=True)
async def generate_trial_result(
    request: Request,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> TrialGeneratedResult:
    task_started_at = perf_counter()
    if _is_multipart_request(request):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请先通过照片上传接口将原图保存到 MinIO，并等待预检完成后再开始检测。",
        )

    trial_request = _trial_generate_request_from_payload(await _trial_payload_from_json_request(request))
    request_id = (request.headers.get("idempotency-key") or "").strip()
    if len(request_id) > 200:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="检测请求标识过长。")
    request_fingerprint = hashlib.sha256(dumps(
        trial_request.model_dump(mode="json"),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")).hexdigest()
    if request_id:
        cached_request = _trial_request_cache_get(current_user, request_id)
        if cached_request:
            if cached_request.get("fingerprint") != request_fingerprint:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="该检测请求标识已用于其他内容，请重新发起。",
                )
            if cached_request.get("status") == "completed" and isinstance(cached_request.get("result"), dict):
                return TrialGeneratedResult.model_validate(cached_request["result"])
            if cached_request.get("status") == "processing":
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="该检测请求仍在处理中，请稍后查询结果。",
                    headers={"Retry-After": "3"},
                )
    if trial_request.archived_report_id is not None:
        _get_trial_result_or_404(
            db,
            trial_request.archived_report_id,
            current_user=current_user,
        )
    photos = _quick_detection_photos_for_user(db, current_user, trial_request.photo_ids)
    _validate_trial_photo_model_compatibility(photos, trial_request.models)
    file_entries = _trial_file_entries_for_quick_photos(photos)
    photo_sources = [
        _TrialStoredPhotoSource(
            photo_id=photo.id,
            filename=photo.original_filename,
            content_type=photo.mime_type,
            storage_bucket=photo.storage_bucket,
            storage_object_key=photo.storage_object_key,
            thermal_imaging_available=photo.thermal_imaging_available,
        )
        for photo in photos
    ]
    rollback = getattr(db, "rollback", None)
    if callable(rollback):
        rollback()
    images = await _trial_images_for_quick_photos(photo_sources)
    estimated_api_requests = _trial_estimated_api_request_count(images)
    reservation = _reserve_trial_usage(
        current_user,
        estimated_api_requests,
        db=db,
    )
    if request_id:
        try:
            _trial_request_cache_set(
                current_user,
                request_id,
                {
                    "status": "processing",
                    "fingerprint": request_fingerprint,
                    "started_at": datetime.now(UTC).isoformat(),
                },
            )
        except BaseException:
            reservation.release(successful=False)
            raise
    try:
        findings, raw_model_outputs = await _trial_outputs_for_images(
            images,
            file_entries,
            db=db,
            source="object_storage",
            models=trial_request.models,
        )
        task_duration_seconds = round(perf_counter() - task_started_at, 3)
        for output in raw_model_outputs:
            output["task_duration_seconds"] = task_duration_seconds
        actual_api_requests = sum(int(item.get("tile_count") or 0) for item in raw_model_outputs)
        result = _trial_generated_result(
            trial_request,
            file_entries,
            findings,
            raw_model_outputs,
        )
        archive_request = TrialReportRequest.model_validate(result.model_dump())
        if trial_request.archived_report_id is not None:
            archived_result = _append_trial_detection_result(
                result=_get_trial_result_or_404(
                    db,
                    trial_request.archived_report_id,
                    current_user=current_user,
                ),
                trial_request=archive_request,
                stored_photos_source=photos,
            )
        else:
            archived_result = _stage_trial_detection_result(
                trial_request=archive_request,
                stored_photos_source=photos,
                db=db,
                current_user=current_user,
            )
        add_inference_usage_event(
            db,
            source_type="trial",
            source_id=uuid4(),
            actor_id=current_user.id,
            report_data={"raw_model_outputs": raw_model_outputs},
            trial_task_count=1,
            photo_count=len(photo_sources),
        )
        db.commit()
        result.archived_report_id = archived_result.id
        result.archived_report_title = archived_result.title
    except BaseException:
        if request_id:
            try:
                _trial_request_cache_set(
                    current_user,
                    request_id,
                    {
                        "status": "failed",
                        "fingerprint": request_fingerprint,
                        "error": "检测任务执行失败，请重新发起。",
                        "finished_at": datetime.now(UTC).isoformat(),
                    },
                )
            except HTTPException:
                pass
        reservation.release(successful=False)
        raise
    reservation.release(
        successful=True,
        actual_api_request_count=actual_api_requests,
    )
    logger.info(
        "trial_inference_completed user_id=%s photos=%d api_requests=%d",
        current_user.id,
        len(photo_sources),
        actual_api_requests,
    )
    if request_id:
        try:
            _trial_request_cache_set(
                current_user,
                request_id,
                {
                    "status": "completed",
                    "fingerprint": request_fingerprint,
                    "result": result.model_dump(mode="json"),
                    "finished_at": datetime.now(UTC).isoformat(),
                },
            )
        except HTTPException:
            # The report is already committed; returning success is safer than
            # encouraging a duplicate inference request.
            pass
    return result


@router.post("/trial/results", response_model=ReportDetailRead, status_code=status.HTTP_201_CREATED)
async def create_trial_result(
    request: Request,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> ReportDetailRead:
    if _is_multipart_request(request):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="请先上传照片，再使用照片 ID 归档检测结果。",
        )
    else:
        trial_request = _trial_report_request_from_payload(await _trial_payload_from_json_request(request))
        photo_ids = [file.photo_id for file in trial_request.files if file.photo_id is not None]
        photos = _quick_detection_photos_for_user(db, current_user, photo_ids)
        stored_photos_source = photos

    result = _stage_trial_detection_result(
        trial_request=trial_request,
        stored_photos_source=stored_photos_source,
        db=db,
        current_user=current_user,
    )
    db.commit()
    db.refresh(result)
    return _trial_detail_item(result, request)


@router.get("/reports/{report_id}", response_model=ReportDetailRead)
def get_report(
    request: Request,
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
        return _detail_item(db, report, project, request)
    except HTTPException as exc:
        if exc.status_code != status.HTTP_404_NOT_FOUND:
            raise
    return _trial_detail_item(_get_trial_result_or_404(db, report_id, current_user=current_user), request)


@router.patch("/reports/{report_id}", response_model=ReportDetailRead)
def update_trial_report_title(
    request: Request,
    report_id: UUID,
    payload: ReportTitleUpdate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> ReportDetailRead:
    result = _get_trial_result_or_404(db, report_id, current_user=current_user)
    title = payload.title.strip()
    if not title:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="报告名称不能为空。",
        )
    result.title = title
    db.commit()
    db.refresh(result)
    return _trial_detail_item(result, request)


@router.post("/reports/{report_id}/push", response_model=ReportDetailRead)
def push_report(
    request: Request,
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
    db.flush()

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
    return _detail_item(db, report, project, request)


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
        trial_result.deleted_at = datetime.now(UTC)
        db.commit()
        return DeleteResponse()

    if current_user.role == UserRole.CUSTOMER.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="正式检测报告属于项目交付记录，普通用户不能删除。",
        )
    if report.docx_bucket and report.docx_object_key:
        remove_object(report.docx_bucket, report.docx_object_key)
    if project.current_report_id == report.id:
        project.current_report_id = None
        project.updated_at = datetime.now(UTC)
    db.delete(report)
    db.commit()
    return DeleteResponse()


@router.post("/reports/{report_id}/restore", response_model=ReportDetailRead)
def restore_trial_report(
    request: Request,
    report_id: UUID,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> ReportDetailRead:
    result = _get_trial_result_or_404(
        db,
        report_id,
        current_user=current_user,
        include_deleted=True,
    )
    if result.deleted_at is None:
        return _trial_detail_item(result, request)
    result.deleted_at = None
    db.commit()
    db.refresh(result)
    return _trial_detail_item(result, request)


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


@router.get("/reports/{report_id}/pdf")
def download_trial_result_pdf(
    report_id: UUID,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> StreamingResponse:
    result = _get_trial_result_or_404(db, report_id, current_user=current_user)
    try:
        pdf_bytes = build_trial_result_pdf(
            report_title=result.title,
            report_no=result.result_no,
            generated_at=result.generated_at.astimezone(ZoneInfo("Asia/Shanghai")).strftime(
                "%Y-%m-%d %H:%M:%S"
            ),
            report_data=result.report_data_json or {},
            read_object=get_object_bytes,
        )
    except TrialPdfExportError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    filename = f"{_safe_filename(result.result_no)}-{_safe_filename(result.title)}.pdf"
    encoded_filename = quote(filename)
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type=PDF_CONTENT_TYPE,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
            "Content-Length": str(len(pdf_bytes)),
        },
    )
