"""Require unique phone numbers for phone-based login.

Revision ID: 0020_unique_user_phone
Revises: 0019_usage_actor_time
Create Date: 2026-07-16
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0020_unique_user_phone"
down_revision: str | None = "0019_usage_actor_time"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("UPDATE user_account SET phone = NULLIF(BTRIM(phone), '') WHERE phone IS NOT NULL")
    op.create_index("uq_user_account_phone", "user_account", ["phone"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_user_account_phone", table_name="user_account")
