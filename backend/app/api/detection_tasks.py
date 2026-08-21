from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from io import BytesIO
from time import perf_counter
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.dependencies import (
    AuthenticatedUser,
    ensure_project_write_access,
    get_current_user,
)
from app.api.projects import _get_project_or_404
from app.core.config import get_settings
from app.db.session import get_db
from app.enums.status import (
    AiResultStatus,
    DetectionTaskStatus,
    InspectionReportStatus,
    PhotoPrecheckStatus,
    PhotoStatus,
    PhotoType,
    ProjectStatus,
    ReviewResultStatus,
)
from app.models.tables import (
    AiDetectionResult,
    DetectionConfig,
    DetectionTask,
    DetectionTaskPhoto,
    InspectionReport,
    Photo,
    Project,
    ReviewResult,
    UploadBatch,
)
from app.schemas.phase5 import (
    AlgorithmFailedPayload,
    AlgorithmHeartbeatResponse,
    AlgorithmResultPayload,
    AlgorithmTaskLease,
    AlgorithmTaskPhoto,
    DetectionStartRequest,
    DetectionTaskRead,
)
from app.services.formal_detection_prompts import formal_detection_prompts
from app.services.inference_scheduling import (
    InferenceUsageReservation,
    reserve_inference_usage,
)
from app.services.local_qwen_lifecycle import start_local_qwen
from app.services.object_storage import get_object_bytes, presigned_get_url
from app.services.photo_metadata import extract_photo_metadata
from app.services.report_data import build_report_data
from app.services.trial_inference_provider import (
    active_trial_inference_runtime,
    trial_prompts,
    trial_scheduling_settings,
)
from app.services.trial_qwen_inference import (
    DEFAULT_INFERENCE_MAX_IMAGE_PIXELS,
    DEFAULT_MAX_IMAGE_PIXELS,
    DEFAULT_MAX_TILES_PER_IMAGE,
    DEFAULT_MAX_TILES_PER_REQUEST,
    NMS_IOU_THRESHOLD,
    TILE_HEIGHT,
    TILE_OVERLAP_RATIO,
    TILE_WIDTH,
    TrialQwenImageInput,
    estimate_trial_api_request_count,
    infer_trial_images,
)
from app.services.usage_tracking import add_inference_usage_event

router = APIRouter(tags=["detection-tasks"])
logger = logging.getLogger(__name__)

MIN_VISIBLE_CONFIDENCE = 0.6
DEFECT_TYPE_NAMES = {
    "crack": "裂缝",
    "spalling": "剥落",
    "moisture": "潮湿",
    "hollow": "空鼓",
}
FORMAL_VISIBLE_DEFECT_TYPES = frozenset({"crack", "spalling"})
FORMAL_BACKEND_WORKER_ID = "formal-backend-queue"
_formal_detection_jobs: set[asyncio.Task[None]] = set()


@dataclass(frozen=True)
class WorkerCredentials:
    worker_id: str


def _now_task_no() -> str:
    timestamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S%f")
    return f"DT-{timestamp}-{uuid4().hex[:6].upper()}"


def _now_report_no() -> str:
    timestamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S%f")
    return f"RPT-{timestamp}-{uuid4().hex[:6].upper()}"


def _task_read(task: DetectionTask) -> DetectionTaskRead:
    return DetectionTaskRead.model_validate(task)


def _get_task_or_404(db: Session, task_id: UUID) -> DetectionTask:
    task = db.get(DetectionTask, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Detection task not found.")
    return task


def _require_worker_credentials(
    worker_id_header: str | None = Header(default=None, alias="X-Worker-Id"),
    worker_token_header: str | None = Header(default=None, alias="X-Worker-Token"),
    worker_id_query: str | None = Query(default=None, alias="worker_id"),
    worker_token_query: str | None = Query(default=None, alias="worker_token"),
) -> WorkerCredentials:
    worker_id = worker_id_header or worker_id_query
    worker_token = worker_token_header or worker_token_query
    if not worker_id or not worker_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Worker credentials are required.",
        )
    if worker_token != get_settings().worker_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid worker token.",
        )
    return WorkerCredentials(worker_id=worker_id)


def _require_model_version(
    model_version: str | None = Query(default=None),
    model_version_header: str | None = Header(default=None, alias="X-Model-Version"),
) -> str:
    version = (model_version_header or model_version or "").strip()
    if not version:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="model_version is required when claiming a task.",
        )
    return version


def _ensure_worker_owns_task(task: DetectionTask, worker_id: str) -> None:
    if task.worker_id != worker_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Task is locked by another worker.",
        )


def _task_photos(db: Session, task_id: UUID) -> list[tuple[DetectionTaskPhoto, Photo]]:
    rows = db.execute(
        select(DetectionTaskPhoto, Photo)
        .join(Photo, Photo.id == DetectionTaskPhoto.photo_id)
        .where(DetectionTaskPhoto.detection_task_id == task_id, Photo.deleted_at.is_(None))
        .order_by(Photo.created_at.asc())
    )
    return list(rows.all())


def _set_task_photo_status(
    task_photos: list[tuple[DetectionTaskPhoto, Photo]],
    photo_status: PhotoStatus,
) -> None:
    for task_photo, photo in task_photos:
        task_photo.status = photo_status.value
        photo.status = photo_status.value


