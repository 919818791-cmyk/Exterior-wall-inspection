"""Track account quota resets without deleting usage history.

Revision ID: 0049_account_quota_reset_at
Revises: 0048_tile_detachment_type
Create Date: 2026-09-17
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0049_account_quota_reset_at"
down_revision: str | None = "0048_tile_detachment_type"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_account",
        sa.Column("quota_reset_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("user_account", "quota_reset_at")
