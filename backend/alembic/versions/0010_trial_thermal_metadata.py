"""Add trial thermal metadata count.

Revision ID: 0010_trial_thermal_metadata
Revises: 0009_trial_no_docx
Create Date: 2026-06-30
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010_trial_thermal_metadata"
down_revision: str | None = "0009_trial_no_docx"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "trial_detection_result",
        sa.Column(
            "thermal_available_photo_count",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("trial_detection_result", "thermal_available_photo_count")
