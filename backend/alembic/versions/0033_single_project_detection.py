"""Remove the building dimension and enforce one formal result per project.

Revision ID: 0033_single_project_detection
Revises: 0032_no_manual_precheck
Create Date: 2026-07-31
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0033_single_project_detection"
down_revision: str | None = "0032_no_manual_precheck"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _ensure_single_row_per_project(table_name: str) -> None:
    duplicate_project = op.get_bind().execute(
        sa.text(
            f"""
            SELECT project_id
            FROM {table_name}
            GROUP BY project_id
            HAVING count(*) > 1
            LIMIT 1
            """
        )
    ).scalar_one_or_none()
    if duplicate_project is not None:
        raise RuntimeError(
            f"Cannot migrate {table_name}: project {duplicate_project} has multiple rows."
        )


def _strip_building_report_snapshots() -> None:
    op.execute(
        sa.text(
            """
            UPDATE inspection_report
            SET report_data_json =
                jsonb_set(
                    jsonb_set(
                        jsonb_set(
                            report_data_json - 'buildings',
                            '{summary}',
                            COALESCE(report_data_json -> 'summary', '{}'::jsonb)
                                - 'building_count'
                        ),
                        '{detection_task}',
                        COALESCE(report_data_json -> 'detection_task', '{}'::jsonb)
                            - 'building_id' - 'run_id'
                    ),
                    '{photos}',
                    COALESCE(
                        (
                            SELECT jsonb_agg(
                                CASE
                                    WHEN jsonb_typeof(photo_item) = 'object'
                                    THEN photo_item - 'building_id'
                                    ELSE photo_item
                                END
                            )
                            FROM jsonb_array_elements(
                                CASE
                                    WHEN jsonb_typeof(report_data_json -> 'photos') = 'array'
                                    THEN report_data_json -> 'photos'
                                    ELSE '[]'::jsonb
                                END
                            ) AS photo_item
                        ),
                        '[]'::jsonb
                    )
                )
            WHERE jsonb_typeof(report_data_json) = 'object'
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE inspection_report
            SET report_data_json = jsonb_set(
                report_data_json,
                '{defects}',
                COALESCE(
                    (
                        SELECT jsonb_agg(
                            CASE
                                WHEN jsonb_typeof(defect_item) = 'object'
                                THEN defect_item - 'building_id' - 'building_name'
                                ELSE defect_item
                            END
                        )
                        FROM jsonb_array_elements(
                            CASE
                                WHEN jsonb_typeof(report_data_json -> 'defects') = 'array'
                                THEN report_data_json -> 'defects'
                                ELSE '[]'::jsonb
                            END
                        ) AS defect_item
                    ),
                    '[]'::jsonb
                )
            )
            WHERE jsonb_typeof(report_data_json) = 'object'
            """
        )
    )


def upgrade() -> None:
    _ensure_single_row_per_project("detection_task")
    _ensure_single_row_per_project("inspection_report")
    _strip_building_report_snapshots()

    op.execute(
        sa.text(
            """
            UPDATE detection_task
            SET result_summary = CASE
                WHEN jsonb_typeof(result_summary) = 'object'
                THEN
                    (result_summary - 'building_id' - 'run_id')
                    || CASE
                        WHEN jsonb_typeof(result_summary -> 'detection_config') = 'object'
                        THEN jsonb_build_object(
                            'detection_config',
                            (result_summary -> 'detection_config')
                                - 'selected_building_ids' - 'run_id'
                        )
                        ELSE '{}'::jsonb
                    END
                ELSE result_summary
            END
            WHERE result_summary IS NOT NULL
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE detection_config
            SET config_json = CASE
                WHEN jsonb_typeof(config_json) = 'object'
                THEN config_json - 'selected_building_ids' - 'run_id'
                ELSE config_json
            END
            WHERE config_json IS NOT NULL
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE ai_detection_result
            SET raw_result_json = CASE
                WHEN jsonb_typeof(raw_result_json) = 'object'
                THEN raw_result_json - 'building_id' - 'run_id'
                ELSE raw_result_json
            END
            WHERE raw_result_json IS NOT NULL
            """
        )
    )

    op.drop_index("idx_detection_task_run_id", table_name="detection_task")
    op.drop_index("idx_detection_task_building_id", table_name="detection_task")
    op.drop_constraint(
        "fk_detection_task_building_id_building",
        "detection_task",
        type_="foreignkey",
    )
    op.drop_column("detection_task", "run_id")
    op.drop_column("detection_task", "building_id")

    op.drop_index("idx_photo_building_id", table_name="photo")
    op.drop_constraint(
        "fk_photo_building_id_building",
        "photo",
        type_="foreignkey",
    )
    op.drop_column("photo", "building_id")

    op.drop_constraint(
        "fk_upload_batch_building_id_building",
        "upload_batch",
        type_="foreignkey",
    )
    op.drop_column("upload_batch", "building_id")

    op.drop_constraint(
        "fk_collection_time_recommendation_building_id_building",
        "collection_time_recommendation",
        type_="foreignkey",
    )
    op.drop_column("collection_time_recommendation", "building_id")

    op.drop_index("idx_building_project_id", table_name="building")
    op.drop_table("building")

    op.create_unique_constraint(
        "uq_detection_task_project_id",
        "detection_task",
        ["project_id"],
    )
    op.create_unique_constraint(
        "uq_inspection_report_project_id",
        "inspection_report",
        ["project_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_inspection_report_project_id",
        "inspection_report",
        type_="unique",
    )
    op.drop_constraint(
        "uq_detection_task_project_id",
        "detection_task",
        type_="unique",
    )

    op.create_table(
        "building",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("building_no", sa.String(length=64), nullable=True),
        sa.Column("structure_type", sa.String(length=64), nullable=True),
        sa.Column("usage_type", sa.String(length=64), nullable=True),
        sa.Column("built_year", sa.Integer(), nullable=True),
        sa.Column("remark", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["project.id"],
            name="fk_building_project_id_project",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_building"),
    )
    op.create_index("idx_building_project_id", "building", ["project_id"])

    for table_name in (
        "collection_time_recommendation",
        "upload_batch",
        "photo",
        "detection_task",
    ):
        op.add_column(
            table_name,
            sa.Column("building_id", postgresql.UUID(as_uuid=True), nullable=True),
        )
        op.create_foreign_key(
            f"fk_{table_name}_building_id_building",
            table_name,
            "building",
            ["building_id"],
            ["id"],
            ondelete="SET NULL",
        )

    op.create_index("idx_photo_building_id", "photo", ["building_id"])
    op.create_index(
        "idx_detection_task_building_id",
        "detection_task",
        ["building_id"],
    )
    op.add_column(
        "detection_task",
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index("idx_detection_task_run_id", "detection_task", ["run_id"])
