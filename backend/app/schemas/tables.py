from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.enums.status import (
    AiResultStatus,
    DefectType,
    DetectionTaskStatus,
    InspectionReportStatus,
    PhotoStatus,
    PhotoType,
    ProjectStatus,
    RecommendationOrientation,
    ReportPushMethod,
    ReportPushStatus,
    ReviewOperationType,
    ReviewResultStatus,
    UploadMode,
    UserRole,
    UserStatus,
)


class OrmSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True, use_enum_values=True)


class UserAccountCreate(OrmSchema):
    username: str
    password_hash: str
    real_name: str | None = None
    phone: str | None = None
    role: UserRole = UserRole.CUSTOMER
    organization: str | None = None
    status: UserStatus = UserStatus.ACTIVE


class UserAccountRead(OrmSchema):
    id: UUID
    username: str
    real_name: str | None
    phone: str | None
    role: UserRole
    organization: str | None
    status: UserStatus
    last_login_at: datetime | None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None


class ProjectBase(OrmSchema):
    project_no: str
    name: str
    client_name: str | None = None
    contact_name: str | None = None
    contact_phone: str | None = None
    province: str | None = None
    city: str | None = None
    district: str | None = None
    address: str | None = None
    longitude: Decimal | None = None
    latitude: Decimal | None = None
    status: ProjectStatus = ProjectStatus.DRAFT


class ProjectCreate(ProjectBase):
    created_by: UUID


class ProjectRead(ProjectBase):
    id: UUID
    created_by: UUID
    current_task_id: UUID | None
    current_report_id: UUID | None
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None


class BuildingBase(OrmSchema):
    project_id: UUID
    name: str
    building_no: str | None = None
    floors: int | None = None
    height: Decimal | None = None
    structure_type: str | None = None
    usage_type: str | None = None
    built_year: int | None = None
    remark: str | None = None
    sort_order: int = 0


class BuildingCreate(BuildingBase):
    pass


class BuildingRead(BuildingBase):
    id: UUID
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None


class FacadeBase(OrmSchema):
    project_id: UUID
    building_id: UUID
    name: str
    area: Decimal | None = None
    floors_range: str | None = None
    description: str | None = None
    sort_order: int = 0


class FacadeCreate(FacadeBase):
    pass


class FacadeRead(FacadeBase):
    id: UUID
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None


class CollectionTimeRecommendationCreate(OrmSchema):
    project_id: UUID
    building_id: UUID | None = None
    facade_id: UUID | None = None
    target_date: date
    orientation: RecommendationOrientation
    recommended_start_time: datetime
    recommended_end_time: datetime
    score: Decimal | None = None
    reason: str | None = None
    weather_json: dict[str, Any] | None = None


class CollectionTimeRecommendationRead(CollectionTimeRecommendationCreate):
    id: UUID
    created_at: datetime


class DetectionConfigBase(OrmSchema):
    project_id: UUID
    model_types: list[DefectType]
    high_precision: bool = False
    config_json: dict[str, Any] | None = None
    created_by: UUID


class DetectionConfigCreate(DetectionConfigBase):
    pass


class DetectionConfigRead(DetectionConfigBase):
    id: UUID
    created_at: datetime
    updated_at: datetime


class UploadBatchCreate(OrmSchema):
    project_id: UUID
    building_id: UUID | None = None
    facade_id: UUID | None = None
    batch_no: str
    drone_type: str | None = None
    upload_mode: UploadMode
    photo_count: int = 0
    uploaded_by: UUID
    uploaded_at: datetime | None = None
    remark: str | None = None


class UploadBatchRead(UploadBatchCreate):
    id: UUID
    uploaded_at: datetime


class PhotoBase(OrmSchema):
    project_id: UUID
    building_id: UUID | None = None
    facade_id: UUID | None = None
    upload_batch_id: UUID
    original_filename: str
    file_ext: str | None = None
    file_size: int | None = None
    mime_type: str | None = None
    storage_bucket: str
    storage_object_key: str
    thumbnail_object_key: str | None = None
    image_width: int | None = None
    image_height: int | None = None
    photo_type: PhotoType
    capture_time: datetime | None = None
    longitude: Decimal | None = None
    latitude: Decimal | None = None
    status: PhotoStatus = PhotoStatus.UPLOADED


