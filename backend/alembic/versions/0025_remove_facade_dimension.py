"""Remove the facade dimension and keep photos grouped by building.

Revision ID: 0025_remove_facade_dimension
Revises: 0024_high_precision_only
Create Date: 2026-07-24
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0025_remove_facade_dimension"
down_revision: str | None = "0024_high_precision_only"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Older uploads may only have recorded their building through the facade.
    # Backfill that relationship before removing the obsolete dimension.
    op.execute(
        sa.text(
            """
            UPDATE photo AS photo_record
            SET building_id = facade_record.building_id
            FROM facade AS facade_record
            WHERE photo_record.facade_id = facade_record.id
              AND photo_record.building_id IS NULL
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE upload_batch AS batch
            SET building_id = facade_record.building_id
            FROM facade AS facade_record
            WHERE batch.facade_id = facade_record.id
              AND batch.building_id IS NULL
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE collection_time_recommendation AS recommendation
            SET building_id = facade_record.building_id
            FROM facade AS facade_record
            WHERE recommendation.facade_id = facade_record.id
              AND recommendation.building_id IS NULL
            """
        )
    )

    op.drop_column("photo", "facade_id")
    op.drop_column("upload_batch", "facade_id")
    op.drop_column("collection_time_recommendation", "facade_id")
    op.drop_table("facade")
    op.create_index("idx_photo_building_id", "photo", ["building_id"])


def downgrade() -> None:
    op.drop_index("idx_photo_building_id", table_name="photo")
    op.create_table(
        "facade",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("building_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("area", sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column("floors_range", sa.String(length=64), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["building_id"], ["building.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_facade_project_id", "facade", ["project_id"])
    op.create_index("idx_facade_building_id", "facade", ["building_id"])

    for table_name in (
        "collection_time_recommendation",
        "upload_batch",
        "photo",
    ):
        op.add_column(
            table_name,
            sa.Column("facade_id", postgresql.UUID(as_uuid=True), nullable=True),
        )
        op.create_foreign_key(
            f"fk_{table_name}_facade_id_facade",
            table_name,
            "facade",
            ["facade_id"],
            ["id"],
            ondelete="SET NULL",
        )
        op.create_index(f"idx_{table_name}_facade_id", table_name, ["facade_id"])
