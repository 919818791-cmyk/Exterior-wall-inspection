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
    DetectionConfig,
    DetectionTask,
    Photo,
    Project,
    ReviewResult,
)
from app.services.defect_area import approximate_bbox_area_m2
from app.services.defect_numbering import number_defects
from app.services.photo_metadata import facade_orientation_from_yaw


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
    detection_task = db.get(DetectionTask, detection_task_id) if detection_task_id else None
    photo_criteria = [
        Photo.project_id == project.id,
        Photo.deleted_at.is_(None),
    ]
    photos = list(
        db.scalars(
            select(Photo)
            .where(*photo_criteria)
            .order_by(Photo.created_at.asc())
        )
    )
    detection_config = db.scalar(select(DetectionConfig).where(DetectionConfig.project_id == project.id))
    detection_task_summary = (
        detection_task.result_summary
        if detection_task is not None and isinstance(detection_task.result_summary, dict)
        else {}
    )

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
    ai_result_ids = [result.ai_result_id for result in review_results if result.ai_result_id is not None]
    ai_results = list(db.scalars(select(AiDetectionResult).where(AiDetectionResult.id.in_(ai_result_ids)))) if ai_result_ids else []
    ai_by_id = {result.id: result for result in ai_results}

    photo_items = [
        {
            "id": str(photo.id),
            "original_filename": photo.original_filename,
            "storage_bucket": photo.storage_bucket,
            "storage_object_key": photo.storage_object_key,
            "thumbnail_object_key": photo.thumbnail_object_key,
            "image_width": photo.image_width,
            "image_height": photo.image_height,
            "camera_make": photo.camera_make,
            "camera_model": photo.camera_model,
            "camera_product_name": photo.camera_product_name,
            "drone_model": photo.drone_model,
            "camera_image_source": photo.camera_image_source,
            "photo_type": photo.photo_type,
            "relative_altitude": photo.relative_altitude,
            "gimbal_yaw_degree": photo.gimbal_yaw_degree,
            "calibrated_focal_length": photo.calibrated_focal_length,
            "focal_length_mm": photo.focal_length_mm,
            "focal_length_35mm": photo.focal_length_35mm,
            "lrf_target_distance": photo.lrf_target_distance,
            "facade_orientation": facade_orientation_from_yaw(
                float(photo.gimbal_yaw_degree) if photo.gimbal_yaw_degree is not None else None
            ),
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
        ai_result = ai_by_id.get(result.ai_result_id) if result.ai_result_id is not None else None
        estimated_area = (
            approximate_bbox_area_m2(photo, result.bbox_json)
            if photo is not None
            else None
        )
        defect_items.append(
            {
                "id": str(result.id),
                "photo_id": str(result.photo_id),
                "photo_filename": photo.original_filename if photo else None,
                "ai_result_id": _optional_id(result.ai_result_id),
                "defect_type": result.defect_type,
                "bbox_json": result.bbox_json,
                "polygon_json": result.polygon_json,
                "severity": result.severity,
                "area": result.area if result.area is not None else estimated_area,
                "area_estimated": result.area is None and estimated_area is not None,
                "length": result.length,
                "status": result.status,
                "confidence": ai_result.confidence if ai_result else None,
                "model_version": ai_result.model_version if ai_result else None,
                "review_note": result.review_note,
                "reviewed_at": result.reviewed_at,
            }
        )

    defect_items = number_defects(defect_items)

    data = {
        "project": {
            "id": str(project.id),
            "project_no": project.project_no,
            "name": project.name,
            "client_name": project.client_name,
            "province": project.province,
            "city": project.city,
            "district": project.district,
            "address": project.address,
            "created_at": project.created_at,
            "started_at": project.started_at,
            "completed_at": project.completed_at,
        },
        "photos": photo_items,
        "detection_config": {
            "model_types": (
                (
                    detection_task_summary.get("detection_config") or {}
                ).get("model_types")
                or (detection_config.model_types if detection_config else [])
            ),
            "high_precision": detection_config.high_precision if detection_config else False,
            "config_json": (
                detection_task_summary.get("detection_config")
                or (detection_config.config_json if detection_config else None)
            ),
        },
        "detection_task": {
            "id": _optional_id(detection_task.id if detection_task else None),
            "task_no": detection_task.task_no if detection_task else None,
            "model_version": detection_task.model_version if detection_task else None,
            "finished_at": detection_task.finished_at if detection_task else None,
        },
        "raw_model_outputs": detection_task_summary.get("raw_model_outputs") or [],
        "summary": {
            "total_review_results": len(review_results),
            "by_defect_type": by_defect_type,
            "by_status": by_status,
            "photo_count": len(photos),
        },
        "defects": defect_items,
        "review_conclusion": "本报告以人工审核确认后的缺陷结果为准。",
    }
    return _json_safe(data)
