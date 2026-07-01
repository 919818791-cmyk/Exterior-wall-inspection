from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.enums.status import DetectionTaskStatus, ProjectStatus


class ApiSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True, use_enum_values=True)


class FacadeCreateRequest(ApiSchema):
    name: str = Field(min_length=1, max_length=128)
    area: Decimal | None = Field(default=None, ge=0)
    floors_range: str | None = Field(default=None, max_length=64)
    description: str | None = None
    sort_order: int | None = Field(default=None, ge=0)


class FacadeUpdateRequest(ApiSchema):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    area: Decimal | None = Field(default=None, ge=0)
    floors_range: str | None = Field(default=None, max_length=64)
    description: str | None = None
    sort_order: int | None = Field(default=None, ge=0)


class BuildingCreateRequest(ApiSchema):
    name: str = Field(min_length=1, max_length=128)
    building_no: str | None = Field(default=None, max_length=64)
    floors: int | None = Field(default=None, ge=0)
    height: Decimal | None = Field(default=None, ge=0)
    structure_type: str | None = Field(default=None, max_length=64)
    usage_type: str | None = Field(default=None, max_length=64)
    built_year: int | None = Field(default=None, ge=1800, le=2200)
    remark: str | None = None
    sort_order: int | None = Field(default=None, ge=0)
    facades: list[FacadeCreateRequest] = Field(default_factory=list)


class BuildingUpdateRequest(ApiSchema):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    building_no: str | None = Field(default=None, max_length=64)
    floors: int | None = Field(default=None, ge=0)
    height: Decimal | None = Field(default=None, ge=0)
    structure_type: str | None = Field(default=None, max_length=64)
    usage_type: str | None = Field(default=None, max_length=64)
    built_year: int | None = Field(default=None, ge=1800, le=2200)
    remark: str | None = None
    sort_order: int | None = Field(default=None, ge=0)


class ProjectCreateRequest(ApiSchema):
    name: str = Field(min_length=1, max_length=128)
    client_name: str | None = Field(default=None, max_length=128)
    contact_name: str | None = Field(default=None, max_length=64)
    contact_phone: str | None = Field(default=None, max_length=32)
    province: str | None = Field(default=None, max_length=64)
    city: str | None = Field(default=None, max_length=64)
    district: str | None = Field(default=None, max_length=64)
    address: str | None = Field(default=None, max_length=255)
    longitude: Decimal | None = Field(default=None, ge=-180, le=180)
    latitude: Decimal | None = Field(default=None, ge=-90, le=90)
    buildings: list[BuildingCreateRequest] = Field(default_factory=list)


class ProjectUpdateRequest(ApiSchema):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    client_name: str | None = Field(default=None, max_length=128)
    contact_name: str | None = Field(default=None, max_length=64)
    contact_phone: str | None = Field(default=None, max_length=32)
    province: str | None = Field(default=None, max_length=64)
    city: str | None = Field(default=None, max_length=64)
    district: str | None = Field(default=None, max_length=64)
    address: str | None = Field(default=None, max_length=255)
    longitude: Decimal | None = Field(default=None, ge=-180, le=180)
    latitude: Decimal | None = Field(default=None, ge=-90, le=90)


class FacadeRead(ApiSchema):
    id: UUID
    project_id: UUID
    building_id: UUID
    name: str
    area: Decimal | None
    floors_range: str | None
    description: str | None
    sort_order: int
    created_at: datetime
    updated_at: datetime


class BuildingRead(ApiSchema):
    id: UUID
    project_id: UUID
    name: str
    building_no: str | None
    floors: int | None
    height: Decimal | None
    structure_type: str | None
    usage_type: str | None
    built_year: int | None
    remark: str | None
    sort_order: int
    facade_count: int
    facades: list[FacadeRead]
    created_at: datetime
    updated_at: datetime


class ProjectListItem(ApiSchema):
    id: UUID
    project_no: str
    name: str
    client_name: str | None
    contact_name: str | None
    contact_phone: str | None
    province: str | None
    city: str | None
    district: str | None
    address: str | None
    longitude: Decimal | None
    latitude: Decimal | None
    status: ProjectStatus
    building_count: int
    photo_count: int
    created_at: datetime
    updated_at: datetime


class ProjectDetailRead(ProjectListItem):
    current_task_id: UUID | None
    current_report_id: UUID | None
    current_task_status: DetectionTaskStatus | None = None
    started_at: datetime | None
    completed_at: datetime | None
    buildings: list[BuildingRead]


class DeleteResponse(ApiSchema):
    ok: bool = True
