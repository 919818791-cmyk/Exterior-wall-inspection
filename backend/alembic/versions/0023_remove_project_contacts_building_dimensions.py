"""Remove project contacts and building dimensions.

Revision ID: 0023_remove_contact_dimensions
Revises: 0022_trial_soft_delete
Create Date: 2026-07-24
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0023_remove_contact_dimensions"
down_revision: str | None = "0022_trial_soft_delete"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Formal reports contain a JSON snapshot of project/building data. Scrub the
    # removed values there before dropping their source columns.
    op.execute(
        sa.text(
            """
            UPDATE inspection_report
            SET report_data_json = jsonb_set(
                report_data_json
                    #- '{project,contact_name}'
                    #- '{project,contact_phone}',
                '{buildings}',
                COALESCE(
                    (
                        SELECT jsonb_agg(building_item - 'floors' - 'height')
                        FROM jsonb_array_elements(
                            CASE
                                WHEN jsonb_typeof(report_data_json -> 'buildings') = 'array'
                                THEN report_data_json -> 'buildings'
                                ELSE '[]'::jsonb
                            END
                        ) AS building_item
                    ),
                    '[]'::jsonb
                ),
                true
            )
            WHERE report_data_json IS NOT NULL
              AND jsonb_typeof(report_data_json) = 'object'
            """
        )
    )

    op.drop_column("project", "contact_name")
    op.drop_column("project", "contact_phone")
    op.drop_column("building", "floors")
    op.drop_column("building", "height")


def downgrade() -> None:
    # Column values and scrubbed report snapshots cannot be restored.
    op.add_column("project", sa.Column("contact_name", sa.String(length=64), nullable=True))
    op.add_column("project", sa.Column("contact_phone", sa.String(length=32), nullable=True))
    op.add_column("building", sa.Column("floors", sa.Integer(), nullable=True))
    op.add_column("building", sa.Column("height", sa.Numeric(8, 2), nullable=True))
