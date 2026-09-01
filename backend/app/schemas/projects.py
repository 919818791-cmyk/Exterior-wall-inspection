from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.enums.status import DetectionTaskStatus, DroneType, FacadeType, ProjectStatus


class ApiSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True, use_enum_values=True)


class ProjectCreateRequest(ApiSchema):
    name: str = Field(min_length=1, max_length=128)
    drone_type: DroneType | None = None
    facade_type: FacadeType = FacadeType.TILE
    description: str | None = Field(default=None, max_length=500)
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
    drone_type: DroneType | None = None
    facade_type: FacadeType = FacadeType.TILE
    description: str | None = Field(default=None, max_length=500)
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
    drone_type: DroneType | None
    facade_type: FacadeType
    description: str | None
    client_name: str | None
    province: str | None
    city: str | None
    district: str | None
    address: str | None
    longitude: Decimal | None
    latitude: Decimal | None
    status: ProjectStatus
    is_example: bool = False
    has_building_model: bool = False
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
    setup_completed_at: datetime | None
    setup_step: int = Field(ge=2, le=3)


class ProjectDetailRead(ProjectListItem):
    current_task_id: UUID | None
    current_report_id: UUID | None
    current_task_status: DetectionTaskStatus | None = None
    completed_at: datetime | None


class ProjectFinalizeRequest(ApiSchema):
    name: str = Field(min_length=1, max_length=128)
    drone_type: DroneType | None = None
    facade_type: FacadeType
    description: str | None = Field(default=None, max_length=500)


class BuildingModelRead(ApiSchema):
    id: UUID
    project_id: UUID
    original_filename: str
    file_size: int
    mime_type: str | None
    url: str
    uploaded_by: UUID | None
    uploaded_at: datetime


class DeleteResponse(ApiSchema):
    ok: bool = True
