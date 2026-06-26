from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.dependencies import AuthenticatedUser, get_current_user, require_roles
from app.api.projects import _get_project_or_404
from app.db.session import get_db
from app.enums.status import (
    InspectionReportStatus,
    ProjectStatus,
    ReviewOperationType,
    ReviewResultStatus,
    UserRole,
)
from app.models.tables import (
    AiDetectionResult,
    DetectionTask,
    InspectionReport,
    Photo,
    Project,
    ReviewOperationLog,
    ReviewResult,
)
from app.schemas.phase6 import (
    AiDetectionResultRead,
    InspectionReportRead,
    ReviewPhotoRead,
    ReviewProjectDetail,
    ReviewProjectListItem,
    ReviewProjectResults,
    ReviewResultCreateRequest,
    ReviewResultRead,
    ReviewResultUpdateRequest,
)
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


def _now_report_no() -> str:
    timestamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S%f")
    return f"RPT-{timestamp}-{uuid4().hex[:6].upper()}"


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
        contact_name=project.contact_name,
        contact_phone=project.contact_phone,
        province=project.province,
        city=project.city,
        district=project.district,
        started_at=project.started_at,
        completed_at=project.completed_at,
    )


def _photo_to_read(photo: Photo) -> ReviewPhotoRead:
    preview_url = presigned_get_url(photo.storage_bucket, photo.storage_object_key)
    thumbnail_url = presigned_get_url(photo.storage_bucket, photo.thumbnail_object_key) or preview_url
    return ReviewPhotoRead(
        id=photo.id,
        project_id=photo.project_id,
        building_id=photo.building_id,
        facade_id=photo.facade_id,
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
        if project.current_task_id is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Project has no current detection task.",
            )
        photo_id = photo.id
        detection_task_id = project.current_task_id
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


@router.post(
    "/review/projects/{project_id}/complete",
    response_model=InspectionReportRead,
    status_code=status.HTTP_201_CREATED,
)
def complete_review(
    project_id: UUID,
    db: Session = Depends(get_db),
    reviewer: AuthenticatedUser = Depends(get_current_user),
) -> InspectionReportRead:
    project = _get_project_or_404(db, project_id)
    _ensure_pending_review(project)
    if project.current_task_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Project has no current detection task.",
        )

    valid_results = list(
        db.scalars(
            select(ReviewResult)
            .where(
                ReviewResult.project_id == project.id,
                ReviewResult.detection_task_id == project.current_task_id,
                ReviewResult.status != ReviewResultStatus.DELETED.value,
            )
            .order_by(ReviewResult.created_at.asc())
        )
    )
    if not valid_results:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="At least one valid review result is required before completing review.",
        )

    now = datetime.now(UTC)
    report = InspectionReport(
        project_id=project.id,
        detection_task_id=project.current_task_id,
        report_no=_now_report_no(),
        title=f"{project.name} 外墙检测报告",
        status=InspectionReportStatus.GENERATED.value,
        report_data_json=build_report_data(db, project, project.current_task_id, valid_results),
        generated_by=reviewer.id,
        generated_at=now,
    )
    db.add(report)
    db.flush()

    project.status = ProjectStatus.REVIEWED.value
    project.current_report_id = report.id
    project.updated_at = now

    _write_operation_log(
        db,
        result=None,
        project_id=project.id,
        detection_task_id=project.current_task_id,
        photo_id=None,
        ai_result_id=None,
        operator_id=reviewer.id,
        operation_type=ReviewOperationType.GENERATE_REPORT.value,
        before_json={"project_status": ProjectStatus.PENDING_REVIEW.value},
        after_json={
            "project_status": ProjectStatus.REVIEWED.value,
            "report_id": str(report.id),
            "report_no": report.report_no,
        },
        note="完成审核并生成报告记录",
    )
    db.commit()
    db.refresh(report)
    return InspectionReportRead.model_validate(report)
