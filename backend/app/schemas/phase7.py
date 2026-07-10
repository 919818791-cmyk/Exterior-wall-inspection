from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.enums.status import InspectionReportStatus


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
    buildings: list[dict]
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


class TrialUploadedPhotoRead(ApiSchema):
    id: UUID
    original_filename: str
    file_size: int | None
    mime_type: str | None
    metadata_json: dict
    thermal_imaging_available: bool
    created_at: datetime


class TrialReportRequest(ApiSchema):
    report_name: str | None = Field(default=None, max_length=255)
    generated_at: str
    models: list[str]
    files: list[TrialReportFile]
    findings: list[TrialReportFinding]
    raw_model_outputs: list[dict] = Field(default_factory=list)


class TrialGeneratedResult(TrialReportRequest):
    pass
