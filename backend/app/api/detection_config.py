from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import AuthenticatedUser, ensure_project_access, get_current_user
from app.api.projects import _ensure_project_editable, _get_project_or_404
from app.db.session import get_db
from app.models.tables import DetectionConfig
from app.schemas.phase4 import DetectionConfigResponse, DetectionConfigUpdateRequest

router = APIRouter(tags=["detection-config"])


def _enum_value(value: object) -> str:
    return getattr(value, "value", value)


def _to_response(config: DetectionConfig | None, project_id: UUID) -> DetectionConfigResponse:
    if config is None:
        return DetectionConfigResponse(project_id=project_id)
    return DetectionConfigResponse(
        id=config.id,
        project_id=config.project_id,
        model_types=config.model_types,
        high_precision=config.high_precision,
        config_json=config.config_json,
        created_at=config.created_at,
        updated_at=config.updated_at,
    )


@router.get(
    "/projects/{project_id}/detection-config",
    response_model=DetectionConfigResponse,
)
def get_detection_config(
    project_id: UUID,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> DetectionConfigResponse:
    project = _get_project_or_404(db, project_id)
    ensure_project_access(project, current_user)
    config = db.scalar(select(DetectionConfig).where(DetectionConfig.project_id == project_id))
    return _to_response(config, project_id)


@router.put(
    "/projects/{project_id}/detection-config",
    response_model=DetectionConfigResponse,
)
def update_detection_config(
    project_id: UUID,
    payload: DetectionConfigUpdateRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> DetectionConfigResponse:
    project = _get_project_or_404(db, project_id)
    ensure_project_access(project, current_user)
    _ensure_project_editable(project)
    config = db.scalar(select(DetectionConfig).where(DetectionConfig.project_id == project_id))

    if config is None:
        config = DetectionConfig(
            project_id=project_id,
            model_types=[_enum_value(item) for item in payload.model_types],
            high_precision=payload.high_precision,
            config_json=payload.config_json,
            created_by=current_user.id,
        )
        db.add(config)
    else:
        config.model_types = [_enum_value(item) for item in payload.model_types]
        config.high_precision = payload.high_precision
        config.config_json = payload.config_json

    project.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(config)
    return _to_response(config, project_id)
