import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import get_settings
from app.core.exceptions import register_exception_handlers
from app.core.upload_temp import configure_upload_temp_directory

settings = get_settings()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    configure_upload_temp_directory()
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
