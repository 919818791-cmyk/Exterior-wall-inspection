"""Create quick detection photo table.

Revision ID: 0012_quick_detection_photo
Revises: 0011_remove_trial_confidence
Create Date: 2026-07-02
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0012_quick_detection_photo"
down_revision: str | None = "0011_remove_trial_confidence"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def uuid_column(name: str, nullable: bool = False) -> sa.Column:
    return sa.Column(name, postgresql.UUID(as_uuid=True), nullable=nullable)


def timestamp_column(name: str) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False)


def upgrade() -> None:
    op.create_table(
        "quick_detection_photo",
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=True),
        sa.Column("mime_type", sa.String(length=64), nullable=True),
        sa.Column("storage_bucket", sa.String(length=64), nullable=False),
        sa.Column("storage_object_key", sa.String(length=512), nullable=False),
        sa.Column("metadata_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("thermal_imaging_available", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        uuid_column("uploaded_by"),
        uuid_column("generated_result_id", nullable=True),
        uuid_column("id"),
        timestamp_column("created_at"),
        timestamp_column("updated_at"),
        sa.ForeignKeyConstraint(["generated_result_id"], ["trial_detection_result.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["uploaded_by"], ["user_account.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_quick_detection_photo_created_at", "quick_detection_photo", ["created_at"], unique=False)
    op.create_index("idx_quick_detection_photo_result_id", "quick_detection_photo", ["generated_result_id"], unique=False)
    op.create_index("idx_quick_detection_photo_uploaded_by", "quick_detection_photo", ["uploaded_by"], unique=False)


def downgrade() -> None:
    op.drop_index("idx_quick_detection_photo_uploaded_by", table_name="quick_detection_photo")
    op.drop_index("idx_quick_detection_photo_result_id", table_name="quick_detection_photo")
    op.drop_index("idx_quick_detection_photo_created_at", table_name="quick_detection_photo")
    op.drop_table("quick_detection_photo")
