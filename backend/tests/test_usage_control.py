from app.core.config import get_settings
from app.services.usage_control import UsageControlStore


def test_atomic_daily_photo_quota_allows_exactly_fifty_and_supports_refund() -> None:
    store = UsageControlStore(get_settings())
    identity = "customer:2026-07-11"

    assert store.consume("trial:daily-photos", identity, amount=30, limit=50, ttl_seconds=3600).allowed
    assert store.consume("trial:daily-photos", identity, amount=20, limit=50, ttl_seconds=3600).allowed
    assert not store.consume("trial:daily-photos", identity, amount=1, limit=50, ttl_seconds=3600).allowed

    store.refund("trial:daily-photos", identity, amount=2)
    assert store.consume("trial:daily-photos", identity, amount=2, limit=50, ttl_seconds=3600).allowed


def test_non_expiring_quota_remains_without_an_expiry() -> None:
    store = UsageControlStore(get_settings())

    assert store.consume("basic:lifetime", "customer", amount=50, limit=50, ttl_seconds=None).allowed
    result = store.consume("basic:lifetime", "customer", amount=1, limit=50, ttl_seconds=None)

    assert not result.allowed
    assert result.retry_after is None


def test_non_expiring_quota_starts_from_persisted_usage_baseline() -> None:
    store = UsageControlStore(get_settings())

    assert store.consume(
        "basic:lifetime-baseline",
        "customer",
        amount=1,
        limit=50,
        ttl_seconds=None,
        baseline=49,
    ).allowed
    assert not store.consume(
        "basic:lifetime-baseline",
        "customer",
        amount=1,
        limit=50,
        ttl_seconds=None,
        baseline=50,
    ).allowed


def test_clear_limit_removes_an_accounts_quota_counter() -> None:
    store = UsageControlStore(get_settings())

    assert store.consume("quota", "customer", amount=50, limit=50, ttl_seconds=None).allowed
    store.clear_limit("quota", "customer")

    assert store.consume("quota", "customer", amount=50, limit=50, ttl_seconds=None).allowed
