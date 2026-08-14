from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.dependencies import AuthenticatedUser, get_current_user, require_roles
from app.api.projects import _get_project_or_404
from app.api.reports import _detail_item
from app.db.session import get_db
from app.enums.status import (
    DefectType,
    DetectionTaskStatus,
    InspectionReportStatus,
    ProjectStatus,
    ReviewOperationType,
    ReviewResultStatus,
    UserRole,
)
from app.models.tables import (
    AiDetectionResult,
    AnnotationPhotoEdit,
    DetectionConfig,
    DetectionTask,
    DetectionTaskPhoto,
    InspectionReport,
    Photo,
    Project,
    ReviewOperationLog,
    ReviewResult,
)
from app.schemas.review_annotations import (
    AnnotationPhotoEditRead,
    AnnotationPhotoEditRequest,
    ReviewAnnotationDetail,
)
from app.schemas.phase6 import (
    AiDetectionResultRead,
    InspectionReportRead,
    ReviewPhotoRead,
    ReviewDetectionListItem,
    ReviewProjectDetail,
    ReviewProjectListItem,
    ReviewProjectResults,
    ReviewResultCreateRequest,
    ReviewResultRead,
    ReviewResultUpdateRequest,
)
from app.schemas.projects import DeleteResponse
from app.schemas.phase7 import ReportDetailRead
from app.services.object_storage import presigned_get_url
from app.services.report_data import build_report_data

router = APIRouter(
    tags=["review"],
    dependencies=[Depends(require_roles(UserRole.REVIEWER, UserRole.ADMIN))],
)
MUTABLE_REVIEW_STATUSES = {
    ReviewResultStatus.CONFIRMED.value,
    ReviewResultStatus.MODIFIED.value,
    ReviewResultStatus.DELETED.value,
    ReviewResultStatus.ADDED.value,
}
REVIEWABLE_REPORT_STATUSES = {
    InspectionReportStatus.DRAFT.value,
    InspectionReportStatus.GENERATED.value,
    InspectionReportStatus.PUSHED.value,
}


def _count_rows(db: Session, model: type, *criteria: object) -> int:
    return db.scalar(select(func.count()).select_from(model).where(*criteria)) or 0


def _photo_count(db: Session, project_id: UUID) -> int:
    return _count_rows(db, Photo, Photo.project_id == project_id, Photo.deleted_at.is_(None))


def _ai_result_count(db: Session, project_id: UUID, task_id: UUID | None = None) -> int:
    criteria = [AiDetectionResult.project_id == project_id]
    if task_id is not None:
        criteria.append(AiDetectionResult.detection_task_id == task_id)
    return _count_rows(db, AiDetectionResult, *criteria)


def _review_result_count(db: Session, project_id: UUID, task_id: UUID | None = None) -> int:
    criteria = [ReviewResult.project_id == project_id]
    if task_id is not None:
        criteria.append(ReviewResult.detection_task_id == task_id)
    return _count_rows(db, ReviewResult, *criteria)


def _task_status(db: Session, project: Project) -> str | None:
    task = db.get(DetectionTask, project.current_task_id) if project.current_task_id else None
    return task.status if task else None


def _project_list_item(db: Session, project: Project) -> ReviewProjectListItem:
    return ReviewProjectListItem(
        id=project.id,
        project_no=project.project_no,
        name=project.name,
        client_name=project.client_name,
        address=project.address,
        status=project.status,
        current_task_id=project.current_task_id,
        current_report_id=project.current_report_id,
        current_task_status=_task_status(db, project),
        photo_count=_photo_count(db, project.id),
        ai_result_count=_ai_result_count(db, project.id, project.current_task_id),
        review_result_count=_review_result_count(db, project.id, project.current_task_id),
        updated_at=project.updated_at,
    )


def _project_detail(db: Session, project: Project) -> ReviewProjectDetail:
    item = _project_list_item(db, project)
    return ReviewProjectDetail(
        **item.model_dump(),
        province=project.province,
        city=project.city,
        district=project.district,
        started_at=project.started_at,
        completed_at=project.completed_at,
    )


def _get_review_task_or_404(db: Session, task_id: UUID) -> DetectionTask:
    task = db.get(DetectionTask, task_id)
    if task is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Detection result not found.",
        )
    project = db.get(Project, task.project_id)
    if project is None or project.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Detection result not found.",
        )
    return task


def _report_for_task(db: Session, task_id: UUID) -> InspectionReport | None:
    return db.scalar(
        select(InspectionReport)
        .where(InspectionReport.detection_task_id == task_id)
        .order_by(InspectionReport.created_at.desc())
    )


def _detection_review_status(
    task: DetectionTask,
    report: InspectionReport | None,
) -> str:
    if task.status == DetectionTaskStatus.FAILED.value:
        return "failed"
    if task.status in {
        DetectionTaskStatus.PENDING.value,
        DetectionTaskStatus.RUNNING.value,
    }:
        return "detecting"
    if report is None or report.status == InspectionReportStatus.DRAFT.value:
        return "pending_review"
    return "completed"


