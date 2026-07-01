"""Restore project coordinate fields.

Revision ID: 0006_restore_project_coordinates
Revises: 0005_remove_project_coordinates
Create Date: 2026-06-29
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_restore_project_coordinates"
down_revision: str | None = "0005_remove_project_coordinates"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("project", sa.Column("longitude", sa.Numeric(10, 7), nullable=True))
    op.add_column("project", sa.Column("latitude", sa.Numeric(10, 7), nullable=True))


def downgrade() -> None:
    op.drop_column("project", "latitude")
    op.drop_column("project", "longitude")
