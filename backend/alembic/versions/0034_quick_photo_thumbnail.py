"""Add thumbnails for quick-detection photos.

Revision ID: 0034_quick_photo_thumbnail
Revises: 0033_single_project_detection
Create Date: 2026-08-04
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0034_quick_photo_thumbnail"
down_revision: str | None = "0033_single_project_detection"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "quick_detection_photo",
        sa.Column("thumbnail_object_key", sa.String(length=512), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("quick_detection_photo", "thumbnail_object_key")
