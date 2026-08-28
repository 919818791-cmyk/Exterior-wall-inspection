"""Add project setup fields for the three-step creation wizard.

Revision ID: 0040_project_creation_wizard
Revises: 0039_photo_projection_pose
Create Date: 2026-08-25
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.enums.status import DroneType

revision: str = "0040_project_creation_wizard"
down_revision: str | None = "0039_photo_projection_pose"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _drone_type_check_sql() -> str:
    values = ", ".join(f"'{item.value}'" for item in DroneType)
    return f"drone_type IN ({values})"


def upgrade() -> None:
    op.add_column("project", sa.Column("drone_type", sa.String(length=64), nullable=True))
    op.add_column("project", sa.Column("description", sa.Text(), nullable=True))
    op.add_column(
        "project",
        sa.Column("setup_completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_check_constraint(
        "project_drone_type",
        "project",
        _drone_type_check_sql(),
    )
    op.execute(
        "UPDATE project SET setup_completed_at = created_at "
        "WHERE setup_completed_at IS NULL"
    )


def downgrade() -> None:
    op.drop_constraint("project_drone_type", "project", type_="check")
    op.drop_column("project", "setup_completed_at")
    op.drop_column("project", "description")
    op.drop_column("project", "drone_type")
