"""Add the persisted queue state for formal detection projects.

Revision ID: 0036_add_project_queued_status
Revises: 0035_formal_photo_pose_metadata
Create Date: 2026-08-07
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op


revision: str = "0036_add_project_queued_status"
down_revision: str | None = "0035_formal_photo_pose_metadata"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


PROJECT_STATUSES = (
    "draft",
    "queued",
    "detecting",
    "pending_review",
    "reviewed",
    "completed",
)


def _replace_project_status_constraint(statuses: tuple[str, ...]) -> None:
    values = ", ".join(f"'{value}'" for value in statuses)
    op.execute(
        """
        ALTER TABLE project DROP CONSTRAINT IF EXISTS ck_project_status
        """
    )
    op.execute(
        f"ALTER TABLE project ADD CONSTRAINT ck_project_status "
        f"CHECK (status IN ({values}))"
    )


def upgrade() -> None:
    _replace_project_status_constraint(PROJECT_STATUSES)


def downgrade() -> None:
    _replace_project_status_constraint(
        tuple(value for value in PROJECT_STATUSES if value != "queued")
    )
