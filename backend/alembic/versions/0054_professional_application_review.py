"""Add professional plan application review fields.

Revision ID: 0054_professional_review
Revises: 0053_model_overview_image
Create Date: 2026-09-22
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0054_professional_review"
down_revision: str | None = "0053_model_overview_image"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_account",
        sa.Column("professional_application_status", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "user_account",
        sa.Column("professional_application_requested_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "user_account",
        sa.Column("professional_application_reviewed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "user_account",
        sa.Column("professional_application_duration_months", sa.SmallInteger(), nullable=True),
    )
    op.add_column(
        "user_account",
        sa.Column("professional_plan_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_check_constraint(
        "professional_application_status",
        "user_account",
        "professional_application_status IN ('pending', 'approved', 'rejected')",
    )
    op.create_check_constraint(
        "professional_application_duration_months",
        "user_account",
        "professional_application_duration_months IS NULL OR "
        "professional_application_duration_months IN (6, 12)",
    )


def downgrade() -> None:
    op.drop_constraint(
        "professional_application_duration_months",
        "user_account",
        type_="check",
    )
    op.drop_constraint(
        "professional_application_status",
        "user_account",
        type_="check",
    )
    op.drop_column("user_account", "professional_plan_expires_at")
    op.drop_column("user_account", "professional_application_duration_months")
    op.drop_column("user_account", "professional_application_reviewed_at")
    op.drop_column("user_account", "professional_application_requested_at")
    op.drop_column("user_account", "professional_application_status")
