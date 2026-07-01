"""Remove confidence from trial result archive data.

Revision ID: 0011_remove_trial_confidence
Revises: 0010_trial_thermal_metadata
Create Date: 2026-07-01
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0011_remove_trial_confidence"
down_revision: str | None = "0010_trial_thermal_metadata"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE trial_detection_result
        SET report_data_json = jsonb_set(
            report_data_json,
            '{defects}',
            (
                SELECT COALESCE(jsonb_agg(defect - 'confidence'), '[]'::jsonb)
                FROM jsonb_array_elements(report_data_json -> 'defects') AS defect
            ),
            true
        )
        WHERE report_data_json ? 'defects';
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE trial_detection_result
        SET report_data_json = jsonb_set(
            report_data_json,
            '{defects}',
            (
                SELECT COALESCE(jsonb_agg(defect || '{"confidence": null}'::jsonb), '[]'::jsonb)
                FROM jsonb_array_elements(report_data_json -> 'defects') AS defect
            ),
            true
        )
        WHERE report_data_json ? 'defects';
        """
    )
