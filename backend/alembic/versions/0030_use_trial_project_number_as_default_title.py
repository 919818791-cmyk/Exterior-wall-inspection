"""Use the trial project number as the default result title.

Revision ID: 0030_trial_number_title
Revises: 0029_short_trial_numbers
Create Date: 2026-07-29
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0030_trial_number_title"
down_revision: str | None = "0029_short_trial_numbers"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE trial_detection_result
            SET title = result_no
            WHERE title = '简易AI检测结果'
            """
        )
    )


def downgrade() -> None:
    # A title equal to the project number may have been explicitly entered by
    # the user, so restoring the old default cannot be done safely.
    pass
