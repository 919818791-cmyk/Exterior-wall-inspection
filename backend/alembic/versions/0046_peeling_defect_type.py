"""Add peeling as a persisted defect type.

Revision ID: 0046_peeling_defect_type
Revises: 0045_plaster_facade_type
Create Date: 2026-09-16
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0046_peeling_defect_type"
down_revision: str | None = "0045_plaster_facade_type"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DEFECT_TYPES = ("crack", "spalling", "peeling", "moisture", "hollow")
LEGACY_DEFECT_TYPES = ("crack", "spalling", "moisture", "hollow")


def _replace_defect_constraints(values: tuple[str, ...]) -> None:
    quoted = ", ".join(f"'{value}'" for value in values)
    check_sql = f"defect_type IN ({quoted})"
    for table_name in ("ai_detection_result", "review_result"):
        constraint_name = op.f(f"ck_{table_name}_defect_type")
        op.drop_constraint(constraint_name, table_name, type_="check")
        op.create_check_constraint(constraint_name, table_name, check_sql)


def upgrade() -> None:
    _replace_defect_constraints(DEFECT_TYPES)


def downgrade() -> None:
    for table_name in ("ai_detection_result", "review_result"):
        op.execute(sa.text(f"DELETE FROM {table_name} WHERE defect_type = 'peeling'"))
    _replace_defect_constraints(LEGACY_DEFECT_TYPES)
