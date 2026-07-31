from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.enums.status import (
    AiResultStatus,
    DefectType,
    DetectionTaskStatus,
    InspectionReportStatus,
    PhotoPrecheckStatus,
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

from .base import (
    CreatedAtMixin,
    SoftDeleteMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
    enum_check,
    status_column,
    utc_now,
)


class UserAccount(UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "user_account"
    __table_args__ = (
        enum_check("role", UserRole, "role"),
        enum_check("status", UserStatus, "status"),
        Index("uq_user_account_phone", "phone", unique=True),
        Index("idx_user_account_role", "role"),
        Index("idx_user_account_status", "status"),
    )

    username: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    real_name: Mapped[str | None] = mapped_column(String(64))
    phone: Mapped[str | None] = mapped_column(String(32))
    role: Mapped[str] = status_column(UserRole.CUSTOMER)
    organization: Mapped[str | None] = mapped_column(String(128))
    status: Mapped[str] = status_column(UserStatus.ACTIVE)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SystemSetting(TimestampMixin, Base):
    __tablename__ = "system_setting"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_by: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="SET NULL"),
    )


class Project(UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "project"
    __table_args__ = (
        enum_check("status", ProjectStatus, "status"),
        Index(
            "uq_project_created_by_client_draft_key",
            "created_by",
            "client_draft_key",
            unique=True,
        ),
        Index("idx_project_status", "status"),
        Index("idx_project_created_by", "created_by"),
        Index("idx_project_created_at", "created_at"),
    )

    project_no: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    client_draft_key: Mapped[str | None] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    client_name: Mapped[str | None] = mapped_column(String(128))
    province: Mapped[str | None] = mapped_column(String(64))
    city: Mapped[str | None] = mapped_column(String(64))
    district: Mapped[str | None] = mapped_column(String(64))
    address: Mapped[str | None] = mapped_column(String(255))
    longitude: Mapped[Decimal | None] = mapped_column(Numeric(10, 7))
    latitude: Mapped[Decimal | None] = mapped_column(Numeric(10, 7))
    status: Mapped[str] = status_column(ProjectStatus.DRAFT)
    created_by: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="RESTRICT"),
        nullable=False,
    )
    current_task_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("detection_task.id", ondelete="SET NULL", use_alter=True),
    )
    current_report_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("inspection_report.id", ondelete="SET NULL", use_alter=True),
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CollectionTimeRecommendation(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "collection_time_recommendation"
    __table_args__ = (
        enum_check("orientation", RecommendationOrientation, "orientation"),
        Index("idx_collection_time_recommendation_project_id", "project_id"),
        Index("idx_collection_time_recommendation_target_date", "target_date"),
    )

    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("project.id", ondelete="CASCADE"),
        nullable=False,
    )
    target_date: Mapped[date] = mapped_column(Date, nullable=False)
    orientation: Mapped[str] = mapped_column(String(32), nullable=False)
    recommended_start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    recommended_end_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    score: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    reason: Mapped[str | None] = mapped_column(Text)
    weather_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)


class DetectionConfig(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "detection_config"
    __table_args__ = (
        UniqueConstraint("project_id", name="uq_detection_config_project_id"),
        Index("idx_detection_config_project_id", "project_id"),
        Index("idx_detection_config_created_by", "created_by"),
    )

    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("project.id", ondelete="CASCADE"),
        nullable=False,
    )
    model_types: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    high_precision: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        server_default="true",
        nullable=False,
    )
    config_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_by: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="RESTRICT"),
        nullable=False,
    )


class UploadBatch(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "upload_batch"
    __table_args__ = (
        enum_check("upload_mode", UploadMode, "upload_mode"),
        Index("idx_upload_batch_project_id", "project_id"),
        Index("idx_upload_batch_uploaded_by", "uploaded_by"),
    )

    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("project.id", ondelete="CASCADE"),
        nullable=False,
    )
    batch_no: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    drone_type: Mapped[str | None] = mapped_column(String(64))
    upload_mode: Mapped[str] = mapped_column(String(32), nullable=False)
    photo_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    uploaded_by: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="RESTRICT"),
        nullable=False,
    )
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
    )
    remark: Mapped[str | None] = mapped_column(Text)


