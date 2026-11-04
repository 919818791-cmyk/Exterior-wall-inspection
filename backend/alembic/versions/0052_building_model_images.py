"""Store the eight report images associated with a building model.

Revision ID: 0052_building_model_images
Revises: 0051_merge_detachment
Create Date: 2026-09-21
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0052_building_model_images"
down_revision: str | None = "0051_merge_detachment"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "building_model_image",
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("orientation", sa.String(length=16), nullable=False),
        sa.Column("image_kind", sa.String(length=16), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=False),
        sa.Column("mime_type", sa.String(length=128), nullable=False),
        sa.Column("storage_bucket", sa.String(length=64), nullable=False),
        sa.Column("storage_object_key", sa.String(length=512), nullable=False),
        sa.Column("uploaded_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "image_kind IN ('elevation', 'annotated')",
            name=op.f("ck_building_model_image_kind"),
        ),
        sa.CheckConstraint(
            "orientation IN ('east', 'west', 'south', 'north')",
            name=op.f("ck_building_model_image_orientation"),
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["project.id"],
            name=op.f("fk_building_model_image_project_id_project"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["uploaded_by"],
            ["user_account.id"],
            name=op.f("fk_building_model_image_uploaded_by_user_account"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_building_model_image")),
        sa.UniqueConstraint(
            "project_id",
            "orientation",
            "image_kind",
            name="uq_building_model_image_project_slot",
        ),
    )
    op.create_index(
        "idx_building_model_image_project_id",
        "building_model_image",
        ["project_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "idx_building_model_image_project_id",
        table_name="building_model_image",
    )
    op.drop_table("building_model_image")
