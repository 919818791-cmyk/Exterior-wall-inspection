"""Replace the Qwen-VL-Max provider selection with Qwen3-VL-Flash.

Revision ID: 0021_qwen3_vl_flash
Revises: 0020_unique_user_phone
Create Date: 2026-07-20
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op


revision: str = "0021_qwen3_vl_flash"
down_revision: str | None = "0020_unique_user_phone"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "UPDATE system_setting "
        "SET value = 'qwen3_vl_flash' "
        "WHERE key = 'trial_inference_provider' AND value = 'qwen_vl_max'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE system_setting "
        "SET value = 'qwen_vl_max' "
        "WHERE key = 'trial_inference_provider' AND value = 'qwen3_vl_flash'"
    )