def _review_detection_item(
    db: Session,
    task: DetectionTask,
    project: Project,
) -> ReviewDetectionListItem:
    report = _report_for_task(db, task.id)
    config = (
        db.get(DetectionConfig, task.detection_config_id)
        if task.detection_config_id
        else None
    )
    summary = task.result_summary if isinstance(task.result_summary, dict) else {}
    snapshot = (
        summary.get("detection_config")
        if isinstance(summary.get("detection_config"), dict)
        else {}
    )
    return ReviewDetectionListItem(
        id=task.id,
        project_id=project.id,
        project_no=project.project_no,
        project_name=project.name,
        client_name=project.client_name,
        address=project.address,
        task_no=task.task_no,
        task_status=task.status,
        review_status=_detection_review_status(task, report),
        report_id=report.id if report is not None else None,
        report_status=report.status if report is not None else None,
        model_types=(
            snapshot.get("model_types")
            or (config.model_types if config is not None else [])
        ),
        photo_count=task.photo_count,
        ai_result_count=_ai_result_count(db, project.id, task.id),
        review_result_count=_review_result_count(db, project.id, task.id),
        created_at=task.created_at,
        updated_at=max(
            task.updated_at,
            report.updated_at if report is not None else task.updated_at,
        ),
    )


def _ensure_report_reviewable(report: InspectionReport | None) -> None:
    if report is not None and report.status not in REVIEWABLE_REPORT_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This review cannot be edited.",
        )


def _ensure_task_reviewable(db: Session, task_id: UUID) -> None:
    _ensure_report_reviewable(_report_for_task(db, task_id))


def _photo_to_read(photo: Photo) -> ReviewPhotoRead:
    preview_url = presigned_get_url(photo.storage_bucket, photo.storage_object_key)
    thumbnail_url = presigned_get_url(photo.storage_bucket, photo.thumbnail_object_key) or preview_url
    return ReviewPhotoRead(
        id=photo.id,
        project_id=photo.project_id,
        original_filename=photo.original_filename,
        image_width=photo.image_width,
        image_height=photo.image_height,
        photo_type=photo.photo_type,
        status=photo.status,
        preview_url=preview_url,
        thumbnail_url=thumbnail_url,
        created_at=photo.created_at,
        updated_at=photo.updated_at,
    )


def _ensure_pending_review(project: Project) -> None:
    if project.status != ProjectStatus.PENDING_REVIEW.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only pending review projects can be reviewed.",
        )


def _ensure_mutable_review_status(value: str) -> None:
    if value not in MUTABLE_REVIEW_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Review result status must be confirmed, modified, deleted, or added.",
        )


def _operation_type(review_status: str, has_ai_result: bool) -> str:
    if review_status == ReviewResultStatus.DELETED.value:
        return ReviewOperationType.DELETE.value
    if review_status == ReviewResultStatus.ADDED.value or not has_ai_result:
        return ReviewOperationType.ADD.value
    if review_status == ReviewResultStatus.CONFIRMED.value:
        return ReviewOperationType.CONFIRM.value
    return ReviewOperationType.MODIFY.value


def _snapshot_review_result(result: ReviewResult) -> dict:
    return {
        "id": str(result.id),
        "project_id": str(result.project_id),
        "detection_task_id": str(result.detection_task_id),
        "photo_id": str(result.photo_id),
        "ai_result_id": str(result.ai_result_id) if result.ai_result_id else None,
        "defect_type": result.defect_type,
        "bbox_json": result.bbox_json,
        "polygon_json": result.polygon_json,
        "severity": result.severity,
        "area": str(result.area) if result.area is not None else None,
        "length": str(result.length) if result.length is not None else None,
        "status": result.status,
        "review_note": result.review_note,
    }


def _write_operation_log(
    db: Session,
    *,
    result: ReviewResult | None,
    project_id: UUID,
    detection_task_id: UUID | None,
    photo_id: UUID | None,
    ai_result_id: UUID | None,
    operator_id: UUID,
    operation_type: str,
    before_json: dict | None,
    after_json: dict | None,
    note: str | None = None,
) -> None:
    db.add(
        ReviewOperationLog(
            project_id=project_id,
            detection_task_id=detection_task_id,
            photo_id=photo_id,
            ai_result_id=ai_result_id,
            review_result_id=result.id if result else None,
            operator_id=operator_id,
            operation_type=operation_type,
            before_json=before_json,
            after_json=after_json,
            note=note,
        )
    )


def _review_result_read(result: ReviewResult) -> ReviewResultRead:
    return ReviewResultRead.model_validate(result)


