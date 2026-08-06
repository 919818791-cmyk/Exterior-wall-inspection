from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.enums.status import InspectionReportStatus, PhotoPrecheckStatus


class ApiSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True, use_enum_values=True)


class ReportListItem(ApiSchema):
    id: UUID
    source_type: Literal["formal", "trial"] = "formal"
    project_id: UUID | None = None
    detection_task_id: UUID | None
    report_no: str
    title: str
    status: InspectionReportStatus
    project_name: str
    client_name: str | None
    address: str | None
    total_defects: int
    by_defect_type: dict[str, int] = Field(default_factory=dict)
    photo_count: int = 0
    first_photo_url: str | None = None
    generated_at: datetime
    pushed_at: datetime | None
    updated_at: datetime


class ReportDetailRead(ApiSchema):
    id: UUID
    source_type: Literal["formal", "trial"] = "formal"
    project_id: UUID | None = None
    detection_task_id: UUID | None
    report_no: str
    title: str
    status: InspectionReportStatus
    report_data_json: dict | None
    project: dict
    detection_config: dict | None
    detection_task: dict | None
    summary: dict
    defects: list[dict]
    photos: list[dict]
    raw_model_outputs: list[dict] = Field(default_factory=list)
    docx_bucket: str | None
    docx_object_key: str | None
    generated_by: UUID
    generated_at: datetime
    pushed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ReportTitleUpdate(ApiSchema):
    title: str = Field(min_length=1, max_length=255)


class TrialReportFile(ApiSchema):
    photo_id: UUID | None = None
    filename: str
    size: int | None = None


class TrialReportFinding(ApiSchema):
    photo_id: UUID | None = None
    filename: str
    model: str
    confidence: float | None = Field(default=None, ge=0, le=1)
    bbox: dict | None = None
    image_width: int | None = None
    image_height: int | None = None
    detection_id: str | None = None
    description: str | None = Field(default=None, max_length=20)


class TrialGenerateRequest(ApiSchema):
    report_name: str | None = Field(default=None, max_length=255)
    models: list[str] = Field(default_factory=lambda: ["裂缝", "剥落"])
    photo_ids: list[UUID] = Field(default_factory=list)
    archived_report_id: UUID | None = None

    @field_validator("models")
    @classmethod
    def validate_models(cls, models: list[str]) -> list[str]:
        allowed_models = {"裂缝", "剥落", "空鼓"}
        unique_models = list(dict.fromkeys(models))
        if any(model not in allowed_models for model in unique_models):
            raise ValueError("models contains an unsupported defect type")
        if not unique_models:
            raise ValueError("models must select at least one supported defect type")
        return unique_models


class TrialUploadedPhotoRead(ApiSchema):
    id: UUID
    original_filename: str
    file_size: int | None
    mime_type: str | None
    metadata_json: dict
    thermal_imaging_available: bool
    precheck_status: PhotoPrecheckStatus
    precheck_category: str | None
    precheck_reason: str | None
    precheck_model: str | None
    precheck_error: str | None
    precheck_attempts: int
    prechecked_at: datetime | None
    created_at: datetime


class TrialReportRequest(ApiSchema):
    report_name: str | None = Field(default=None, max_length=255)
    generated_at: str
    models: list[str]
    files: list[TrialReportFile]
    findings: list[TrialReportFinding]
    raw_model_outputs: list[dict] = Field(default_factory=list)


class TrialGeneratedResult(TrialReportRequest):
    archived_report_id: UUID | None = None
    archived_report_title: str | None = None
