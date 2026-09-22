"""Add the model overview image report slot.

Revision ID: 0053_model_overview_image
Revises: 0052_building_model_images
Create Date: 2026-09-21
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op


revision: str = "0053_model_overview_image"
down_revision: str | None = "0052_building_model_images"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(
        op.f("ck_building_model_image_orientation"),
        "building_model_image",
        type_="check",
    )
    op.drop_constraint(
        op.f("ck_building_model_image_kind"),
        "building_model_image",
        type_="check",
    )
    op.create_check_constraint(
        op.f("ck_building_model_image_orientation"),
        "building_model_image",
        "orientation IN ('overview', 'east', 'west', 'south', 'north')",
    )
    op.create_check_constraint(
        op.f("ck_building_model_image_kind"),
        "building_model_image",
        "image_kind IN ('model', 'elevation', 'annotated')",
    )
    op.create_check_constraint(
        op.f("ck_building_model_image_slot"),
        "building_model_image",
        "(orientation = 'overview' AND image_kind = 'model') OR "
        "(orientation IN ('east', 'west', 'south', 'north') "
        "AND image_kind IN ('elevation', 'annotated'))",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("ck_building_model_image_slot"),
        "building_model_image",
        type_="check",
    )
    op.drop_constraint(
        op.f("ck_building_model_image_orientation"),
        "building_model_image",
        type_="check",
    )
    op.drop_constraint(
        op.f("ck_building_model_image_kind"),
        "building_model_image",
        type_="check",
    )
    op.execute(
        "DELETE FROM building_model_image "
        "WHERE orientation = 'overview' OR image_kind = 'model'"
    )
    op.create_check_constraint(
        op.f("ck_building_model_image_orientation"),
        "building_model_image",
        "orientation IN ('east', 'west', 'south', 'north')",
    )
    op.create_check_constraint(
        op.f("ck_building_model_image_kind"),
        "building_model_image",
        "image_kind IN ('elevation', 'annotated')",
    )
