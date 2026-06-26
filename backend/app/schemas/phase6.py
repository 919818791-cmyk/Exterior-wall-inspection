from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.enums.status import (
    AiResultStatus,
    DefectType,
    DetectionTaskStatus,
    InspectionReportStatus,
    PhotoStatus,
    PhotoType,
    ProjectStatus,
    ReviewResultStatus,
)


class ApiSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True, use_enum_values=True)


class ReviewBBox(ApiSchema):
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    width: float = Field(gt=0)
    height: float = Field(gt=0)


class ReviewProjectListItem(ApiSchema):
    id: UUID
    project_no: str
    name: str
    client_name: str | None
    address: str | None
    status: ProjectStatus
    current_task_id: UUID | None
    current_report_id: UUID | None
    current_task_status: DetectionTaskStatus | None = None
    photo_count: int
    ai_result_count: int
    review_result_count: int
    updated_at: datetime


class ReviewProjectDetail(ReviewProjectListItem):
    contact_name: str | None
    contact_phone: str | None
    province: str | None
    city: str | None
    district: str | None
    started_at: datetime | None
    completed_at: datetime | None


class ReviewPhotoRead(ApiSchema):
    id: UUID
    project_id: UUID
    building_id: UUID | None
    facade_id: UUID | None
    original_filename: str
    image_width: int | None
    image_height: int | None
    photo_type: PhotoType
    status: PhotoStatus
    preview_url: str | None
    thumbnail_url: str | None
    created_at: datetime
    updated_at: datetime


class AiDetectionResultRead(ApiSchema):
    id: UUID
    project_id: UUID
    detection_task_id: UUID
    photo_id: UUID
    defect_type: DefectType
    confidence: Decimal | None
    bbox_json: dict
    polygon_json: dict | None
    severity: str | None
    area: Decimal | None
    length: Decimal | None
    model_version: str | None
    raw_result_json: dict | None
    status: AiResultStatus
    created_at: datetime


class ReviewResultRead(ApiSchema):
    id: UUID
    project_id: UUID
    detection_task_id: UUID
    photo_id: UUID
    ai_result_id: UUID | None
    defect_type: DefectType
    bbox_json: dict
    polygon_json: dict | None
    severity: str | None
    area: Decimal | None
    length: Decimal | None
    status: ReviewResultStatus
    reviewer_id: UUID
    review_note: str | None
    reviewed_at: datetime
    created_at: datetime
    updated_at: datetime


class ReviewProjectResults(ApiSchema):
    project: ReviewProjectDetail
    photos: list[ReviewPhotoRead]
    ai_results: list[AiDetectionResultRead]
    review_results: list[ReviewResultRead]


class ReviewResultCreateRequest(ApiSchema):
    project_id: UUID | None = None
    photo_id: UUID | None = None
    ai_result_id: UUID | None = None
    defect_type: DefectType
    bbox: ReviewBBox
    polygon_json: dict | None = None
    severity: str | None = Field(default=None, max_length=32)
    area: Decimal | None = Field(default=None, ge=0)
    length: Decimal | None = Field(default=None, ge=0)
    status: ReviewResultStatus
    review_note: str | None = Field(default=None, max_length=2000)


class ReviewResultUpdateRequest(ApiSchema):
    defect_type: DefectType | None = None
    bbox: ReviewBBox | None = None
    polygon_json: dict | None = None
    severity: str | None = Field(default=None, max_length=32)
    area: Decimal | None = Field(default=None, ge=0)
    length: Decimal | None = Field(default=None, ge=0)
    status: ReviewResultStatus | None = None
    review_note: str | None = Field(default=None, max_length=2000)


class InspectionReportRead(ApiSchema):
    id: UUID
    project_id: UUID
    detection_task_id: UUID | None
    report_no: str
    title: str
    status: InspectionReportStatus
    report_data_json: dict | None
    docx_bucket: str | None = None
    docx_object_key: str | None = None
    generated_by: UUID
    generated_at: datetime
    created_at: datetime
    updated_at: datetime