@router.get("/review/detections", response_model=list[ReviewDetectionListItem])
def list_review_detections(
    db: Session = Depends(get_db),
    _: AuthenticatedUser = Depends(get_current_user),
) -> list[ReviewDetectionListItem]:
    projects = list(
        db.scalars(
            select(Project)
            .where(
                Project.deleted_at.is_(None),
                Project.status != ProjectStatus.DRAFT.value,
                Project.current_task_id.is_not(None),
            )
            .order_by(Project.updated_at.desc(), Project.created_at.desc())
        )
    )
    items: list[ReviewDetectionListItem] = []
    for project in projects:
        current_task = (
            db.get(DetectionTask, project.current_task_id)
            if project.current_task_id
            else None
        )
        if current_task is None:
            continue
        items.append(_review_detection_item(db, current_task, project))
    return sorted(
        items,
        key=lambda item: (item.updated_at, item.created_at),
        reverse=True,
    )


@router.get(
    "/review/detections/{task_id}",
    response_model=ReviewDetectionListItem,
)
def get_review_detection(
    task_id: UUID,
    db: Session = Depends(get_db),
    _: AuthenticatedUser = Depends(get_current_user),
) -> ReviewDetectionListItem:
    task = _get_review_task_or_404(db, task_id)
    project = _get_project_or_404(db, task.project_id)
    return _review_detection_item(db, task, project)


def _review_annotation_report(
    db: Session,
    task_id: UUID,
) -> tuple[DetectionTask, InspectionReport]:
    task = _get_review_task_or_404(db, task_id)
    report = _report_for_task(db, task.id)
    if report is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Detection result is not ready for review.",
        )
    return task, report


def _review_result_detail(
    db: Session,
    request: Request,
    report: InspectionReport,
) -> ReportDetailRead:
    project = _get_project_or_404(db, report.project_id)
    return _detail_item(db, report, project, request)


def _photo_group_key(value: dict, *, fallback: str = "") -> str:
    if value.get("id"):
        return f"photo:{value['id']}"
    if value.get("original_filename"):
        return f"filename:{value['original_filename']}"
    return fallback


def _defect_group_key(value: dict) -> str:
    if value.get("photo_id"):
        return f"photo:{value['photo_id']}"
    if value.get("photo_filename"):
        return f"filename:{value['photo_filename']}"
    if value.get("id"):
        return f"defect:{value['id']}"
    return ""


def _valid_photo_keys(result: ReportDetailRead) -> set[str]:
    keys = {
        key
        for index, photo in enumerate(result.photos)
        if (key := _photo_group_key(photo, fallback=f"photo-index:{index}"))
    }
    keys.update(
        key
        for defect in result.defects
        if (key := _defect_group_key(defect))
    )
    return keys


def _edit_read(edit: AnnotationPhotoEdit) -> AnnotationPhotoEditRead:
    if edit.report_id is None:
        raise RuntimeError("Review annotation edit is missing its inspection report.")
    return AnnotationPhotoEditRead(
        id=edit.id,
        source_type="formal",
        result_id=edit.report_id,
        photo_key=edit.photo_key,
        annotations=edit.annotations_json,
        edited_by=edit.edited_by,
        created_at=edit.created_at,
        updated_at=edit.updated_at,
    )


def _review_preview_result(
    result: ReportDetailRead,
    edits: list[AnnotationPhotoEdit],
) -> ReportDetailRead:
    defects = [dict(defect) for defect in result.defects]
    photo_by_key = {
        key: photo
        for index, photo in enumerate(result.photos)
        if (key := _photo_group_key(photo, fallback=f"photo-index:{index}"))
    }

    for edit in edits:
        source_defects = {
            str(defect.get("id")): defect
            for defect in defects
            if _defect_group_key(defect) == edit.photo_key and defect.get("id")
        }
        defects = [
            defect
            for defect in defects
            if _defect_group_key(defect) != edit.photo_key
        ]
        photo = photo_by_key.get(edit.photo_key, {})
        for annotation in edit.annotations_json:
            source_id = annotation.get("source_annotation_id")
            preview_defect = dict(source_defects.get(str(source_id), {}))
            photo_filename = (
                photo.get("original_filename")
                or preview_defect.get("photo_filename")
                or (
                    edit.photo_key.removeprefix("filename:")
                    if edit.photo_key.startswith("filename:")
                    else None
                )
            )
            preview_defect.update(
                {
                    "id": source_id or annotation.get("id"),
                    "photo_id": photo.get("id") or preview_defect.get("photo_id"),
                    "photo_filename": photo_filename,
                    "defect_type": annotation.get("defect_type"),
                    "bbox_json": annotation.get("bbox") or {},
                    "confidence": annotation.get("confidence"),
                    "status": "preview",
                }
            )
            defects.append(preview_defect)

    by_defect_type: dict[str, int] = {}
    by_status: dict[str, int] = {}
    for defect in defects:
        defect_type = str(defect.get("defect_type") or "")
        defect_status = str(defect.get("status") or "pending")
        if defect_type:
            by_defect_type[defect_type] = by_defect_type.get(defect_type, 0) + 1
        by_status[defect_status] = by_status.get(defect_status, 0) + 1

    summary = dict(result.summary)
    summary.update(
        {
            "total_review_results": len(defects),
            "by_defect_type": by_defect_type,
            "by_status": by_status,
        }
    )
    return result.model_copy(update={"defects": defects, "summary": summary})


