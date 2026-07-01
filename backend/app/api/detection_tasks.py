from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.dependencies import AuthenticatedUser, ensure_project_access, require_roles
from app.api.projects import _get_project_or_404
from app.core.config import get_settings
from app.db.session import get_db
from app.enums.status import (
    AiResultStatus,
    DetectionTaskStatus,
    PhotoStatus,
    ProjectStatus,
    UserRole,
)
from app.models.tables import (
    AiDetectionResult,
    DetectionConfig,
    DetectionTask,
    DetectionTaskPhoto,
    Photo,
    Project,
)
from app.schemas.phase5 import (
    AlgorithmFailedPayload,
    AlgorithmHeartbeatResponse,
    AlgorithmResultPayload,
    AlgorithmTaskLease,
    AlgorithmTaskPhoto,
    DetectionTaskRead,
)
from app.services.object_storage import presigned_get_url

router = APIRouter(tags=["detection-tasks"])


@dataclass(frozen=True)
class WorkerCredentials:
    worker_id: str


def _now_task_no() -> str:
    timestamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S%f")
    return f"DT-{timestamp}-{uuid4().hex[:6].upper()}"


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


@router.post(
    "/projects/{project_id}/start-detection",
    response_model=DetectionTaskRead,
    status_code=status.HTTP_201_CREATED,
)
def start_detection(
    project_id: UUID,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_roles(UserRole.ADMIN)),
) -> DetectionTaskRead:
    project = _get_project_or_404(db, project_id)
    ensure_project_access(project, current_user)
    if project.status != ProjectStatus.DRAFT.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only draft projects can start AI detection.",
        )

    photos = list(
        db.scalars(
            select(Photo)
            .where(Photo.project_id == project.id, Photo.deleted_at.is_(None))
            .order_by(Photo.created_at.asc())
        )
    )
    if not photos:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Upload at least one photo before starting AI detection.",
        )

    detection_config = db.scalar(select(DetectionConfig).where(DetectionConfig.project_id == project.id))
    if detection_config is None or not detection_config.model_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Select at least one detection model before starting AI detection.",
        )

    now = datetime.now(UTC)
    task = DetectionTask(
        project_id=project.id,
        detection_config_id=detection_config.id,
        task_no=_now_task_no(),
        status=DetectionTaskStatus.PENDING.value,
        priority=0,
        photo_count=len(photos),
        created_by=project.created_by,
    )
    db.add(task)
    db.flush()

    for photo in photos:
        photo.status = PhotoStatus.DETECTING.value
        db.add(
            DetectionTaskPhoto(
                detection_task_id=task.id,
                photo_id=photo.id,
                status=PhotoStatus.DETECTING.value,
            )
        )

    project.status = ProjectStatus.DETECTING.value
    project.current_task_id = task.id
    project.started_at = now
    project.updated_at = now

    db.commit()
    db.refresh(task)
    return _task_read(task)


@router.get("/algorithm/tasks/next", response_model=AlgorithmTaskLease | None)
def claim_next_task(
    credentials: WorkerCredentials = Depends(_require_worker_credentials),
    model_version: str = Depends(_require_model_version),
    db: Session = Depends(get_db),
) -> AlgorithmTaskLease | None:
    task = db.scalar(
        select(DetectionTask)
        .where(DetectionTask.status == DetectionTaskStatus.PENDING.value)
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
                building_id=photo.building_id,
                facade_id=photo.facade_id,
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
    payload_photo_ids = {result.photo_id for result in payload.results}
    unknown_photo_ids = payload_photo_ids - task_photo_ids
    if unknown_photo_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Result payload contains photos outside the task.",
        )

    db.execute(delete(AiDetectionResult).where(AiDetectionResult.detection_task_id == task.id))

    result_counts: dict[str, int] = {}
    total_detections = 0
    for photo_result in payload.results:
        for detection in photo_result.detections:
            detection_data = detection.model_dump(mode="json")
            defect_type = detection.type.value if hasattr(detection.type, "value") else detection.type
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
    }
    task.updated_at = now
    project.status = ProjectStatus.PENDING_REVIEW.value
    project.updated_at = now

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
