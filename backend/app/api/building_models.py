from __future__ import annotations

from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from PIL import Image, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import (
    AuthenticatedUser,
    ensure_project_access,
    get_current_user,
    get_optional_current_user,
)
from app.api.projects import _api_base_url, _get_project_or_404
from app.db.session import get_db
from app.enums.status import UserRole
from app.models.tables import BuildingModel, BuildingModelImage, Project
from app.schemas.projects import BuildingModelImageRead, BuildingModelRead, DeleteResponse
from app.services.object_storage import put_object, remove_object, signed_object_url
from app.services.usage_tracking import add_building_model_upload_event

router = APIRouter(tags=["building-models"])

MAX_BUILDING_MODEL_BYTES = 1024 * 1024 * 1024
MODEL_IMAGE_SLOTS = (
    ("overview", "model"),
    ("east", "elevation"),
    ("east", "annotated"),
    ("south", "elevation"),
    ("south", "annotated"),
    ("west", "elevation"),
    ("west", "annotated"),
    ("north", "elevation"),
    ("north", "annotated"),
)


def _get_building_model(db: Session, project_id: UUID) -> BuildingModel | None:
    return db.scalar(select(BuildingModel).where(BuildingModel.project_id == project_id))


def _get_building_model_images(db: Session, project_id: UUID) -> list[BuildingModelImage]:
    return list(
        db.scalars(
            select(BuildingModelImage)
            .where(BuildingModelImage.project_id == project_id)
            .order_by(BuildingModelImage.orientation, BuildingModelImage.image_kind)
        )
    )


def has_complete_building_model_images(db: Session, project_id: UUID) -> bool:
    slots = {
        (image.orientation, image.image_kind)
        for image in _get_building_model_images(db, project_id)
    }
    return slots == set(MODEL_IMAGE_SLOTS)


def _ensure_model_write_access(project: Project, current_user: AuthenticatedUser) -> None:
    ensure_project_access(project, current_user)
    if project.is_example:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="示例项目为只读项目。",
        )
    if current_user.role not in {UserRole.REVIEWER.value, UserRole.ADMIN.value}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅审核员或管理员可以管理三维模型。",
        )


def _to_read(request: Request, model: BuildingModel) -> BuildingModelRead:
    url = signed_object_url(
        _api_base_url(request),
        model.storage_bucket,
        model.storage_object_key,
    )
    if url is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="三维模型存储信息不完整。",
        )
    return BuildingModelRead(
        id=model.id,
        project_id=model.project_id,
        original_filename=model.original_filename,
        file_size=model.file_size,
        mime_type=model.mime_type,
        url=url,
        uploaded_by=model.uploaded_by,
        uploaded_at=model.updated_at,
    )


def _image_to_read(request: Request, image: BuildingModelImage) -> BuildingModelImageRead:
    url = signed_object_url(
        _api_base_url(request),
        image.storage_bucket,
        image.storage_object_key,
    )
    if url is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="三维模型图片存储信息不完整。",
        )
    return BuildingModelImageRead(
        id=image.id,
        project_id=image.project_id,
        orientation=image.orientation,
        image_kind=image.image_kind,
        original_filename=image.original_filename,
        file_size=image.file_size,
        mime_type=image.mime_type,
        url=url,
        uploaded_by=image.uploaded_by,
        uploaded_at=image.updated_at,
    )


@router.get(
    "/projects/{project_id}/building-model",
    response_model=BuildingModelRead | None,
)
def get_building_model(
    project_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser | None = Depends(get_optional_current_user),
) -> BuildingModelRead | None:
    project = _get_project_or_404(db, project_id)
    ensure_project_access(project, current_user)
    model = _get_building_model(db, project.id)
    return _to_read(request, model) if model is not None else None


@router.put(
    "/projects/{project_id}/building-model",
    response_model=BuildingModelRead,
)
def upload_building_model(
    project_id: UUID,
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> BuildingModelRead:
    project = _get_project_or_404(db, project_id)
    _ensure_model_write_access(project, current_user)

    filename = (file.filename or "").strip()
    if Path(filename).suffix.lower() != ".glb":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请选择 GLB 格式的三维模型文件。",
        )
    if len(filename) > 255:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="三维模型文件名不能超过 255 个字符。",
        )

    file.file.seek(0, 2)
    file_size = file.file.tell()
    file.file.seek(0)
    if file_size <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="上传文件不能为空。")
    if file_size > MAX_BUILDING_MODEL_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="三维模型文件不能超过 1 GB。",
        )

    upload_id = uuid4()
    object_key = f"projects/{project.id}/building-models/{upload_id}.glb"
    model = _get_building_model(db, project.id)
    old_storage = (
        (model.storage_bucket, model.storage_object_key)
        if model is not None
        else None
    )
    bucket = put_object(
        object_key=object_key,
        data=file.file,
        length=file_size,
        content_type=file.content_type or "model/gltf-binary",
    )

    try:
        uploaded_at = datetime.now(UTC)
        if model is None:
            model = BuildingModel(id=uuid4(), project_id=project.id)
            db.add(model)

        model.original_filename = filename
        model.file_size = file_size
        model.mime_type = (file.content_type or "model/gltf-binary")[:128]
        model.storage_bucket = bucket
        model.storage_object_key = object_key
        model.uploaded_by = current_user.id
        model.updated_at = uploaded_at
        project.updated_at = uploaded_at
        add_building_model_upload_event(
            db,
            upload_id=upload_id,
            actor_id=current_user.id,
            storage_bytes=file_size,
            occurred_at=uploaded_at,
        )
        db.commit()
    except Exception:
        db.rollback()
        remove_object(bucket, object_key)
        raise

    assert model is not None
    if old_storage is not None:
        remove_object(*old_storage)
    db.refresh(model)
    return _to_read(request, model)


