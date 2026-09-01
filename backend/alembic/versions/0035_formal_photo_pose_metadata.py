"""Add DJI pose metadata to formal project photos.

Revision ID: 0035_formal_photo_pose_metadata
Revises: 0034_quick_photo_thumbnail
Create Date: 2026-08-04
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0035_formal_photo_pose_metadata"
down_revision: str | None = "0034_quick_photo_thumbnail"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "photo",
        sa.Column("relative_altitude", sa.Numeric(precision=10, scale=3), nullable=True),
    )
    op.add_column(
        "photo",
        sa.Column("gimbal_yaw_degree", sa.Numeric(precision=8, scale=3), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("photo", "gimbal_yaw_degree")
    op.drop_column("photo", "relative_altitude")
