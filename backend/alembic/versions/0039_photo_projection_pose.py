"""Store the camera pose needed to project detections onto a geographic model.

Revision ID: 0039_photo_projection_pose
Revises: 0038_building_model
Create Date: 2026-08-24
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0039_photo_projection_pose"
down_revision: str | None = "0038_building_model"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("photo", sa.Column("absolute_altitude", sa.Numeric(10, 3), nullable=True))
    op.add_column("photo", sa.Column("gimbal_pitch_degree", sa.Numeric(8, 3), nullable=True))
    op.add_column("photo", sa.Column("gimbal_roll_degree", sa.Numeric(8, 3), nullable=True))
    op.add_column("photo", sa.Column("calibrated_focal_length", sa.Numeric(12, 4), nullable=True))


def downgrade() -> None:
    op.drop_column("photo", "calibrated_focal_length")
    op.drop_column("photo", "gimbal_roll_degree")
    op.drop_column("photo", "gimbal_pitch_degree")
    op.drop_column("photo", "absolute_altitude")
