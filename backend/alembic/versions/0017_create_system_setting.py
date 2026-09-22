"""Create persistent administrator-managed system settings.

Revision ID: 0017_system_setting
Revises: 0016_annotation_photo_edit
Create Date: 2026-07-14
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0017_system_setting"
down_revision: str | None = "0016_annotation_photo_edit"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "system_setting",
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("value", sa.String(length=255), nullable=False),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["user_account.id"],
            name=op.f("fk_system_setting_updated_by_user_account"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_system_setting")),
    )
    op.execute(
        sa.text(
            "INSERT INTO system_setting (key, value, created_at, updated_at) "
            "VALUES ('trial_inference_provider', 'qwen', now(), now())"
        )
    )


def downgrade() -> None:
    op.drop_table("system_setting")