@router.get(
    "/review/detections/{task_id}/annotations",
    response_model=ReviewAnnotationDetail,
)
def get_review_detection_annotations(
    request: Request,
    task_id: UUID,
    db: Session = Depends(get_db),
    _: AuthenticatedUser = Depends(get_current_user),
) -> ReviewAnnotationDetail:
    _, report = _review_annotation_report(db, task_id)
    result = _review_result_detail(db, request, report)
    edits = list(
        db.scalars(
            select(AnnotationPhotoEdit)
            .where(AnnotationPhotoEdit.report_id == report.id)
            .order_by(AnnotationPhotoEdit.created_at.asc())
        )
    )
    return ReviewAnnotationDetail(
        result=result,
        edits=[_edit_read(edit) for edit in edits],
    )


@router.get(
    "/review/detections/{task_id}/preview",
    response_model=ReportDetailRead,
)
def get_review_detection_preview(
    request: Request,
    task_id: UUID,
    db: Session = Depends(get_db),
    _: AuthenticatedUser = Depends(get_current_user),
) -> ReportDetailRead:
    _, report = _review_annotation_report(db, task_id)
    result = _review_result_detail(db, request, report)
    edits = list(
        db.scalars(
            select(AnnotationPhotoEdit)
            .where(AnnotationPhotoEdit.report_id == report.id)
            .order_by(AnnotationPhotoEdit.created_at.asc())
        )
    )
    return _review_preview_result(result, edits)


@router.put(
    "/review/detections/{task_id}/annotations/photos",
    response_model=AnnotationPhotoEditRead,
)
def save_review_detection_annotations(
    request: Request,
    task_id: UUID,
    payload: AnnotationPhotoEditRequest,
    db: Session = Depends(get_db),
    reviewer: AuthenticatedUser = Depends(get_current_user),
) -> AnnotationPhotoEditRead:
    task, report = _review_annotation_report(db, task_id)
    _ensure_task_reviewable(db, task.id)
    allowed_defect_types = {
        DefectType.CRACK.value,
        DefectType.SPALLING.value,
        DefectType.HOLLOW.value,
    }
    if any(
        annotation.defect_type not in allowed_defect_types
        for annotation in payload.annotations
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Review annotations only support crack, spalling, and hollow.",
        )
    result = _review_result_detail(db, request, report)
    if payload.photo_key not in _valid_photo_keys(result):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Photo not found in detection result.",
        )
    edit = db.scalar(
        select(AnnotationPhotoEdit).where(
            AnnotationPhotoEdit.report_id == report.id,
            AnnotationPhotoEdit.photo_key == payload.photo_key,
        )
    )
    annotations_json = [
        annotation.model_dump(mode="json")
        for annotation in payload.annotations
    ]
    if edit is None:
        edit = AnnotationPhotoEdit(
            report_id=report.id,
            trial_result_id=None,
            photo_key=payload.photo_key,
            annotations_json=annotations_json,
            edited_by=reviewer.id,
        )
        db.add(edit)
    else:
        edit.annotations_json = annotations_json
        edit.edited_by = reviewer.id
    db.commit()
    db.refresh(edit)
    return _edit_read(edit)


@router.delete(
    "/review/detections/{task_id}/annotations/photos",
    response_model=DeleteResponse,
)
def reset_review_detection_annotations(
    request: Request,
    task_id: UUID,
    photo_key: str = Query(min_length=1, max_length=512),
    db: Session = Depends(get_db),
    _: AuthenticatedUser = Depends(get_current_user),
) -> DeleteResponse:
    task, report = _review_annotation_report(db, task_id)
    _ensure_task_reviewable(db, task.id)
    result = _review_result_detail(db, request, report)
    if photo_key not in _valid_photo_keys(result):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Photo not found in detection result.",
        )
    edit = db.scalar(
        select(AnnotationPhotoEdit).where(
            AnnotationPhotoEdit.report_id == report.id,
            AnnotationPhotoEdit.photo_key == photo_key,
        )
    )
    if edit is not None:
        db.delete(edit)
        db.commit()
    return DeleteResponse()


@router.get("/review/projects", response_model=list[ReviewProjectListItem])
def list_review_projects(
    db: Session = Depends(get_db),
    _: AuthenticatedUser = Depends(get_current_user),
) -> list[ReviewProjectListItem]:
    projects = list(
        db.scalars(
            select(Project)
            .where(Project.deleted_at.is_(None), Project.status != ProjectStatus.DRAFT.value)
            .order_by(Project.updated_at.desc(), Project.created_at.desc())
        )
    )
    return [_project_list_item(db, project) for project in projects]


