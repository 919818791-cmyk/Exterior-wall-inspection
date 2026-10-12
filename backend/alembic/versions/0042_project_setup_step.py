"""Persist the furthest completed project setup step.

Revision ID: 0042_project_setup_step
Revises: 0041_project_facade_type
Create Date: 2026-08-26
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0042_project_setup_step"
down_revision: str | None = "0041_project_facade_type"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "project",
        sa.Column("setup_step", sa.SmallInteger(), server_default="3", nullable=False),
    )
    op.execute(
        "UPDATE project SET setup_step = 2 WHERE setup_completed_at IS NULL"
    )
    op.create_check_constraint(
        "project_setup_step",
        "project",
        "setup_step IN (2, 3)",
    )


def downgrade() -> None:
    op.drop_constraint("project_setup_step", "project", type_="check")
    op.drop_column("project", "setup_step")
