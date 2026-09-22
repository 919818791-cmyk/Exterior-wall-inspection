"""Store embedded camera metadata used for approximate defect measurements.

Revision ID: 0043_photo_measurement_metadata
Revises: 0042_project_setup_step
Create Date: 2026-08-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0043_photo_measurement_metadata"
down_revision: str | None = "0042_project_setup_step"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("photo", sa.Column("camera_make", sa.String(length=64), nullable=True))
    op.add_column("photo", sa.Column("camera_model", sa.String(length=128), nullable=True))
    op.add_column("photo", sa.Column("camera_product_name", sa.String(length=128), nullable=True))
    op.add_column("photo", sa.Column("drone_model", sa.String(length=128), nullable=True))
    op.add_column("photo", sa.Column("camera_image_source", sa.String(length=64), nullable=True))
    op.add_column("photo", sa.Column("focal_length_mm", sa.Numeric(10, 4), nullable=True))
    op.add_column("photo", sa.Column("focal_length_35mm", sa.Numeric(10, 4), nullable=True))
    op.add_column("photo", sa.Column("lrf_target_distance", sa.Numeric(12, 3), nullable=True))


def downgrade() -> None:
    op.drop_column("photo", "lrf_target_distance")
    op.drop_column("photo", "focal_length_35mm")
    op.drop_column("photo", "focal_length_mm")
    op.drop_column("photo", "camera_image_source")
    op.drop_column("photo", "drone_model")
    op.drop_column("photo", "camera_product_name")
    op.drop_column("photo", "camera_model")
    op.drop_column("photo", "camera_make")
