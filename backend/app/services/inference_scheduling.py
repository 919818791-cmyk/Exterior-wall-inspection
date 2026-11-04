from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
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

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class InferenceUsageReservation:
    store: UsageControlStore
    user_identity: str
    user_slot_token: str
    global_slot_token: str
    released: bool = False
    lease_seconds: int = 900
    _heartbeat_task: asyncio.Task[None] | None = field(default=None, init=False, repr=False)

    @property
    def user_semaphore_scope(self) -> str:
        return f"trial:user-jobs:{self.user_identity}"

    def start_heartbeat(self, ttl_seconds: int) -> None:
        if self.released:
            raise RuntimeError("Cannot attach a released inference reservation.")
        self.lease_seconds = ttl_seconds
        if self._heartbeat_task is not None:
            self._heartbeat_task.cancel()
        try:
            job_task = asyncio.current_task()
        except RuntimeError:
            # Synchronous callers have no running inference coroutine.
            return
        if job_task is None:
            return

        async def heartbeat() -> None:
            while not self.released:
                await asyncio.sleep(min(30.0, ttl_seconds / 3))
                if self.released:
                    return
                try:
                    renewed = await asyncio.to_thread(
                        self.store.renew_job_reservation,
                        user_semaphore_scope=self.user_semaphore_scope,
                        user_semaphore_token=self.user_slot_token,
                        semaphore_scope="trial:inference-jobs",
                        semaphore_token=self.global_slot_token,
                        ttl_seconds=ttl_seconds,
                    )
                except Exception:
                    logger.exception("inference_job_lease_renewal_failed")
                    renewed = False
                if not renewed and not self.released:
                    logger.error("inference_job_lease_lost user_id=%s", self.user_identity)
                    job_task.cancel("检测任务调度锁续期失败，请稍后重试。")
                    return

        self._heartbeat_task = asyncio.create_task(heartbeat())

    def release(
        self,
        *,
        successful: bool,
        actual_api_request_count: int | None = None,
    ) -> None:
        if self.released:
            return
        self.released = True
        if self._heartbeat_task is not None:
            self._heartbeat_task.cancel()
        self.store.release_semaphore(
            "trial:inference-jobs",
            self.global_slot_token,
        )
        self.store.release_semaphore(
            self.user_semaphore_scope,
            self.user_slot_token,
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
    user_semaphore_scope = f"trial:user-jobs:{user_identity}"
    enforce_limit(
        store,
        "trial:generate:user",
        user_identity,
        limit=scheduling.generate_limit_per_user,
        ttl_seconds=scheduling.generate_window_seconds,
        detail=generate_limit_detail,
    )
    try:
        user_slot_token = store.acquire_semaphore(
            user_semaphore_scope,
            limit=scheduling.user_job_concurrency,
            ttl_seconds=scheduling.job_lock_seconds,
        )
    except SecurityStoreUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    if user_slot_token is None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"同一账号最多可同时执行 {scheduling.user_job_concurrency} 个检测任务，请稍后重试。",
            headers={"Retry-After": "30"},
        )

    try:
        global_slot_token = store.acquire_semaphore(
            "trial:inference-jobs",
            limit=scheduling.global_job_concurrency,
            ttl_seconds=scheduling.job_lock_seconds,
        )
    except SecurityStoreUnavailable as exc:
        store.release_semaphore(user_semaphore_scope, user_slot_token)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    if global_slot_token is None:
        store.release_semaphore(user_semaphore_scope, user_slot_token)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="当前检测任务较多，请稍后重试。",
            headers={"Retry-After": "30"},
        )

    reservation = InferenceUsageReservation(
        store=store,
        user_identity=user_identity,
        user_slot_token=user_slot_token,
        global_slot_token=global_slot_token,
        lease_seconds=scheduling.job_lock_seconds,
    )
    reservation.start_heartbeat(scheduling.job_lock_seconds)
    return reservation