@router.get("/review/projects/{project_id}", response_model=ReviewProjectDetail)
def get_review_project(
    project_id: UUID,
    db: Session = Depends(get_db),
    _: AuthenticatedUser = Depends(get_current_user),
) -> ReviewProjectDetail:
    project = _get_project_or_404(db, project_id)
    if project.status == ProjectStatus.DRAFT.value:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review project not found.")
    return _project_detail(db, project)


@router.get("/review/projects/{project_id}/results", response_model=ReviewProjectResults)
def get_review_project_results(
    project_id: UUID,
    db: Session = Depends(get_db),
    _: AuthenticatedUser = Depends(get_current_user),
) -> ReviewProjectResults:
    project = _get_project_or_404(db, project_id)
    if project.status == ProjectStatus.DRAFT.value:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review project not found.")

    photos = list(
        db.scalars(
            select(Photo)
            .where(Photo.project_id == project.id, Photo.deleted_at.is_(None))
            .order_by(Photo.created_at.asc())
        )
    )
    ai_criteria = [AiDetectionResult.project_id == project.id]
    review_criteria = [ReviewResult.project_id == project.id]
    if project.current_task_id is not None:
        ai_criteria.append(AiDetectionResult.detection_task_id == project.current_task_id)
        review_criteria.append(ReviewResult.detection_task_id == project.current_task_id)

    ai_results = list(
        db.scalars(
            select(AiDetectionResult)
            .where(*ai_criteria)
            .order_by(AiDetectionResult.created_at.asc())
        )
    )
    review_results = list(
        db.scalars(
            select(ReviewResult)
            .where(*review_criteria)
            .order_by(ReviewResult.created_at.asc(), ReviewResult.updated_at.asc())
        )
    )

    return ReviewProjectResults(
        project=_project_detail(db, project),
        photos=[_photo_to_read(photo) for photo in photos],
        ai_results=[AiDetectionResultRead.model_validate(result) for result in ai_results],
        review_results=[ReviewResultRead.model_validate(result) for result in review_results],
    )


@router.post(
    "/review/results",
    response_model=ReviewResultRead,
    status_code=status.HTTP_201_CREATED,
)
def create_review_result(
    payload: ReviewResultCreateRequest,
    db: Session = Depends(get_db),
    reviewer: AuthenticatedUser = Depends(get_current_user),
) -> ReviewResultRead:
    review_status = payload.status.value if hasattr(payload.status, "value") else payload.status
    _ensure_mutable_review_status(review_status)

    ai_result = db.get(AiDetectionResult, payload.ai_result_id) if payload.ai_result_id else None
    if payload.ai_result_id is not None and ai_result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="AI result not found.")

    if ai_result is not None:
        project = _get_project_or_404(db, ai_result.project_id)
        photo_id = ai_result.photo_id
        detection_task_id = ai_result.detection_task_id
        _ensure_task_reviewable(db, detection_task_id)
        existing_result = db.scalar(
            select(ReviewResult).where(ReviewResult.ai_result_id == ai_result.id)
        )
    else:
        if payload.project_id is None or payload.photo_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="project_id and photo_id are required when adding a manual review result.",
            )
        if review_status != ReviewResultStatus.ADDED.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Manual review results must use added status.",
            )
        project = _get_project_or_404(db, payload.project_id)
        photo = db.get(Photo, payload.photo_id)
        if photo is None or photo.deleted_at is not None or photo.project_id != project.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found.")
        detection_task_id = payload.detection_task_id or project.current_task_id
        if detection_task_id is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Project has no current detection task.",
            )
        task = db.get(DetectionTask, detection_task_id)
        task_photo = db.scalar(
            select(DetectionTaskPhoto).where(
                DetectionTaskPhoto.detection_task_id == detection_task_id,
                DetectionTaskPhoto.photo_id == photo.id,
            )
        )
        if (
            task is None
            or task.project_id != project.id
            or task_photo is None
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Photo does not belong to the selected detection result.",
            )
        _ensure_task_reviewable(db, detection_task_id)
        photo_id = photo.id
        existing_result = None

    _ensure_pending_review(project)

    now = datetime.now(UTC)
    bbox_json = payload.bbox.model_dump(mode="json")
    if existing_result is None:
        result = ReviewResult(
            project_id=project.id,
            detection_task_id=detection_task_id,
            photo_id=photo_id,
            ai_result_id=ai_result.id if ai_result else None,
            defect_type=payload.defect_type.value if hasattr(payload.defect_type, "value") else payload.defect_type,
            bbox_json=bbox_json,
            polygon_json=payload.polygon_json,
            severity=payload.severity,
            area=payload.area,
            length=payload.length,
            status=review_status,
            reviewer_id=reviewer.id,
            review_note=payload.review_note,
            reviewed_at=now,
        )
        db.add(result)
        db.flush()
        before_json = None
    else:
        result = existing_result
        before_json = _snapshot_review_result(result)
        result.defect_type = payload.defect_type.value if hasattr(payload.defect_type, "value") else payload.defect_type
        result.bbox_json = bbox_json
        result.polygon_json = payload.polygon_json
        result.severity = payload.severity
        result.area = payload.area
        result.length = payload.length
        result.status = review_status
        result.reviewer_id = reviewer.id
        result.review_note = payload.review_note
        result.reviewed_at = now
        result.updated_at = now

    project.updated_at = now
    operation_type = _operation_type(result.status, result.ai_result_id is not None)
    _write_operation_log(
        db,
        result=result,
        project_id=project.id,
        detection_task_id=result.detection_task_id,
        photo_id=result.photo_id,
        ai_result_id=result.ai_result_id,
        operator_id=reviewer.id,
        operation_type=operation_type,
        before_json=before_json,
        after_json=_snapshot_review_result(result),
        note=payload.review_note,
    )
    db.commit()
    db.refresh(result)
    return _review_result_read(result)


