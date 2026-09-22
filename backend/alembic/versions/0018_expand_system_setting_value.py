"""Allow prompts and encrypted secrets in system settings.

Revision ID: 0018_setting_text
Revises: 0017_system_setting
Create Date: 2026-07-14
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0018_setting_text"
down_revision: str | None = "0017_system_setting"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("system_setting", "value", existing_type=sa.String(length=255), type_=sa.Text())


def downgrade() -> None:
    op.alter_column("system_setting", "value", existing_type=sa.Text(), type_=sa.String(length=255))
