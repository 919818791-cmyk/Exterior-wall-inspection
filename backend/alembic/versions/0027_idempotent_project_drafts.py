"""Add idempotency keys for automatically created project drafts.

Revision ID: 0027_idempotent_drafts
Revises: 0026_building_detection_runs
Create Date: 2026-07-28
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0027_idempotent_drafts"
down_revision: str | None = "0026_building_detection_runs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "project",
        sa.Column("client_draft_key", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "uq_project_created_by_client_draft_key",
        "project",
        ["created_by", "client_draft_key"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "uq_project_created_by_client_draft_key",
        table_name="project",
    )
    op.drop_column("project", "client_draft_key")
