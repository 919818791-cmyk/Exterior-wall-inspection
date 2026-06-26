from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.enums.status import InspectionReportStatus


class ApiSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True, use_enum_values=True)


class ReportListItem(ApiSchema):
    id: UUID
    project_id: UUID
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
    project_id: UUID
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
    docx_bucket: str | None
    docx_object_key: str | None
    generated_by: UUID
    generated_at: datetime
    pushed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class TrialReportFile(ApiSchema):
    filename: str
    size: int | None = None


class TrialReportFinding(ApiSchema):
    filename: str
    model: str
    confidence: str | None = None


class TrialReportRequest(ApiSchema):
    generated_at: str
    models: list[str]
    files: list[TrialReportFile]
    findings: list[TrialReportFinding]
