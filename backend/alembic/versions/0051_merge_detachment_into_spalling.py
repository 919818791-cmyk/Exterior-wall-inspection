"""Merge detachment into spalling and use the 脱落 display name.

Revision ID: 0051_merge_detachment
Revises: 0050_photo_detection_quota
Create Date: 2026-09-21
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0051_merge_detachment"
down_revision: str | None = "0050_photo_detection_quota"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DEFECT_TYPES = ("crack", "spalling", "peeling", "damage", "moisture", "hollow")
DEFECT_TYPES_WITH_DETACHMENT = (
    "crack",
    "spalling",
    "peeling",
    "damage",
    "detachment",
    "moisture",
    "hollow",
)
PROMPT_KEY_MOVES = (
    ("formal_tile_detachment_prompt", "formal_tile_spalling_prompt"),
    ("formal_tile_crack_detachment_prompt", "formal_tile_visible_prompt"),
    ("formal_panel_detachment_prompt", "formal_panel_spalling_prompt"),
)


def _replace_defect_constraints(values: tuple[str, ...]) -> None:
    quoted = ", ".join(f"'{value}'" for value in values)
    check_sql = f"defect_type IN ({quoted})"
    for table_name in ("ai_detection_result", "review_result"):
        constraint_name = op.f(f"ck_{table_name}_defect_type")
        op.drop_constraint(constraint_name, table_name, type_="check")
        op.create_check_constraint(constraint_name, table_name, check_sql)


def _move_prompt(source_key: str, target_key: str, old_type: str, new_type: str) -> None:
    op.execute(
        sa.text(
            "DELETE FROM system_setting WHERE key = :target_key "
            "AND EXISTS (SELECT 1 FROM system_setting WHERE key = :source_key)"
        ).bindparams(source_key=source_key, target_key=target_key)
    )
    op.execute(
        sa.text(
            "UPDATE system_setting SET key = :target_key, "
            "value = replace(value, :old_type, :new_type) WHERE key = :source_key"
        ).bindparams(
            source_key=source_key,
            target_key=target_key,
            old_type=old_type,
            new_type=new_type,
        )
    )


def _replace_json_string(table: str, column: str, old: str, new: str) -> None:
    op.execute(
        sa.text(
            f"UPDATE {table} SET {column} = "
            f"replace({column}::text, :old_json, :new_json)::jsonb "
            f"WHERE {column} IS NOT NULL AND {column}::text LIKE :pattern"
        ).bindparams(
            old_json=f'"{old}"',
            new_json=f'"{new}"',
            pattern=f'%"{old}"%',
        )
    )


def upgrade() -> None:
    op.execute("UPDATE ai_detection_result SET defect_type = 'spalling' WHERE defect_type = 'detachment'")
    op.execute("UPDATE review_result SET defect_type = 'spalling' WHERE defect_type = 'detachment'")
    _replace_defect_constraints(DEFECT_TYPES)

    for table, column in (
        ("detection_config", "model_types"),
        ("detection_config", "config_json"),
        ("detection_task", "result_summary"),
        ("ai_detection_result", "raw_result_json"),
        ("review_operation_log", "before_json"),
        ("review_operation_log", "after_json"),
        ("inspection_report", "report_data_json"),
        ("trial_detection_result", "report_data_json"),
        ("annotation_photo_edit", "annotations_json"),
    ):
        _replace_json_string(table, column, "detachment", "spalling")

    for source_key, target_key in PROMPT_KEY_MOVES:
        _move_prompt(source_key, target_key, "detachment", "spalling")


def downgrade() -> None:
    _replace_defect_constraints(DEFECT_TYPES_WITH_DETACHMENT)
    op.execute(
        "UPDATE ai_detection_result AS result SET defect_type = 'detachment' "
        "FROM project WHERE project.id = result.project_id "
        "AND project.facade_type IN ('tile', 'panel') "
        "AND result.defect_type = 'spalling'"
    )
    op.execute(
        "UPDATE review_result AS result SET defect_type = 'detachment' "
        "FROM project WHERE project.id = result.project_id "
        "AND project.facade_type IN ('tile', 'panel') "
        "AND result.defect_type = 'spalling'"
    )

    for table, column in (
        ("detection_config", "model_types"),
        ("detection_config", "config_json"),
        ("detection_task", "result_summary"),
        ("ai_detection_result", "raw_result_json"),
        ("review_operation_log", "before_json"),
        ("review_operation_log", "after_json"),
        ("inspection_report", "report_data_json"),
    ):
        op.execute(
            sa.text(
                f"UPDATE {table} SET {column} = "
                f"replace({column}::text, :old_json, :new_json)::jsonb "
                "WHERE project_id IN ("
                "SELECT id FROM project WHERE facade_type IN ('tile', 'panel')"
                f") AND {column} IS NOT NULL AND {column}::text LIKE :pattern"
            ).bindparams(
                old_json='"spalling"',
                new_json='"detachment"',
                pattern='%"spalling"%',
            )
        )
    op.execute(
        sa.text(
            "UPDATE annotation_photo_edit AS edit SET annotations_json = "
            "replace(edit.annotations_json::text, :old_json, :new_json)::jsonb "
            "FROM inspection_report AS report, project "
            "WHERE report.id = edit.report_id AND project.id = report.project_id "
            "AND project.facade_type IN ('tile', 'panel') "
            "AND edit.annotations_json::text LIKE :pattern"
        ).bindparams(
            old_json='"spalling"',
            new_json='"detachment"',
            pattern='%"spalling"%',
        )
    )

    for source_key, target_key in PROMPT_KEY_MOVES:
        _move_prompt(target_key, source_key, "spalling", "detachment")