def _remove_rejected_project_photos(
    db: Session,
    photos: list[Photo],
    *,
    deleted_at: datetime,
) -> list[Photo]:
    """Remove rejected uploads from the project before creating a task.

    Detection tasks and their reports must only retain building photos.  This
    uses the same soft-delete convention as the project photo list, so the
    rejected photos immediately disappear from every later project query.
    """
    rejected_photos = [
        photo
        for photo in photos
        if getattr(photo, "precheck_status", None)
        == PhotoPrecheckStatus.REJECTED.value
    ]
    removed_by_batch: dict[UUID, int] = {}
    for photo in rejected_photos:
        photo.deleted_at = deleted_at
        photo.updated_at = deleted_at
        removed_by_batch[photo.upload_batch_id] = (
            removed_by_batch.get(photo.upload_batch_id, 0) + 1
        )

    for upload_batch_id, removed_count in removed_by_batch.items():
        batch = db.get(UploadBatch, upload_batch_id)
        if batch is not None:
            batch.photo_count = max(0, batch.photo_count - removed_count)

    return rejected_photos


def _defect_type_value(value: object) -> str:
    return value.value if hasattr(value, "value") else str(value)


def _formal_allowed_defect_types(
    photo: Photo,
    selected_model_types: list[str] | set[str] | frozenset[str],
) -> set[str]:
    selected = set(selected_model_types)
    if photo.photo_type == PhotoType.THERMAL.value:
        return {"hollow"}.intersection(selected)
    return set(FORMAL_VISIBLE_DEFECT_TYPES.intersection(selected))


def _validate_formal_photo_model_compatibility(
    photos: list[Photo],
    selected_model_types: list[str],
) -> None:
    thermal_photo_count = sum(
        1 for photo in photos if photo.photo_type == PhotoType.THERMAL.value
    )
    visible_photo_count = len(photos) - thermal_photo_count
    selected = set(selected_model_types)
    if thermal_photo_count and "hollow" not in selected:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="热成像图片只执行空鼓检测，请勾选空鼓或移除热成像图片。",
        )
    if visible_photo_count and not FORMAL_VISIBLE_DEFECT_TYPES.intersection(selected):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="可见光图片只执行裂缝或剥落检测，请至少勾选其中一项或移除可见光图片。",
        )


def _formal_compatible_inference(
    photo: Photo,
    inference: dict[str, Any],
    selected_model_types: list[str],
) -> dict[str, Any]:
    allowed_defect_types = _formal_allowed_defect_types(
        photo,
        selected_model_types,
    )
    return {
        **inference,
        "requested_models": [
            defect_type
            for defect_type in ("crack", "spalling", "hollow")
            if defect_type in allowed_defect_types
        ],
        "detections": [
            detection
            for detection in inference.get("detections") or []
            if (
                isinstance(detection, dict)
                and str(detection.get("type") or "") in allowed_defect_types
            )
        ],
    }


def _formal_inference_prompts(
    prompts: Any,
    visible_model_labels: list[str],
    inference_snapshot: dict[str, Any],
) -> tuple[str, str]:
    prompt_snapshot = (
        inference_snapshot.get("prompts")
        if isinstance(inference_snapshot.get("prompts"), dict)
        else {}
    )
    snapshot_visible = prompt_snapshot.get("visible")
    snapshot_thermal = prompt_snapshot.get("thermal")
    return (
        snapshot_visible.strip()
        if isinstance(snapshot_visible, str) and snapshot_visible.strip()
        else prompts.visible_prompt_for_models(visible_model_labels),
        snapshot_thermal.strip()
        if isinstance(snapshot_thermal, str) and snapshot_thermal.strip()
        else prompts.thermal_prompt,
    )


def _raw_model_output_detection(detection: Any) -> dict[str, Any]:
    detection_data = detection.model_dump(mode="json")
    defect_type = _defect_type_value(detection.type)
    confidence = detection.confidence
    detection_data["type"] = defect_type
    detection_data["model"] = DEFECT_TYPE_NAMES.get(defect_type, defect_type)
    detection_data["visible"] = confidence is not None and confidence >= MIN_VISIBLE_CONFIDENCE
    return detection_data


def _raw_model_output_for_photo(
    photo_result: Any,
    photo: Photo | None,
    model_version: str,
    allowed_defect_types: set[str],
) -> dict[str, Any]:
    model_output = photo_result.model_output if isinstance(photo_result.model_output, dict) else {}
    image = model_output.get("image") if isinstance(model_output.get("image"), dict) else {}
    return {
        "photo_id": str(photo_result.photo_id),
        "filename": photo.original_filename if photo else None,
        "image_width": image.get("width"),
        "image_height": image.get("height"),
        "model_version": model_output.get("model_version") or model_version,
        "requested_models": [
            DEFECT_TYPE_NAMES.get(defect_type, defect_type)
            for defect_type in ("crack", "spalling", "hollow")
            if defect_type in allowed_defect_types
        ],
        "executed_models": model_output.get("executed_models") or [],
        "inference": model_output.get("inference") if isinstance(model_output.get("inference"), dict) else None,
        "api_request_count": model_output.get("api_request_count"),
        "token_usage": model_output.get("token_usage") if isinstance(model_output.get("token_usage"), dict) else None,
        "tile_token_usages": model_output.get("tile_token_usages") or [],
        "detections": [
            _raw_model_output_detection(detection)
            for detection in photo_result.detections
            if _defect_type_value(detection.type) in allowed_defect_types
        ],
    }


async def _formal_image_input(photo: Photo) -> TrialQwenImageInput:
    content = await asyncio.to_thread(
        get_object_bytes,
        photo.storage_bucket,
        photo.storage_object_key,
    )
    metadata = extract_photo_metadata(BytesIO(content))
    thermal = (
        photo.photo_type == PhotoType.THERMAL.value
        or metadata["thermal_imaging_available"]
    )
    if thermal:
        photo.photo_type = PhotoType.THERMAL.value
    return TrialQwenImageInput(
        filename=photo.original_filename,
        content=content,
        content_type=photo.mime_type,
        photo_id=photo.id,
        thermal_imaging_available=thermal,
    )


