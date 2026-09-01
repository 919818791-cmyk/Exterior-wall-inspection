"""Index account usage events by actor and occurrence time.

Revision ID: 0019_usage_actor_time
Revises: 0018_setting_text
Create Date: 2026-07-15
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0019_usage_actor_time"
down_revision: str | None = "0018_setting_text"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "idx_usage_event_actor_occurred_at",
        "usage_event",
        ["actor_id", "occurred_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_usage_event_actor_occurred_at", table_name="usage_event")
