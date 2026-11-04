from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient

from app.api.dependencies import AuthenticatedUser
from app.enums.status import UserRole, UserStatus
from app.main import app
from app.models.tables import UserAccount
from app.schemas.auth import AccountCreateRequest, AccountRead, AccountUpdateRequest, AuthUserRead


def test_account_and_auth_contracts_have_no_plan_fields() -> None:
    for model in (AccountCreateRequest, AccountUpdateRequest, AccountRead, AuthUserRead):
        assert not any("plan" in field or "professional_application" in field for field in model.model_fields)
    assert not any("plan" in column or "professional_application" in column for column in UserAccount.__table__.columns.keys())


def test_existing_account_serialization_ignores_retired_plan_metadata() -> None:
    now = datetime.now(UTC)
    account = SimpleNamespace(
        id=uuid4(), username="customer", real_name=None, phone=None,
        role=UserRole.CUSTOMER.value, organization=None, status=UserStatus.ACTIVE.value,
        trial_detection_quota=123, formal_detection_quota=456,
        last_login_at=None, created_at=now, updated_at=now,
        account_plan="professional", professional_plan_expires_at=now,
    )
    result = AccountRead.model_validate(account).model_dump()
    assert result["trial_detection_quota"] == 123
    assert result["formal_detection_quota"] == 456
    assert "account_plan" not in result
    assert "professional_plan_expires_at" not in result
    assert AuthenticatedUser.from_model(account).role == UserRole.CUSTOMER.value


def test_plan_application_and_review_endpoints_are_removed() -> None:
    client = TestClient(app)
    assert client.post("/api/accounts/me/professional-application").status_code == 404
    assert client.post(f"/api/accounts/{uuid4()}/professional-application/review").status_code == 404
