from fastapi import APIRouter

from app.core.config import get_settings
from app.schemas.health import HealthResponse, PhotoGuardHealth, WorkerContractHealth
from app.services.photo_guard import (
    photo_guard_api_base_url,
    photo_guard_health,
    photo_guard_model_name,
)

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
def health_check() -> HealthResponse:
    settings = get_settings()
    guard_ready, guard_message = photo_guard_health(settings)

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
            model=photo_guard_model_name(settings),
            endpoint=photo_guard_api_base_url(settings),
            message=guard_message,
        ),
        worker_contract=WorkerContractHealth(
            backend_base_url=settings.worker_backend_base_url,
            minio_public_url=settings.minio_public_url,
            worker_token_configured=settings.worker_token != "change-this-worker-token",
            lease_seconds=settings.worker_lease_seconds,
        ),
    )
