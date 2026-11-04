from dataclasses import replace
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api import accounts
from app.api.dependencies import AuthenticatedUser, get_current_user
from app.db.session import get_db
from app.main import app
from app.models.tables import UsageEvent, UserAccount
from app.schemas.account_usage import AccountQuotaAddRequest
from app.services import photo_upload_quota
from app.services.usage_control import get_usage_store, reset_usage_store


def add_event(db, user, source, amount, *, event_type="photo_detection", occurred_at=None):
    event = UsageEvent(
        event_key=str(uuid4()), event_type=event_type, source_type=source,
        actor_id=user.id, photo_count=amount, occurred_at=occurred_at or datetime.now(UTC),
    )
    db.add(event)
    db.commit()
    return event


@pytest.fixture
def quota_case(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    UserAccount.__table__.create(engine)
    UsageEvent.__table__.create(engine)
    scheduling = SimpleNamespace(trial_photo_detection_limit=1500, formal_photo_detection_limit=2500)
    monkeypatch.setattr(accounts, "trial_scheduling_settings", lambda *_: scheduling)
    monkeypatch.setattr(photo_upload_quota, "trial_scheduling_settings", lambda *_: scheduling)
    user = AuthenticatedUser(id=uuid4(), username="admin", real_name=None, role="admin", organization=None)
    with Session(engine) as db:
        db.add(UserAccount(
            id=user.id, username=user.username, password_hash="test", role=user.role,
            trial_detection_quota=1000, formal_detection_quota=2000,
        ))
        db.commit()
        yield db, user
    engine.dispose()


@pytest.mark.parametrize("amount", [200, 500, 1000])
def test_add_quota_replenishes_both_remaining_balances_without_changing_totals(quota_case, amount):
    db, user = quota_case
    add_event(db, user, "trial", 900)
    add_event(db, user, "formal", 1500)
    before = accounts.get_current_account_usage(user, db)
    result = accounts.add_current_account_quota(AccountQuotaAddRequest(amount=amount), user, db)
    account = db.get(UserAccount, user.id)
    assert (account.trial_detection_quota, account.formal_detection_quota) == (1000, 2000)
    assert account.quota_reset_at is None
    assert result.trial_photo_detection_balance.limit == 1000
    assert result.formal_photo_detection_balance.limit == 2000
    assert result.trial_photo_detection_balance.remaining == min(1000, 100 + amount)
    assert result.formal_photo_detection_balance.remaining == min(2000, 500 + amount)
    assert result.usage == before.usage
    assert result.usage.detected_photo_count == 2400
    assert accounts.get_current_account_usage(user, db) == result


def test_add_quota_uses_default_without_creating_account_override(quota_case):
    db, user = quota_case
    account = db.get(UserAccount, user.id)
    account.trial_detection_quota = account.formal_detection_quota = None
    db.commit()
    add_event(db, user, "trial", 800)
    result = accounts.add_current_account_quota(AccountQuotaAddRequest(amount=500), user, db)
    assert result.trial_photo_detection_balance.limit == 1500
    assert result.trial_photo_detection_balance.remaining == 1200
    assert result.formal_photo_detection_balance.limit == 2500
    assert result.formal_photo_detection_balance.remaining == 2500
    assert account.trial_detection_quota is None
    assert account.formal_detection_quota is None


@pytest.mark.parametrize("source", ["trial", "formal"])
def test_add_quota_caps_each_source_and_repeated_additions_cannot_exceed_total(quota_case, source):
    db, user = quota_case
    add_event(db, user, source, 150)
    for _ in range(3):
        result = accounts.add_current_account_quota(AccountQuotaAddRequest(amount=200), user, db)
        for name in ("trial", "formal"):
            balance = getattr(result, f"{name}_photo_detection_balance")
            assert balance.remaining == balance.limit
            assert balance.used == 0
    credits = db.scalars(select(UsageEvent).where(UsageEvent.event_type == photo_upload_quota.PHOTO_QUOTA_ADD_EVENT)).all()
    assert [(event.source_type, event.photo_count) for event in credits] == [(source, 150)]


@pytest.mark.parametrize("amount", [0, -200, 201, 1001, "500", 500.5])
def test_add_quota_accepts_only_the_three_fixed_amounts(amount):
    with pytest.raises(ValidationError):
        AccountQuotaAddRequest(amount=amount)


def test_add_quota_requires_authentication():
    client = TestClient(app)
    assert client.post("/api/accounts/me/add-quota", json={"amount": 200}).status_code == 401


@pytest.mark.parametrize("role", ["customer", "reviewer"])
def test_add_quota_rejects_non_admin_without_changing_balances(quota_case, role):
    db, user = quota_case
    user = replace(user, role=role)
    add_event(db, user, "trial", 400)
    add_event(db, user, "formal", 800)
    before = accounts.get_current_account_usage(user, db)
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db
    try:
        assert TestClient(app).post("/api/accounts/me/add-quota", json={"amount": 200}).status_code == 403
        assert accounts.get_current_account_usage(user, db) == before
        assert not db.scalars(select(UsageEvent).where(
            UsageEvent.event_type == photo_upload_quota.PHOTO_QUOTA_ADD_EVENT,
        )).all()
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_db, None)


