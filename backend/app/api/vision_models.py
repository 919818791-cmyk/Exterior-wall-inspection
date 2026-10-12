import json
import logging
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.api.dependencies import AuthenticatedUser, require_roles
from app.db.session import get_db
from app.enums.status import UserRole
from app.models.tables import SystemSetting
from app.schemas.vision_models import ModelIdentifier, ModelRuntimeRead, VisionModelEdit, VisionModelRead
from app.services import vision_models
from app.services.local_qwen_lifecycle import LocalQwenLifecycleError, start_local_qwen, stop_local_qwen
from app.services.trial_inference_provider import set_setting_value

admin = require_roles(UserRole.ADMIN)
router = APIRouter(prefix="/vision-models", tags=["vision-models"], dependencies=[Depends(admin)])
logger = logging.getLogger(__name__)


@router.get("", response_model=list[VisionModelRead])
def list_models(db: Session = Depends(get_db)):
    return vision_models.model_catalog(db)


@router.post("", response_model=VisionModelRead, status_code=201)
def create_model(payload: VisionModelEdit, db: Session = Depends(get_db), user: AuthenticatedUser = Depends(admin)):
    identifier = str(uuid4())
    set_setting_value(db, vision_models.VISION_PREFIX + identifier, payload.model_dump_json(), updated_by=user.id)
    db.commit()
    return vision_models.model_read(db, identifier)


@router.patch("/{identifier}", response_model=VisionModelRead)
def edit_model(identifier: ModelIdentifier, payload: VisionModelEdit, db: Session = Depends(get_db), user: AuthenticatedUser = Depends(admin)):
    old = vision_models.model_read(db, identifier)
    if old.kind != payload.kind:
        raise HTTPException(422, "模型来源不能修改，请新增独立模型。")
    if old.runtime_status in {"running", "starting"}:
        raise HTTPException(409, "请先停止本地模型，再修改配置。")
    set_setting_value(db, vision_models.VISION_PREFIX + identifier, payload.model_dump_json(), updated_by=user.id)
    db.commit()
    return vision_models.model_read(db, identifier)


@router.delete("/{identifier}", status_code=204)
def delete_model(identifier: ModelIdentifier, db: Session = Depends(get_db)):
    model = vision_models.model_read(db, identifier)
    if model.builtin:
        raise HTTPException(409, "系统预置模型不能删除。")
    if model.runtime_status in {"running", "starting"}:
        raise HTTPException(409, "请先停止本地模型。")
    vision_models.ensure_model_unbound(db, identifier)
    db.delete(db.get(SystemSetting, vision_models.VISION_PREFIX + identifier))
    db.commit()
    return Response(status_code=204)


@router.post("/{identifier}/runtime/{action}", response_model=ModelRuntimeRead)
def control_model(identifier: ModelIdentifier, action: Literal["start", "stop"], db: Session = Depends(get_db), user: AuthenticatedUser = Depends(admin)):
    model = vision_models.model_read(db, identifier)
    if model.kind != "local_vlm":
        raise HTTPException(422, "云端 API 无需本地启停。")
    if not model.control_supported:
        raise HTTPException(409, model.runtime_message)
    service = ""
    try:
        service = vision_models.managed_photo_guard_service(identifier, model)
        status = (vision_models.control_managed_photo_guard(service, model, action) if service else
            (start_local_qwen if action == "start" else stop_local_qwen)(vision_models.local_model_settings(identifier, model)))
    except (LocalQwenLifecycleError, OSError) as error:
        logger.warning("vision_model_control actor=%s model=%s unit=%s action=%s result=failed error_type=%s",
            user.id, identifier, service or "local_vllm", action, type(error).__name__)
        raise HTTPException(409, "模型启停失败，请检查服务端配置及日志。") from error
    logger.info("vision_model_control actor=%s model=%s unit=%s action=%s result=%s",
        user.id, identifier, service or "local_vllm", action, status.state)
    return ModelRuntimeRead(state=status.state, message=status.message)