def _formal_raw_model_output(
    photo: Photo,
    inference: dict[str, Any],
) -> dict[str, Any]:
    image = inference.get("image") if isinstance(inference.get("image"), dict) else {}
    inference_config = (
        inference.get("inference")
        if isinstance(inference.get("inference"), dict)
        else {}
    )
    detections: list[dict[str, Any]] = []
    for index, detection in enumerate(inference.get("detections") or []):
        if not isinstance(detection, dict):
            continue
        defect_type = str(detection.get("type") or "")
        try:
            confidence = float(detection.get("confidence"))
        except (TypeError, ValueError):
            confidence = None
        detections.append(
            {
                "detection_id": detection.get("id") or f"formal-{index + 1}",
                "type": defect_type,
                "type_name": detection.get("type_name"),
                "model": DEFECT_TYPE_NAMES.get(defect_type, defect_type),
                "confidence": confidence,
                "bbox": detection.get("bbox"),
                "severity": detection.get("severity"),
                "description": detection.get("description"),
                "visible": (
                    confidence is not None
                    and confidence > MIN_VISIBLE_CONFIDENCE
                ),
            }
        )
    return {
        "photo_id": str(photo.id),
        "filename": photo.original_filename,
        "image_width": image.get("width"),
        "image_height": image.get("height"),
        "upstream_provider": inference.get("provider"),
        "upstream_model": inference.get("model_version"),
        "model_version": inference.get("model_version"),
        "requested_models": [
            DEFECT_TYPE_NAMES.get(str(value), str(value))
            for value in inference.get("requested_models") or []
        ],
        "executed_models": inference.get("executed_models") or [],
        "tile_width": inference_config.get("tile_width", TILE_WIDTH),
        "tile_height": inference_config.get("tile_height", TILE_HEIGHT),
        "tile_overlap_ratio": inference_config.get(
            "tile_overlap_ratio",
            TILE_OVERLAP_RATIO,
        ),
        "tile_count": inference_config.get("tile_count"),
        "api_request_count": inference_config.get("tile_count"),
        "token_usage": inference.get("token_usage"),
        "tile_token_usages": inference.get("tile_token_usages") or [],
        "deduplication_method": "cross_tile_union+nms",
        "cross_tile_merge_method": inference_config.get("cross_tile_merge_method"),
        "pre_merge_detection_count": inference_config.get(
            "pre_merge_detection_count"
        ),
        "post_merge_detection_count": inference_config.get(
            "post_merge_detection_count"
        ),
        "nms_iou_threshold": inference_config.get(
            "nms_iou_threshold",
            NMS_IOU_THRESHOLD,
        ),
        "detections": detections,
    }


def _initial_review_result(
    *,
    ai_result: AiDetectionResult,
    reviewer_id: UUID,
    reviewed_at: datetime,
) -> ReviewResult:
    return ReviewResult(
        project_id=ai_result.project_id,
        detection_task_id=ai_result.detection_task_id,
        photo_id=ai_result.photo_id,
        ai_result_id=ai_result.id,
        defect_type=ai_result.defect_type,
        bbox_json=ai_result.bbox_json,
        polygon_json=ai_result.polygon_json,
        severity=ai_result.severity,
        area=ai_result.area,
        length=ai_result.length,
        status=ReviewResultStatus.PENDING.value,
        reviewer_id=reviewer_id,
        review_note=None,
        reviewed_at=reviewed_at,
    )


