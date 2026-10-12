"""Remove manual photo precheck review fields.

Revision ID: 0032_no_manual_precheck
Revises: 0031_photo_precheck
Create Date: 2026-07-31
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0032_no_manual_precheck"
down_revision: str | None = "0031_photo_precheck"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE quick_detection_photo
            SET metadata_json = jsonb_set(
                metadata_json,
                '{photo_precheck}',
                (metadata_json -> 'photo_precheck') - 'reviewed_by' - 'reviewed_at'
            )
            WHERE metadata_json ? 'photo_precheck'
            """
        )
    )
    for table_name in ("photo", "quick_detection_photo"):
        op.drop_column(table_name, "precheck_reviewed_at")
        op.drop_column(table_name, "precheck_reviewed_by")


def downgrade() -> None:
    for table_name in ("photo", "quick_detection_photo"):
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
            sa.Column(
                "precheck_reviewed_at",
                sa.DateTime(timezone=True),
                nullable=True,
            ),
        )
