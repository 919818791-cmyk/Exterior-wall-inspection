from __future__ import annotations

import hashlib
import logging
from pathlib import PurePosixPath
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import AuthenticatedUser, require_roles
from app.core.config import get_settings
from app.db.session import get_db
from app.enums.status import UserRole
from app.models.base import utc_now
from app.models.tables import YoloModel, YoloModelVersion
from app.schemas.yolo_models import (
    YoloModelCatalog, YoloModelCreate, YoloModelEdit,
    YoloModelRead, YoloVersionEdit, YoloVersionRead,
)
from app.schemas.vision_models import ModelRuntimeRead
from app.services import object_storage, yolo_runtime

logger = logging.getLogger(__name__)
admin = require_roles(UserRole.ADMIN)
router = APIRouter(prefix="/yolo-models", tags=["yolo-models"], dependencies=[Depends(admin)])


def _lock_model(db: Session, model_id: UUID) -> YoloModel:
    model = db.scalar(select(YoloModel).where(
        YoloModel.id == model_id, YoloModel.deleted_at.is_(None),
    ).with_for_update())
    if model is None:
        raise HTTPException(404, "模型不存在或已删除。")
    return model


def _version_or_404(db: Session, model_id: UUID, version_id: UUID) -> YoloModelVersion:
    version = db.scalar(select(YoloModelVersion).join(YoloModel).where(
        YoloModelVersion.id == version_id, YoloModelVersion.model_id == model_id,
        YoloModel.deleted_at.is_(None),
    ))
    if version is None:
        raise HTTPException(404, "模型版本不存在。")
    return version


def _version_read(version: YoloModelVersion) -> YoloVersionRead:
    status = yolo_runtime.version_status(version)
    return YoloVersionRead.model_validate(version).model_copy(update={
        "runtime_status": status.state, "runtime_message": status.message,
        "control_supported": status.control_supported,
    })


def _ensure_version_stopped(version: YoloModelVersion) -> None:
    yolo_runtime.ensure_stopped(version)
    if yolo_runtime.version_status(version).state in {"running", "starting", "stopping"}:
        raise HTTPException(409, "版本正在运行或切换状态，请先停止该版本。")


@router.get("", response_model=YoloModelCatalog)
def list_models(db: Session = Depends(get_db)) -> YoloModelCatalog:
    models = db.scalars(select(YoloModel).where(YoloModel.deleted_at.is_(None)).order_by(
        YoloModel.created_at, YoloModel.id,
    )).all()
    versions_by_model: dict[UUID, list[YoloVersionRead]] = {}
    versions = db.scalars(select(YoloModelVersion).join(YoloModel).where(
        YoloModel.deleted_at.is_(None),
    ).order_by(YoloModelVersion.created_at.desc(), YoloModelVersion.id)).all()
    for version in versions:
        versions_by_model.setdefault(version.model_id, []).append(_version_read(version))
    return YoloModelCatalog(
        items=[YoloModelRead(
            id=model.id, name=model.name or "YOLO 模型", description=model.description,
            created_at=model.created_at, updated_at=model.updated_at,
            versions=versions_by_model.get(model.id, []),
        ) for model in models],
        max_upload_bytes=get_settings().yolo_model_max_upload_bytes,
        inference_ready=any(version.runtime_status == "running" for versions in versions_by_model.values() for version in versions),
    )


def _model_read(db: Session, model_id: UUID) -> YoloModelRead:
    return next(item for item in list_models(db).items if item.id == model_id)


@router.post("", response_model=YoloModelRead, status_code=201)
def create_model(payload: YoloModelCreate, db: Session = Depends(get_db)) -> YoloModelRead:
    model = YoloModel(name=payload.name, description=payload.description.strip() or None)
    db.add(model)
    db.flush()
    db.commit()
    return _model_read(db, model.id)


@router.patch("/{model_id}", response_model=YoloModelRead)
def edit_model(model_id: UUID, payload: YoloModelEdit, db: Session = Depends(get_db)) -> YoloModelRead:
    model = _lock_model(db, model_id)
    model.name = payload.name
    model.description = payload.description.strip() or None
    model.updated_at = utc_now()
    db.commit()
    return _model_read(db, model_id)


@router.delete("/{model_id}", status_code=204)
def delete_model(model_id: UUID, db: Session = Depends(get_db)) -> Response:
    model = _lock_model(db, model_id)
    from app.services.vision_models import ensure_model_unbound
    ensure_model_unbound(db, str(model_id))
    for version in db.scalars(select(YoloModelVersion).where(YoloModelVersion.model_id == model_id)):
        _ensure_version_stopped(version)
    # Follow the repository's soft-deletion pattern and retain uploaded weights.
    model.deleted_at = utc_now()
    db.commit()
    return Response(status_code=204)


