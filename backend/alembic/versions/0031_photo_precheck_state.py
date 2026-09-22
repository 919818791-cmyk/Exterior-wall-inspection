"""Persist photo precheck state after originals are stored.

Revision ID: 0031_photo_precheck
Revises: 0030_trial_number_title
Create Date: 2026-07-31
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0031_photo_precheck"
down_revision: str | None = "0030_trial_number_title"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PRECHECK_VALUES = "'pending', 'running', 'passed', 'rejected', 'error'"


def _add_precheck_columns(table_name: str) -> None:
    op.add_column(
        table_name,
        sa.Column(
            "precheck_status",
            sa.String(length=32),
            nullable=False,
            server_default="pending",
        ),
    )
    op.add_column(table_name, sa.Column("precheck_category", sa.String(length=32), nullable=True))
    op.add_column(table_name, sa.Column("precheck_reason", sa.String(length=255), nullable=True))
    op.add_column(table_name, sa.Column("precheck_model", sa.String(length=128), nullable=True))
    op.add_column(table_name, sa.Column("precheck_error", sa.Text(), nullable=True))
    op.add_column(
        table_name,
        sa.Column(
            "precheck_attempts",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(table_name, sa.Column("prechecked_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        table_name,
        sa.Column(
            "precheck_reviewed_by",
            sa.UUID(),
            sa.ForeignKey("user_account.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        table_name,
        sa.Column("precheck_reviewed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_check_constraint(
        "precheck_status",
        table_name,
        f"precheck_status IN ({PRECHECK_VALUES})",
    )


def upgrade() -> None:
    _add_precheck_columns("photo")
    _add_precheck_columns("quick_detection_photo")
    op.create_index("idx_photo_precheck_status", "photo", ["precheck_status"])
    op.create_index(
        "idx_quick_detection_photo_precheck_status",
        "quick_detection_photo",
        ["precheck_status"],
    )


def _drop_precheck_columns(table_name: str) -> None:
    op.drop_constraint("precheck_status", table_name, type_="check")
    op.drop_column(table_name, "precheck_reviewed_at")
    op.drop_column(table_name, "precheck_reviewed_by")
    op.drop_column(table_name, "prechecked_at")
    op.drop_column(table_name, "precheck_attempts")
    op.drop_column(table_name, "precheck_error")
    op.drop_column(table_name, "precheck_model")
    op.drop_column(table_name, "precheck_reason")
    op.drop_column(table_name, "precheck_category")
    op.drop_column(table_name, "precheck_status")


def downgrade() -> None:
    op.drop_index("idx_quick_detection_photo_precheck_status", table_name="quick_detection_photo")
    op.drop_index("idx_photo_precheck_status", table_name="photo")
    _drop_precheck_columns("quick_detection_photo")
    _drop_precheck_columns("photo")
