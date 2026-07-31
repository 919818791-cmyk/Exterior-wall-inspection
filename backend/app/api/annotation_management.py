from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import AuthenticatedUser, require_roles
from app.api.reports import _detail_item, _list_item, _trial_detail_item, _trial_list_item
from app.db.session import get_db
from app.enums.status import UserRole
from app.enums.status import InspectionReportStatus
from app.models.tables import (
    AnnotationPhotoEdit,
    InspectionReport,
    Project,
    TrialDetectionResult,
)
from app.schemas.annotation_management import (
    AnnotationManagementDetail,
    AnnotationPhotoEditRead,
    AnnotationPhotoEditRequest,
    AnnotationResultListItem,
    AnnotationSourceType,
)
from app.schemas.phase7 import ReportDetailRead, ReportListItem
from app.schemas.projects import DeleteResponse


router = APIRouter(
    prefix="/annotation-management",
    tags=["annotation-management"],
    dependencies=[Depends(require_roles(UserRole.ADMIN))],
)


def _result_or_404(
    db: Session,
    result_id: UUID,
    source_type: AnnotationSourceType,
) -> tuple[InspectionReport, Project] | TrialDetectionResult:
    if source_type == "formal":
        row = db.execute(
            select(InspectionReport, Project)
            .join(Project, Project.id == InspectionReport.project_id)
            .where(
                InspectionReport.id == result_id,
                Project.deleted_at.is_(None),
            )
        ).first()
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Detection result not found.")
        return row

    result = db.get(TrialDetectionResult, result_id)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Detection result not found.")
    return result


def _result_detail(
    db: Session,
    request: Request,
    result_id: UUID,
    source_type: AnnotationSourceType,
) -> ReportDetailRead:
    result = _result_or_404(db, result_id, source_type)
    if source_type == "formal":
        report, project = result
        return _detail_item(db, report, project, request)
    return _trial_detail_item(result, request)


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


def _edit_criteria(source_type: AnnotationSourceType, result_id: UUID) -> object:
    if source_type == "formal":
        return AnnotationPhotoEdit.report_id == result_id
    return AnnotationPhotoEdit.trial_result_id == result_id


def _edit_read(edit: AnnotationPhotoEdit) -> AnnotationPhotoEditRead:
    source_type: AnnotationSourceType = "formal" if edit.report_id is not None else "trial"
    result_id = edit.report_id or edit.trial_result_id
    if result_id is None:  # Guard against legacy/corrupt rows outside the database check constraint.
        raise RuntimeError("Annotation edit is missing its detection result.")
    return AnnotationPhotoEditRead(
        id=edit.id,
        source_type=source_type,
        result_id=result_id,
        photo_key=edit.photo_key,
        annotations=edit.annotations_json,
        edited_by=edit.edited_by,
        created_at=edit.created_at,
        updated_at=edit.updated_at,
    )


def _result_photo_count(report_data: dict | None) -> int:
    data = report_data or {}
    summary = data.get("summary") or {}
    photo_count = summary.get("photo_count")
    if photo_count is not None:
        return int(photo_count)
    return len(data.get("photos") or [])


def _annotation_list_item(
    item: ReportListItem,
    report_data: dict | None,
) -> AnnotationResultListItem:
    payload = item.model_dump()
    payload["photo_count"] = _result_photo_count(report_data)
    return AnnotationResultListItem(**payload)


@router.get("/results", response_model=list[AnnotationResultListItem])
def list_annotation_results(
    request: Request = None,
    db: Session = Depends(get_db),
) -> list[AnnotationResultListItem]:
    formal_rows = db.execute(
        select(InspectionReport, Project)
        .join(Project, Project.id == InspectionReport.project_id)
        .where(
            Project.deleted_at.is_(None),
            InspectionReport.status != InspectionReportStatus.DRAFT.value,
        )
        .order_by(InspectionReport.generated_at.desc(), InspectionReport.created_at.desc())
    ).all()
    items = [
        _annotation_list_item(
            _list_item(report, project, request),
            report.report_data_json,
        )
        for report, project in formal_rows
    ]

    trial_results = db.scalars(
        select(TrialDetectionResult).order_by(
            TrialDetectionResult.generated_at.desc(),
            TrialDetectionResult.created_at.desc(),
        )
    )
    items.extend(
        _annotation_list_item(
            _trial_list_item(result, request),
            result.report_data_json,
        )
        for result in trial_results
    )
    return sorted(items, key=lambda item: (item.generated_at, item.updated_at), reverse=True)


@router.get("/results/{result_id}", response_model=AnnotationManagementDetail)
def get_annotation_result(
    request: Request,
    result_id: UUID,
    source_type: AnnotationSourceType = Query(),
    db: Session = Depends(get_db),
) -> AnnotationManagementDetail:
    result = _result_detail(db, request, result_id, source_type)
    edits = list(
        db.scalars(
            select(AnnotationPhotoEdit)
            .where(_edit_criteria(source_type, result_id))
            .order_by(AnnotationPhotoEdit.created_at.asc())
        )
    )
    return AnnotationManagementDetail(
        result=result,
        edits=[_edit_read(edit) for edit in edits],
    )


@router.put("/results/{result_id}/photos", response_model=AnnotationPhotoEditRead)
def save_photo_annotations(
    request: Request,
    result_id: UUID,
    payload: AnnotationPhotoEditRequest,
    source_type: AnnotationSourceType = Query(),
    db: Session = Depends(get_db),
    admin: AuthenticatedUser = Depends(require_roles(UserRole.ADMIN)),
) -> AnnotationPhotoEditRead:
    result = _result_detail(db, request, result_id, source_type)
    if payload.photo_key not in _valid_photo_keys(result):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found in detection result.")

    edit = db.scalar(
        select(AnnotationPhotoEdit).where(
            _edit_criteria(source_type, result_id),
            AnnotationPhotoEdit.photo_key == payload.photo_key,
        )
    )
    annotations_json = [annotation.model_dump(mode="json") for annotation in payload.annotations]
    if edit is None:
        edit = AnnotationPhotoEdit(
            report_id=result_id if source_type == "formal" else None,
            trial_result_id=result_id if source_type == "trial" else None,
            photo_key=payload.photo_key,
            annotations_json=annotations_json,
            edited_by=admin.id,
        )
        db.add(edit)
    else:
        edit.annotations_json = annotations_json
        edit.edited_by = admin.id

    db.commit()
    db.refresh(edit)
    return _edit_read(edit)


@router.delete("/results/{result_id}/photos", response_model=DeleteResponse)
def reset_photo_annotations(
    request: Request,
    result_id: UUID,
    photo_key: str = Query(min_length=1, max_length=512),
    source_type: AnnotationSourceType = Query(),
    db: Session = Depends(get_db),
) -> DeleteResponse:
    result = _result_detail(db, request, result_id, source_type)
    if photo_key not in _valid_photo_keys(result):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found in detection result.")
    edit = db.scalar(
        select(AnnotationPhotoEdit).where(
            _edit_criteria(source_type, result_id),
            AnnotationPhotoEdit.photo_key == photo_key,
        )
    )
    if edit is not None:
        db.delete(edit)
        db.commit()
    return DeleteResponse()
