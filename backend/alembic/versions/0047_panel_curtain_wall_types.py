"""Add panel and curtain wall facade and defect types.

Revision ID: 0047_panel_curtain_wall_types
Revises: 0046_peeling_defect_type
Create Date: 2026-09-16
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0047_panel_curtain_wall_types"
down_revision: str | None = "0046_peeling_defect_type"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FACADE_TYPES = ("tile", "coating", "plaster", "panel", "curtain_wall", "stone")
LEGACY_FACADE_TYPES = ("tile", "coating", "plaster", "stone")
DEFECT_TYPES = (
    "crack",
    "spalling",
    "peeling",
    "damage",
    "detachment",
    "moisture",
    "hollow",
)
LEGACY_DEFECT_TYPES = ("crack", "spalling", "peeling", "moisture", "hollow")


def _check_sql(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({quoted})"


def _replace_defect_constraints(values: tuple[str, ...]) -> None:
    for table_name in ("ai_detection_result", "review_result"):
        constraint_name = op.f(f"ck_{table_name}_defect_type")
        op.drop_constraint(constraint_name, table_name, type_="check")
        op.create_check_constraint(
            constraint_name,
            table_name,
            _check_sql("defect_type", values),
        )


def _replace_facade_constraint(values: tuple[str, ...]) -> None:
    op.drop_constraint("project_facade_type", "project", type_="check")
    op.create_check_constraint(
        "project_facade_type",
        "project",
        _check_sql("facade_type", values),
    )


def upgrade() -> None:
    _replace_facade_constraint(FACADE_TYPES)
    _replace_defect_constraints(DEFECT_TYPES)


def downgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE project SET facade_type = 'coating' "
            "WHERE facade_type IN ('panel', 'curtain_wall')"
        )
    )
    for table_name in ("ai_detection_result", "review_result"):
        op.execute(
            sa.text(
                f"DELETE FROM {table_name} "
                "WHERE defect_type IN ('damage', 'detachment')"
            )
        )
    _replace_facade_constraint(LEGACY_FACADE_TYPES)
    _replace_defect_constraints(LEGACY_DEFECT_TYPES)
