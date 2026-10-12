"""Backfill quota usage from photos that entered detection tasks.

Revision ID: 0050_photo_detection_quota
Revises: 0049_account_quota_reset_at
Create Date: 2026-09-18
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from uuid import uuid4

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0050_photo_detection_quota"
down_revision: str | None = "0049_account_quota_reset_at"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


usage_event = sa.table(
    "usage_event",
    sa.column("id", postgresql.UUID(as_uuid=True)),
    sa.column("event_key", sa.String()),
    sa.column("event_type", sa.String()),
    sa.column("source_type", sa.String()),
    sa.column("actor_id", postgresql.UUID(as_uuid=True)),
    sa.column("photo_count", sa.Integer()),
    sa.column("storage_bytes", sa.BigInteger()),
    sa.column("api_request_count", sa.Integer()),
    sa.column("input_token_count", sa.BigInteger()),
    sa.column("output_token_count", sa.BigInteger()),
    sa.column("token_count", sa.BigInteger()),
    sa.column("trial_task_count", sa.Integer()),
    sa.column("occurred_at", sa.DateTime(timezone=True)),
)


def _quota_event(
    *,
    event_key: str,
    source_type: str,
    actor_id: object,
    photo_count: object,
    occurred_at: object,
) -> dict[str, object]:
    return {
        "id": uuid4(),
        "event_key": event_key,
        "event_type": "photo_detection",
        "source_type": source_type,
        "actor_id": actor_id,
        "photo_count": max(0, int(photo_count or 0)),
        "storage_bytes": 0,
        "api_request_count": 0,
        "input_token_count": 0,
        "output_token_count": 0,
        "token_count": 0,
        "trial_task_count": 0,
        "occurred_at": occurred_at,
    }


def _bulk_insert(rows: Iterable[dict[str, object]], *, chunk_size: int = 1000) -> None:
    chunk: list[dict[str, object]] = []
    for row in rows:
        if int(row["photo_count"]) <= 0:
            continue
        chunk.append(row)
        if len(chunk) >= chunk_size:
            op.bulk_insert(usage_event, chunk)
            chunk = []
    if chunk:
        op.bulk_insert(usage_event, chunk)


def upgrade() -> None:
    bind = op.get_bind()

    detection_task = sa.table(
        "detection_task",
        sa.column("id"),
        sa.column("created_by"),
        sa.column("photo_count"),
        sa.column("started_at"),
    )
    formal_rows = bind.execute(
        sa.select(detection_task).where(detection_task.c.started_at.is_not(None))
    )
    _bulk_insert(
        _quota_event(
            event_key=f"photo-detection:formal:backfill:{row.id}",
            source_type="formal",
            actor_id=row.created_by,
            photo_count=row.photo_count,
            occurred_at=row.started_at,
        )
        for row in formal_rows
    )

    trial_result = sa.table(
        "trial_detection_result",
        sa.column("id"),
        sa.column("generated_by"),
        sa.column("photo_count"),
        sa.column("generated_at"),
    )
    trial_rows = bind.execute(sa.select(trial_result))
    _bulk_insert(
        _quota_event(
            event_key=f"photo-detection:trial:backfill:{row.id}",
            source_type="trial",
            actor_id=row.generated_by,
            photo_count=row.photo_count,
            occurred_at=row.generated_at,
        )
        for row in trial_rows
    )


def downgrade() -> None:
    op.execute(
        sa.delete(usage_event).where(
            usage_event.c.event_type == "photo_detection",
            usage_event.c.event_key.like("photo-detection:%:backfill:%"),
        )
    )
