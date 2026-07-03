"""Update defect types for production model classes.

Revision ID: 0013_model_defect_types
Revises: 0012_quick_detection_photo
Create Date: 2026-07-03
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0013_model_defect_types"
down_revision: str | None = "0012_quick_detection_photo"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NEW_DEFECT_TYPES = ("crack", "missing", "spalling", "moisture")
OLD_DEFECT_TYPES = ("crack", "spalling", "hollowing", "leakage", "corrosion")


def _check_sql(values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"defect_type IN ({quoted})"


def _replace_defect_constraints(values: tuple[str, ...]) -> None:
    op.drop_constraint(
        op.f("ck_ai_detection_result_defect_type"),
        "ai_detection_result",
        type_="check",
    )
    op.drop_constraint(
        op.f("ck_review_result_defect_type"),
        "review_result",
        type_="check",
    )
    op.create_check_constraint(
        op.f("ck_ai_detection_result_defect_type"),
        "ai_detection_result",
        _check_sql(values),
    )
    op.create_check_constraint(
        op.f("ck_review_result_defect_type"),
        "review_result",
        _check_sql(values),
    )


def upgrade() -> None:
    _replace_defect_constraints(OLD_DEFECT_TYPES + ("missing", "moisture"))
    op.execute(
        """
        UPDATE ai_detection_result
        SET defect_type = CASE defect_type
            WHEN 'hollowing' THEN 'missing'
            WHEN 'leakage' THEN 'moisture'
            WHEN 'corrosion' THEN 'spalling'
            ELSE defect_type
        END
        WHERE defect_type IN ('hollowing', 'leakage', 'corrosion')
        """
    )
    op.execute(
        """
        UPDATE review_result
        SET defect_type = CASE defect_type
            WHEN 'hollowing' THEN 'missing'
            WHEN 'leakage' THEN 'moisture'
            WHEN 'corrosion' THEN 'spalling'
            ELSE defect_type
        END
        WHERE defect_type IN ('hollowing', 'leakage', 'corrosion')
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
                                WHEN 'hollowing' THEN 'missing'
                                WHEN 'leakage' THEN 'moisture'
                                WHEN 'corrosion' THEN NULL
                                ELSE item.value
                            END AS value
                            FROM jsonb_array_elements_text(model_types) AS item(value)
                        ) mapped
                        WHERE value IN ('crack', 'missing', 'spalling', 'moisture')
                    ),
                    '[]'::jsonb
                ) AS model_types
            FROM detection_config
        )
        UPDATE detection_config
        SET model_types = CASE
            WHEN jsonb_array_length(normalized.model_types) = 0
                THEN '["crack", "missing", "spalling", "moisture"]'::jsonb
            ELSE normalized.model_types
        END
        FROM normalized
        WHERE detection_config.id = normalized.id
        """
    )
    _replace_defect_constraints(NEW_DEFECT_TYPES)


def downgrade() -> None:
    _replace_defect_constraints(OLD_DEFECT_TYPES + ("missing", "moisture"))
    op.execute(
        """
        UPDATE ai_detection_result
        SET defect_type = CASE defect_type
            WHEN 'missing' THEN 'hollowing'
            WHEN 'moisture' THEN 'leakage'
            ELSE defect_type
        END
        WHERE defect_type IN ('missing', 'moisture')
        """
    )
    op.execute(
        """
        UPDATE review_result
        SET defect_type = CASE defect_type
            WHEN 'missing' THEN 'hollowing'
            WHEN 'moisture' THEN 'leakage'
            ELSE defect_type
        END
        WHERE defect_type IN ('missing', 'moisture')
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
                                WHEN 'missing' THEN 'hollowing'
                                WHEN 'moisture' THEN 'leakage'
                                ELSE item.value
                            END AS value
                            FROM jsonb_array_elements_text(model_types) AS item(value)
                        ) mapped
                        WHERE value IN ('crack', 'spalling', 'hollowing', 'leakage', 'corrosion')
                    ),
                    '[]'::jsonb
                ) AS model_types
            FROM detection_config
        )
        UPDATE detection_config
        SET model_types = CASE
            WHEN jsonb_array_length(normalized.model_types) = 0
                THEN '["crack", "spalling"]'::jsonb
            ELSE normalized.model_types
        END
        FROM normalized
        WHERE detection_config.id = normalized.id
        """
    )
    _replace_defect_constraints(OLD_DEFECT_TYPES)
