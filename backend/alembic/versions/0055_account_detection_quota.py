"""Add an optional per-account detection quota.

Revision ID: 0055_account_detection_quota
Revises: 0054_professional_review
Create Date: 2026-09-23
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0055_account_detection_quota"
down_revision: str | None = "0054_professional_review"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_account",
        sa.Column("detection_quota", sa.Integer(), nullable=True),
    )
    op.create_check_constraint(
        "detection_quota",
        "user_account",
        "detection_quota IS NULL OR detection_quota BETWEEN 1 AND 100000",
    )


def downgrade() -> None:
    op.drop_constraint("detection_quota", "user_account", type_="check")
    op.drop_column("user_account", "detection_quota")
