"""Remove DOCX fields from trial detection results.

Revision ID: 0009_trial_no_docx
Revises: 0008_remove_user_account_email
Create Date: 2026-06-30
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0009_trial_no_docx"
down_revision: str | None = "0008_remove_user_account_email"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE trial_detection_result DROP COLUMN IF EXISTS docx_bucket")
    op.execute("ALTER TABLE trial_detection_result DROP COLUMN IF EXISTS docx_object_key")


def downgrade() -> None:
    op.execute("ALTER TABLE trial_detection_result ADD COLUMN IF NOT EXISTS docx_bucket VARCHAR(64)")
    op.execute("ALTER TABLE trial_detection_result ADD COLUMN IF NOT EXISTS docx_object_key VARCHAR(512)")
