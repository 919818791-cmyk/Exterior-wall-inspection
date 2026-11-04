"""Unify all spalling defects under the spalling type.

Revision ID: 0014_unify_spalling
Revises: 0013_model_defect_types
Create Date: 2026-07-09
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0014_unify_spalling"
down_revision: str | None = "0013_model_defect_types"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UNIFIED_DEFECT_TYPES = ("crack", "spalling", "moisture")
LEGACY_DEFECT_TYPES = ("crack", "missing", "spalling", "moisture")


def _check_sql(values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"defect_type IN ({quoted})"


def _replace_defect_constraints(values: tuple[str, ...]) -> None:
    for table_name in ("ai_detection_result", "review_result"):
        constraint_name = op.f(f"ck_{table_name}_defect_type")
        op.drop_constraint(constraint_name, table_name, type_="check")
        op.create_check_constraint(
            constraint_name,
            table_name,
            _check_sql(values),
        )


def upgrade() -> None:
    _replace_defect_constraints(LEGACY_DEFECT_TYPES)

    for table_name in ("ai_detection_result", "review_result"):
        op.execute(
            f"""
            UPDATE {table_name}
            SET defect_type = 'spalling'
            WHERE defect_type = 'missing'
            """
        )

    op.execute(
        """
        WITH normalized AS (
            SELECT
                id,
                COALESCE(
                    (
                        SELECT jsonb_agg(value ORDER BY value)
                        FROM (
                            SELECT DISTINCT CASE item.value
                                WHEN 'missing' THEN 'spalling'
                                ELSE item.value
                            END AS value
                            FROM jsonb_array_elements_text(model_types) AS item(value)
                        ) mapped
                        WHERE value IN ('crack', 'spalling', 'moisture')
                    ),
                    '[]'::jsonb
                ) AS model_types
            FROM detection_config
        )
        UPDATE detection_config
        SET model_types = CASE
            WHEN jsonb_array_length(normalized.model_types) = 0
                THEN '["crack", "spalling", "moisture"]'::jsonb
            ELSE normalized.model_types
        END
        FROM normalized
        WHERE detection_config.id = normalized.id
        """
    )

    _replace_defect_constraints(UNIFIED_DEFECT_TYPES)


def downgrade() -> None:
    # Unified spalling records cannot be reliably split back into material-specific
    # categories, so downgrade only restores acceptance of the legacy value.
    _replace_defect_constraints(LEGACY_DEFECT_TYPES)