@router.post(
    "/projects/{project_id}/start-detection",
    response_model=DetectionTaskRead,
    status_code=status.HTTP_201_CREATED,
)
async def start_detection(
    project_id: UUID,
    payload: DetectionStartRequest | None = None,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> DetectionTaskRead:
    project = _get_project_or_404(db, project_id)
    ensure_project_write_access(project, current_user)
    if project.status != ProjectStatus.DRAFT.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only draft projects can start AI detection.",
        )

    all_photos = list(
        db.scalars(
            select(Photo)
            .where(Photo.project_id == project.id, Photo.deleted_at.is_(None))
            .order_by(Photo.created_at.asc())
        )
    )
    if not all_photos:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Upload at least one photo before starting AI detection.",
        )

    incomplete_photos = [
        photo
        for photo in all_photos
        if (getattr(photo, "precheck_status", None) or PhotoPrecheckStatus.PENDING.value)
        in {
            PhotoPrecheckStatus.PENDING.value,
            PhotoPrecheckStatus.RUNNING.value,
            PhotoPrecheckStatus.ERROR.value,
        }
    ]
    if incomplete_photos:
        status_counts = {
            value: sum(
                1
                for photo in incomplete_photos
                if (getattr(photo, "precheck_status", None) or PhotoPrecheckStatus.PENDING.value)
                == value
            )
            for value in (
                PhotoPrecheckStatus.PENDING.value,
                PhotoPrecheckStatus.RUNNING.value,
                PhotoPrecheckStatus.ERROR.value,
            )
        }
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "照片预检尚未全部完成："
                f"待处理 {status_counts['pending']} 张、"
                f"处理中 {status_counts['running']} 张、"
                f"预检失败 {status_counts['error']} 张。"
                "请等待正在处理的照片；预检失败照片请删除后重新上传。"
            ),
        )

    qualified_photos = [
        photo
        for photo in all_photos
        if getattr(photo, "precheck_status", None)
        == PhotoPrecheckStatus.PASSED.value
    ]
    rejected_photos = [
        photo
        for photo in all_photos
        if getattr(photo, "precheck_status", None)
        == PhotoPrecheckStatus.REJECTED.value
    ]
    rejected_photo_count = len(rejected_photos)
    if not qualified_photos:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "项目没有通过预检的照片。"
                f"已排除 {rejected_photo_count} 张不合格照片。"
            ),
        )
    all_photos = qualified_photos

    selected_model_types = [
        _defect_type_value(value)
        for value in (
            payload.model_types
            if payload is not None
            else ["crack", "spalling", "hollow"]
        )
    ]
    if not selected_model_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请至少选择一种检测类型。",
        )
    _validate_formal_photo_model_compatibility(
        qualified_photos,
        selected_model_types,
    )

    runtime = active_trial_inference_runtime(db)
    scheduling = trial_scheduling_settings(db)
    prompts = trial_prompts(db)
    visible_model_labels = [
        DEFECT_TYPE_NAMES[value]
        for value in selected_model_types
        if value in FORMAL_VISIBLE_DEFECT_TYPES
    ]
    specialized_prompts = (
        formal_detection_prompts(
            payload.facade_type,
            selected_model_types,
            db=db,
        )
        if payload is not None and payload.facade_type is not None
        else None
    )
    visible_prompt = (
        specialized_prompts.visible_prompt
        if specialized_prompts is not None
        and specialized_prompts.visible_prompt is not None
        else prompts.visible_prompt_for_models(visible_model_labels)
    )
    thermal_prompt = (
        specialized_prompts.thermal_prompt
        if specialized_prompts is not None
        and specialized_prompts.thermal_prompt is not None
        else prompts.thermal_prompt
    )
    if not runtime.configured:
        detail = (
            f"{runtime.label} 尚未配置服务地址或模型名称。"
            if runtime.provider == "local_qwen"
            else f"{runtime.label} 尚未配置有效的 API Key。"
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=detail,
        )
    if runtime.provider == "local_qwen":
        local_status = start_local_qwen(get_settings())
        if local_status.state != "running":
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=local_status.message,
            )

    now = datetime.now(UTC)
    _remove_rejected_project_photos(db, rejected_photos, deleted_at=now)
    inference_snapshot = {
        "source": "formal_project",
        "facade_type": payload.facade_type if payload is not None else None,
        "model_types": selected_model_types,
        "high_precision": True,
        "provider": runtime.provider,
        "provider_label": runtime.label,
        "upstream_provider": runtime.upstream_provider,
        "model": runtime.model,
        "scheduling": {
            "global_job_concurrency": scheduling.global_job_concurrency,
            "request_concurrency": runtime.max_concurrency,
            "daily_api_request_limit": scheduling.daily_api_request_limit,
            "generate_limit_per_user": scheduling.generate_limit_per_user,
            "request_timeout_seconds": runtime.timeout_seconds,
        },
        "tiling": {
            "tile_width": TILE_WIDTH,
            "tile_height": TILE_HEIGHT,
            "tile_overlap_ratio": TILE_OVERLAP_RATIO,
        },
        "prompts": {
            "visible": visible_prompt,
            "thermal": thermal_prompt,
        },
        "prompt_files": {
            "visible": (
                specialized_prompts.visible_file
                if specialized_prompts is not None
                else None
            ),
            "thermal": (
                specialized_prompts.thermal_file
                if specialized_prompts is not None
                else None
            ),
        },
        "qualified_photo_count": len(qualified_photos),
        "rejected_photo_count": rejected_photo_count,
    }
    detection_config = db.scalar(
        select(DetectionConfig).where(DetectionConfig.project_id == project.id)
    )
    if detection_config is None:
        detection_config = DetectionConfig(
            project_id=project.id,
            model_types=selected_model_types,
            high_precision=True,
            config_json=inference_snapshot,
            created_by=current_user.id,
        )
        db.add(detection_config)
    else:
        detection_config.model_types = selected_model_types
        detection_config.high_precision = True
        detection_config.config_json = inference_snapshot
    db.flush()

    task = db.scalar(
        select(DetectionTask).where(DetectionTask.project_id == project.id)
    )
    if task is not None:
        if task.status != DetectionTaskStatus.FAILED.value:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="项目已经创建过检测任务。",
            )
        db.execute(
            delete(ReviewResult).where(ReviewResult.detection_task_id == task.id)
        )
        db.execute(
            delete(AiDetectionResult).where(
                AiDetectionResult.detection_task_id == task.id
            )
        )
        db.execute(
            delete(DetectionTaskPhoto).where(
                DetectionTaskPhoto.detection_task_id == task.id
            )
        )
        task.retry_count += 1
    else:
        task = DetectionTask(
            project_id=project.id,
            task_no=_now_task_no(),
            priority=0,
            retry_count=0,
            created_by=current_user.id,
        )
        db.add(task)
    task.detection_config_id = detection_config.id
    task.status = DetectionTaskStatus.PENDING.value
    task.photo_count = len(qualified_photos)
    task.result_summary = {"detection_config": inference_snapshot}
    task.started_at = None
    task.finished_at = None
    task.failed_reason = None
    task.model_version = runtime.model
    task.worker_id = FORMAL_BACKEND_WORKER_ID
    task.locked_at = None
    task.worker_heartbeat_at = None
    task.lease_expires_at = None
    db.flush()
    for photo in qualified_photos:
        photo.status = PhotoStatus.UPLOADED.value
        db.add(
            DetectionTaskPhoto(
                detection_task_id=task.id,
                photo_id=photo.id,
                status=PhotoStatus.UPLOADED.value,
            )
        )

    project.status = ProjectStatus.QUEUED.value
    project.current_task_id = task.id
    project.started_at = now
    project.updated_at = now

    db.commit()

    _schedule_formal_project_inference(
        project_id=project.id,
        task_id=task.id,
        actor_id=current_user.id,
        photo_ids=[photo.id for photo in all_photos],
        selected_model_types=selected_model_types,
        runtime=runtime,
        prompts=prompts,
        inference_snapshot=inference_snapshot,
    )
    db.refresh(task)
    return _task_read(task)


