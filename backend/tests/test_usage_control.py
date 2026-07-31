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
