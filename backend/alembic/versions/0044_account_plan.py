"""Add the customer account plan.

Revision ID: 0044_account_plan
Revises: 0043_photo_measurement_metadata
Create Date: 2026-09-15
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0044_account_plan"
down_revision: str | None = "0043_photo_measurement_metadata"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_account",
        sa.Column(
            "account_plan",
            sa.String(length=32),
            server_default="basic",
            nullable=False,
        ),
    )
    op.create_check_constraint(
        "account_plan",
        "user_account",
        "account_plan IN ('basic', 'professional')",
    )


def downgrade() -> None:
    op.drop_constraint("account_plan", "user_account", type_="check")
    op.drop_column("user_account", "account_plan")
