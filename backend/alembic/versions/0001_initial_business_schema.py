"""Initial business schema for phase 2.

Revision ID: 0001_initial_business_schema
Revises:
Create Date: 2026-06-25
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial_business_schema"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def uuid_column(name: str, nullable: bool = False) -> sa.Column:
    return sa.Column(name, postgresql.UUID(as_uuid=True), nullable=nullable)


def created_at_column() -> sa.Column:
    return sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False)


def updated_at_column() -> sa.Column:
    return sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False)


def deleted_at_column() -> sa.Column:
    return sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True)


def check_values(column_name: str, values: Sequence[str], name: str) -> sa.CheckConstraint:
    value_sql = ", ".join(f"'{value}'" for value in values)
    return sa.CheckConstraint(f"{column_name} IN ({value_sql})", name=op.f(name))


PROJECT_STATUSES = ("draft", "detecting", "pending_review", "reviewed", "completed", "failed")
TASK_STATUSES = ("pending", "running", "success", "failed", "canceled")
REPORT_STATUSES = ("draft", "generated", "pushed", "revoked")
REVIEW_STATUSES = ("pending", "confirmed", "modified", "deleted", "added")
AI_RESULT_STATUSES = ("pending",)
USER_ROLES = ("customer", "reviewer", "admin")
USER_STATUSES = ("active", "disabled")
DEFECT_TYPES = ("crack", "spalling", "hollowing", "leakage", "corrosion")
PHOTO_TYPES = ("visible", "thermal", "dji", "other")
PHOTO_STATUSES = ("uploaded", "detecting", "detected", "failed")
UPLOAD_MODES = ("dji", "visible", "thermal", "mixed")
RECOMMENDATION_ORIENTATIONS = ("east", "south", "west", "north", "southeast", "southwest", "northeast", "northwest")
REVIEW_OPERATIONS = ("confirm", "modify", "delete", "add", "generate_report", "push_report")
PUSH_METHODS = ("platform", "email", "manual")
PUSH_STATUSES = ("success", "failed")


def upgrade() -> None:
    op.create_table(
        "user_account",
        uuid_column("id"),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("real_name", sa.String(length=64), nullable=True),
        sa.Column("phone", sa.String(length=32), nullable=True),
        sa.Column("email", sa.String(length=128), nullable=True),
        sa.Column("role", sa.String(length=32), server_default=sa.text("'customer'"), nullable=False),
        sa.Column("organization", sa.String(length=128), nullable=True),
        sa.Column("status", sa.String(length=32), server_default=sa.text("'active'"), nullable=False),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        created_at_column(),
        updated_at_column(),
        deleted_at_column(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_account")),
        sa.UniqueConstraint("username", name=op.f("uq_user_account_username")),
        check_values("role", USER_ROLES, "ck_user_account_role"),
        check_values("status", USER_STATUSES, "ck_user_account_status"),
    )
    op.create_index("idx_user_account_role", "user_account", ["role"])
    op.create_index("idx_user_account_status", "user_account", ["status"])

    op.create_table(
        "project",
        uuid_column("id"),
        sa.Column("project_no", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("client_name", sa.String(length=128), nullable=True),
        sa.Column("contact_name", sa.String(length=64), nullable=True),
        sa.Column("contact_phone", sa.String(length=32), nullable=True),
        sa.Column("province", sa.String(length=64), nullable=True),
        sa.Column("city", sa.String(length=64), nullable=True),
        sa.Column("district", sa.String(length=64), nullable=True),
        sa.Column("address", sa.String(length=255), nullable=True),
        sa.Column("longitude", sa.Numeric(10, 7), nullable=True),
        sa.Column("latitude", sa.Numeric(10, 7), nullable=True),
        sa.Column("status", sa.String(length=32), server_default=sa.text("'draft'"), nullable=False),
        uuid_column("created_by"),
        uuid_column("current_task_id", nullable=True),
        uuid_column("current_report_id", nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        created_at_column(),
        updated_at_column(),
        deleted_at_column(),
        sa.ForeignKeyConstraint(["created_by"], ["user_account.id"], name=op.f("fk_project_created_by_user_account"), ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_project")),
        sa.UniqueConstraint("project_no", name=op.f("uq_project_project_no")),
        check_values("status", PROJECT_STATUSES, "ck_project_status"),
    )
    op.create_index("idx_project_status", "project", ["status"])
    op.create_index("idx_project_created_by", "project", ["created_by"])
    op.create_index("idx_project_created_at", "project", ["created_at"])

    op.create_table(
        "building",
        uuid_column("id"),
        uuid_column("project_id"),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("building_no", sa.String(length=64), nullable=True),
        sa.Column("floors", sa.Integer(), nullable=True),
        sa.Column("height", sa.Numeric(8, 2), nullable=True),
        sa.Column("structure_type", sa.String(length=64), nullable=True),
        sa.Column("usage_type", sa.String(length=64), nullable=True),
        sa.Column("built_year", sa.Integer(), nullable=True),
        sa.Column("remark", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), server_default=sa.text("0"), nullable=False),
        created_at_column(),
        updated_at_column(),
        deleted_at_column(),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], name=op.f("fk_building_project_id_project"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_building")),
    )
    op.create_index("idx_building_project_id", "building", ["project_id"])

    op.create_table(
        "facade",
        uuid_column("id"),
        uuid_column("project_id"),
        uuid_column("building_id"),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("area", sa.Numeric(10, 2), nullable=True),
        sa.Column("floors_range", sa.String(length=64), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), server_default=sa.text("0"), nullable=False),
        created_at_column(),
        updated_at_column(),
        deleted_at_column(),
        sa.ForeignKeyConstraint(["building_id"], ["building.id"], name=op.f("fk_facade_building_id_building"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], name=op.f("fk_facade_project_id_project"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_facade")),
    )
    op.create_index("idx_facade_project_id", "facade", ["project_id"])
    op.create_index("idx_facade_building_id", "facade", ["building_id"])

    op.create_table(
        "collection_time_recommendation",
        uuid_column("id"),
        uuid_column("project_id"),
        uuid_column("building_id", nullable=True),
        uuid_column("facade_id", nullable=True),
        sa.Column("target_date", sa.Date(), nullable=False),
        sa.Column("orientation", sa.String(length=32), nullable=False),
        sa.Column("recommended_start_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("recommended_end_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("score", sa.Numeric(5, 2), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("weather_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        created_at_column(),
        sa.ForeignKeyConstraint(["building_id"], ["building.id"], name=op.f("fk_collection_time_recommendation_building_id_building"), ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["facade_id"], ["facade.id"], name=op.f("fk_collection_time_recommendation_facade_id_facade"), ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], name=op.f("fk_collection_time_recommendation_project_id_project"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_collection_time_recommendation")),
        check_values("orientation", RECOMMENDATION_ORIENTATIONS, "ck_collection_time_recommendation_orientation"),
    )
    op.create_index("idx_collection_time_recommendation_project_id", "collection_time_recommendation", ["project_id"])
    op.create_index("idx_collection_time_recommendation_facade_id", "collection_time_recommendation", ["facade_id"])
    op.create_index("idx_collection_time_recommendation_target_date", "collection_time_recommendation", ["target_date"])

    op.create_table(
        "detection_config",
        uuid_column("id"),
        uuid_column("project_id"),
        sa.Column("model_types", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("high_precision", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("config_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        uuid_column("created_by"),
        created_at_column(),
        updated_at_column(),
        sa.ForeignKeyConstraint(["created_by"], ["user_account.id"], name=op.f("fk_detection_config_created_by_user_account"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], name=op.f("fk_detection_config_project_id_project"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_detection_config")),
        sa.UniqueConstraint("project_id", name=op.f("uq_detection_config_project_id")),
    )
    op.create_index("idx_detection_config_project_id", "detection_config", ["project_id"])
    op.create_index("idx_detection_config_created_by", "detection_config", ["created_by"])

    op.create_table(
        "upload_batch",
        uuid_column("id"),
        uuid_column("project_id"),
        uuid_column("building_id", nullable=True),
        uuid_column("facade_id", nullable=True),
        sa.Column("batch_no", sa.String(length=64), nullable=False),
        sa.Column("drone_type", sa.String(length=64), nullable=True),
        sa.Column("upload_mode", sa.String(length=32), nullable=False),
        sa.Column("photo_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        uuid_column("uploaded_by"),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("remark", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["building_id"], ["building.id"], name=op.f("fk_upload_batch_building_id_building"), ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["facade_id"], ["facade.id"], name=op.f("fk_upload_batch_facade_id_facade"), ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], name=op.f("fk_upload_batch_project_id_project"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by"], ["user_account.id"], name=op.f("fk_upload_batch_uploaded_by_user_account"), ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_upload_batch")),
        sa.UniqueConstraint("batch_no", name=op.f("uq_upload_batch_batch_no")),
        check_values("upload_mode", UPLOAD_MODES, "ck_upload_batch_upload_mode"),
    )
    op.create_index("idx_upload_batch_project_id", "upload_batch", ["project_id"])
    op.create_index("idx_upload_batch_facade_id", "upload_batch", ["facade_id"])
    op.create_index("idx_upload_batch_uploaded_by", "upload_batch", ["uploaded_by"])

    op.create_table(
        "photo",
        uuid_column("id"),
        uuid_column("project_id"),
        uuid_column("building_id", nullable=True),
        uuid_column("facade_id", nullable=True),
        uuid_column("upload_batch_id"),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("file_ext", sa.String(length=32), nullable=True),
        sa.Column("file_size", sa.BigInteger(), nullable=True),
        sa.Column("mime_type", sa.String(length=64), nullable=True),
        sa.Column("storage_bucket", sa.String(length=64), nullable=False),
        sa.Column("storage_object_key", sa.String(length=512), nullable=False),
        sa.Column("thumbnail_object_key", sa.String(length=512), nullable=True),
        sa.Column("image_width", sa.Integer(), nullable=True),
        sa.Column("image_height", sa.Integer(), nullable=True),
        sa.Column("photo_type", sa.String(length=32), nullable=False),
        sa.Column("capture_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("longitude", sa.Numeric(10, 7), nullable=True),
        sa.Column("latitude", sa.Numeric(10, 7), nullable=True),
        sa.Column("status", sa.String(length=32), server_default=sa.text("'uploaded'"), nullable=False),
        created_at_column(),
        updated_at_column(),
        deleted_at_column(),
        sa.ForeignKeyConstraint(["building_id"], ["building.id"], name=op.f("fk_photo_building_id_building"), ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["facade_id"], ["facade.id"], name=op.f("fk_photo_facade_id_facade"), ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], name=op.f("fk_photo_project_id_project"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["upload_batch_id"], ["upload_batch.id"], name=op.f("fk_photo_upload_batch_id_upload_batch"), ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_photo")),
        check_values("photo_type", PHOTO_TYPES, "ck_photo_photo_type"),
        check_values("status", PHOTO_STATUSES, "ck_photo_status"),
    )
    op.create_index("idx_photo_project_id", "photo", ["project_id"])
    op.create_index("idx_photo_facade_id", "photo", ["facade_id"])
    op.create_index("idx_photo_upload_batch_id", "photo", ["upload_batch_id"])
    op.create_index("idx_photo_status", "photo", ["status"])

    op.create_table(
        "detection_task",
        uuid_column("id"),
        uuid_column("project_id"),
        uuid_column("detection_config_id", nullable=True),
        sa.Column("task_no", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), server_default=sa.text("'pending'"), nullable=False),
        sa.Column("priority", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("photo_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("worker_id", sa.String(length=128), nullable=True),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("worker_heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failed_reason", sa.Text(), nullable=True),
        sa.Column("retry_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("model_version", sa.String(length=128), nullable=True),
        sa.Column("result_summary", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        uuid_column("created_by"),
        created_at_column(),
        updated_at_column(),
        sa.ForeignKeyConstraint(["created_by"], ["user_account.id"], name=op.f("fk_detection_task_created_by_user_account"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["detection_config_id"], ["detection_config.id"], name=op.f("fk_detection_task_detection_config_id_detection_config"), ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], name=op.f("fk_detection_task_project_id_project"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_detection_task")),
        sa.UniqueConstraint("task_no", name=op.f("uq_detection_task_task_no")),
        check_values("status", TASK_STATUSES, "ck_detection_task_status"),
    )
    op.create_index("idx_detection_task_project_id", "detection_task", ["project_id"])
    op.create_index("idx_detection_task_status", "detection_task", ["status"])
    op.create_index("idx_detection_task_created_at", "detection_task", ["created_at"])

    op.create_table(
        "detection_task_photo",
        uuid_column("id"),
        uuid_column("detection_task_id"),
        uuid_column("photo_id"),
        sa.Column("status", sa.String(length=32), server_default=sa.text("'uploaded'"), nullable=False),
        created_at_column(),
        updated_at_column(),
        sa.ForeignKeyConstraint(["detection_task_id"], ["detection_task.id"], name=op.f("fk_detection_task_photo_detection_task_id_detection_task"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["photo_id"], ["photo.id"], name=op.f("fk_detection_task_photo_photo_id_photo"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_detection_task_photo")),
        sa.UniqueConstraint("detection_task_id", "photo_id", name=op.f("uq_detection_task_photo_task_photo")),
        check_values("status", PHOTO_STATUSES, "ck_detection_task_photo_status"),
    )
    op.create_index("idx_detection_task_photo_task_id", "detection_task_photo", ["detection_task_id"])
    op.create_index("idx_detection_task_photo_photo_id", "detection_task_photo", ["photo_id"])

    op.create_table(
        "ai_detection_result",
        uuid_column("id"),
        uuid_column("project_id"),
        uuid_column("detection_task_id"),
        uuid_column("photo_id"),
        sa.Column("defect_type", sa.String(length=32), nullable=False),
        sa.Column("confidence", sa.Numeric(5, 4), nullable=True),
        sa.Column("bbox_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("polygon_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("mask_object_key", sa.String(length=512), nullable=True),
        sa.Column("severity", sa.String(length=32), nullable=True),
        sa.Column("area", sa.Numeric(10, 4), nullable=True),
        sa.Column("length", sa.Numeric(10, 4), nullable=True),
        sa.Column("model_version", sa.String(length=128), nullable=True),
        sa.Column("raw_result_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("status", sa.String(length=32), server_default=sa.text("'pending'"), nullable=False),
        created_at_column(),
        sa.ForeignKeyConstraint(["detection_task_id"], ["detection_task.id"], name=op.f("fk_ai_detection_result_detection_task_id_detection_task"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["photo_id"], ["photo.id"], name=op.f("fk_ai_detection_result_photo_id_photo"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], name=op.f("fk_ai_detection_result_project_id_project"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_detection_result")),
        check_values("defect_type", DEFECT_TYPES, "ck_ai_detection_result_defect_type"),
        check_values("status", AI_RESULT_STATUSES, "ck_ai_detection_result_status"),
    )
    op.create_index("idx_ai_result_task_id", "ai_detection_result", ["detection_task_id"])
    op.create_index("idx_ai_result_photo_id", "ai_detection_result", ["photo_id"])
    op.create_index("idx_ai_result_defect_type", "ai_detection_result", ["defect_type"])

    op.create_table(
        "review_result",
        uuid_column("id"),
        uuid_column("project_id"),
        uuid_column("detection_task_id"),
        uuid_column("photo_id"),
        uuid_column("ai_result_id", nullable=True),
        sa.Column("defect_type", sa.String(length=32), nullable=False),
        sa.Column("bbox_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("polygon_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("severity", sa.String(length=32), nullable=True),
        sa.Column("area", sa.Numeric(10, 4), nullable=True),
        sa.Column("length", sa.Numeric(10, 4), nullable=True),
        sa.Column("status", sa.String(length=32), server_default=sa.text("'pending'"), nullable=False),
        uuid_column("reviewer_id"),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        created_at_column(),
        updated_at_column(),
        sa.ForeignKeyConstraint(["ai_result_id"], ["ai_detection_result.id"], name=op.f("fk_review_result_ai_result_id_ai_detection_result"), ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["detection_task_id"], ["detection_task.id"], name=op.f("fk_review_result_detection_task_id_detection_task"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["photo_id"], ["photo.id"], name=op.f("fk_review_result_photo_id_photo"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], name=op.f("fk_review_result_project_id_project"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reviewer_id"], ["user_account.id"], name=op.f("fk_review_result_reviewer_id_user_account"), ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_review_result")),
        sa.UniqueConstraint("ai_result_id", name=op.f("uq_review_result_ai_result_id")),
        check_values("defect_type", DEFECT_TYPES, "ck_review_result_defect_type"),
        check_values("status", REVIEW_STATUSES, "ck_review_result_status"),
    )
    op.create_index("idx_review_result_project_id", "review_result", ["project_id"])
    op.create_index("idx_review_result_photo_id", "review_result", ["photo_id"])
    op.create_index("idx_review_result_status", "review_result", ["status"])

    op.create_table(
        "review_operation_log",
        uuid_column("id"),
        uuid_column("project_id"),
        uuid_column("detection_task_id", nullable=True),
        uuid_column("photo_id", nullable=True),
        uuid_column("ai_result_id", nullable=True),
        uuid_column("review_result_id", nullable=True),
        uuid_column("operator_id"),
        sa.Column("operation_type", sa.String(length=32), nullable=False),
        sa.Column("before_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("after_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        created_at_column(),
        sa.ForeignKeyConstraint(["ai_result_id"], ["ai_detection_result.id"], name=op.f("fk_review_operation_log_ai_result_id_ai_detection_result"), ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["detection_task_id"], ["detection_task.id"], name=op.f("fk_review_operation_log_detection_task_id_detection_task"), ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["operator_id"], ["user_account.id"], name=op.f("fk_review_operation_log_operator_id_user_account"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["photo_id"], ["photo.id"], name=op.f("fk_review_operation_log_photo_id_photo"), ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], name=op.f("fk_review_operation_log_project_id_project"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["review_result_id"], ["review_result.id"], name=op.f("fk_review_operation_log_review_result_id_review_result"), ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_review_operation_log")),
        check_values("operation_type", REVIEW_OPERATIONS, "ck_review_operation_log_operation_type"),
    )
    op.create_index("idx_review_operation_log_project_id", "review_operation_log", ["project_id"])
    op.create_index("idx_review_operation_log_detection_task_id", "review_operation_log", ["detection_task_id"])
    op.create_index("idx_review_operation_log_photo_id", "review_operation_log", ["photo_id"])
    op.create_index("idx_review_operation_log_operator_id", "review_operation_log", ["operator_id"])

    op.create_table(
        "inspection_report",
        uuid_column("id"),
        uuid_column("project_id"),
        uuid_column("detection_task_id", nullable=True),
        sa.Column("report_no", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=32), server_default=sa.text("'draft'"), nullable=False),
        sa.Column("report_data_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("docx_bucket", sa.String(length=64), nullable=True),
        sa.Column("docx_object_key", sa.String(length=512), nullable=True),
        uuid_column("generated_by"),
        sa.Column("generated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("pushed_at", sa.DateTime(timezone=True), nullable=True),
        created_at_column(),
        updated_at_column(),
        sa.ForeignKeyConstraint(["detection_task_id"], ["detection_task.id"], name=op.f("fk_inspection_report_detection_task_id_detection_task"), ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["generated_by"], ["user_account.id"], name=op.f("fk_inspection_report_generated_by_user_account"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], name=op.f("fk_inspection_report_project_id_project"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_inspection_report")),
        sa.UniqueConstraint("report_no", name=op.f("uq_inspection_report_report_no")),
        check_values("status", REPORT_STATUSES, "ck_inspection_report_status"),
    )
    op.create_index("idx_report_project_id", "inspection_report", ["project_id"])
    op.create_index("idx_report_status", "inspection_report", ["status"])

    op.create_table(
        "report_push_log",
        uuid_column("id"),
        uuid_column("project_id"),
        uuid_column("report_id"),
        uuid_column("pushed_by"),
        uuid_column("push_target_user_id", nullable=True),
        sa.Column("push_target_email", sa.String(length=128), nullable=True),
        sa.Column("push_method", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("pushed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], name=op.f("fk_report_push_log_project_id_project"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["push_target_user_id"], ["user_account.id"], name=op.f("fk_report_push_log_push_target_user_id_user_account"), ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["pushed_by"], ["user_account.id"], name=op.f("fk_report_push_log_pushed_by_user_account"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["report_id"], ["inspection_report.id"], name=op.f("fk_report_push_log_report_id_inspection_report"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_report_push_log")),
        check_values("push_method", PUSH_METHODS, "ck_report_push_log_push_method"),
        check_values("status", PUSH_STATUSES, "ck_report_push_log_status"),
    )
    op.create_index("idx_report_push_log_project_id", "report_push_log", ["project_id"])
    op.create_index("idx_report_push_log_report_id", "report_push_log", ["report_id"])
    op.create_index("idx_report_push_log_pushed_by", "report_push_log", ["pushed_by"])

    op.create_foreign_key(
        op.f("fk_project_current_task_id_detection_task"),
        "project",
        "detection_task",
        ["current_task_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        op.f("fk_project_current_report_id_inspection_report"),
        "project",
        "inspection_report",
        ["current_report_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("fk_project_current_report_id_inspection_report"), "project", type_="foreignkey")
    op.drop_constraint(op.f("fk_project_current_task_id_detection_task"), "project", type_="foreignkey")
    op.drop_table("report_push_log")
    op.drop_table("inspection_report")
    op.drop_table("review_operation_log")
    op.drop_table("review_result")
    op.drop_table("ai_detection_result")
    op.drop_table("detection_task_photo")
    op.drop_table("detection_task")
    op.drop_table("photo")
    op.drop_table("upload_batch")
    op.drop_table("detection_config")
    op.drop_table("collection_time_recommendation")
    op.drop_table("facade")
    op.drop_table("building")
    op.drop_table("project")
    op.drop_table("user_account")
