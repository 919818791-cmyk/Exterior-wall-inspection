"""Remove email from user accounts.

Revision ID: 0008_remove_user_account_email
Revises: 0007_trial_detection_result
Create Date: 2026-06-30
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008_remove_user_account_email"
down_revision: str | None = "0007_trial_detection_result"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("user_account", "email")


def downgrade() -> None:
    op.add_column("user_account", sa.Column("email", sa.String(length=128), nullable=True))
