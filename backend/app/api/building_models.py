from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
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
from app.models.tables import BuildingModel, Project
from app.schemas.projects import BuildingModelRead, DeleteResponse
from app.services.object_storage import put_object, remove_object, signed_object_url
from app.services.usage_tracking import add_building_model_upload_event

router = APIRouter(tags=["building-models"])

MAX_BUILDING_MODEL_BYTES = 1024 * 1024 * 1024


def _get_building_model(db: Session, project_id: UUID) -> BuildingModel | None:
    return db.scalar(select(BuildingModel).where(BuildingModel.project_id == project_id))


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
