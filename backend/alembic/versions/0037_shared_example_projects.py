"""Mark the existing professional and trial examples as shared read-only data.

Revision ID: 0037_shared_example_projects
Revises: 0036_add_project_queued_status
Create Date: 2026-08-24
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0037_shared_example_projects"
down_revision: str | None = "0036_add_project_queued_status"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "project",
        sa.Column("is_example", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column(
        "trial_detection_result",
        sa.Column("is_example", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.create_index("idx_project_is_example", "project", ["is_example"])
    op.create_index(
        "idx_trial_result_is_example",
        "trial_detection_result",
        ["is_example"],
    )

    # These are the complete, curated examples already present in the project.
    # Keep their data and object-storage references intact while making the
    # designation explicit and normalizing the user-facing name.
    op.execute(
        """
        UPDATE project
        SET is_example = TRUE,
            name = '示例项目'
        WHERE name = '示例项目（专业）'
        """
    )
    op.execute(
        """
        UPDATE inspection_report
        SET title = '示例项目',
            report_data_json = jsonb_set(
                COALESCE(report_data_json, '{}'::jsonb),
                '{project,name}',
                to_jsonb('示例项目'::text),
                TRUE
            )
        WHERE project_id IN (SELECT id FROM project WHERE is_example = TRUE)
        """
    )
    op.execute(
        """
        UPDATE trial_detection_result
        SET is_example = TRUE,
            title = '示例项目',
            report_data_json = jsonb_set(
                COALESCE(report_data_json, '{}'::jsonb),
                '{project,name}',
                to_jsonb('示例项目'::text),
                TRUE
            )
        WHERE title = '示例项目（免费）'
        """
    )


def downgrade() -> None:
    op.drop_index("idx_trial_result_is_example", table_name="trial_detection_result")
    op.drop_index("idx_project_is_example", table_name="project")
    op.drop_column("trial_detection_result", "is_example")
    op.drop_column("project", "is_example")
