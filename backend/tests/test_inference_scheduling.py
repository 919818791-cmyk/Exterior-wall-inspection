import asyncio
from types import SimpleNamespace
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor

from fastapi import HTTPException

import pytest

from app.core.config import get_settings
from app.services.inference_scheduling import InferenceUsageReservation, reserve_inference_usage
from app.services.usage_control import UsageControlStore


def test_owned_job_leases_renew_past_original_expiry(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr("app.services.usage_control.time.time", lambda: clock[0])
    store = UsageControlStore(get_settings())
    lock = store.acquire_semaphore("trial:user-jobs:customer", limit=1, ttl_seconds=60)
    slot = store.acquire_semaphore("trial:inference-jobs", limit=1, ttl_seconds=60)
    clock[0] += 40
    assert store.renew_job_reservation(
        user_semaphore_scope="trial:user-jobs:customer", user_semaphore_token=lock,
        semaphore_scope="trial:inference-jobs", semaphore_token=slot, ttl_seconds=60,
    )
    clock[0] += 30
    assert store.acquire_semaphore("trial:user-jobs:customer", limit=1, ttl_seconds=60) is None
    assert store.acquire_semaphore("trial:inference-jobs", limit=1, ttl_seconds=60) is None
    store.release_semaphore("trial:user-jobs:customer", lock)
    store.release_semaphore("trial:inference-jobs", slot)
    assert store.acquire_semaphore("trial:user-jobs:customer", limit=1, ttl_seconds=60)
    assert store.acquire_semaphore("trial:inference-jobs", limit=1, ttl_seconds=60)


@pytest.mark.parametrize("lost", ["expired", "lock", "slot", "wrong_owner"])
def test_renewal_does_not_revive_lost_leases(monkeypatch, lost):
    clock = [1000.0]
    monkeypatch.setattr("app.services.usage_control.time.time", lambda: clock[0])
    store = UsageControlStore(get_settings())
    lock = store.acquire_semaphore("trial:user-jobs:customer", limit=1, ttl_seconds=60)
    slot = store.acquire_semaphore("trial:inference-jobs", limit=1, ttl_seconds=60)
    if lost == "expired":
        clock[0] += 61
    elif lost == "lock":
        store.release_semaphore("trial:user-jobs:customer", lock)
    elif lost == "slot":
        store.release_semaphore("trial:inference-jobs", slot)
    else:
        lock = "different-owner"
    assert not store.renew_job_reservation(
        user_semaphore_scope="trial:user-jobs:customer", user_semaphore_token=lock,
        semaphore_scope="trial:inference-jobs", semaphore_token=slot, ttl_seconds=60,
    )


def test_heartbeat_renews_and_stops_when_reservation_released():
    async def scenario():
        renewed = asyncio.Event()
        loop = asyncio.get_running_loop()
        calls = []

        def renew(**kwargs):
            calls.append(kwargs)
            loop.call_soon_threadsafe(renewed.set)
            return True

        store = SimpleNamespace(
            renew_job_reservation=renew,
            release_lock=lambda *args: None,
            release_semaphore=lambda *args: None,
        )
        reservation = InferenceUsageReservation(store, "customer", "lock", "slot")
        reservation.start_heartbeat(0.03)
        await asyncio.wait_for(renewed.wait(), timeout=1)
        reservation.release(successful=True)
        await asyncio.gather(reservation._heartbeat_task, return_exceptions=True)
        call_count = len(calls)
        await asyncio.sleep(0.04)
        assert len(calls) == call_count
        assert calls[0]["user_semaphore_token"] == "lock"
        assert calls[0]["semaphore_token"] == "slot"

    asyncio.run(scenario())


def test_lost_lease_cancels_inference_instead_of_running_without_a_slot():
    async def scenario():
        store = SimpleNamespace(
            renew_job_reservation=lambda **kwargs: False,
            release_lock=lambda *args: None,
            release_semaphore=lambda *args: None,
        )
        reservation = InferenceUsageReservation(store, "customer", "lock", "slot")
        reservation.start_heartbeat(0.03)
        try:
            with pytest.raises(asyncio.CancelledError, match="调度锁续期失败"):
                await asyncio.sleep(1)
        finally:
            reservation.release(successful=False)
            await asyncio.gather(reservation._heartbeat_task, return_exceptions=True)

    asyncio.run(scenario())


def test_heartbeat_ownership_moves_from_submission_to_background_job():
    async def scenario():
        store = SimpleNamespace(
            renew_job_reservation=lambda **kwargs: False,
            release_lock=lambda *args: None,
            release_semaphore=lambda *args: None,
        )

        async def submit():
            reservation = InferenceUsageReservation(store, "customer", "lock", "slot")
            reservation.start_heartbeat(3)
            return reservation

        submission = asyncio.create_task(submit())
        reservation = await submission
        request_heartbeat = reservation._heartbeat_task

        async def background_job():
            reservation.start_heartbeat(0.03)
            try:
                await asyncio.sleep(1)
            finally:
                reservation.release(successful=False)

        job = asyncio.create_task(background_job())
        with pytest.raises(asyncio.CancelledError, match="调度锁续期失败"):
            await job
        assert submission.done() and not submission.cancelled()
        await asyncio.gather(request_heartbeat, reservation._heartbeat_task, return_exceptions=True)
        assert request_heartbeat.cancelled()

    asyncio.run(scenario())


@pytest.mark.parametrize("limit", [1, 2, 10])
def test_account_concurrency_is_atomic_and_releases_only_its_own_slot(limit):
    actor = uuid4()
    settings = get_settings().model_copy(update={
        "trial_user_job_concurrency": limit, "trial_global_job_concurrency": 10,
    })

    def submit(_):
        try:
            return reserve_inference_usage(actor, 1, settings=settings)
        except HTTPException as exc:
            assert exc.status_code == 429
            assert f"{limit} 个检测任务" in exc.detail
            return None

    with ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(submit, range(16)))
    reservations = [item for item in results if item is not None]
    assert len(reservations) == limit
    reservations[0].release(successful=False)
    replacement = reserve_inference_usage(actor, 1, settings=settings)
    # Releasing the same reservation twice must not free someone else's slot.
    reservations[0].release(successful=True)
    assert submit(None) is None
    replacement.release(successful=True)
    for reservation in reservations:
        reservation.release(successful=True)


