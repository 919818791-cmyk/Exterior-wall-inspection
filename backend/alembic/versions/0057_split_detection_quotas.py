"""Split account quotas for quick trials and formal detection, defaulting to 1000.

Revision ID: 0057_split_detection_quotas
Revises: 0056_remove_account_plans
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0057_split_detection_quotas"
down_revision: str | None = "0056_remove_account_plans"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for field in ("trial_detection_quota", "formal_detection_quota"):
        op.add_column("user_account", sa.Column(field, sa.Integer(), nullable=True, server_default="1000"))
        op.create_check_constraint(field, "user_account", f"{field} IS NULL OR {field} BETWEEN 1 AND 100000")
    # Preserve any explicit legacy account quota in both independent balances.
    op.execute(
        "UPDATE user_account SET trial_detection_quota = COALESCE(detection_quota, 1000), "
        "formal_detection_quota = COALESCE(detection_quota, 1000)"
    )
    op.drop_constraint("detection_quota", "user_account", type_="check")
    op.drop_column("user_account", "detection_quota")
    for key in ("trial_photo_detection_limit", "formal_photo_detection_limit"):
        op.execute(
            sa.text(
                "INSERT INTO system_setting (key, value, created_at, updated_at) "
                "VALUES (:key, '1000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) "
                "ON CONFLICT (key) DO UPDATE SET value = '1000', updated_at = CURRENT_TIMESTAMP"
            ).bindparams(key=key)
        )


def downgrade() -> None:
    op.add_column("user_account", sa.Column("detection_quota", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "detection_quota", "user_account", "detection_quota IS NULL OR detection_quota BETWEEN 1 AND 100000",
    )
    # The single legacy field can only retain one limit; prefer the formal quota.
    op.execute("UPDATE user_account SET detection_quota = COALESCE(formal_detection_quota, trial_detection_quota)")
    for field in ("trial_detection_quota", "formal_detection_quota"):
        op.drop_constraint(field, "user_account", type_="check")
        op.drop_column("user_account", field)