async def _run_formal_project_inference(
    *,
    project_id: UUID,
    task_id: UUID,
    actor_id: UUID,
    photo_ids: list[UUID],
    selected_model_types: list[str],
    runtime: Any,
    prompts: Any,
    inference_snapshot: dict[str, Any],
) -> None:
    """Run a formal task immediately after it has been persisted."""
    from app.db.session import SessionLocal

    db = SessionLocal()
    usage_reservation: InferenceUsageReservation | None = None
    project: Project | None = None
    task: DetectionTask | None = None
    try:
        project = db.scalar(
            select(Project)
            .where(Project.id == project_id)
            .with_for_update()
        )
        task = db.scalar(
            select(DetectionTask)
            .where(DetectionTask.id == task_id)
            .with_for_update()
        )
        if (
            project is None
            or project.deleted_at is not None
            or task is None
            or task.status != DetectionTaskStatus.PENDING.value
            or project.status != ProjectStatus.QUEUED.value
        ):
            return

        now = datetime.now(UTC)
        task.status = DetectionTaskStatus.RUNNING.value
        task.started_at = now
        task.model_version = runtime.model
        task.locked_at = now
        task.worker_heartbeat_at = now
        task.updated_at = now
        project.status = ProjectStatus.DETECTING.value
        project.updated_at = now
        task_photo_rows = _task_photos(db, task.id)
        _set_task_photo_status(task_photo_rows, PhotoStatus.DETECTING)
        db.commit()

        all_photos = list(
            db.scalars(
                select(Photo)
                .where(Photo.id.in_(photo_ids), Photo.deleted_at.is_(None))
                .order_by(Photo.created_at.asc())
            )
        )
        visible_model_labels = [
            DEFECT_TYPE_NAMES[value]
            for value in selected_model_types
            if value in FORMAL_VISIBLE_DEFECT_TYPES
        ]
        visible_prompt, thermal_prompt = _formal_inference_prompts(
            prompts,
            visible_model_labels,
            inference_snapshot,
        )
        task_started_at = perf_counter()
        image_pairs = [
            (photo, await _formal_image_input(photo))
            for photo in all_photos
        ]
        inference_pairs = [
            (photo, image)
            for photo, image in image_pairs
            if (
                image.thermal_imaging_available
                and "hollow" in selected_model_types
            )
            or (
                not image.thermal_imaging_available
                and bool(FORMAL_VISIBLE_DEFECT_TYPES.intersection(selected_model_types))
            )
        ]
        settings = get_settings()
        estimated_api_requests = estimate_trial_api_request_count(
            [image for _, image in inference_pairs],
            max_image_pixels=getattr(
                settings,
                "trial_max_image_pixels",
                DEFAULT_MAX_IMAGE_PIXELS,
            ),
            inference_max_image_pixels=getattr(
                settings,
                "trial_inference_max_image_pixels",
                DEFAULT_INFERENCE_MAX_IMAGE_PIXELS,
            ),
            max_tiles_per_image=getattr(
                settings,
                "trial_max_tiles_per_image",
                DEFAULT_MAX_TILES_PER_IMAGE,
            ),
            max_tiles_per_request=getattr(
                settings,
                "trial_max_tiles_per_request",
                DEFAULT_MAX_TILES_PER_REQUEST,
            ),
        )
        # The formal and TRIAL paths intentionally share the scheduler's
        # semaphore and per-account counters configured in 推理设置.
        usage_reservation = reserve_inference_usage(
            actor_id,
            estimated_api_requests,
            db=db,
            generate_limit_detail="检测请求过于频繁，请稍后重试。",
            settings=settings,
        )
        inferences = (
            await infer_trial_images(
                [image for _, image in inference_pairs],
                api_key=runtime.api_key,
                base_url=runtime.base_url,
                model=runtime.model,
                provider=runtime.upstream_provider,
                visible_prompt=visible_prompt,
                thermal_prompt=thermal_prompt,
                visible_defect_types=[
                    value
                    for value in selected_model_types
                    if value in FORMAL_VISIBLE_DEFECT_TYPES
                ],
                timeout_seconds=runtime.timeout_seconds,
                max_concurrency=runtime.max_concurrency,
                max_image_pixels=getattr(
                    settings,
                    "trial_max_image_pixels",
                    DEFAULT_MAX_IMAGE_PIXELS,
                ),
                inference_max_image_pixels=getattr(
                    settings,
                    "trial_inference_max_image_pixels",
                    DEFAULT_INFERENCE_MAX_IMAGE_PIXELS,
                ),
                max_tiles_per_image=getattr(
                    settings,
                    "trial_max_tiles_per_image",
                    DEFAULT_MAX_TILES_PER_IMAGE,
                ),
                max_tiles_per_request=getattr(
                    settings,
                    "trial_max_tiles_per_request",
                    DEFAULT_MAX_TILES_PER_REQUEST,
                ),
            )
            if inference_pairs
            else []
        )
        inference_by_photo_id = {
            photo.id: inference
            for (photo, _), inference in zip(
                inference_pairs,
                inferences,
                strict=True,
            )
        }
        duration_seconds = round(perf_counter() - task_started_at, 3)
        finished_at = datetime.now(UTC)
        actual_api_requests = sum(
            int(
                (
                    inference.get("inference")
                    if isinstance(inference.get("inference"), dict)
                    else {}
                ).get("api_request_count")
                or (
                    inference.get("inference")
                    if isinstance(inference.get("inference"), dict)
                    else {}
                ).get("tile_count")
                or 0
            )
            for inference in inferences
        )

        task_photo_rows = _task_photos(db, task.id)
        raw_model_outputs: list[dict[str, Any]] = []
        result_counts: dict[str, int] = {}
        total_detections = 0
        for _, photo in task_photo_rows:
            inference = inference_by_photo_id.get(photo.id)
            if inference is None:
                continue
            inference = _formal_compatible_inference(
                photo,
                inference,
                selected_model_types,
            )
            image = (
                inference.get("image")
                if isinstance(inference.get("image"), dict)
                else {}
            )
            if image.get("width"):
                photo.image_width = int(image["width"])
            if image.get("height"):
                photo.image_height = int(image["height"])
            raw_output = _formal_raw_model_output(photo, inference)
            raw_output["task_duration_seconds"] = duration_seconds
            raw_model_outputs.append(raw_output)
            for index, detection in enumerate(inference.get("detections") or []):
                if not isinstance(detection, dict):
                    continue
                defect_type = str(detection.get("type") or "")
                if defect_type not in selected_model_types:
                    continue
                try:
                    confidence = float(detection.get("confidence"))
                except (TypeError, ValueError):
                    continue
                bbox = detection.get("bbox")
                if (
                    confidence <= MIN_VISIBLE_CONFIDENCE
                    or not isinstance(bbox, dict)
                ):
                    continue
                ai_result = AiDetectionResult(
                    project_id=project.id,
                    detection_task_id=task.id,
                    photo_id=photo.id,
                    defect_type=defect_type,
                    confidence=Decimal(str(confidence)),
                    bbox_json=bbox,
                    polygon_json=None,
                    mask_object_key=None,
                    severity=detection.get("severity"),
                    model_version=runtime.model,
                    raw_result_json={
                        "photo_id": str(photo.id),
                        "provider": runtime.provider,
                        "model": runtime.model,
                        "detection": {
                            **detection,
                            "id": detection.get("id")
                            or f"formal-{index + 1}",
                        },
                    },
                    status=AiResultStatus.PENDING.value,
                )
                db.add(ai_result)
                db.flush()
                db.add(
                    _initial_review_result(
                        ai_result=ai_result,
                        reviewer_id=actor_id,
                        reviewed_at=finished_at,
                    )
                )
                result_counts[defect_type] = (
                    result_counts.get(defect_type, 0) + 1
                )
                total_detections += 1

        _set_task_photo_status(task_photo_rows, PhotoStatus.DETECTED)
        task.status = DetectionTaskStatus.SUCCESS.value
        task.finished_at = finished_at
        task.failed_reason = None
        task.result_summary = {
            "total_detections": total_detections,
            "photo_count": len(task_photo_rows),
            "by_defect_type": result_counts,
            "model_version": runtime.model,
            "detection_config": inference_snapshot,
            "raw_model_output_count": sum(
                len(item.get("detections") or [])
                for item in raw_model_outputs
            ),
            "raw_model_outputs": raw_model_outputs,
        }
        task.updated_at = finished_at
        db.flush()

        report = InspectionReport(
            project_id=project.id,
            detection_task_id=task.id,
            report_no=_now_report_no(),
            title=f"{project.name}外墙检测报告",
            status=InspectionReportStatus.DRAFT.value,
            report_data_json=build_report_data(db, project, task.id),
            generated_by=actor_id,
            generated_at=finished_at,
        )
        db.add(report)
        add_inference_usage_event(
            db,
            source_type="formal",
            source_id=task.id,
            actor_id=actor_id,
            report_data=task.result_summary,
            occurred_at=finished_at,
        )

        project.status = ProjectStatus.PENDING_REVIEW.value
        project.updated_at = finished_at
        db.commit()
        usage_reservation.release(
            successful=True,
            actual_api_request_count=actual_api_requests,
        )
        usage_reservation = None
    except (Exception, asyncio.CancelledError) as exc:
        logger.exception(
            "formal_project_inference_failed project_id=%s error_type=%s",
            project_id,
            type(exc).__name__,
        )
        if usage_reservation is not None:
            usage_reservation.release(successful=False)
            usage_reservation = None
        db.rollback()
        failed_at = datetime.now(UTC)
        persisted_task = db.get(DetectionTask, task.id) if task is not None else None
        if persisted_task is not None:
            _set_task_photo_status(
                _task_photos(db, persisted_task.id),
                PhotoStatus.FAILED,
            )
            persisted_task.status = DetectionTaskStatus.FAILED.value
            persisted_task.failed_reason = str(exc)[:2000]
            persisted_task.finished_at = failed_at
            persisted_task.result_summary = {
                "detection_config": inference_snapshot,
                "failed_reason": str(exc),
            }
            persisted_task.updated_at = failed_at
        persisted_project = db.get(Project, project.id) if project is not None else None
        if persisted_project is not None:
            persisted_project.status = ProjectStatus.DRAFT.value
            persisted_project.updated_at = failed_at
        db.commit()
        if isinstance(exc, asyncio.CancelledError):
            raise
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="视觉检测服务暂时不可用，请稍后重试。",
        ) from exc

    finally:
        db.close()


