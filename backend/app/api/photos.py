from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import AuthenticatedUser, ensure_project_access, get_current_user, require_roles
from app.api.projects import (
    _ensure_project_editable,
    _get_building_or_404,
    _get_facade_or_404,
    _get_project_or_404,
)
from app.db.session import get_db
from app.enums.status import PhotoStatus, PhotoType, UserRole
from app.models.tables import Photo, Project, UploadBatch
from app.schemas.phase4 import PhotoRead, UploadBatchCreateRequest, UploadBatchRead
from app.services.object_storage import presigned_get_url, put_object, remove_object

router = APIRouter(tags=["photos"], dependencies=[Depends(require_roles(UserRole.ADMIN))])


def _enum_value(value: object) -> str:
    return getattr(value, "value", value)


def _batch_no() -> str:
    timestamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S%f")
    return f"UP-{timestamp}-{uuid4().hex[:6].upper()}"


def _validate_project_scope(
    db: Session,
    project: Project,
    building_id: UUID | None,
    facade_id: UUID | None,
) -> None:
    if building_id is not None:
        building = _get_building_or_404(db, building_id)
        if building.project_id != project.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Building does not belong to project.")
    if facade_id is not None:
        facade = _get_facade_or_404(db, facade_id)
        if facade.project_id != project.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Facade does not belong to project.")
        if building_id is not None and facade.building_id != building_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Facade does not belong to building.")


def _photo_to_read(photo: Photo) -> PhotoRead:
    preview_url = presigned_get_url(photo.storage_bucket, photo.storage_object_key)
    thumbnail_url = presigned_get_url(photo.storage_bucket, photo.thumbnail_object_key) or preview_url
    return PhotoRead(
        id=photo.id,
        project_id=photo.project_id,
        building_id=photo.building_id,
        facade_id=photo.facade_id,
        upload_batch_id=photo.upload_batch_id,
        original_filename=photo.original_filename,
        file_ext=photo.file_ext,
        file_size=photo.file_size,
        mime_type=photo.mime_type,
        storage_bucket=photo.storage_bucket,
        storage_object_key=photo.storage_object_key,
        thumbnail_object_key=photo.thumbnail_object_key,
        image_width=photo.image_width,
        image_height=photo.image_height,
        photo_type=photo.photo_type,
        status=photo.status,
        preview_url=preview_url,
        thumbnail_url=thumbnail_url,
        created_at=photo.created_at,
        updated_at=photo.updated_at,
    )


def _count_active_batch_photos(db: Session, upload_batch_id: UUID) -> int:
    return len(
        list(
            db.scalars(
                select(Photo).where(
                    Photo.upload_batch_id == upload_batch_id,
                    Photo.deleted_at.is_(None),
                )
            )
        )
    )


@router.post(
    "/projects/{project_id}/upload-batches",
    response_model=UploadBatchRead,
    status_code=status.HTTP_201_CREATED,
)
def create_upload_batch(
    project_id: UUID,
    payload: UploadBatchCreateRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> UploadBatchRead:
    project = _get_project_or_404(db, project_id)
    ensure_project_access(project, current_user)
    _ensure_project_editable(project)
    _validate_project_scope(db, project, payload.building_id, payload.facade_id)

    batch = UploadBatch(
        project_id=project.id,
        building_id=payload.building_id,
        facade_id=payload.facade_id,
        batch_no=_batch_no(),
        drone_type=payload.drone_type,
        upload_mode=_enum_value(payload.upload_mode),
        photo_count=0,
        uploaded_by=current_user.id,
        remark=payload.remark,
    )
    db.add(batch)
    project.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(batch)
    return UploadBatchRead.model_validate(batch)


@router.post("/photos/upload", response_model=PhotoRead, status_code=status.HTTP_201_CREATED)
def upload_photo(
    project_id: UUID = Form(...),
    upload_batch_id: UUID = Form(...),
    building_id: UUID | None = Form(default=None),
    facade_id: UUID | None = Form(default=None),
    photo_type: PhotoType = Form(default=PhotoType.VISIBLE),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> PhotoRead:
    project = _get_project_or_404(db, project_id)
    ensure_project_access(project, current_user)
    _ensure_project_editable(project)

    batch = db.get(UploadBatch, upload_batch_id)
    if batch is None or batch.project_id != project.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload batch not found.")

    final_building_id = building_id or batch.building_id
    final_facade_id = facade_id or batch.facade_id
    _validate_project_scope(db, project, final_building_id, final_facade_id)

    file.file.seek(0, 2)
    file_size = file.file.tell()
    file.file.seek(0)
    if file_size <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty.")

    suffix = Path(file.filename or "").suffix.lower()
    object_id = uuid4()
    object_key = f"projects/{project.id}/photos/{object_id}{suffix or '.bin'}"
    bucket = put_object(
        object_key=object_key,
        data=file.file,
        length=file_size,
        content_type=file.content_type,
    )

    photo = Photo(
        project_id=project.id,
        building_id=final_building_id,
        facade_id=final_facade_id,
        upload_batch_id=batch.id,
        original_filename=file.filename or f"{object_id}{suffix}",
        file_ext=suffix.lstrip(".") or None,
        file_size=file_size,
        mime_type=file.content_type,
        storage_bucket=bucket,
        storage_object_key=object_key,
        thumbnail_object_key=None,
        photo_type=_enum_value(photo_type),
        status=PhotoStatus.UPLOADED.value,
    )
    db.add(photo)
    db.flush()
    batch.photo_count = _count_active_batch_photos(db, batch.id)
    project.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(photo)
    return _photo_to_read(photo)


@router.get("/projects/{project_id}/photos", response_model=list[PhotoRead])
def list_project_photos(
    project_id: UUID,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> list[PhotoRead]:
    project = _get_project_or_404(db, project_id)
    ensure_project_access(project, current_user)
    photos = list(
        db.scalars(
            select(Photo)
            .where(Photo.project_id == project_id, Photo.deleted_at.is_(None))
            .order_by(Photo.created_at.desc())
        )
    )
    return [_photo_to_read(photo) for photo in photos]


@router.delete("/photos/{photo_id}")
def delete_photo(
    photo_id: UUID,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, bool]:
    photo = db.scalar(select(Photo).where(Photo.id == photo_id, Photo.deleted_at.is_(None)))
    if photo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found.")
    project = _get_project_or_404(db, photo.project_id)
    ensure_project_access(project, current_user)
    _ensure_project_editable(project)

    deleted_at = datetime.now(UTC)
    photo.deleted_at = deleted_at
    project.updated_at = deleted_at

    batch = db.get(UploadBatch, photo.upload_batch_id)
    if batch is not None:
        batch.photo_count = max(0, batch.photo_count - 1)

    remove_object(photo.storage_bucket, photo.storage_object_key)
    remove_object(photo.storage_bucket, photo.thumbnail_object_key)
    db.commit()
    return {"ok": True}