class Photo(UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "photo"
    __table_args__ = (
        enum_check("photo_type", PhotoType, "photo_type"),
        enum_check("status", PhotoStatus, "status"),
        enum_check("precheck_status", PhotoPrecheckStatus, "precheck_status"),
        Index("idx_photo_project_id", "project_id"),
        Index("idx_photo_upload_batch_id", "upload_batch_id"),
        Index("idx_photo_status", "status"),
        Index("idx_photo_precheck_status", "precheck_status"),
    )

    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("project.id", ondelete="CASCADE"),
        nullable=False,
    )
    upload_batch_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("upload_batch.id", ondelete="RESTRICT"),
        nullable=False,
    )
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_ext: Mapped[str | None] = mapped_column(String(32))
    file_size: Mapped[int | None] = mapped_column(BigInteger)
    mime_type: Mapped[str | None] = mapped_column(String(64))
    storage_bucket: Mapped[str] = mapped_column(String(64), nullable=False)
    storage_object_key: Mapped[str] = mapped_column(String(512), nullable=False)
    thumbnail_object_key: Mapped[str | None] = mapped_column(String(512))
    image_width: Mapped[int | None] = mapped_column(Integer)
    image_height: Mapped[int | None] = mapped_column(Integer)
    photo_type: Mapped[str] = mapped_column(String(32), nullable=False)
    capture_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    longitude: Mapped[Decimal | None] = mapped_column(Numeric(10, 7))
    latitude: Mapped[Decimal | None] = mapped_column(Numeric(10, 7))
    status: Mapped[str] = status_column(PhotoStatus.UPLOADED)
    precheck_status: Mapped[str] = status_column(PhotoPrecheckStatus.PENDING)
    precheck_category: Mapped[str | None] = mapped_column(String(32))
    precheck_reason: Mapped[str | None] = mapped_column(String(255))
    precheck_model: Mapped[str | None] = mapped_column(String(128))
    precheck_error: Mapped[str | None] = mapped_column(Text)
    precheck_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    prechecked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DetectionTask(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "detection_task"
    __table_args__ = (
        enum_check("status", DetectionTaskStatus, "status"),
        UniqueConstraint("project_id", name="uq_detection_task_project_id"),
        Index("idx_detection_task_project_id", "project_id"),
        Index("idx_detection_task_status", "status"),
        Index("idx_detection_task_created_at", "created_at"),
    )

    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("project.id", ondelete="CASCADE"),
        nullable=False,
    )
    detection_config_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("detection_config.id", ondelete="SET NULL"),
    )
    task_no: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    status: Mapped[str] = status_column(DetectionTaskStatus.PENDING)
    priority: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    photo_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    worker_id: Mapped[str | None] = mapped_column(String(128))
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    worker_heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failed_reason: Mapped[str | None] = mapped_column(Text)
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    model_version: Mapped[str | None] = mapped_column(String(128))
    result_summary: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_by: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="RESTRICT"),
        nullable=False,
    )


class DetectionTaskPhoto(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "detection_task_photo"
    __table_args__ = (
        enum_check("status", PhotoStatus, "status"),
        UniqueConstraint("detection_task_id", "photo_id", name="uq_detection_task_photo_task_photo"),
        Index("idx_detection_task_photo_task_id", "detection_task_id"),
        Index("idx_detection_task_photo_photo_id", "photo_id"),
    )

    detection_task_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("detection_task.id", ondelete="CASCADE"),
        nullable=False,
    )
    photo_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("photo.id", ondelete="CASCADE"),
        nullable=False,
    )
    status: Mapped[str] = status_column(PhotoStatus.UPLOADED)


class AiDetectionResult(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "ai_detection_result"
    __table_args__ = (
        enum_check("defect_type", DefectType, "defect_type"),
        enum_check("status", AiResultStatus, "status"),
        Index("idx_ai_result_task_id", "detection_task_id"),
        Index("idx_ai_result_photo_id", "photo_id"),
        Index("idx_ai_result_defect_type", "defect_type"),
    )

    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("project.id", ondelete="CASCADE"),
        nullable=False,
    )
    detection_task_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("detection_task.id", ondelete="CASCADE"),
        nullable=False,
    )
    photo_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("photo.id", ondelete="CASCADE"),
        nullable=False,
    )
    defect_type: Mapped[str] = mapped_column(String(32), nullable=False)
    confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 4))
    bbox_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    polygon_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    mask_object_key: Mapped[str | None] = mapped_column(String(512))
    severity: Mapped[str | None] = mapped_column(String(32))
    area: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))
    length: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))
    model_version: Mapped[str | None] = mapped_column(String(128))
    raw_result_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    status: Mapped[str] = status_column(AiResultStatus.PENDING)