@router.put("/review/results/{result_id}", response_model=ReviewResultRead)
def update_review_result(
    result_id: UUID,
    payload: ReviewResultUpdateRequest,
    db: Session = Depends(get_db),
    reviewer: AuthenticatedUser = Depends(get_current_user),
) -> ReviewResultRead:
    result = db.get(ReviewResult, result_id)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review result not found.")

    project = _get_project_or_404(db, result.project_id)
    _ensure_pending_review(project)
    _ensure_task_reviewable(db, result.detection_task_id)
    before_json = _snapshot_review_result(result)

    updates = payload.model_dump(exclude_unset=True)
    if payload.defect_type is not None:
        result.defect_type = payload.defect_type.value if hasattr(payload.defect_type, "value") else payload.defect_type
    if payload.bbox is not None:
        result.bbox_json = payload.bbox.model_dump(mode="json")
    if "polygon_json" in updates:
        result.polygon_json = payload.polygon_json
    if "severity" in updates:
        result.severity = payload.severity
    if "area" in updates:
        result.area = payload.area
    if "length" in updates:
        result.length = payload.length
    if payload.status is not None:
        review_status = payload.status.value if hasattr(payload.status, "value") else payload.status
        _ensure_mutable_review_status(review_status)
        if result.ai_result_id is None and review_status not in {
            ReviewResultStatus.ADDED.value,
            ReviewResultStatus.DELETED.value,
        }:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Manual review results can only be added or deleted.",
            )
        result.status = review_status
    if "review_note" in updates:
        result.review_note = payload.review_note

    now = datetime.now(UTC)
    result.reviewer_id = reviewer.id
    result.reviewed_at = now
    result.updated_at = now
    project.updated_at = now

    _write_operation_log(
        db,
        result=result,
        project_id=result.project_id,
        detection_task_id=result.detection_task_id,
        photo_id=result.photo_id,
        ai_result_id=result.ai_result_id,
        operator_id=reviewer.id,
        operation_type=_operation_type(result.status, result.ai_result_id is not None),
        before_json=before_json,
        after_json=_snapshot_review_result(result),
        note=result.review_note,
    )
    db.commit()
    db.refresh(result)
    return _review_result_read(result)


@router.delete("/review/results/{result_id}", response_model=ReviewResultRead)
def delete_review_result(
    result_id: UUID,
    db: Session = Depends(get_db),
    reviewer: AuthenticatedUser = Depends(get_current_user),
) -> ReviewResultRead:
    result = db.get(ReviewResult, result_id)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review result not found.")

    project = _get_project_or_404(db, result.project_id)
    _ensure_pending_review(project)
    _ensure_task_reviewable(db, result.detection_task_id)
    before_json = _snapshot_review_result(result)
    now = datetime.now(UTC)
    result.status = ReviewResultStatus.DELETED.value
    result.reviewer_id = reviewer.id
    result.reviewed_at = now
    result.updated_at = now
    project.updated_at = now

    _write_operation_log(
        db,
        result=result,
        project_id=result.project_id,
        detection_task_id=result.detection_task_id,
        photo_id=result.photo_id,
        ai_result_id=result.ai_result_id,
        operator_id=reviewer.id,
        operation_type=ReviewOperationType.DELETE.value,
        before_json=before_json,
        after_json=_snapshot_review_result(result),
        note=result.review_note,
    )
    db.commit()
    db.refresh(result)
    return _review_result_read(result)


