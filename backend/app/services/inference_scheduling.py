from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.services.trial_inference_provider import trial_scheduling_settings
from app.services.usage_control import (
    SecurityStoreUnavailable,
    UsageControlStore,
    enforce_limit,
    get_usage_store,
)


@dataclass(slots=True)
class InferenceUsageReservation:
    store: UsageControlStore
    user_identity: str
    user_lock_token: str
    global_slot_token: str
    released: bool = False

    def release(
        self,
        *,
        successful: bool,
        actual_api_request_count: int | None = None,
    ) -> None:
        if self.released:
            return
        self.released = True
        self.store.release_semaphore(
            "trial:inference-jobs",
            self.global_slot_token,
        )
        self.store.release_lock(
            "trial:user-job",
            self.user_identity,
            self.user_lock_token,
        )


def reserve_inference_usage(
    actor_id: UUID,
    api_request_count: int,
    *,
    db: Session | None = None,
    generate_limit_detail: str = "检测请求过于频繁，请稍后重试。",
    settings: Settings | None = None,
) -> InferenceUsageReservation:
    """Reserve the scheduler shared by TRIAL and formal detection jobs."""
    settings = settings or get_settings()
    scheduling = trial_scheduling_settings(db, settings)
    store = get_usage_store()
    user_identity = str(actor_id)
    enforce_limit(
        store,
        "trial:generate:user",
        user_identity,
        limit=scheduling.generate_limit_per_user,
        ttl_seconds=scheduling.generate_window_seconds,
        detail=generate_limit_detail,
    )
    try:
        user_lock_token = store.acquire_lock(
            "trial:user-job",
            user_identity,
            ttl_seconds=scheduling.job_lock_seconds,
        )
    except SecurityStoreUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    if user_lock_token is None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="同一账号只能同时执行一个检测任务。",
            headers={"Retry-After": "30"},
        )

    try:
        global_slot_token = store.acquire_semaphore(
            "trial:inference-jobs",
            limit=scheduling.global_job_concurrency,
            ttl_seconds=scheduling.job_lock_seconds,
        )
    except SecurityStoreUnavailable as exc:
        store.release_lock("trial:user-job", user_identity, user_lock_token)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    if global_slot_token is None:
        store.release_lock("trial:user-job", user_identity, user_lock_token)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="当前检测任务较多，请稍后重试。",
            headers={"Retry-After": "30"},
        )

    return InferenceUsageReservation(
        store=store,
        user_identity=user_identity,
        user_lock_token=user_lock_token,
        global_slot_token=global_slot_token,
    )
