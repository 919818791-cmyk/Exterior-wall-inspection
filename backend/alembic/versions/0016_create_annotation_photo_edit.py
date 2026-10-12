"""Create administrator-only annotation photo edits.

Revision ID: 0016_annotation_photo_edit
Revises: 0015_usage_event_ledger
Create Date: 2026-07-13
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0016_annotation_photo_edit"
down_revision: str | None = "0015_usage_event_ledger"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "annotation_photo_edit",
        sa.Column("report_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("trial_result_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("photo_key", sa.String(length=512), nullable=False),
        sa.Column("annotations_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("edited_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "(report_id IS NOT NULL AND trial_result_id IS NULL) OR "
            "(report_id IS NULL AND trial_result_id IS NOT NULL)",
            name=op.f("ck_annotation_photo_edit_exactly_one_result"),
        ),
        sa.ForeignKeyConstraint(
            ["edited_by"],
            ["user_account.id"],
            name=op.f("fk_annotation_photo_edit_edited_by_user_account"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["report_id"],
            ["inspection_report.id"],
            name=op.f("fk_annotation_photo_edit_report_id_inspection_report"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["trial_result_id"],
            ["trial_detection_result.id"],
            name=op.f("fk_annotation_photo_edit_trial_result_id_trial_detection_result"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_annotation_photo_edit")),
        sa.UniqueConstraint(
            "report_id",
            "photo_key",
            name="uq_annotation_photo_edit_report_photo",
        ),
        sa.UniqueConstraint(
            "trial_result_id",
            "photo_key",
            name="uq_annotation_photo_edit_trial_result_photo",
        ),
    )
    op.create_index(
        "idx_annotation_photo_edit_report_id",
        "annotation_photo_edit",
        ["report_id"],
        unique=False,
    )
    op.create_index(
        "idx_annotation_photo_edit_trial_result_id",
        "annotation_photo_edit",
        ["trial_result_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_annotation_photo_edit_trial_result_id", table_name="annotation_photo_edit")
    op.drop_index("idx_annotation_photo_edit_report_id", table_name="annotation_photo_edit")
    op.drop_table("annotation_photo_edit")
