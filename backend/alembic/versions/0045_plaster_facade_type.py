"""Add plaster as a selectable facade type.

Revision ID: 0045_plaster_facade_type
Revises: 0044_account_plan
Create Date: 2026-09-16
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0045_plaster_facade_type"
down_revision: str | None = "0044_account_plan"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("project_facade_type", "project", type_="check")
    op.create_check_constraint(
        "project_facade_type",
        "project",
        "facade_type IN ('tile', 'coating', 'plaster', 'stone')",
    )


def downgrade() -> None:
    op.execute("UPDATE project SET facade_type = 'coating' WHERE facade_type = 'plaster'")
    op.drop_constraint("project_facade_type", "project", type_="check")
    op.create_check_constraint(
        "project_facade_type",
        "project",
        "facade_type IN ('tile', 'coating', 'stone')",
    )
