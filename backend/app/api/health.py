from fastapi import APIRouter, Depends
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import get_db
from app.schemas.health import HealthResponse, PhotoGuardHealth, WorkerContractHealth
from app.services.photo_guard import (
    photo_guard_api_base_url,
    photo_guard_health,
    photo_guard_model_name,
    PhotoGuardUnavailable,
)
from app.services.photo_guard_strategy import photo_guard_strategy_settings

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
def health_check(db: Session = Depends(get_db)) -> HealthResponse:
    settings = get_settings()
    guard_model, guard_endpoint = photo_guard_model_name(settings), photo_guard_api_base_url(settings)
    try:
        if settings.photo_guard_enabled:
            settings, _ = photo_guard_strategy_settings(db, settings)
            guard_model, guard_endpoint = photo_guard_model_name(settings), photo_guard_api_base_url(settings)
        guard_ready, guard_message = photo_guard_health(settings)
    except PhotoGuardUnavailable as error:
        guard_ready, guard_message = False, str(error)
        guard_model, guard_endpoint = "", ""
    except SQLAlchemyError:
        guard_ready, guard_message = False, "照片预检策略配置暂时不可读取。"
        guard_model, guard_endpoint = "", ""

    return HealthResponse(
        status="ok" if guard_ready else "degraded",
        service=settings.app_name,
        environment=settings.app_env,
        api_prefix=settings.api_prefix,
        database_configured=bool(settings.database_url),
        minio_configured=bool(settings.minio_endpoint and settings.minio_bucket),
        redis_configured=bool(settings.redis_url),
        photo_guard=PhotoGuardHealth(
            enabled=settings.photo_guard_enabled,
            ready=guard_ready,
            model=guard_model,
            endpoint=guard_endpoint,
            message=guard_message,
        ),
        worker_contract=WorkerContractHealth(
            backend_base_url=settings.worker_backend_base_url,
            minio_public_url=settings.minio_public_url,
            worker_token_configured=settings.worker_token != "change-this-worker-token",
            lease_seconds=settings.worker_lease_seconds,
        ),
    )