def _schedule_formal_project_inference(
    **job: Any,
) -> None:
    task = asyncio.create_task(_run_formal_project_inference(**job))
    _formal_detection_jobs.add(task)
    task.add_done_callback(_formal_detection_jobs.discard)


def schedule_queued_formal_detections() -> None:
    """Resume queued formal jobs after an application restart."""
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        queued_tasks = list(
            db.scalars(
                select(DetectionTask).where(
                    DetectionTask.status == DetectionTaskStatus.PENDING.value,
                    DetectionTask.worker_id == FORMAL_BACKEND_WORKER_ID,
                )
            )
        )
        for task in queued_tasks:
            project = db.get(Project, task.project_id)
            detection_config = (
                db.get(DetectionConfig, task.detection_config_id)
                if task.detection_config_id
                else None
            )
            if project is None or detection_config is None:
                continue
            summary = task.result_summary if isinstance(task.result_summary, dict) else {}
            snapshot = (
                summary.get("detection_config")
                if isinstance(summary.get("detection_config"), dict)
                else {}
            )
            _schedule_formal_project_inference(
                project_id=project.id,
                task_id=task.id,
                actor_id=task.created_by,
                photo_ids=[
                    photo_id
                    for photo_id in db.scalars(
                        select(DetectionTaskPhoto.photo_id).where(
                            DetectionTaskPhoto.detection_task_id == task.id
                        )
                    )
                ],
                selected_model_types=list(detection_config.model_types),
                runtime=active_trial_inference_runtime(db),
                prompts=trial_prompts(db),
                inference_snapshot=snapshot,
            )
    finally:
        db.close()


