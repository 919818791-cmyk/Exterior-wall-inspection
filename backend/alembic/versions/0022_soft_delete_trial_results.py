"""Add recoverable deletion to trial detection results.

Revision ID: 0022_trial_soft_delete
Revises: 0021_qwen3_vl_flash
Create Date: 2026-07-24
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0022_trial_soft_delete"
down_revision: str | None = "0021_qwen3_vl_flash"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "trial_detection_result",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "idx_trial_result_deleted_at",
        "trial_detection_result",
        ["deleted_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_trial_result_deleted_at", table_name="trial_detection_result")
    op.drop_column("trial_detection_result", "deleted_at")
