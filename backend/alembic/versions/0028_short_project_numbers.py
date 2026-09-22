"""Shorten project numbers to a daily three-digit sequence.

Revision ID: 0028_short_project_numbers
Revises: 0027_idempotent_drafts
Create Date: 2026-07-29
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0028_short_project_numbers"
down_revision: str | None = "0027_idempotent_drafts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            DO $migration$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM project
                    GROUP BY (
                        created_at AT TIME ZONE 'Asia/Shanghai'
                    )::date
                    HAVING count(*) > 999
                ) THEN
                    RAISE EXCEPTION
                        'Cannot shorten project numbers: more than 999 projects exist on one date.';
                END IF;
            END
            $migration$;
            """
        )
    )
    op.execute(
        sa.text(
            """
            CREATE TEMPORARY TABLE project_number_migration
            ON COMMIT DROP
            AS
            SELECT
                id,
                row_number() OVER (
                    PARTITION BY (created_at AT TIME ZONE 'Asia/Shanghai')::date
                    ORDER BY created_at, id
                ) AS sequence_no,
                to_char(
                    created_at AT TIME ZONE 'Asia/Shanghai',
                    'YYYYMMDD'
                ) AS project_date
            FROM project
            """
        )
    )

    # Move every existing value out of the target namespace before assigning
    # the deterministic short values, preserving the unique constraint.
    op.execute(
        sa.text(
            """
            UPDATE project
            SET project_no = 'TMP-' || replace(id::text, '-', '')
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE project AS p
            SET project_no = (
                'PRJ-' || m.project_date || '-' ||
                lpad(m.sequence_no::text, 3, '0')
            )
            FROM project_number_migration AS m
            WHERE p.id = m.id
            """
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE project
            SET project_no = 'TMP-' || replace(id::text, '-', '')
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE project
            SET project_no = (
                'PRJ-' ||
                to_char(created_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS') ||
                '-' ||
                upper(substring(replace(id::text, '-', '') FROM 1 FOR 6))
            )
            """
        )
    )
