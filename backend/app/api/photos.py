from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import (
    AuthenticatedUser,
    ensure_project_access,
    ensure_project_write_access,
    get_current_user,
)
from app.api.projects import _ensure_project_editable, _get_project_or_404
from app.db.session import get_db
from app.enums.status import PhotoPrecheckStatus, PhotoStatus, PhotoType
from app.models.tables import Photo, UploadBatch
from app.schemas.phase4 import (
    PhotoRead,
    UploadBatchCreateRequest,
    UploadBatchRead,
)
from app.services.object_storage import presigned_get_url, put_object, remove_object
from app.services.photo_metadata import (
    FormalPhotoMetadata,
    extract_formal_photo_metadata,
    facade_orientation_from_yaw,
)
from app.services.photo_precheck import run_stored_photo_precheck
from app.services.photo_thumbnails import build_thumbnail, store_thumbnail
from app.services.usage_tracking import add_photo_upload_event

router = APIRouter(tags=["photos"])

FORMAL_MAX_PHOTO_COUNT = 30
FORMAL_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024


def _enum_value(value: object) -> str:
    return getattr(value, "value", value)


def _batch_no() -> str:
    timestamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S%f")
    return f"UP-{timestamp}-{uuid4().hex[:6].upper()}"


def _non_drone_photo_reason(metadata: FormalPhotoMetadata) -> str:
    missing_items: list[str] = []
    if not metadata["drone_metadata_available"]:
        missing_items.append("无人机拍摄元数据")
    if not metadata["camera_model"]:
        missing_items.append("无人机机型信息")
    return f"未检测到{'或'.join(missing_items)}。仅支持专业无人机拍摄的原始照片。"


def _photo_to_read(photo: Photo) -> PhotoRead:
    preview_url = presigned_get_url(photo.storage_bucket, photo.storage_object_key)
    thumbnail_url = presigned_get_url(photo.storage_bucket, photo.thumbnail_object_key) or preview_url
    return PhotoRead(
        id=photo.id,
        project_id=photo.project_id,
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
        relative_altitude=photo.relative_altitude,
        gimbal_yaw_degree=photo.gimbal_yaw_degree,
        facade_orientation=facade_orientation_from_yaw(
            float(photo.gimbal_yaw_degree) if photo.gimbal_yaw_degree is not None else None
        ),
        photo_type=photo.photo_type,
        status=photo.status,
        precheck_status=photo.precheck_status,
        precheck_category=photo.precheck_category,
        precheck_reason=photo.precheck_reason,
        precheck_model=photo.precheck_model,
        precheck_error=photo.precheck_error,
        precheck_attempts=photo.precheck_attempts,
        prechecked_at=photo.prechecked_at,
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


def _count_active_project_photos(db: Session, project_id: UUID) -> int:
    return len(
        list(
            db.scalars(
                select(Photo).where(
                    Photo.project_id == project_id,
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
    ensure_project_write_access(project, current_user)
    _ensure_project_editable(project)
    batch = UploadBatch(
        project_id=project.id,
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
    photo_type: PhotoType = Form(default=PhotoType.VISIBLE),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> PhotoRead:
    project = _get_project_or_404(db, project_id)
    ensure_project_write_access(project, current_user)
    _ensure_project_editable(project)

    batch = db.get(UploadBatch, upload_batch_id)
    if batch is None or batch.project_id != project.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload batch not found.")

    file.file.seek(0, 2)
    file_size = file.file.tell()
    file.file.seek(0)
    if file_size <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty.")
    if file_size > FORMAL_MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"单张图片最大 {FORMAL_MAX_FILE_SIZE_BYTES // (1024 * 1024)}MB。",
        )
    if _count_active_project_photos(db, project.id) >= FORMAL_MAX_PHOTO_COUNT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"每个项目最多上传 {FORMAL_MAX_PHOTO_COUNT} 张照片。",
        )

    suffix = Path(file.filename or "").suffix.lower()
    object_id = uuid4()
    object_key = f"projects/{project.id}/photos/{object_id}{suffix or '.bin'}"
    metadata = extract_formal_photo_metadata(file.file)
    thumbnail = build_thumbnail(file.file, object_key)
    bucket: str | None = None
    thumbnail_bucket: str | None = None
    try:
        bucket = put_object(
            object_key=object_key,
            data=file.file,
            length=file_size,
            content_type=file.content_type,
        )
        if thumbnail is not None:
            thumbnail_bucket = store_thumbnail(thumbnail)
    except Exception:
        if bucket is not None:
            remove_object(bucket, object_key)
        if thumbnail_bucket is not None and thumbnail is not None:
            remove_object(thumbnail_bucket, thumbnail.object_key)
        raise

    photo = Photo(
        project_id=project.id,
        upload_batch_id=batch.id,
        original_filename=file.filename or f"{object_id}{suffix}",
        file_ext=suffix.lstrip(".") or None,
        file_size=file_size,
        mime_type=file.content_type,
        storage_bucket=bucket,
        storage_object_key=object_key,
        thumbnail_object_key=thumbnail.object_key if thumbnail is not None else None,
        image_width=thumbnail.source_width if thumbnail is not None else None,
        image_height=thumbnail.source_height if thumbnail is not None else None,
        relative_altitude=metadata["relative_altitude"],
        gimbal_yaw_degree=metadata["gimbal_yaw_degree"],
        photo_type=(
            PhotoType.THERMAL.value
            if metadata["thermal_imaging_available"]
            else _enum_value(photo_type)
        ),
        status=PhotoStatus.UPLOADED.value,
        precheck_status=(
            PhotoPrecheckStatus.PENDING.value
            if metadata["professional_drone_photo"]
            else PhotoPrecheckStatus.REJECTED.value
        ),
        precheck_category=None if metadata["professional_drone_photo"] else "NON_DRONE",
        precheck_reason=(
            None
            if metadata["professional_drone_photo"]
            else _non_drone_photo_reason(metadata)
        ),
        precheck_model=None if metadata["professional_drone_photo"] else "embedded-metadata",
        precheck_attempts=0 if metadata["professional_drone_photo"] else 1,
        prechecked_at=None if metadata["professional_drone_photo"] else datetime.now(UTC),
    )
    db.add(photo)
    db.flush()
    add_photo_upload_event(
        db,
        source_type="formal",
        photo_id=photo.id,
        actor_id=current_user.id,
        storage_bytes=file_size,
        occurred_at=photo.created_at,
    )
    batch.photo_count = _count_active_batch_photos(db, batch.id)
    if metadata["camera_model"] and not batch.drone_type:
        batch.drone_type = metadata["camera_model"]
    project.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(photo)
    if metadata["professional_drone_photo"]:
        run_stored_photo_precheck(db, photo)
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
    ensure_project_write_access(project, current_user)
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
