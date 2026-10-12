"""Shorten trial result numbers to a daily three-digit sequence.

Revision ID: 0029_short_trial_numbers
Revises: 0028_short_project_numbers
Create Date: 2026-07-29
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0029_short_trial_numbers"
down_revision: str | None = "0028_short_project_numbers"
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
                    FROM trial_detection_result
                    GROUP BY (
                        created_at AT TIME ZONE 'Asia/Shanghai'
                    )::date
                    HAVING count(*) > 999
                ) THEN
                    RAISE EXCEPTION
                        'Cannot shorten trial result numbers: more than 999 results exist on one date.';
                END IF;
            END
            $migration$;
            """
        )
    )
    op.execute(
        sa.text(
            """
            CREATE TEMPORARY TABLE trial_number_migration
            ON COMMIT DROP
            AS
            SELECT
                id,
                result_no AS old_result_no,
                (
                    'TRY-' ||
                    to_char(
                        created_at AT TIME ZONE 'Asia/Shanghai',
                        'YYYYMMDD'
                    ) ||
                    '-' ||
                    lpad(
                        row_number() OVER (
                            PARTITION BY (
                                created_at AT TIME ZONE 'Asia/Shanghai'
                            )::date
                            ORDER BY created_at, id
                        )::text,
                        3,
                        '0'
                    )
                ) AS new_result_no
            FROM trial_detection_result
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE trial_detection_result
            SET result_no = 'TMP-' || replace(id::text, '-', '')
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE trial_detection_result AS result
            SET
                result_no = migration.new_result_no,
                report_data_json = jsonb_set(
                    jsonb_set(
                        result.report_data_json,
                        '{project,project_no}',
                        to_jsonb(migration.new_result_no),
                        true
                    ),
                    '{detection_task,task_no}',
                    to_jsonb(migration.new_result_no),
                    true
                )
            FROM trial_number_migration AS migration
            WHERE result.id = migration.id
            """
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            CREATE TEMPORARY TABLE trial_number_downgrade
            ON COMMIT DROP
            AS
            SELECT
                id,
                (
                    'TRY-' ||
                    to_char(
                        created_at AT TIME ZONE 'UTC',
                        'YYYYMMDDHH24MISSUS'
                    ) ||
                    '-' ||
                    upper(
                        substring(
                            replace(id::text, '-', '')
                            FROM 1 FOR 6
                        )
                    )
                ) AS legacy_result_no
            FROM trial_detection_result
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE trial_detection_result
            SET result_no = 'TMP-' || replace(id::text, '-', '')
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE trial_detection_result AS result
            SET
                result_no = migration.legacy_result_no,
                report_data_json = jsonb_set(
                    jsonb_set(
                        result.report_data_json,
                        '{project,project_no}',
                        to_jsonb(migration.legacy_result_no),
                        true
                    ),
                    '{detection_task,task_no}',
                    to_jsonb(migration.legacy_result_no),
                    true
                )
            FROM trial_number_downgrade AS migration
            WHERE result.id = migration.id
            """
        )
    )