class ReviewResult(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "review_result"
    __table_args__ = (
        enum_check("defect_type", DefectType, "defect_type"),
        enum_check("status", ReviewResultStatus, "status"),
        UniqueConstraint("ai_result_id", name="uq_review_result_ai_result_id"),
        Index("idx_review_result_project_id", "project_id"),
        Index("idx_review_result_photo_id", "photo_id"),
        Index("idx_review_result_status", "status"),
    )

    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("project.id", ondelete="CASCADE"),
        nullable=False,
    )
    detection_task_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("detection_task.id", ondelete="CASCADE"),
        nullable=False,
    )
    photo_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("photo.id", ondelete="CASCADE"),
        nullable=False,
    )
    ai_result_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("ai_detection_result.id", ondelete="SET NULL"),
    )
    defect_type: Mapped[str] = mapped_column(String(32), nullable=False)
    bbox_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    polygon_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    severity: Mapped[str | None] = mapped_column(String(32))
    area: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))
    length: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))
    status: Mapped[str] = status_column(ReviewResultStatus.PENDING)
    reviewer_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="RESTRICT"),
        nullable=False,
    )
    review_note: Mapped[str | None] = mapped_column(Text)
    reviewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class ReviewOperationLog(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "review_operation_log"
    __table_args__ = (
        enum_check("operation_type", ReviewOperationType, "operation_type"),
        Index("idx_review_operation_log_project_id", "project_id"),
        Index("idx_review_operation_log_detection_task_id", "detection_task_id"),
        Index("idx_review_operation_log_photo_id", "photo_id"),
        Index("idx_review_operation_log_operator_id", "operator_id"),
    )

    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("project.id", ondelete="CASCADE"),
        nullable=False,
    )
    detection_task_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("detection_task.id", ondelete="SET NULL"),
    )
    photo_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("photo.id", ondelete="SET NULL"),
    )
    ai_result_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("ai_detection_result.id", ondelete="SET NULL"),
    )
    review_result_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("review_result.id", ondelete="SET NULL"),
    )
    operator_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="RESTRICT"),
        nullable=False,
    )
    operation_type: Mapped[str] = mapped_column(String(32), nullable=False)
    before_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    after_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    note: Mapped[str | None] = mapped_column(Text)