class PhotoCreate(PhotoBase):
    pass


class PhotoRead(PhotoBase):
    id: UUID
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None


class DetectionTaskBase(OrmSchema):
    project_id: UUID
    detection_config_id: UUID | None = None
    task_no: str
    status: DetectionTaskStatus = DetectionTaskStatus.PENDING
    priority: int = 0
    photo_count: int = 0
    worker_id: str | None = None
    locked_at: datetime | None = None
    worker_heartbeat_at: datetime | None = None
    lease_expires_at: datetime | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    failed_reason: str | None = None
    retry_count: int = 0
    model_version: str | None = None
    result_summary: dict[str, Any] | None = None
    created_by: UUID


class DetectionTaskCreate(DetectionTaskBase):
    pass


class DetectionTaskRead(DetectionTaskBase):
    id: UUID
    created_at: datetime
    updated_at: datetime


class DetectionTaskPhotoCreate(OrmSchema):
    detection_task_id: UUID
    photo_id: UUID
    status: PhotoStatus = PhotoStatus.UPLOADED


class DetectionTaskPhotoRead(DetectionTaskPhotoCreate):
    id: UUID
    created_at: datetime
    updated_at: datetime


class AiDetectionResultBase(OrmSchema):
    project_id: UUID
    detection_task_id: UUID
    photo_id: UUID
    defect_type: DefectType
    confidence: Decimal | None = None
    bbox_json: dict[str, Any]
    polygon_json: dict[str, Any] | None = None
    mask_object_key: str | None = None
    severity: str | None = None
    area: Decimal | None = None
    length: Decimal | None = None
    model_version: str | None = None
    raw_result_json: dict[str, Any] | None = None
    status: AiResultStatus = AiResultStatus.PENDING


class AiDetectionResultCreate(AiDetectionResultBase):
    pass


class AiDetectionResultRead(AiDetectionResultBase):
    id: UUID
    created_at: datetime


class ReviewResultBase(OrmSchema):
    project_id: UUID
    detection_task_id: UUID
    photo_id: UUID
    ai_result_id: UUID | None = None
    defect_type: DefectType
    bbox_json: dict[str, Any]
    polygon_json: dict[str, Any] | None = None
    severity: str | None = None
    area: Decimal | None = None
    length: Decimal | None = None
    status: ReviewResultStatus = ReviewResultStatus.PENDING
    reviewer_id: UUID
    review_note: str | None = None
    reviewed_at: datetime | None = None


class ReviewResultCreate(ReviewResultBase):
    pass


class ReviewResultRead(ReviewResultBase):
    id: UUID
    reviewed_at: datetime
    created_at: datetime
    updated_at: datetime


class ReviewOperationLogCreate(OrmSchema):
    project_id: UUID
    detection_task_id: UUID | None = None
    photo_id: UUID | None = None
    ai_result_id: UUID | None = None
    review_result_id: UUID | None = None
    operator_id: UUID
    operation_type: ReviewOperationType
    before_json: dict[str, Any] | None = None
    after_json: dict[str, Any] | None = None
    note: str | None = None


class ReviewOperationLogRead(ReviewOperationLogCreate):
    id: UUID
    created_at: datetime


class InspectionReportBase(OrmSchema):
    project_id: UUID
    detection_task_id: UUID | None = None
    report_no: str
    title: str
    status: InspectionReportStatus = InspectionReportStatus.DRAFT
    report_data_json: dict[str, Any] | None = None
    docx_bucket: str | None = None
    docx_object_key: str | None = None
    generated_by: UUID
    generated_at: datetime | None = None
    pushed_at: datetime | None = None


class InspectionReportCreate(InspectionReportBase):
    pass


class InspectionReportRead(InspectionReportBase):
    id: UUID
    generated_at: datetime
    created_at: datetime
    updated_at: datetime


class ReportPushLogCreate(OrmSchema):
    project_id: UUID
    report_id: UUID
    pushed_by: UUID
    push_target_user_id: UUID | None = None
    push_target_email: str | None = None
    push_method: ReportPushMethod
    status: ReportPushStatus
    error_message: str | None = None
    pushed_at: datetime | None = None


class ReportPushLogRead(ReportPushLogCreate):
    id: UUID
    pushed_at: datetime