def _annotation_photo_id(
    photo_key: str,
    *,
    photo_id_by_filename: dict[str, UUID],
    valid_photo_ids: set[UUID],
) -> UUID | None:
    if photo_key.startswith("photo:"):
        try:
            photo_id = UUID(photo_key.removeprefix("photo:"))
        except ValueError:
            return None
        return photo_id if photo_id in valid_photo_ids else None
    if photo_key.startswith("filename:"):
        return photo_id_by_filename.get(photo_key.removeprefix("filename:"))
    return None


def _apply_review_annotation_edits(
    db: Session,
    *,
    task: DetectionTask,
    report: InspectionReport,
    reviewer: AuthenticatedUser,
    reviewed_at: datetime,
) -> list[ReviewResult]:
    photos = list(
        db.scalars(
            select(Photo)
            .join(DetectionTaskPhoto, DetectionTaskPhoto.photo_id == Photo.id)
            .where(
                DetectionTaskPhoto.detection_task_id == task.id,
                Photo.deleted_at.is_(None),
            )
        )
    )
    valid_photo_ids = {photo.id for photo in photos}
    photo_id_by_filename = {
        photo.original_filename: photo.id
        for photo in photos
    }
    results = list(
        db.scalars(
            select(ReviewResult)
            .where(ReviewResult.detection_task_id == task.id)
            .order_by(ReviewResult.created_at.asc())
        )
    )
    result_by_id = {result.id: result for result in results}
    edits = list(
        db.scalars(
            select(AnnotationPhotoEdit)
            .where(AnnotationPhotoEdit.report_id == report.id)
            .order_by(AnnotationPhotoEdit.created_at.asc())
        )
    )

    for edit in edits:
        photo_id = _annotation_photo_id(
            edit.photo_key,
            photo_id_by_filename=photo_id_by_filename,
            valid_photo_ids=valid_photo_ids,
        )
        if photo_id is None:
            continue
        retained_ids: set[UUID] = set()
        saved_annotations: list[dict] = []
        for annotation in edit.annotations_json:
            saved_annotation = dict(annotation)
            source_value = annotation.get("source_annotation_id")
            source_id: UUID | None = None
            if source_value:
                try:
                    source_id = UUID(str(source_value))
                except ValueError:
                    source_id = None
            existing = result_by_id.get(source_id) if source_id else None
            bbox = annotation.get("bbox")
            defect_type = str(annotation.get("defect_type") or "")
            if (
                not isinstance(bbox, dict)
                or defect_type not in {
                    DefectType.CRACK.value,
                    DefectType.SPALLING.value,
                    DefectType.HOLLOW.value,
                }
            ):
                continue

            if existing is None and source_id is None:
                existing = next(
                    (
                        result
                        for result in results
                        if result.photo_id == photo_id
                        and result.ai_result_id is None
                        and result.id not in retained_ids
                        and result.status != ReviewResultStatus.DELETED.value
                        and result.defect_type == defect_type
                        and result.bbox_json == bbox
                    ),
                    None,
                )

            if existing is not None and existing.photo_id == photo_id:
                retained_ids.add(existing.id)
                saved_annotation["source_annotation_id"] = str(existing.id)
                saved_annotations.append(saved_annotation)
                before_json = _snapshot_review_result(existing)
                changed = (
                    existing.defect_type != defect_type
                    or existing.bbox_json != bbox
                )
                existing.defect_type = defect_type
                existing.bbox_json = bbox
                existing.status = (
                    ReviewResultStatus.ADDED.value
                    if existing.ai_result_id is None
                    else (
                        ReviewResultStatus.MODIFIED.value
                        if changed
                        else ReviewResultStatus.CONFIRMED.value
                    )
                )
                existing.reviewer_id = reviewer.id
                existing.review_note = (
                    "审核工作台调整标注"
                    if changed
                    else "审核工作台确认标注"
                )
                existing.reviewed_at = reviewed_at
                existing.updated_at = reviewed_at
                _write_operation_log(
                    db,
                    result=existing,
                    project_id=existing.project_id,
                    detection_task_id=existing.detection_task_id,
                    photo_id=existing.photo_id,
                    ai_result_id=existing.ai_result_id,
                    operator_id=reviewer.id,
                    operation_type=(
                        ReviewOperationType.MODIFY.value
                        if changed
                        else ReviewOperationType.CONFIRM.value
                    ),
                    before_json=before_json,
                    after_json=_snapshot_review_result(existing),
                    note=existing.review_note,
                )
                continue

            added = ReviewResult(
                project_id=task.project_id,
                detection_task_id=task.id,
                photo_id=photo_id,
                ai_result_id=None,
                defect_type=defect_type,
                bbox_json=bbox,
                polygon_json=None,
                severity=None,
                area=None,
                length=None,
                status=ReviewResultStatus.ADDED.value,
                reviewer_id=reviewer.id,
                review_note="审核工作台新增标注",
                reviewed_at=reviewed_at,
            )
            db.add(added)
            db.flush()
            results.append(added)
            result_by_id[added.id] = added
            retained_ids.add(added.id)
            saved_annotation["source_annotation_id"] = str(added.id)
            saved_annotations.append(saved_annotation)
            _write_operation_log(
                db,
                result=added,
                project_id=added.project_id,
                detection_task_id=added.detection_task_id,
                photo_id=added.photo_id,
                ai_result_id=None,
                operator_id=reviewer.id,
                operation_type=ReviewOperationType.ADD.value,
                before_json=None,
                after_json=_snapshot_review_result(added),
                note=added.review_note,
            )

        # Persist the server-side result ids after the first completion so a
        # subsequent review updates the same manual annotations instead of
        # creating replacement rows on every completion.
        edit.annotations_json = saved_annotations

        for existing in results:
            if (
                existing.photo_id != photo_id
                or existing.id in retained_ids
                or existing.status == ReviewResultStatus.DELETED.value
            ):
                continue
            before_json = _snapshot_review_result(existing)
            existing.status = ReviewResultStatus.DELETED.value
            existing.reviewer_id = reviewer.id
            existing.review_note = "审核工作台删除标注"
            existing.reviewed_at = reviewed_at
            existing.updated_at = reviewed_at
            _write_operation_log(
                db,
                result=existing,
                project_id=existing.project_id,
                detection_task_id=existing.detection_task_id,
                photo_id=existing.photo_id,
                ai_result_id=existing.ai_result_id,
                operator_id=reviewer.id,
                operation_type=ReviewOperationType.DELETE.value,
                before_json=before_json,
                after_json=_snapshot_review_result(existing),
                note=existing.review_note,
            )

    for result in results:
        if result.status != ReviewResultStatus.PENDING.value:
            continue
        before_json = _snapshot_review_result(result)
        result.status = ReviewResultStatus.CONFIRMED.value
        result.reviewer_id = reviewer.id
        result.review_note = "审核工作台确认标注"
        result.reviewed_at = reviewed_at
        result.updated_at = reviewed_at
        _write_operation_log(
            db,
            result=result,
            project_id=result.project_id,
            detection_task_id=result.detection_task_id,
            photo_id=result.photo_id,
            ai_result_id=result.ai_result_id,
            operator_id=reviewer.id,
            operation_type=ReviewOperationType.CONFIRM.value,
            before_json=before_json,
            after_json=_snapshot_review_result(result),
            note=result.review_note,
        )
    return [
        result
        for result in results
        if result.status != ReviewResultStatus.DELETED.value
    ]