def test_global_limit_is_shared_across_accounts_and_failed_admission_frees_user_slot():
    settings = get_settings().model_copy(update={
        "trial_user_job_concurrency": 2, "trial_global_job_concurrency": 2,
    })
    actor, other = uuid4(), uuid4()
    first = reserve_inference_usage(actor, 1, settings=settings)
    second = reserve_inference_usage(other, 1, settings=settings)
    for _ in range(3):
        with pytest.raises(HTTPException, match="当前检测任务较多"):
            reserve_inference_usage(other, 1, settings=settings)
    first.release(successful=True)
    replacement = reserve_inference_usage(other, 1, settings=settings)
    replacement.release(successful=True)
    second.release(successful=True)


def test_changed_account_limit_applies_to_new_admissions_without_stopping_existing_jobs():
    actor = uuid4()
    settings = get_settings().model_copy(update={"trial_user_job_concurrency": 1})
    first = reserve_inference_usage(actor, 1, settings=settings)
    settings.trial_user_job_concurrency = 2
    second = reserve_inference_usage(actor, 1, settings=settings)
    settings.trial_user_job_concurrency = 1
    first.release(successful=True)
    with pytest.raises(HTTPException, match="1 个检测任务"):
        reserve_inference_usage(actor, 1, settings=settings)
    second.release(successful=True)
    final = reserve_inference_usage(actor, 1, settings=settings)
    final.release(successful=True)


def test_global_store_failure_releases_user_slot(monkeypatch):
    from app.services.usage_control import SecurityStoreUnavailable, get_usage_store

    store = get_usage_store()
    original = store.acquire_semaphore

    def acquire(scope, **kwargs):
        if scope == "trial:inference-jobs":
            raise SecurityStoreUnavailable("store unavailable")
        return original(scope, **kwargs)

    monkeypatch.setattr(store, "acquire_semaphore", acquire)
    actor = uuid4()
    with pytest.raises(HTTPException) as raised:
        reserve_inference_usage(actor, 1)
    assert raised.value.status_code == 503
    monkeypatch.setattr(store, "acquire_semaphore", original)
    reservation = reserve_inference_usage(actor, 1)
    reservation.release(successful=True)