def test_add_quota_route_allows_admin(quota_case):
    db, user = quota_case
    add_event(db, user, "trial", 400)
    add_event(db, user, "formal", 800)
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db
    try:
        response = TestClient(app).post("/api/accounts/me/add-quota", json={"amount": 200})
        assert response.status_code == 200
        assert response.json()["account_id"] == str(user.id)
        assert response.json()["trial_photo_detection_balance"] == {"limit": 1000, "remaining": 800, "used": 200}
        assert response.json()["formal_photo_detection_balance"] == {"limit": 2000, "remaining": 1400, "used": 600}
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_db, None)


def test_added_quota_is_persisted_for_next_session(quota_case):
    db, user = quota_case
    add_event(db, user, "trial", 800)
    add_event(db, user, "formal", 1000)
    accounts.add_current_account_quota(AccountQuotaAddRequest(amount=500), user, db)
    with Session(db.get_bind()) as next_db:
        stored = next_db.get(UserAccount, user.id)
        assert stored.trial_detection_quota == 1000
        assert stored.formal_detection_quota == 2000
        result = accounts.get_current_account_usage(user, next_db)
        assert result.trial_photo_detection_balance.remaining == 700
        assert result.formal_photo_detection_balance.remaining == 1500


@pytest.mark.parametrize("source", ["trial", "formal"])
@pytest.mark.parametrize("warm_counter", [False, True])
def test_added_balance_can_be_consumed_but_not_exceeded(quota_case, monkeypatch, source, warm_counter):
    db, user = quota_case
    limit = getattr(db.get(UserAccount, user.id), f"{source}_detection_quota")
    add_event(db, user, source, limit)
    if warm_counter:
        scope = photo_upload_quota.TRIAL_LIFETIME_SCOPE if source == "trial" else photo_upload_quota.FORMAL_LIFETIME_SCOPE
        assert get_usage_store().consume(scope, str(user.id), amount=limit, limit=limit, ttl_seconds=None).allowed
    accounts.add_current_account_quota(AccountQuotaAddRequest(amount=200), user, db)
    monkeypatch.setattr(photo_upload_quota, "_pending_photo_count", lambda *_: 0)
    photo_upload_quota.ensure_photo_upload_capacity(db, user.id, source=source, amount=200)
    with pytest.raises(HTTPException) as error:
        photo_upload_quota.ensure_photo_upload_capacity(db, user.id, source=source, amount=201)
    assert error.value.status_code == 409
    photo_upload_quota.reserve_photo_detection_quota(user.id, source=source, amount=200, db=db)
    add_event(db, user, source, 200)
    with pytest.raises(HTTPException) as error:
        photo_upload_quota.reserve_photo_detection_quota(user.id, source=source, db=db)
    assert error.value.status_code == 429
    assert getattr(accounts.get_current_account_usage(user, db), f"{source}_photo_detection_balance").remaining == 0
    # Losing the cache must not restore already-consumed credits.
    reset_usage_store()
    with pytest.raises(HTTPException):
        photo_upload_quota.reserve_photo_detection_quota(user.id, source=source, db=db)


def test_reset_excludes_old_credits_and_preserves_detection_statistics(quota_case):
    db, user = quota_case
    add_event(db, user, "trial", 500, occurred_at=datetime.now(UTC) - timedelta(days=2))
    add_event(db, user, "trial", 200, event_type=photo_upload_quota.PHOTO_QUOTA_ADD_EVENT,
              occurred_at=datetime.now(UTC) - timedelta(days=1))
    account = db.get(UserAccount, user.id)
    account.quota_reset_at = datetime.now(UTC) - timedelta(hours=1)
    db.commit()
    add_event(db, user, "trial", 100)
    usage = accounts.get_current_account_usage(user, db)
    assert usage.trial_photo_detection_balance.remaining == 900
    assert photo_upload_quota._quota_limit_and_baseline(db, user.id, "trial") == (1000, 100)
    summary = accounts.list_account_usage_summary(user, db)
    assert summary[0].detected_photo_count == 600


def test_quota_add_locks_only_the_authenticated_account(quota_case, monkeypatch):
    db, user = quota_case
    original_scalar = db.scalar
    statements = []

    def scalar(statement, *args, **kwargs):
        statements.append(statement)
        return original_scalar(statement, *args, **kwargs)

    monkeypatch.setattr(db, "scalar", scalar)
    accounts.add_current_account_quota(AccountQuotaAddRequest(amount=200), user, db)
    statement = statements[0]
    assert statement._for_update_arg is not None
    assert user.id in statement.compile().params.values()
