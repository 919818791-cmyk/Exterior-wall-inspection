"""Remove unused project coordinate fields.

Revision ID: 0005_remove_project_coordinates
Revises: 0004_remove_failed_status
Create Date: 2026-06-26
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005_remove_project_coordinates"
down_revision: str | None = "0004_remove_failed_status"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("project", "longitude")
    op.drop_column("project", "latitude")


def downgrade() -> None:
    op.add_column("project", sa.Column("longitude", sa.Numeric(10, 7), nullable=True))
    op.add_column("project", sa.Column("latitude", sa.Numeric(10, 7), nullable=True))