@router.post(
    "/review/detections/{task_id}/complete",
    response_model=InspectionReportRead,
)
def complete_detection_review(
    task_id: UUID,
    db: Session = Depends(get_db),
    reviewer: AuthenticatedUser = Depends(get_current_user),
) -> InspectionReportRead:
    task, report = _review_annotation_report(db, task_id)
    _ensure_task_reviewable(db, task.id)
    if task.status != DetectionTaskStatus.SUCCESS.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only successful detection results can be reviewed.",
        )
    project = _get_project_or_404(db, task.project_id)
    if project.status not in {
        ProjectStatus.PENDING_REVIEW.value,
        ProjectStatus.REVIEWED.value,
        ProjectStatus.COMPLETED.value,
    }:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Project is not awaiting review.",
        )

    now = datetime.now(UTC)
    previous_report_status = report.status
    is_repeat_review = previous_report_status in {
        InspectionReportStatus.GENERATED.value,
        InspectionReportStatus.PUSHED.value,
    }
    valid_results = _apply_review_annotation_edits(
        db,
        task=task,
        report=report,
        reviewer=reviewer,
        reviewed_at=now,
    )
    db.flush()
    report.status = InspectionReportStatus.GENERATED.value
    report.report_data_json = build_report_data(
        db,
        project,
        task.id,
        valid_results,
    )
    report.generated_by = reviewer.id
    report.generated_at = now
    report.docx_bucket = None
    report.docx_object_key = None
    report.pushed_at = None
    report.updated_at = now
    db.flush()

    project.status = ProjectStatus.COMPLETED.value
    project.completed_at = now
    project.current_report_id = report.id
    project.updated_at = now
    _write_operation_log(
        db,
        result=None,
        project_id=project.id,
        detection_task_id=task.id,
        photo_id=None,
        ai_result_id=None,
        operator_id=reviewer.id,
        operation_type=ReviewOperationType.GENERATE_REPORT.value,
        before_json={"report_status": previous_report_status},
        after_json={
            "report_status": InspectionReportStatus.GENERATED.value,
            "report_id": str(report.id),
            "report_no": report.report_no,
        },
        note=(
            "完成再次审核并更新报告"
            if is_repeat_review
            else "完成检测结果审核并生成报告"
        ),
    )
    db.commit()
    db.refresh(report)
    return InspectionReportRead.model_validate(report)