async def stop_formal_detection_jobs() -> None:
    jobs = list(_formal_detection_jobs)
    for job in jobs:
        job.cancel()
    if jobs:
        await asyncio.gather(*jobs, return_exceptions=True)
    _formal_detection_jobs.clear()


@router.get("/algorithm/tasks/next", response_model=AlgorithmTaskLease | None)
def claim_next_task(
    credentials: WorkerCredentials = Depends(_require_worker_credentials),
    model_version: str = Depends(_require_model_version),
    db: Session = Depends(get_db),
) -> AlgorithmTaskLease | None:
    task = db.scalar(
        select(DetectionTask)
        .where(
            DetectionTask.status == DetectionTaskStatus.PENDING.value,
            DetectionTask.worker_id.is_(None),
        )
        .order_by(DetectionTask.priority.desc(), DetectionTask.created_at.asc())
        .with_for_update(skip_locked=True)
    )
    if task is None:
        return None

    detection_config = db.get(DetectionConfig, task.detection_config_id) if task.detection_config_id else None
    if detection_config is None or not detection_config.model_types:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Task has no valid detection configuration.",
        )

    task_photo_rows = _task_photos(db, task.id)
    if not task_photo_rows:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Task has no available photos.",
        )

    now = datetime.now(UTC)
    lease_expires_at = now + timedelta(seconds=get_settings().worker_lease_seconds)
    task.status = DetectionTaskStatus.RUNNING.value
    task.worker_id = credentials.worker_id
    task.locked_at = now
    task.started_at = task.started_at or now
    task.worker_heartbeat_at = now
    task.lease_expires_at = lease_expires_at
    task.model_version = model_version
    task.updated_at = now

    photos: list[AlgorithmTaskPhoto] = []
    for _, photo in task_photo_rows:
        download_url = presigned_get_url(photo.storage_bucket, photo.storage_object_key)
        if not download_url:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Photo {photo.id} has no downloadable object.",
            )
        photos.append(
            AlgorithmTaskPhoto(
                photo_id=photo.id,
                original_filename=photo.original_filename,
                download_url=download_url,
                storage_bucket=photo.storage_bucket,
                storage_object_key=photo.storage_object_key,
                photo_type=photo.photo_type,
            )
        )

    db.commit()
    return AlgorithmTaskLease(
        task_id=task.id,
        project_id=task.project_id,
        lease_expires_at=lease_expires_at,
        models=detection_config.model_types,
        high_precision=detection_config.high_precision,
        model_version=model_version,
        photos=photos,
    )


@router.post(
    "/algorithm/tasks/{task_id}/heartbeat",
    response_model=AlgorithmHeartbeatResponse,
)
def heartbeat_task(
    task_id: UUID,
    credentials: WorkerCredentials = Depends(_require_worker_credentials),
    db: Session = Depends(get_db),
) -> AlgorithmHeartbeatResponse:
    task = _get_task_or_404(db, task_id)
    _ensure_worker_owns_task(task, credentials.worker_id)
    if task.status != DetectionTaskStatus.RUNNING.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only running tasks can receive heartbeat.",
        )

    now = datetime.now(UTC)
    lease_expires_at = now + timedelta(seconds=get_settings().worker_lease_seconds)
    task.worker_heartbeat_at = now
    task.lease_expires_at = lease_expires_at
    task.updated_at = now
    db.commit()

    return AlgorithmHeartbeatResponse(
        task_id=task.id,
        status=task.status,
        worker_id=credentials.worker_id,
        worker_heartbeat_at=now,
        lease_expires_at=lease_expires_at,
    )


