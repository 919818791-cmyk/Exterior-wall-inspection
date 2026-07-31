"""Make high-precision detection the only project detection mode.

Revision ID: 0024_high_precision_only
Revises: 0023_remove_contact_dimensions
Create Date: 2026-07-24
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0024_high_precision_only"
down_revision: str | None = "0023_remove_contact_dimensions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(sa.text("UPDATE detection_config SET high_precision = true"))
    op.alter_column(
        "detection_config",
        "high_precision",
        existing_type=sa.Boolean(),
        existing_nullable=False,
        server_default=sa.true(),
    )


def downgrade() -> None:
    # Configurations converted during upgrade cannot be distinguished from
    # configurations that were already high precision.
    op.alter_column(
        "detection_config",
        "high_precision",
        existing_type=sa.Boolean(),
        existing_nullable=False,
        server_default=sa.false(),
    )
