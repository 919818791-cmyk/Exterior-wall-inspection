from __future__ import annotations

import logging
from datetime import UTC, datetime
from io import BytesIO
from threading import BoundedSemaphore
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.enums.status import PhotoPrecheckStatus
from app.services.object_storage import get_object_bytes
from app.services.photo_guard import (
    PhotoGuardInvalidImage,
    PhotoGuardUnavailable,
    classify_building_photo,
    photo_guard_enabled,
    photo_guard_model_name,
)
from app.services.trial_inference_provider import trial_prompts


logger = logging.getLogger(__name__)
_PRECHECK_SLOTS = BoundedSemaphore(
    value=max(1, get_settings().photo_guard_request_concurrency)
)


def run_stored_photo_precheck(db: Session, photo: Any) -> Any:
    """Run a best-effort precheck against the already persisted MinIO original.

    A precheck failure is business state, not an upload failure. This function
    therefore records rejected/error outcomes and deliberately does not raise
    model or image-read exceptions to the upload endpoint.
    """

    settings = get_settings()
    attempt = int(getattr(photo, "precheck_attempts", 0) or 0) + 1
    _set_precheck_fields(
        photo,
        status_value=PhotoPrecheckStatus.RUNNING,
        category=None,
        reason=None,
        model=None,
        error=None,
        attempts=attempt,
        checked_at=None,
    )
    _commit_and_refresh(db, photo)

    if not photo_guard_enabled(settings):
        return _finish_if_current(
            db,
            photo,
            attempt=attempt,
            status_value=PhotoPrecheckStatus.ERROR,
            category="SERVICE_DISABLED",
            reason=None,
            model=None,
            error="建筑照片预检服务未启用，请联系管理员或稍后重试。",
        )

    try:
        original = get_object_bytes(
            photo.storage_bucket,
            photo.storage_object_key,
        )
        prompt = trial_prompts(db).photo_guard_prompt
        with _PRECHECK_SLOTS:
            result = classify_building_photo(
                BytesIO(original),
                filename=photo.original_filename,
                settings=settings,
                prompt=prompt,
            )
    except PhotoGuardInvalidImage as exc:
        logger.info(
            "photo_precheck_invalid photo_id=%s error=%s",
            getattr(photo, "id", None),
            exc,
        )
        return _finish_if_current(
            db,
            photo,
            attempt=attempt,
            status_value=PhotoPrecheckStatus.REJECTED,
            category="INVALID_IMAGE",
            reason=f"无法读取为有效图片：{exc}",
            model=photo_guard_model_name(settings),
            error=None,
        )
    except PhotoGuardUnavailable as exc:
        logger.warning(
            "photo_precheck_unavailable photo_id=%s error_type=%s error=%s",
            getattr(photo, "id", None),
            type(exc).__name__,
            exc,
        )
        return _finish_if_current(
            db,
            photo,
            attempt=attempt,
            status_value=PhotoPrecheckStatus.ERROR,
            category="SERVICE_ERROR",
            reason=None,
            model=photo_guard_model_name(settings),
            error="建筑照片预检服务暂时不可用，原图已保留；如需再次判断，请删除后重新上传。",
        )
    except Exception as exc:
        logger.exception(
            "photo_precheck_failed photo_id=%s error_type=%s",
            getattr(photo, "id", None),
            type(exc).__name__,
        )
        return _finish_if_current(
            db,
            photo,
            attempt=attempt,
            status_value=PhotoPrecheckStatus.ERROR,
            category="STORAGE_OR_SYSTEM_ERROR",
            reason=None,
            model=photo_guard_model_name(settings),
            error="读取原图或执行预检时失败，原图已保留；如需再次判断，请删除后重新上传。",
        )

    return _finish_if_current(
        db,
        photo,
        attempt=attempt,
        status_value=(
            PhotoPrecheckStatus.PASSED
            if result.allowed
            else PhotoPrecheckStatus.REJECTED
        ),
        category=result.category,
        reason=result.reason,
        model=result.model,
        error=None,
        result_metadata=result.metadata(),
        source_width=result.source_width,
        source_height=result.source_height,
    )


def _finish_if_current(
    db: Session,
    photo: Any,
    *,
    attempt: int,
    status_value: PhotoPrecheckStatus,
    category: str | None,
    reason: str | None,
    model: str | None,
    error: str | None,
    result_metadata: dict[str, object] | None = None,
    source_width: int | None = None,
    source_height: int | None = None,
) -> Any:
    _refresh(db, photo)
    if (
        int(getattr(photo, "precheck_attempts", 0) or 0) != attempt
        or getattr(photo, "precheck_status", None)
        != PhotoPrecheckStatus.RUNNING.value
    ):
        return photo
    if hasattr(photo, "image_width"):
        photo.image_width = source_width
        photo.image_height = source_height
    _set_precheck_fields(
        photo,
        status_value=status_value,
        category=category,
        reason=reason,
        model=model,
        error=error,
        attempts=attempt,
        checked_at=datetime.now(UTC),
    )
    _update_json_metadata(photo, result_metadata=result_metadata)
    _commit_and_refresh(db, photo)
    logger.info(
        "photo_precheck_completed photo_id=%s status=%s category=%s attempt=%d",
        getattr(photo, "id", None),
        status_value.value,
        category,
        attempt,
    )
    return photo


def _set_precheck_fields(
    photo: Any,
    *,
    status_value: PhotoPrecheckStatus,
    category: str | None,
    reason: str | None,
    model: str | None,
    error: str | None,
    attempts: int,
    checked_at: datetime | None,
) -> None:
    photo.precheck_status = status_value.value
    photo.precheck_category = category
    photo.precheck_reason = reason
    photo.precheck_model = model
    photo.precheck_error = error
    photo.precheck_attempts = attempts
    photo.prechecked_at = checked_at


def _update_json_metadata(
    photo: Any,
    *,
    result_metadata: dict[str, object] | None = None,
) -> None:
    if not hasattr(photo, "metadata_json"):
        return
    metadata = dict(getattr(photo, "metadata_json", None) or {})
    metadata["photo_precheck"] = {
        "status": photo.precheck_status,
        "category": photo.precheck_category,
        "reason": photo.precheck_reason,
        "model": photo.precheck_model,
        "error": photo.precheck_error,
        "attempts": photo.precheck_attempts,
        "checked_at": (
            photo.prechecked_at.isoformat()
            if photo.prechecked_at is not None
            else None
        ),
        "result": result_metadata,
    }
    photo.metadata_json = metadata


def _refresh(db: Session, photo: Any) -> None:
    refresh = getattr(db, "refresh", None)
    if callable(refresh):
        refresh(photo)


def _commit_and_refresh(db: Session, photo: Any) -> None:
    db.commit()
    _refresh(db, photo)
