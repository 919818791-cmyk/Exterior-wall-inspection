from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.enums.status import ReviewResultStatus
from app.models.tables import (
    AiDetectionResult,
    Building,
    DetectionConfig,
    DetectionTask,
    Facade,
    Photo,
    Project,
    ReviewResult,
)


def _json_safe(value: Any) -> Any:
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_json_safe(item) for item in value]
    return value


def _optional_id(value: UUID | None) -> str | None:
    return str(value) if value is not None else None


def build_report_data(
    db: Session,
    project: Project,
    detection_task_id: UUID | None,
    review_results: list[ReviewResult] | None = None,
) -> dict[str, Any]:
    buildings = list(
        db.scalars(
            select(Building)
            .where(Building.project_id == project.id, Building.deleted_at.is_(None))
            .order_by(Building.sort_order.asc(), Building.created_at.asc())
        )
    )
    facades = list(
        db.scalars(
            select(Facade)
            .where(Facade.project_id == project.id, Facade.deleted_at.is_(None))
            .order_by(Facade.sort_order.asc(), Facade.created_at.asc())
        )
    )
    photos = list(
        db.scalars(
            select(Photo)
            .where(Photo.project_id == project.id, Photo.deleted_at.is_(None))
            .order_by(Photo.created_at.asc())
        )
    )
    detection_config = db.scalar(select(DetectionConfig).where(DetectionConfig.project_id == project.id))
    detection_task = db.get(DetectionTask, detection_task_id) if detection_task_id else None

    if review_results is None:
        criteria = [
            ReviewResult.project_id == project.id,
            ReviewResult.status != ReviewResultStatus.DELETED.value,
        ]
        if detection_task_id is not None:
            criteria.append(ReviewResult.detection_task_id == detection_task_id)
        review_results = list(
            db.scalars(
                select(ReviewResult)
                .where(*criteria)
                .order_by(ReviewResult.created_at.asc())
            )
        )

    photo_by_id = {photo.id: photo for photo in photos}
    building_by_id = {building.id: building for building in buildings}
    facade_by_id = {facade.id: facade for facade in facades}
    ai_result_ids = [result.ai_result_id for result in review_results if result.ai_result_id is not None]
    ai_results = list(db.scalars(select(AiDetectionResult).where(AiDetectionResult.id.in_(ai_result_ids)))) if ai_result_ids else []
    ai_by_id = {result.id: result for result in ai_results}

    facades_by_building: dict[UUID, list[Facade]] = {}
    for facade in facades:
        facades_by_building.setdefault(facade.building_id, []).append(facade)

    building_items = []
    for building in buildings:
        building_items.append(
            {
                "id": str(building.id),
                "name": building.name,
                "building_no": building.building_no,
                "floors": building.floors,
                "height": building.height,
                "structure_type": building.structure_type,
                "usage_type": building.usage_type,
                "built_year": building.built_year,
                "facades": [
                    {
                        "id": str(facade.id),
                        "name": facade.name,
                        "area": facade.area,
                        "floors_range": facade.floors_range,
                        "description": facade.description,
                    }
                    for facade in facades_by_building.get(building.id, [])
                ],
            }
        )

    photo_items = [
        {
            "id": str(photo.id),
            "building_id": _optional_id(photo.building_id),
            "facade_id": _optional_id(photo.facade_id),
            "original_filename": photo.original_filename,
            "storage_bucket": photo.storage_bucket,
            "storage_object_key": photo.storage_object_key,
            "thumbnail_object_key": photo.thumbnail_object_key,
            "image_width": photo.image_width,
            "image_height": photo.image_height,
            "photo_type": photo.photo_type,
            "created_at": photo.created_at,
        }
        for photo in photos
    ]

    by_defect_type: dict[str, int] = {}
    by_status: dict[str, int] = {}
    defect_items = []
    for result in review_results:
        by_defect_type[result.defect_type] = by_defect_type.get(result.defect_type, 0) + 1
        by_status[result.status] = by_status.get(result.status, 0) + 1

        photo = photo_by_id.get(result.photo_id)
        building = building_by_id.get(photo.building_id) if photo and photo.building_id else None
        facade = facade_by_id.get(photo.facade_id) if photo and photo.facade_id else None
        ai_result = ai_by_id.get(result.ai_result_id) if result.ai_result_id is not None else None
        defect_items.append(
            {
                "id": str(result.id),
                "photo_id": str(result.photo_id),
                "photo_filename": photo.original_filename if photo else None,
                "building_id": _optional_id(building.id if building else None),
                "building_name": building.name if building else None,
                "facade_id": _optional_id(facade.id if facade else None),
                "facade_name": facade.name if facade else None,
                "ai_result_id": _optional_id(result.ai_result_id),
                "defect_type": result.defect_type,
                "bbox_json": result.bbox_json,
                "polygon_json": result.polygon_json,
                "severity": result.severity,
                "area": result.area,
                "length": result.length,
                "status": result.status,
                "confidence": ai_result.confidence if ai_result else None,
                "model_version": ai_result.model_version if ai_result else None,
                "review_note": result.review_note,
                "reviewed_at": result.reviewed_at,
            }
        )

    data = {
        "project": {
            "id": str(project.id),
            "project_no": project.project_no,
            "name": project.name,
            "client_name": project.client_name,
            "contact_name": project.contact_name,
            "contact_phone": project.contact_phone,
            "province": project.province,
            "city": project.city,
            "district": project.district,
            "address": project.address,
            "created_at": project.created_at,
            "started_at": project.started_at,
            "completed_at": project.completed_at,
        },
        "buildings": building_items,
        "photos": photo_items,
        "detection_config": {
            "model_types": detection_config.model_types if detection_config else [],
            "high_precision": detection_config.high_precision if detection_config else False,
            "config_json": detection_config.config_json if detection_config else None,
        },
        "detection_task": {
            "id": _optional_id(detection_task.id if detection_task else None),
            "task_no": detection_task.task_no if detection_task else None,
            "model_version": detection_task.model_version if detection_task else None,
            "finished_at": detection_task.finished_at if detection_task else None,
        },
        "summary": {
            "total_review_results": len(review_results),
            "by_defect_type": by_defect_type,
            "by_status": by_status,
            "photo_count": len(photos),
            "building_count": len(buildings),
            "facade_count": len(facades),
        },
        "defects": defect_items,
        "review_conclusion": "本报告以人工审核确认后的缺陷结果为准。",
    }
    return _json_safe(data)