@router.post("/algorithm/tasks/{task_id}/results", response_model=DetectionTaskRead)
def submit_task_results(
    task_id: UUID,
    payload: AlgorithmResultPayload,
    credentials: WorkerCredentials = Depends(_require_worker_credentials),
    db: Session = Depends(get_db),
) -> DetectionTaskRead:
    task = _get_task_or_404(db, task_id)
    _ensure_worker_owns_task(task, credentials.worker_id)
    if payload.task_id != task.id or payload.project_id != task.project_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Result payload does not match the detection task.",
        )
    if task.status == DetectionTaskStatus.SUCCESS.value:
        return _task_read(task)
    if task.status != DetectionTaskStatus.RUNNING.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only running tasks can accept detection results.",
        )

    project = db.get(Project, task.project_id)
    if project is None or project.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    task_photo_rows = _task_photos(db, task.id)
    task_photo_ids = {photo.id for _, photo in task_photo_rows}
    photo_by_id = {photo.id: photo for _, photo in task_photo_rows}
    payload_photo_ids = {result.photo_id for result in payload.results}
    unknown_photo_ids = payload_photo_ids - task_photo_ids
    if unknown_photo_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Result payload contains photos outside the task.",
        )

    db.execute(delete(AiDetectionResult).where(AiDetectionResult.detection_task_id == task.id))

    detection_config = (
        db.get(DetectionConfig, task.detection_config_id)
        if task.detection_config_id
        else None
    )
    selected_model_types = (
        set(detection_config.model_types)
        if detection_config is not None
        else set(DEFECT_TYPE_NAMES)
    )
    raw_model_outputs = [
        _raw_model_output_for_photo(
            photo_result,
            photo_by_id.get(photo_result.photo_id),
            payload.model_version,
            _formal_allowed_defect_types(
                photo_by_id[photo_result.photo_id],
                selected_model_types,
            ),
        )
        for photo_result in payload.results
    ]
    result_counts: dict[str, int] = {}
    total_detections = 0
    for photo_result in payload.results:
        allowed_defect_types = _formal_allowed_defect_types(
            photo_by_id[photo_result.photo_id],
            selected_model_types,
        )
        for detection in photo_result.detections:
            if detection.confidence is None or detection.confidence < MIN_VISIBLE_CONFIDENCE:
                continue
            detection_data = detection.model_dump(mode="json")
            defect_type = _defect_type_value(detection.type)
            if defect_type not in allowed_defect_types:
                continue
            result_counts[defect_type] = result_counts.get(defect_type, 0) + 1
            total_detections += 1
            db.add(
                AiDetectionResult(
                    project_id=task.project_id,
                    detection_task_id=task.id,
                    photo_id=photo_result.photo_id,
                    defect_type=defect_type,
                    confidence=(
                        Decimal(str(detection.confidence))
                        if detection.confidence is not None
                        else None
                    ),
                    bbox_json=detection.bbox.model_dump(mode="json"),
                    polygon_json=None,
                    mask_object_key=None,
                    severity=detection.severity,
                    model_version=payload.model_version,
                    raw_result_json={
                        "task_id": str(payload.task_id),
                        "project_id": str(payload.project_id),
                        "photo_id": str(photo_result.photo_id),
                        "worker_id": credentials.worker_id,
                        "detection": detection_data,
                    },
                    status=AiResultStatus.PENDING.value,
                )
            )

    now = datetime.now(UTC)
    if task.started_at is not None:
        task_duration_seconds = max(0.0, (now - task.started_at).total_seconds())
        for output in raw_model_outputs:
            output["task_duration_seconds"] = round(task_duration_seconds, 3)
    _set_task_photo_status(task_photo_rows, PhotoStatus.DETECTED)
    task.status = DetectionTaskStatus.SUCCESS.value
    task.finished_at = payload.finished_at or now
    task.failed_reason = None
    task.model_version = payload.model_version
    task.result_summary = {
        "total_detections": total_detections,
        "photo_count": len(task_photo_rows),
        "by_defect_type": result_counts,
        "model_version": payload.model_version,
        "raw_model_output_count": sum(len(item.get("detections") or []) for item in raw_model_outputs),
        "raw_model_outputs": raw_model_outputs,
    }
    task.updated_at = now
    project.status = ProjectStatus.PENDING_REVIEW.value
    project.updated_at = now
    add_inference_usage_event(
        db,
        source_type="formal",
        source_id=task.id,
        actor_id=task.created_by,
        report_data=task.result_summary,
        occurred_at=task.finished_at,
    )

    db.commit()
    db.refresh(task)
    return _task_read(task)


@router.post("/algorithm/tasks/{task_id}/failed", response_model=DetectionTaskRead)
def mark_task_failed(
    task_id: UUID,
    payload: AlgorithmFailedPayload,
    credentials: WorkerCredentials = Depends(_require_worker_credentials),
    db: Session = Depends(get_db),
) -> DetectionTaskRead:
    task = _get_task_or_404(db, task_id)
    _ensure_worker_owns_task(task, credentials.worker_id)
    if task.status == DetectionTaskStatus.SUCCESS.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Successful tasks cannot be marked failed.",
        )

    project = db.get(Project, task.project_id)
    if project is None or project.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    now = datetime.now(UTC)
    _set_task_photo_status(_task_photos(db, task.id), PhotoStatus.FAILED)
    task.status = DetectionTaskStatus.FAILED.value
    task.failed_reason = payload.reason
    task.finished_at = now
    task.worker_heartbeat_at = now
    task.lease_expires_at = None
    task.result_summary = {
        "failed_reason": payload.reason,
        "detail": payload.detail,
    }
    task.updated_at = now
    project.status = ProjectStatus.DRAFT.value
    project.updated_at = now

    db.commit()
    db.refresh(task)
    return _task_read(task)
