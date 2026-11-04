"""Remove account plans and keep independent account detection quotas.

Revision ID: 0056_remove_account_plans
Revises: 0055_account_detection_quota
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0056_remove_account_plans"
down_revision: str | None = "0055_account_detection_quota"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

QUOTA_KEYS = (
    ("trial_monthly_photo_upload_limit", "trial_photo_detection_limit"),
    ("basic_formal_monthly_photo_upload_limit", "formal_photo_detection_limit"),
)


def _rename_setting(old: str, new: str) -> None:
    op.execute(
        sa.text(
            "INSERT INTO system_setting (key, value, updated_by, created_at, updated_at) "
            "SELECT :new, value, updated_by, created_at, updated_at "
            "FROM system_setting WHERE key = :old "
            "ON CONFLICT (key) DO NOTHING"
        ).bindparams(old=old, new=new)
    )
    op.execute(sa.text("DELETE FROM system_setting WHERE key = :old").bindparams(old=old))


def upgrade() -> None:
    for old, new in QUOTA_KEYS:
        _rename_setting(old, new)
    op.execute(
        "DELETE FROM system_setting WHERE key IN "
        "('professional_monthly_photo_upload_limit', 'professional_trial_monthly_photo_upload_limit')"
    )
    for constraint in (
        "account_plan",
        "professional_application_status",
        "professional_application_duration_months",
    ):
        op.drop_constraint(constraint, "user_account", type_="check")
    for column in (
        "professional_plan_expires_at",
        "professional_application_duration_months",
        "professional_application_reviewed_at",
        "professional_application_requested_at",
        "professional_application_status",
        "account_plan",
    ):
        op.drop_column("user_account", column)


def downgrade() -> None:
    op.add_column(
        "user_account",
        sa.Column("account_plan", sa.String(32), nullable=False, server_default="basic"),
    )
    op.alter_column("user_account", "account_plan", server_default=None)
    op.add_column("user_account", sa.Column("professional_application_status", sa.String(32)))
    op.add_column("user_account", sa.Column("professional_application_requested_at", sa.DateTime(timezone=True)))
    op.add_column("user_account", sa.Column("professional_application_reviewed_at", sa.DateTime(timezone=True)))
    op.add_column("user_account", sa.Column("professional_application_duration_months", sa.SmallInteger()))
    op.add_column("user_account", sa.Column("professional_plan_expires_at", sa.DateTime(timezone=True)))
    op.create_check_constraint("account_plan", "user_account", "account_plan IN ('basic', 'professional')")
    op.create_check_constraint(
        "professional_application_status", "user_account",
        "professional_application_status IN ('pending', 'approved', 'rejected')",
    )
    op.create_check_constraint(
        "professional_application_duration_months", "user_account",
        "professional_application_duration_months IS NULL OR professional_application_duration_months IN (6, 12)",
    )
    for old, new in QUOTA_KEYS:
        _rename_setting(new, old)
