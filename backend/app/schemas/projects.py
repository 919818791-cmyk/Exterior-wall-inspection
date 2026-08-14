from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.enums.status import DetectionTaskStatus, ProjectStatus


class ApiSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True, use_enum_values=True)


class ProjectCreateRequest(ApiSchema):
    name: str | None = Field(default=None, max_length=128)
    client_name: str | None = Field(default=None, max_length=128)
    province: str | None = Field(default=None, max_length=64)
    city: str | None = Field(default=None, max_length=64)
    district: str | None = Field(default=None, max_length=64)
    address: str | None = Field(default=None, max_length=255)
    longitude: Decimal | None = Field(default=None, ge=-180, le=180)
    latitude: Decimal | None = Field(default=None, ge=-90, le=90)


class ProjectDraftCreateRequest(ProjectCreateRequest):
    client_draft_key: str = Field(min_length=1, max_length=64)


class ProjectUpdateRequest(ApiSchema):
    name: str | None = Field(default=None, max_length=128)
    client_name: str | None = Field(default=None, max_length=128)
    province: str | None = Field(default=None, max_length=64)
    city: str | None = Field(default=None, max_length=64)
    district: str | None = Field(default=None, max_length=64)
    address: str | None = Field(default=None, max_length=255)
    longitude: Decimal | None = Field(default=None, ge=-180, le=180)
    latitude: Decimal | None = Field(default=None, ge=-90, le=90)


class ProjectListItem(ApiSchema):
    id: UUID
    created_by: UUID
    project_no: str
    name: str
    client_name: str | None
    province: str | None
    city: str | None
    district: str | None
    address: str | None
    longitude: Decimal | None
    latitude: Decimal | None
    status: ProjectStatus
    current_report_id: UUID | None
    photo_count: int
    valid_photo_count: int
    total_defects: int = 0
    by_defect_type: dict[str, int] = Field(default_factory=dict)
    model_types: list[str] = Field(default_factory=list)
    first_photo_url: str | None = None
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ProjectDetailRead(ProjectListItem):
    current_task_id: UUID | None
    current_report_id: UUID | None
    current_task_status: DetectionTaskStatus | None = None
    completed_at: datetime | None


class DeleteResponse(ApiSchema):
    ok: bool = True
