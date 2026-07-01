"""Create trial detection result archive.

Revision ID: 0007_trial_detection_result
Revises: 0006_restore_project_coordinates
Create Date: 2026-06-30
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007_trial_detection_result"
down_revision: str | None = "0006_restore_project_coordinates"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

REPORT_STATUSES = ("draft", "generated", "pushed", "revoked")


def uuid_column(name: str, nullable: bool = False) -> sa.Column:
    return sa.Column(name, postgresql.UUID(as_uuid=True), nullable=nullable)


def timestamp_column(name: str) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False)


def check_values(column_name: str, values: Sequence[str], name: str) -> sa.CheckConstraint:
    value_sql = ", ".join(f"'{value}'" for value in values)
    return sa.CheckConstraint(f"{column_name} IN ({value_sql})", name=op.f(name))


def upgrade() -> None:
    op.create_table(
        "trial_detection_result",
        uuid_column("id"),
        sa.Column("result_no", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=32), server_default=sa.text("'generated'"), nullable=False),
        sa.Column("report_data_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("photo_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("finding_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        uuid_column("generated_by"),
        sa.Column("generated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        timestamp_column("created_at"),
        timestamp_column("updated_at"),
        sa.ForeignKeyConstraint(
            ["generated_by"],
            ["user_account.id"],
            name=op.f("fk_trial_detection_result_generated_by_user_account"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_trial_detection_result")),
        sa.UniqueConstraint("result_no", name=op.f("uq_trial_detection_result_result_no")),
        check_values("status", REPORT_STATUSES, "ck_trial_detection_result_status"),
    )
    op.create_index("idx_trial_result_generated_by", "trial_detection_result", ["generated_by"])
    op.create_index("idx_trial_result_generated_at", "trial_detection_result", ["generated_at"])
    op.create_index("idx_trial_result_status", "trial_detection_result", ["status"])


def downgrade() -> None:
    op.drop_table("trial_detection_result")
