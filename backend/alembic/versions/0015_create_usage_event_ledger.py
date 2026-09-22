"""Create the durable resource-usage event ledger.

Revision ID: 0015_usage_event_ledger
Revises: 0014_unify_spalling
Create Date: 2026-07-13
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any
from uuid import uuid4

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0015_usage_event_ledger"
down_revision: str | None = "0014_unify_spalling"
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


def upgrade() -> None:
    op.create_table(
        "usage_event",
        sa.Column("event_key", sa.String(length=160), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("source_type", sa.String(length=32), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("photo_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("storage_bytes", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("api_request_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("input_token_count", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("output_token_count", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("token_count", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("trial_task_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("photo_count >= 0", name=op.f("ck_usage_event_photo_count_non_negative")),
        sa.CheckConstraint("storage_bytes >= 0", name=op.f("ck_usage_event_storage_bytes_non_negative")),
        sa.CheckConstraint("api_request_count >= 0", name=op.f("ck_usage_event_api_request_count_non_negative")),
        sa.CheckConstraint("input_token_count >= 0", name=op.f("ck_usage_event_input_token_count_non_negative")),
        sa.CheckConstraint("output_token_count >= 0", name=op.f("ck_usage_event_output_token_count_non_negative")),
        sa.CheckConstraint("token_count >= 0", name=op.f("ck_usage_event_token_count_non_negative")),
        sa.CheckConstraint("trial_task_count >= 0", name=op.f("ck_usage_event_trial_task_count_non_negative")),
        sa.ForeignKeyConstraint(
            ["actor_id"],
            ["user_account.id"],
            name=op.f("fk_usage_event_actor_id_user_account"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_usage_event")),
        sa.UniqueConstraint("event_key", name=op.f("uq_usage_event_event_key")),
    )
    op.create_index("idx_usage_event_occurred_at", "usage_event", ["occurred_at"], unique=False)
    op.create_index("idx_usage_event_event_type", "usage_event", ["event_type"], unique=False)
    op.create_index("idx_usage_event_source_type", "usage_event", ["source_type"], unique=False)

    _backfill_photo_uploads()
    _backfill_inference_usage()


def downgrade() -> None:
    op.drop_index("idx_usage_event_source_type", table_name="usage_event")
    op.drop_index("idx_usage_event_event_type", table_name="usage_event")
    op.drop_index("idx_usage_event_occurred_at", table_name="usage_event")
    op.drop_table("usage_event")


def _backfill_photo_uploads() -> None:
    bind = op.get_bind()
    photo = sa.table(
        "photo",
        sa.column("id"),
        sa.column("upload_batch_id"),
        sa.column("file_size"),
        sa.column("created_at"),
    )
    upload_batch = sa.table(
        "upload_batch",
        sa.column("id"),
        sa.column("uploaded_by"),
    )
    formal_rows = bind.execute(
        sa.select(
            photo.c.id,
            photo.c.file_size,
            photo.c.created_at,
            upload_batch.c.uploaded_by,
        ).join(upload_batch, upload_batch.c.id == photo.c.upload_batch_id)
    )
    _bulk_insert(
        {
            "id": uuid4(),
            "event_key": f"photo:formal:{row.id}",
            "event_type": "photo_upload",
            "source_type": "formal",
            "actor_id": row.uploaded_by,
            "photo_count": 1,
            "storage_bytes": max(0, int(row.file_size or 0)),
            "api_request_count": 0,
            "input_token_count": 0,
            "output_token_count": 0,
            "token_count": 0,
            "trial_task_count": 0,
            "occurred_at": row.created_at,
        }
        for row in formal_rows
    )

    quick_photo = sa.table(
        "quick_detection_photo",
        sa.column("id"),
        sa.column("file_size"),
        sa.column("created_at"),
        sa.column("uploaded_by"),
    )
    quick_rows = bind.execute(
        sa.select(
            quick_photo.c.id,
            quick_photo.c.file_size,
            quick_photo.c.created_at,
            quick_photo.c.uploaded_by,
        )
    )
    _bulk_insert(
        {
            "id": uuid4(),
            "event_key": f"photo:trial:{row.id}",
            "event_type": "photo_upload",
            "source_type": "trial",
            "actor_id": row.uploaded_by,
            "photo_count": 1,
            "storage_bytes": max(0, int(row.file_size or 0)),
            "api_request_count": 0,
            "input_token_count": 0,
            "output_token_count": 0,
            "token_count": 0,
            "trial_task_count": 0,
            "occurred_at": row.created_at,
        }
        for row in quick_rows
    )


def _backfill_inference_usage() -> None:
    bind = op.get_bind()
    trial_result = sa.table(
        "trial_detection_result",
        sa.column("id"),
        sa.column("report_data_json"),
        sa.column("generated_by"),
        sa.column("generated_at"),
    )
    trial_rows = bind.execute(sa.select(trial_result))
    _bulk_insert(
        _inference_row(
            event_key=f"inference:trial:{row.id}",
            source_type="trial",
            actor_id=row.generated_by,
            occurred_at=row.generated_at,
            report_data=row.report_data_json,
            trial_task_count=1,
        )
        for row in trial_rows
    )

    detection_task = sa.table(
        "detection_task",
        sa.column("id"),
        sa.column("status"),
        sa.column("result_summary"),
        sa.column("created_by"),
        sa.column("finished_at"),
        sa.column("updated_at"),
    )
    formal_rows = bind.execute(
        sa.select(detection_task).where(detection_task.c.status == "success")
    )
    _bulk_insert(
        _inference_row(
            event_key=f"inference:formal:{row.id}",
            source_type="formal",
            actor_id=row.created_by,
            occurred_at=row.finished_at or row.updated_at,
            report_data=row.result_summary,
            trial_task_count=0,
        )
        for row in formal_rows
    )


def _inference_row(
    *,
    event_key: str,
    source_type: str,
    actor_id: object,
    occurred_at: object,
    report_data: dict[str, Any] | None,
    trial_task_count: int,
) -> dict[str, object]:
    input_tokens, output_tokens, total_tokens = _token_counts(report_data)
    return {
        "id": uuid4(),
        "event_key": event_key,
        "event_type": "inference",
        "source_type": source_type,
        "actor_id": actor_id,
        "photo_count": 0,
        "storage_bytes": 0,
        "api_request_count": _api_request_count(
            report_data,
            allow_tile_count_fallback=source_type == "trial",
        ),
        "input_token_count": input_tokens,
        "output_token_count": output_tokens,
        "token_count": total_tokens,
        "trial_task_count": trial_task_count,
        "occurred_at": occurred_at,
    }


def _bulk_insert(rows: object, *, chunk_size: int = 1000) -> None:
    chunk: list[dict[str, object]] = []
    for row in rows:
        chunk.append(row)
        if len(chunk) >= chunk_size:
            op.bulk_insert(usage_event, chunk)
            chunk = []
    if chunk:
        op.bulk_insert(usage_event, chunk)


def _api_request_count(
    report_data: dict[str, Any] | None,
    *,
    allow_tile_count_fallback: bool,
) -> int:
    total = 0
    for output in (report_data or {}).get("raw_model_outputs") or []:
        if not isinstance(output, dict):
            continue
        inference = output.get("inference") if isinstance(output.get("inference"), dict) else {}
        candidates = [inference.get("api_request_count"), output.get("api_request_count")]
        if allow_tile_count_fallback:
            candidates.extend([inference.get("tile_count"), output.get("tile_count")])
        value = next((candidate for candidate in candidates if candidate is not None), 0)
        parsed = _non_negative_int(value)
        if parsed is not None:
            total += parsed
    return total


def _token_counts(report_data: dict[str, Any] | None) -> tuple[int, int, int]:
    input_total = 0
    output_total = 0
    combined_total = 0
    for output in (report_data or {}).get("raw_model_outputs") or []:
        if not isinstance(output, dict):
            continue
        usage = output.get("token_usage") if isinstance(output.get("token_usage"), dict) else {}
        input_count = _first_token_count(usage, "prompt_tokens", "input_tokens")
        output_count = _first_token_count(usage, "completion_tokens", "output_tokens")
        total_count = _first_token_count(usage, "total_tokens")
        if input_count is None:
            input_count = _tile_token_count(output, "prompt_tokens", "input_tokens")
        if output_count is None:
            output_count = _tile_token_count(output, "completion_tokens", "output_tokens")
        if total_count is None:
            total_count = _tile_token_count(output, "total_tokens")
        normalized_input = input_count or 0
        normalized_output = output_count or 0
        input_total += normalized_input
        output_total += normalized_output
        combined_total += total_count if total_count is not None else normalized_input + normalized_output
    return input_total, output_total, combined_total


def _first_token_count(usage: dict[str, Any], *keys: str) -> int | None:
    for key in keys:
        value = _non_negative_int(usage.get(key))
        if value is not None:
            return value
    return None


def _tile_token_count(output: dict[str, Any], *keys: str) -> int | None:
    total = 0
    found = False
    for tile in output.get("tile_token_usages") or []:
        if not isinstance(tile, dict) or not isinstance(tile.get("token_usage"), dict):
            continue
        value = _first_token_count(tile["token_usage"], *keys)
        if value is not None:
            total += value
            found = True
    return total if found else None


def _non_negative_int(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None
