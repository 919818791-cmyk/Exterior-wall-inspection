from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.tables import UsageEvent

UsageSourceType = Literal["formal", "trial", "building_model"]


def api_request_count(
    report_data: dict[str, Any] | None,
    *,
    allow_tile_count_fallback: bool = True,
) -> int:
    total = 0
    for output in (report_data or {}).get("raw_model_outputs") or []:
        if not isinstance(output, dict):
            continue
        inference = output.get("inference") if isinstance(output.get("inference"), dict) else {}
        candidates = [
            inference.get("api_request_count"),
            output.get("api_request_count"),
        ]
        if allow_tile_count_fallback:
            candidates.extend([inference.get("tile_count"), output.get("tile_count")])
        value = next((candidate for candidate in candidates if candidate is not None), 0)
        parsed = non_negative_int(value)
        if parsed is not None:
            total += parsed
    return total


def token_counts(report_data: dict[str, Any] | None) -> tuple[int, int, int]:
    input_total = 0
    output_total = 0
    combined_total = 0
    for output in (report_data or {}).get("raw_model_outputs") or []:
        if not isinstance(output, dict):
            continue
        token_usage = output.get("token_usage")
        photo_usage = token_usage if isinstance(token_usage, dict) else {}
        input_count = _first_token_count(photo_usage, "prompt_tokens", "input_tokens")
        output_count = _first_token_count(photo_usage, "completion_tokens", "output_tokens")
        total_count = _first_token_count(photo_usage, "total_tokens")

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


def add_photo_upload_event(
    db: Session,
    *,
    source_type: UsageSourceType,
    photo_id: UUID,
    actor_id: UUID,
    storage_bytes: int | None,
    occurred_at: datetime | None = None,
) -> UsageEvent:
    event = UsageEvent(
        event_key=f"photo:{source_type}:{photo_id}",
        event_type="photo_upload",
        source_type=source_type,
        actor_id=actor_id,
        photo_count=1,
        storage_bytes=max(0, int(storage_bytes or 0)),
        occurred_at=occurred_at or datetime.now(UTC),
    )
    db.add(event)
    return event


def add_building_model_upload_event(
    db: Session,
    *,
    upload_id: UUID,
    actor_id: UUID,
    storage_bytes: int,
    occurred_at: datetime,
) -> UsageEvent:
    event = UsageEvent(
        event_key=f"building-model:{upload_id}",
        event_type="model_upload",
        source_type="building_model",
        actor_id=actor_id,
        storage_bytes=max(0, storage_bytes),
        occurred_at=occurred_at,
    )
    db.add(event)
    return event


def add_inference_usage_event(
    db: Session,
    *,
    source_type: UsageSourceType,
    source_id: UUID,
    actor_id: UUID,
    report_data: dict[str, Any] | None,
    trial_task_count: int = 0,
    photo_count: int = 0,
    storage_bytes: int = 0,
    occurred_at: datetime | None = None,
) -> UsageEvent:
    input_tokens, output_tokens, total_tokens = token_counts(report_data)
    event = UsageEvent(
        event_key=f"inference:{source_type}:{source_id}",
        event_type="inference",
        source_type=source_type,
        actor_id=actor_id,
        photo_count=max(0, photo_count),
        storage_bytes=max(0, storage_bytes),
        api_request_count=api_request_count(
            report_data,
            allow_tile_count_fallback=source_type == "trial",
        ),
        input_token_count=input_tokens,
        output_token_count=output_tokens,
        token_count=total_tokens,
        trial_task_count=max(0, trial_task_count),
        occurred_at=occurred_at or datetime.now(UTC),
    )
    db.add(event)
    return event


def non_negative_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if not isinstance(value, (int, str)):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


def _first_token_count(usage: dict[str, Any], *keys: str) -> int | None:
    for key in keys:
        value = non_negative_int(usage.get(key))
        if value is not None:
            return value
    return None


def _tile_token_count(output: dict[str, Any], *keys: str) -> int | None:
    total = 0
    found = False
    for tile in output.get("tile_token_usages") or []:
        if not isinstance(tile, dict):
            continue
        tile_usage = tile.get("token_usage")
        if not isinstance(tile_usage, dict):
            continue
        value = _first_token_count(tile_usage, *keys)
        if value is not None:
            total += value
            found = True
    return total if found else None
