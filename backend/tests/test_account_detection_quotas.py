from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.api import accounts
from app.api.dependencies import AuthenticatedUser
from app.models.tables import UserAccount
from app.schemas.auth import AccountCreateRequest, AccountUpdateRequest


def test_new_accounts_default_both_quotas_to_one_thousand() -> None:
    payload = AccountCreateRequest(username="quota-customer", password="Customer123!")
    assert payload.trial_detection_quota == 1000
    assert payload.formal_detection_quota == 1000


@pytest.mark.parametrize("field", ["trial_detection_quota", "formal_detection_quota"])
@pytest.mark.parametrize("value", [0, -1, 100001, 1.5])
def test_each_account_quota_rejects_invalid_limits(field, value) -> None:
    with pytest.raises(ValidationError):
        AccountUpdateRequest.model_validate({field: value})


def test_account_creation_and_partial_updates_preserve_independent_quotas(monkeypatch) -> None:
    class FakeDb:
        def scalar(self, _):
            return None

        def add(self, account):
            self.account = account
            account.id = uuid4()
            account.created_at = account.updated_at = datetime.now(UTC)

        def commit(self):
            pass

        def refresh(self, _):
            pass

    db = FakeDb()
    admin = AuthenticatedUser(id=uuid4(), username="admin", real_name=None, role="admin", organization=None)
    created = accounts.create_account(
        AccountCreateRequest(
            username="quota-customer", password="Customer123!",
            trial_detection_quota=1200, formal_detection_quota=2400,
        ), admin, db,
    )
    assert (created.trial_detection_quota, created.formal_detection_quota) == (1200, 2400)
    monkeypatch.setattr(accounts, "_account_or_404", lambda *_: db.account)
    updated = accounts.update_account(created.id, AccountUpdateRequest(trial_detection_quota=1500), admin, db)
    assert (updated.trial_detection_quota, updated.formal_detection_quota) == (1500, 2400)
    updated = accounts.update_account(created.id, AccountUpdateRequest(formal_detection_quota=3000), admin, db)
    assert (updated.trial_detection_quota, updated.formal_detection_quota) == (1500, 3000)


@pytest.mark.parametrize("role", ["customer", "admin"])
def test_usage_balances_use_each_account_quota_separately(monkeypatch, role) -> None:
    class FakeDb:
        def get(self, model, _):
            if model is UserAccount:
                return SimpleNamespace(trial_detection_quota=123, formal_detection_quota=456, quota_reset_at=None)
            return None

        def execute(self, _):
            return SimpleNamespace(all=lambda: [])

    monkeypatch.setattr(
        accounts, "trial_scheduling_settings",
        lambda *_: SimpleNamespace(trial_photo_detection_limit=1000, formal_photo_detection_limit=1000),
    )
    user = AuthenticatedUser(id=uuid4(), username=role, real_name=None, role=role, organization=None)
    result = accounts.get_current_account_usage(user, FakeDb())
    assert result.trial_photo_detection_balance.limit == 123
    assert result.formal_photo_detection_balance.limit == 456
