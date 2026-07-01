"""Remove the failed state from the project lifecycle.

Revision ID: 0004_remove_failed_status
Revises: 0003_report_docx_fields
Create Date: 2026-06-26
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0004_remove_failed_status"
down_revision: str | None = "0003_report_docx_fields"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PROJECT_STATUSES = ("draft", "detecting", "pending_review", "reviewed", "completed")


def _replace_project_status_constraint(statuses: tuple[str, ...]) -> None:
    values = ", ".join(f"'{status}'" for status in statuses)
    op.execute(
        """
        DO $$
        DECLARE
            constraint_name text;
        BEGIN
            SELECT c.conname INTO constraint_name
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE t.relname = 'project'
              AND n.nspname = current_schema()
              AND c.contype = 'c'
              AND pg_get_constraintdef(c.oid) LIKE '%status%';

            IF constraint_name IS NOT NULL THEN
                EXECUTE format('ALTER TABLE project DROP CONSTRAINT %I', constraint_name);
            END IF;
        END $$;
        """
    )
    op.execute(f"ALTER TABLE project ADD CONSTRAINT ck_project_status CHECK (status IN ({values}))")


def upgrade() -> None:
    op.execute("UPDATE project SET status = 'draft' WHERE status = 'failed'")
    _replace_project_status_constraint(PROJECT_STATUSES)


def downgrade() -> None:
    _replace_project_status_constraint((*PROJECT_STATUSES, "failed"))
