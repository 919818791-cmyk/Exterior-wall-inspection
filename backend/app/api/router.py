from fastapi import APIRouter

from app.api import accounts, annotation_management, auth, data_management, detection_config, detection_tasks, health, object_storage, photos, projects, reports, review, system_settings, weather

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router)
api_router.include_router(object_storage.router)
api_router.include_router(accounts.router)
api_router.include_router(annotation_management.router)
api_router.include_router(data_management.router)
api_router.include_router(projects.router)
api_router.include_router(photos.router)
api_router.include_router(detection_config.router)
api_router.include_router(detection_tasks.router)
api_router.include_router(review.router)
api_router.include_router(reports.router)
api_router.include_router(system_settings.router)
api_router.include_router(weather.router)