@router.get(
    "/projects/{project_id}/building-model-images",
    response_model=list[BuildingModelImageRead],
)
def get_building_model_images(
    project_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser | None = Depends(get_optional_current_user),
) -> list[BuildingModelImageRead]:
    project = _get_project_or_404(db, project_id)
    ensure_project_access(project, current_user)
    return [_image_to_read(request, image) for image in _get_building_model_images(db, project.id)]


def _validated_image_upload(
    file: UploadFile,
    slot: tuple[str, str],
) -> tuple[str, bytes, str, str]:
    filename = (file.filename or "").strip()
    if not filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="图片文件名不能为空。")
    if len(filename) > 255:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{filename} 文件名不能超过 255 个字符。",
        )
    content = file.file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{filename} 不能为空。")
    try:
        with Image.open(BytesIO(content)) as source:
            image_format = str(source.format or "").upper()
            source.verify()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{filename} 不是有效的图片文件。",
        ) from exc
    if image_format not in {"JPEG", "PNG"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{filename} 仅支持 JPG、JPEG 或 PNG 格式。",
        )
    extension = ".jpg" if image_format == "JPEG" else ".png"
    mime_type = "image/jpeg" if image_format == "JPEG" else "image/png"
    orientation, image_kind = slot
    object_key = (
        f"projects/{{project_id}}/building-model-images/"
        f"{orientation}-{image_kind}-{{upload_id}}{extension}"
    )
    return filename, content, mime_type, object_key


@router.put(
    "/projects/{project_id}/building-model-images",
    response_model=list[BuildingModelImageRead],
)
def upload_building_model_images(
    project_id: UUID,
    request: Request,
    files: list[UploadFile] = File(...),
    slots: list[str] = Form(...),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> list[BuildingModelImageRead]:
    project = _get_project_or_404(db, project_id)
    _ensure_model_write_access(project, current_user)
    if not files or len(files) != len(slots):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请至少选择一张图片，并确保图片与槽位一一对应。",
        )

    parsed_slots: list[tuple[str, str]] = []
    for slot in slots:
        orientation, separator, image_kind = slot.partition(":")
        parsed = (orientation, image_kind)
        if not separator or parsed not in MODEL_IMAGE_SLOTS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="图片槽位无效。")
        parsed_slots.append(parsed)
    if len(set(parsed_slots)) != len(parsed_slots):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="同一图片槽位不能重复上传。",
        )

    validated = [
        (slot, *_validated_image_upload(file, slot))
        for file, slot in zip(files, parsed_slots, strict=True)
    ]
    existing_images = _get_building_model_images(db, project.id)
    submitted_slots = set(parsed_slots)
    replaced_images = [
        image
        for image in existing_images
        if (image.orientation, image.image_kind) in submitted_slots
    ]
    old_storage = [
        (image.storage_bucket, image.storage_object_key)
        for image in replaced_images
    ]
    uploaded_storage: list[tuple[str, str]] = []
    new_images: list[BuildingModelImage] = []
    uploaded_at = datetime.now(UTC)
    try:
        for slot, filename, content, mime_type, object_key_template in validated:
            upload_id = uuid4()
            object_key = object_key_template.format(
                project_id=project.id,
                upload_id=upload_id,
            )
            bucket = put_object(
                object_key=object_key,
                data=BytesIO(content),
                length=len(content),
                content_type=mime_type,
            )
            uploaded_storage.append((bucket, object_key))
            image = BuildingModelImage(
                id=uuid4(),
                project_id=project.id,
                orientation=slot[0],
                image_kind=slot[1],
                original_filename=filename,
                file_size=len(content),
                mime_type=mime_type,
                storage_bucket=bucket,
                storage_object_key=object_key,
                uploaded_by=current_user.id,
                created_at=uploaded_at,
                updated_at=uploaded_at,
            )
            new_images.append(image)

        for image in replaced_images:
            db.delete(image)
        db.flush()
        db.add_all(new_images)
        project.updated_at = uploaded_at
        db.commit()
    except Exception:
        db.rollback()
        for storage in uploaded_storage:
            remove_object(*storage)
        raise

    for storage in old_storage:
        remove_object(*storage)
    images_by_slot = {
        (image.orientation, image.image_kind): image
        for image in existing_images
        if (image.orientation, image.image_kind) not in submitted_slots
    }
    images_by_slot.update({
        (image.orientation, image.image_kind): image
        for image in new_images
    })
    return [
        _image_to_read(request, images_by_slot[slot])
        for slot in MODEL_IMAGE_SLOTS
        if slot in images_by_slot
    ]


@router.delete(
    "/projects/{project_id}/building-model",
    response_model=DeleteResponse,
)
def delete_building_model(
    project_id: UUID,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> DeleteResponse:
    project = _get_project_or_404(db, project_id)
    _ensure_model_write_access(project, current_user)
    model = _get_building_model(db, project.id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目尚未上传三维模型。")

    storage = (model.storage_bucket, model.storage_object_key)
    project.updated_at = datetime.now(UTC)
    db.delete(model)
    db.commit()
    remove_object(*storage)
    return DeleteResponse()
