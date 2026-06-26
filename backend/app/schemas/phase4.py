from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.enums.status import DefectType, PhotoStatus, PhotoType, UploadMode


class ApiSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True, use_enum_values=True)


class UploadBatchCreateRequest(ApiSchema):
    building_id: UUID | None = None
    facade_id: UUID | None = None
    drone_type: str | None = Field(default=None, max_length=64)
    upload_mode: UploadMode = UploadMode.VISIBLE
    remark: str | None = None


class UploadBatchRead(ApiSchema):
    id: UUID
    project_id: UUID
    building_id: UUID | None
    facade_id: UUID | None
    batch_no: str
    drone_type: str | None
    upload_mode: UploadMode
    photo_count: int
    uploaded_by: UUID
    uploaded_at: datetime
    remark: str | None


class PhotoRead(ApiSchema):
    id: UUID
    project_id: UUID
    building_id: UUID | None
    facade_id: UUID | None
    upload_batch_id: UUID
    original_filename: str
    file_ext: str | None
    file_size: int | None
    mime_type: str | None
    storage_bucket: str
    storage_object_key: str
    thumbnail_object_key: str | None
    image_width: int | None
    image_height: int | None
    photo_type: PhotoType
    status: PhotoStatus
    preview_url: str | None
    thumbnail_url: str | None
    created_at: datetime
    updated_at: datetime


class DetectionConfigResponse(ApiSchema):
    id: UUID | None = None
    project_id: UUID
    model_types: list[DefectType] = Field(default_factory=list)
    high_precision: bool = False
    config_json: dict | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class DetectionConfigUpdateRequest(ApiSchema):
    model_types: list[DefectType] = Field(min_length=1)
    high_precision: bool = False
    config_json: dict | None = None
