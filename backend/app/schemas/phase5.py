from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.enums.status import DefectType, DetectionTaskStatus


class ApiSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True, use_enum_values=True)


class DetectionTaskRead(ApiSchema):
    id: UUID
    project_id: UUID
    detection_config_id: UUID | None
    task_no: str
    status: DetectionTaskStatus
    photo_count: int
    worker_id: str | None
    locked_at: datetime | None
    worker_heartbeat_at: datetime | None
    lease_expires_at: datetime | None
    started_at: datetime | None
    finished_at: datetime | None
    failed_reason: str | None
    retry_count: int
    model_version: str | None
    result_summary: dict | None
    created_at: datetime
    updated_at: datetime


class AlgorithmTaskPhoto(ApiSchema):
    photo_id: UUID
    original_filename: str
    download_url: str
    storage_bucket: str
    storage_object_key: str
    building_id: UUID | None
    facade_id: UUID | None


class AlgorithmTaskLease(ApiSchema):
    task_id: UUID
    project_id: UUID
    lease_expires_at: datetime
    models: list[DefectType]
    high_precision: bool
    model_version: str
    photos: list[AlgorithmTaskPhoto]


class AlgorithmHeartbeatResponse(ApiSchema):
    task_id: UUID
    status: DetectionTaskStatus
    worker_id: str
    worker_heartbeat_at: datetime
    lease_expires_at: datetime


class DetectionBBox(ApiSchema):
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    width: float = Field(gt=0)
    height: float = Field(gt=0)


class DetectionPayload(ApiSchema):
    id: str | None = Field(default=None, max_length=128)
    type: DefectType
    type_name: str | None = Field(default=None, max_length=64)
    confidence: float | None = Field(default=None, ge=0, le=1)
    bbox: DetectionBBox
    mask: dict | None = None
    severity: str | None = Field(default=None, max_length=32)
    description: str | None = None


class PhotoDetectionResult(ApiSchema):
    photo_id: UUID
    detections: list[DetectionPayload] = Field(default_factory=list)


class AlgorithmResultPayload(ApiSchema):
    task_id: UUID
    project_id: UUID
    results: list[PhotoDetectionResult] = Field(default_factory=list)
    model_version: str = Field(min_length=1, max_length=128)
    started_at: datetime | None = None
    finished_at: datetime | None = None


class AlgorithmFailedPayload(ApiSchema):
    reason: str = Field(min_length=1, max_length=2000)
    detail: dict | None = None
