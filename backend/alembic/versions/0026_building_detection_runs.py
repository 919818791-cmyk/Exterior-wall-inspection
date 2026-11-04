"""Group formal detection results by building and support hollow defects.

Revision ID: 0026_building_detection_runs
Revises: 0025_remove_facade_dimension
Create Date: 2026-07-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0026_building_detection_runs"
down_revision: str | None = "0025_remove_facade_dimension"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DEFECT_TYPES = ("crack", "spalling", "moisture", "hollow")
LEGACY_DEFECT_TYPES = ("crack", "spalling", "moisture")


def _check_sql(values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"defect_type IN ({quoted})"


def _replace_defect_constraints(values: tuple[str, ...]) -> None:
    for table_name in ("ai_detection_result", "review_result"):
        constraint_name = op.f(f"ck_{table_name}_defect_type")
        op.drop_constraint(constraint_name, table_name, type_="check")
        op.create_check_constraint(constraint_name, table_name, _check_sql(values))


def upgrade() -> None:
    op.add_column(
        "detection_task",
        sa.Column("building_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "detection_task",
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_detection_task_building_id_building",
        "detection_task",
        "building",
        ["building_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "idx_detection_task_building_id",
        "detection_task",
        ["building_id"],
    )
    op.create_index("idx_detection_task_run_id", "detection_task", ["run_id"])
    _replace_defect_constraints(DEFECT_TYPES)


def downgrade() -> None:
    for table_name in ("ai_detection_result", "review_result"):
        op.execute(
            sa.text(
                f"""
                DELETE FROM {table_name}
                WHERE defect_type = 'hollow'
                """
            )
        )
    _replace_defect_constraints(LEGACY_DEFECT_TYPES)
    op.drop_index("idx_detection_task_run_id", table_name="detection_task")
    op.drop_index("idx_detection_task_building_id", table_name="detection_task")
    op.drop_constraint(
        "fk_detection_task_building_id_building",
        "detection_task",
        type_="foreignkey",
    )
    op.drop_column("detection_task", "run_id")
    op.drop_column("detection_task", "building_id")