@router.post("/{model_id}/versions", response_model=YoloVersionRead, status_code=201)
def upload_version(
    model_id: UUID,
    version: str = Form(min_length=1, max_length=64),
    description: str = Form(default="", max_length=2000),
    file: UploadFile = File(),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(admin),
) -> YoloVersionRead:
    version = version.strip()
    if not version:
        raise HTTPException(422, "版本号不能为空。")
    filename = PurePosixPath((file.filename or "").replace("\\", "/")).name
    if not filename.lower().endswith(".pt") or len(filename) > 255 or any(ord(char) < 32 for char in filename):
        raise HTTPException(422, "请选择文件名不超过 255 字符的 YOLO .pt 权重文件。")
    limit = get_settings().yolo_model_max_upload_bytes
    digest, size = hashlib.sha256(), 0
    file.file.seek(0)
    while chunk := file.file.read(1024 * 1024):
        size += len(chunk)
        if size > limit:
            raise HTTPException(413, "模型文件超过上传大小限制。")
        digest.update(chunk)
    if size == 0:
        raise HTTPException(422, "模型文件不能为空。")
    file.file.seek(0)
    model = _lock_model(db, model_id)
    if db.scalar(select(YoloModelVersion.id).where(
        YoloModelVersion.model_id == model_id, YoloModelVersion.version == version,
    )):
        raise HTTPException(409, "该模型已存在相同版本号，请使用新的版本号。")
    identifier = uuid4()
    key = f"yolo-models/{model_id}/{identifier.hex}/weights.pt"
    try:
        bucket = object_storage.put_object(key, file.file, size, "application/octet-stream")
    except Exception as error:
        logger.exception("yolo_model_upload_failed")
        raise HTTPException(502, "模型文件存储失败，请稍后重试。") from error
    item = YoloModelVersion(
        # Retain the legacy database column without exposing or requiring it in model management.
        id=identifier, model_id=model_id, version=version, architecture="",
        description=description.strip() or None, original_filename=filename, file_size=size,
        sha256=digest.hexdigest(), storage_bucket=bucket, storage_object_key=key,
        is_active=False, created_by=current_user.id,
    )
    db.add(item)
    model.updated_at = utc_now()
    try:
        db.flush()
        db.commit()
    except Exception as error:
        db.rollback()
        try:
            object_storage.remove_object(bucket, key)
        except Exception:
            logger.exception("yolo_model_upload_cleanup_failed")
        if isinstance(error, IntegrityError):
            raise HTTPException(409, "版本保存冲突，请刷新后重试。") from error
        raise
    db.refresh(item)
    return _version_read(item)


@router.patch("/{model_id}/versions/{version_id}", response_model=YoloVersionRead)
def edit_version(model_id: UUID, version_id: UUID, payload: YoloVersionEdit, db: Session = Depends(get_db)) -> YoloVersionRead:
    model = _lock_model(db, model_id)
    item = _version_or_404(db, model_id, version_id)
    item.version = payload.version
    item.description = payload.description.strip() or None
    model.updated_at = utc_now()
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(409, "该模型已存在相同版本号，请使用新的版本号。") from error
    db.refresh(item)
    return _version_read(item)


@router.post("/{model_id}/versions/{version_id}/runtime/{action}", response_model=ModelRuntimeRead)
def control_version(model_id: UUID, version_id: UUID, action: str, db: Session = Depends(get_db)):
    _lock_model(db, model_id)
    version = _version_or_404(db, model_id, version_id)
    if action not in {"start", "stop"}:
        raise HTTPException(422, "未知模型运行操作。")
    result = yolo_runtime.control_version(version, action)
    return ModelRuntimeRead(state=result.state, message=result.message)


@router.delete("/{model_id}/versions/{version_id}", status_code=204)
def delete_version(model_id: UUID, version_id: UUID, db: Session = Depends(get_db)) -> Response:
    model = _lock_model(db, model_id)
    item = _version_or_404(db, model_id, version_id)
    _ensure_version_stopped(item)
    from app.services.vision_models import ensure_model_unbound
    ensure_model_unbound(db, str(model_id), version_id=str(version_id))
    try:
        object_storage.remove_object(item.storage_bucket, item.storage_object_key, strict=True)
    except Exception as error:
        logger.exception("yolo_model_delete_failed")
        raise HTTPException(502, "模型文件删除失败，请稍后重试。") from error
    db.delete(item)
    model.updated_at = utc_now()
    db.commit()
    return Response(status_code=204)
