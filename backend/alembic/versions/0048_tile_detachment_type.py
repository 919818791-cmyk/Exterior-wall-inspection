"""Separate tile detachment from plaster spalling.

Revision ID: 0048_tile_detachment_type
Revises: 0047_panel_curtain_wall_types
Create Date: 2026-09-16
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op


revision: str = "0048_tile_detachment_type"
down_revision: str | None = "0047_panel_curtain_wall_types"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _move_prompt(
    source_key: str,
    target_key: str,
    old_type: str,
    new_type: str,
    old_label: str,
    new_label: str,
) -> None:
    op.execute(
        f"DELETE FROM system_setting WHERE key = '{target_key}' "
        f"AND EXISTS (SELECT 1 FROM system_setting WHERE key = '{source_key}')"
    )
    op.execute(
        "UPDATE system_setting "
        f"SET key = '{target_key}', "
        f"value = replace(replace(value, '{old_type}', '{new_type}'), "
        f"'{old_label}', '{new_label}') "
        f"WHERE key = '{source_key}'"
    )


def upgrade() -> None:
    _move_prompt(
        "formal_tile_spalling_prompt",
        "formal_tile_detachment_prompt",
        "spalling",
        "detachment",
        "剥落",
        "脱落",
    )
    _move_prompt(
        "formal_tile_visible_prompt",
        "formal_tile_crack_detachment_prompt",
        "spalling",
        "detachment",
        "剥落",
        "脱落",
    )


def downgrade() -> None:
    _move_prompt(
        "formal_tile_detachment_prompt",
        "formal_tile_spalling_prompt",
        "detachment",
        "spalling",
        "脱落",
        "剥落",
    )
    _move_prompt(
        "formal_tile_crack_detachment_prompt",
        "formal_tile_visible_prompt",
        "detachment",
        "spalling",
        "脱落",
        "剥落",
    )
