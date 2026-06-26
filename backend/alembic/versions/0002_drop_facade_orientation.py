"""Drop legacy facade orientation column.

Revision ID: 0002_drop_facade_orientation
Revises: 0001_initial_business_schema
Create Date: 2026-06-25
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0002_drop_facade_orientation"
down_revision: str | None = "0001_initial_business_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE facade DROP COLUMN IF EXISTS orientation")


def downgrade() -> None:
    op.execute("ALTER TABLE facade ADD COLUMN IF NOT EXISTS orientation VARCHAR(32)")
