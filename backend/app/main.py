import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import get_settings
from app.core.exceptions import register_exception_handlers
from app.db.session import SessionLocal
from app.services.local_qwen_lifecycle import reconcile_local_qwen
from app.services.trial_inference_provider import get_trial_inference_provider

settings = get_settings()
logger = logging.getLogger(__name__)


def synchronize_local_qwen_on_startup() -> None:
    try:
        with SessionLocal() as db:
            selected_provider = get_trial_inference_provider(db)
        status = reconcile_local_qwen(selected_provider, settings)
    except Exception:
        logger.exception("local_qwen_startup_reconcile_failed")
        return
    logger.info(
        "local_qwen_startup_reconciled selected_provider=%s state=%s",
        selected_provider,
        status.state,
    )


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    synchronize_local_qwen_on_startup()
    from app.api.detection_tasks import (
        schedule_queued_formal_detections,
        stop_formal_detection_jobs,
    )

    try:
        schedule_queued_formal_detections()
    except Exception:
        logger.exception("formal_detection_queue_startup_resume_failed")
    try:
        yield
    finally:
        await stop_formal_detection_jobs()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    docs_url=f"{settings.api_prefix}/docs" if settings.docs_enabled else None,
    redoc_url=f"{settings.api_prefix}/redoc" if settings.docs_enabled else None,
    openapi_url=f"{settings.api_prefix}/openapi.json" if settings.docs_enabled else None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.backend_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)
app.include_router(api_router, prefix=settings.api_prefix)


@app.get("/", include_in_schema=False)
def root() -> dict[str, str]:
    return {
        "service": settings.app_name,
        "health": f"{settings.api_prefix}/health",
    }
