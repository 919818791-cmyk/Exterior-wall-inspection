"""Store the facade type selected during project creation.

Revision ID: 0041_project_facade_type
Revises: 0040_project_creation_wizard
Create Date: 2026-08-26
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.enums.status import FacadeType

revision: str = "0041_project_facade_type"
down_revision: str | None = "0040_project_creation_wizard"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _facade_type_check_sql() -> str:
    values = ", ".join(f"'{item.value}'" for item in FacadeType)
    return f"facade_type IN ({values})"


def upgrade() -> None:
    op.add_column(
        "project",
        sa.Column("facade_type", sa.String(length=32), nullable=True),
    )
    op.execute("UPDATE project SET facade_type = 'tile' WHERE facade_type IS NULL")
    op.alter_column("project", "facade_type", nullable=False)
    op.create_check_constraint(
        "project_facade_type",
        "project",
        _facade_type_check_sql(),
    )


def downgrade() -> None:
    op.drop_constraint("project_facade_type", "project", type_="check")
    op.drop_column("project", "facade_type")
