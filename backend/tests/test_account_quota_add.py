from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.api import accounts
from app.api.dependencies import AuthenticatedUser, get_current_user
from app.db.session import get_db
from app.main import app
from app.models.tables import UserAccount
from app.schemas.account_usage import AccountQuotaAddRequest


class QuotaDb:
    def __init__(self, trial_limit=1000):
        self.account = SimpleNamespace(
            trial_detection_quota=trial_limit, formal_detection_quota=2000, quota_reset_at=None,
        )
        self.commits = 0

    def scalar(self, statement):
        self.statement = statement
        return self.account

    def get(self, model, _):
        return self.account if model is UserAccount else None

    def commit(self):
        self.commits += 1

    def execute(self, _):
        event = SimpleNamespace(
            occurred_at=datetime.now(UTC), event_type="photo_detection", source_type="trial",
            photo_count=150, api_request_count=0, token_count=0, input_token_count=0,
            output_token_count=0, trial_task_count=0,
        )
        return SimpleNamespace(all=lambda: [event])


@pytest.mark.parametrize("amount", [200, 500, 1000])
@pytest.mark.parametrize("role", ["customer", "admin"])
def test_add_quota_increases_both_balances_and_preserves_used_photos(amount, role):
    db = QuotaDb()
    user = AuthenticatedUser(id=uuid4(), username=role, real_name=None, role=role, organization=None)
    result = accounts.add_current_account_quota(AccountQuotaAddRequest(amount=amount), user, db)
    assert db.commits == 1
    assert db.account.trial_detection_quota == 1000 + amount
    assert db.account.formal_detection_quota == 2000 + amount
    assert db.account.quota_reset_at is None
    assert result.trial_photo_detection_balance.remaining == 850 + amount
    assert result.trial_photo_detection_balance.used == 150
    assert result.formal_photo_detection_balance.limit == 2000 + amount
    # The account row is locked, and only the authenticated account is addressed.
    assert db.statement._for_update_arg is not None
    assert user.id in db.statement.compile().params.values()
    refreshed = accounts.get_current_account_usage(user, db)
    assert refreshed == result


def test_add_quota_uses_effective_default_when_account_has_no_override(monkeypatch):
    monkeypatch.setattr(accounts, "trial_scheduling_settings", lambda *_: SimpleNamespace(
        trial_photo_detection_limit=1500, formal_photo_detection_limit=1000,
    ))
    db = QuotaDb(trial_limit=None)
    user = AuthenticatedUser(id=uuid4(), username="customer", real_name=None, role="customer", organization=None)
    result = accounts.add_current_account_quota(AccountQuotaAddRequest(amount=500), user, db)
    assert result.trial_photo_detection_balance.limit == 2000


@pytest.mark.parametrize("source", ["trial", "formal"])
def test_add_quota_rejects_limit_overflow_without_changing_either_balance(source):
    db = QuotaDb()
    setattr(db.account, f"{source}_detection_quota", 99900)
    before = (db.account.trial_detection_quota, db.account.formal_detection_quota)
    user = AuthenticatedUser(id=uuid4(), username="customer", real_name=None, role="customer", organization=None)
    with pytest.raises(HTTPException) as error:
        accounts.add_current_account_quota(AccountQuotaAddRequest(amount=200), user, db)
    assert error.value.status_code == 409
    assert (db.account.trial_detection_quota, db.account.formal_detection_quota) == before
    assert db.commits == 0


@pytest.mark.parametrize("amount", [0, -200, 201, 1001, "500", 500.5])
def test_add_quota_accepts_only_the_three_fixed_amounts(amount):
    with pytest.raises(ValidationError):
        AccountQuotaAddRequest(amount=amount)


def test_add_quota_requires_authenticated_customer_or_admin():
    client = TestClient(app)
    assert client.post("/api/accounts/me/add-quota", json={"amount": 200}).status_code == 401
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        id=uuid4(), username="reviewer", real_name=None, role="reviewer", organization=None,
    )
    try:
        assert client.post("/api/accounts/me/add-quota", json={"amount": 200}).status_code == 403
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.parametrize("role", ["customer", "admin"])
def test_add_quota_route_allows_customers_and_admins(role):
    db = QuotaDb()
    user = AuthenticatedUser(id=uuid4(), username=role, real_name=None, role=role, organization=None)
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db
    try:
        response = TestClient(app).post("/api/accounts/me/add-quota", json={"amount": 200})
        assert response.status_code == 200
        assert response.json()["account_id"] == str(user.id)
        assert response.json()["trial_photo_detection_balance"]["remaining"] == 1050
        assert response.json()["formal_photo_detection_balance"]["remaining"] == 2200
        assert db.commits == 1
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_db, None)


def test_added_quota_is_persisted_for_next_session(monkeypatch):
    engine = create_engine("sqlite://")
    UserAccount.__table__.create(engine)
    with engine.begin() as connection:
        connection.execute(text("""
            CREATE TABLE usage_event (
                actor_id CHAR(32), occurred_at DATETIME, event_type TEXT, source_type TEXT,
                photo_count INTEGER, api_request_count INTEGER, token_count INTEGER,
                input_token_count INTEGER, output_token_count INTEGER, trial_task_count INTEGER
            )
        """))
    monkeypatch.setattr(accounts, "trial_scheduling_settings", lambda *_: SimpleNamespace(
        trial_photo_detection_limit=1000, formal_photo_detection_limit=1000,
    ))
    account_id = uuid4()
    user = AuthenticatedUser(id=account_id, username="customer", real_name=None, role="customer", organization=None)
    with Session(engine) as db:
        db.add(UserAccount(id=account_id, username="customer", password_hash="test", trial_detection_quota=1000, formal_detection_quota=2000))
        db.commit()
        result = accounts.add_current_account_quota(AccountQuotaAddRequest(amount=500), user, db)
        assert result.trial_photo_detection_balance.remaining == 1500
    with Session(engine) as next_db:
        stored = next_db.get(UserAccount, account_id)
        assert stored.trial_detection_quota == 1500
        assert stored.formal_detection_quota == 2500
        assert accounts.get_current_account_usage(user, next_db).trial_photo_detection_balance.remaining == 1500