class InspectionReport(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "inspection_report"
    __table_args__ = (
        enum_check("status", InspectionReportStatus, "status"),
        UniqueConstraint("project_id", name="uq_inspection_report_project_id"),
        Index("idx_report_project_id", "project_id"),
        Index("idx_report_status", "status"),
    )

    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("project.id", ondelete="CASCADE"),
        nullable=False,
    )
    detection_task_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("detection_task.id", ondelete="SET NULL"),
    )
    report_no: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = status_column(InspectionReportStatus.DRAFT)
    report_data_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    docx_bucket: Mapped[str | None] = mapped_column(String(64))
    docx_object_key: Mapped[str | None] = mapped_column(String(512))
    generated_by: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="RESTRICT"),
        nullable=False,
    )
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    pushed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TrialDetectionResult(UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "trial_detection_result"
    __table_args__ = (
        enum_check("status", InspectionReportStatus, "status"),
        Index("idx_trial_result_generated_by", "generated_by"),
        Index("idx_trial_result_generated_at", "generated_at"),
        Index("idx_trial_result_status", "status"),
    )

    result_no: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = status_column(InspectionReportStatus.GENERATED)
    report_data_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    photo_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    finding_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    thermal_available_photo_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    generated_by: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="RESTRICT"),
        nullable=False,
    )
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class AnnotationPhotoEdit(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Administrator-only annotation copy; never used to build customer reports."""

    __tablename__ = "annotation_photo_edit"
    __table_args__ = (
        CheckConstraint(
            "(report_id IS NOT NULL AND trial_result_id IS NULL) OR "
            "(report_id IS NULL AND trial_result_id IS NOT NULL)",
            name="exactly_one_result",
        ),
        UniqueConstraint("report_id", "photo_key", name="uq_annotation_photo_edit_report_photo"),
        UniqueConstraint(
            "trial_result_id",
            "photo_key",
            name="uq_annotation_photo_edit_trial_result_photo",
        ),
        Index("idx_annotation_photo_edit_report_id", "report_id"),
        Index("idx_annotation_photo_edit_trial_result_id", "trial_result_id"),
    )

    report_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("inspection_report.id", ondelete="CASCADE"),
    )
    trial_result_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("trial_detection_result.id", ondelete="CASCADE"),
    )
    photo_key: Mapped[str] = mapped_column(String(512), nullable=False)
    annotations_json: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False)
    edited_by: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="RESTRICT"),
        nullable=False,
    )


class QuickDetectionPhoto(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "quick_detection_photo"
    __table_args__ = (
        Index("idx_quick_detection_photo_uploaded_by", "uploaded_by"),
        Index("idx_quick_detection_photo_result_id", "generated_result_id"),
        Index("idx_quick_detection_photo_created_at", "created_at"),
        enum_check("precheck_status", PhotoPrecheckStatus, "precheck_status"),
        Index("idx_quick_detection_photo_precheck_status", "precheck_status"),
    )

    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int | None] = mapped_column(BigInteger)
    mime_type: Mapped[str | None] = mapped_column(String(64))
    storage_bucket: Mapped[str] = mapped_column(String(64), nullable=False)
    storage_object_key: Mapped[str] = mapped_column(String(512), nullable=False)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    thermal_imaging_available: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    precheck_status: Mapped[str] = status_column(PhotoPrecheckStatus.PENDING)
    precheck_category: Mapped[str | None] = mapped_column(String(32))
    precheck_reason: Mapped[str | None] = mapped_column(String(255))
    precheck_model: Mapped[str | None] = mapped_column(String(128))
    precheck_error: Mapped[str | None] = mapped_column(Text)
    precheck_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    prechecked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    uploaded_by: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="RESTRICT"),
        nullable=False,
    )
    generated_result_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("trial_detection_result.id", ondelete="SET NULL"),
    )


class UsageEvent(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """Immutable resource-usage ledger independent of deletable business data."""

    __tablename__ = "usage_event"
    __table_args__ = (
        CheckConstraint("photo_count >= 0", name="photo_count_non_negative"),
        CheckConstraint("storage_bytes >= 0", name="storage_bytes_non_negative"),
        CheckConstraint("api_request_count >= 0", name="api_request_count_non_negative"),
        CheckConstraint("input_token_count >= 0", name="input_token_count_non_negative"),
        CheckConstraint("output_token_count >= 0", name="output_token_count_non_negative"),
        CheckConstraint("token_count >= 0", name="token_count_non_negative"),
        CheckConstraint("trial_task_count >= 0", name="trial_task_count_non_negative"),
        Index("idx_usage_event_occurred_at", "occurred_at"),
        Index("idx_usage_event_event_type", "event_type"),
        Index("idx_usage_event_source_type", "source_type"),
        Index("idx_usage_event_actor_occurred_at", "actor_id", "occurred_at"),
    )

    event_key: Mapped[str] = mapped_column(String(160), nullable=False, unique=True)
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)
    actor_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="SET NULL"),
    )
    photo_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    storage_bytes: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    api_request_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    input_token_count: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    output_token_count: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    token_count: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    trial_task_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
    )


class ReportPushLog(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "report_push_log"
    __table_args__ = (
        enum_check("push_method", ReportPushMethod, "push_method"),
        enum_check("status", ReportPushStatus, "status"),
        Index("idx_report_push_log_project_id", "project_id"),
        Index("idx_report_push_log_report_id", "report_id"),
        Index("idx_report_push_log_pushed_by", "pushed_by"),
    )

    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("project.id", ondelete="CASCADE"),
        nullable=False,
    )
    report_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("inspection_report.id", ondelete="CASCADE"),
        nullable=False,
    )
    pushed_by: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="RESTRICT"),
        nullable=False,
    )
    push_target_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="SET NULL"),
    )
    push_target_email: Mapped[str | None] = mapped_column(String(128))
    push_method: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text)
    pushed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
