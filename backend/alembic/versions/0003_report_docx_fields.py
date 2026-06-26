"""Rename report file fields for DOCX delivery.

Revision ID: 0003_report_docx_fields
Revises: 0002_drop_facade_orientation
Create Date: 2026-06-26
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0003_report_docx_fields"
down_revision: str | None = "0002_drop_facade_orientation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'inspection_report' AND column_name = 'pdf_bucket'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'inspection_report' AND column_name = 'docx_bucket'
            ) THEN
                ALTER TABLE inspection_report RENAME COLUMN pdf_bucket TO docx_bucket;
            END IF;

            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'inspection_report' AND column_name = 'pdf_object_key'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'inspection_report' AND column_name = 'docx_object_key'
            ) THEN
                ALTER TABLE inspection_report RENAME COLUMN pdf_object_key TO docx_object_key;
            END IF;
        END $$
        """
    )
    op.execute("ALTER TABLE inspection_report ADD COLUMN IF NOT EXISTS docx_bucket VARCHAR(64)")
    op.execute("ALTER TABLE inspection_report ADD COLUMN IF NOT EXISTS docx_object_key VARCHAR(512)")
    op.execute("ALTER TABLE inspection_report DROP COLUMN IF EXISTS pdf_bucket")
    op.execute("ALTER TABLE inspection_report DROP COLUMN IF EXISTS pdf_object_key")


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'inspection_report' AND column_name = 'docx_bucket'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'inspection_report' AND column_name = 'pdf_bucket'
            ) THEN
                ALTER TABLE inspection_report RENAME COLUMN docx_bucket TO pdf_bucket;
            END IF;

            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'inspection_report' AND column_name = 'docx_object_key'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'inspection_report' AND column_name = 'pdf_object_key'
            ) THEN
                ALTER TABLE inspection_report RENAME COLUMN docx_object_key TO pdf_object_key;
            END IF;
        END $$
        """
    )
    op.execute("ALTER TABLE inspection_report ADD COLUMN IF NOT EXISTS pdf_bucket VARCHAR(64)")
    op.execute("ALTER TABLE inspection_report ADD COLUMN IF NOT EXISTS pdf_object_key VARCHAR(512)")
    op.execute("ALTER TABLE inspection_report DROP COLUMN IF EXISTS docx_bucket")
    op.execute("ALTER TABLE inspection_report DROP COLUMN IF EXISTS docx_object_key")
