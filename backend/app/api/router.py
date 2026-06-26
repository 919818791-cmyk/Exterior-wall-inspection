from fastapi import APIRouter

from app.api import auth, detection_config, detection_tasks, health, photos, projects, reports, review

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router)
api_router.include_router(projects.router)
api_router.include_router(photos.router)
api_router.include_router(detection_config.router)
api_router.include_router(detection_tasks.router)
api_router.include_router(review.router)
api_router.include_router(reports.router)
