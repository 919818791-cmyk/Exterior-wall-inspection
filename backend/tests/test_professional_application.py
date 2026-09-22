from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import UUID

from fastapi.testclient import TestClient

from app.api.dependencies import AuthenticatedUser, get_current_user
from app.db.session import get_db
from app.enums.status import AccountPlan, ProfessionalApplicationStatus, UserRole, UserStatus
from app.main import app


ACCOUNT_ID = UUID("00000000-0000-0000-0000-000000000001")


def _account() -> SimpleNamespace:
    now = datetime.now(UTC)
    return SimpleNamespace(
        id=ACCOUNT_ID,
        username="customer",
        real_name="申请用户",
        phone="13800000001",
        role=UserRole.CUSTOMER.value,
        account_plan=AccountPlan.BASIC.value,
        professional_application_status=None,
        professional_application_requested_at=None,
        professional_application_reviewed_at=None,
        professional_application_duration_months=None,
        professional_plan_expires_at=None,
        organization="示例单位",
        status=UserStatus.ACTIVE.value,
        last_login_at=None,
        deleted_at=None,
        created_at=now,
        updated_at=now,
    )


class FakeDb:
    def __init__(self, account: SimpleNamespace) -> None:
        self.account = account
        self.commit_count = 0

    def get(self, _model: object, account_id: UUID) -> SimpleNamespace | None:
        return self.account if account_id == self.account.id else None

    def scalar(self, _statement: object) -> SimpleNamespace:
        return self.account

    def commit(self) -> None:
        self.commit_count += 1

    def refresh(self, _account: object) -> None:
        return None


def _user(role: UserRole) -> AuthenticatedUser:
    return AuthenticatedUser(
        id=ACCOUNT_ID,
        username=role.value,
        real_name=None,
        role=role.value,
        organization=None,
    )


def test_customer_can_submit_professional_application() -> None:
    account = _account()
    fake_db = FakeDb(account)
    app.dependency_overrides[get_current_user] = lambda: _user(UserRole.CUSTOMER)
    app.dependency_overrides[get_db] = lambda: fake_db

    try:
        response = TestClient(app).post("/api/accounts/me/professional-application")
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_db, None)

    assert response.status_code == 200
    assert response.json()["status"] == ProfessionalApplicationStatus.PENDING.value
    assert account.professional_application_status == ProfessionalApplicationStatus.PENDING.value
    assert account.professional_application_requested_at is not None
    assert fake_db.commit_count == 1


def test_admin_can_approve_then_reject_professional_application() -> None:
    account = _account()
    account.professional_application_status = ProfessionalApplicationStatus.PENDING.value
    account.professional_application_requested_at = datetime.now(UTC)
    fake_db = FakeDb(account)
    app.dependency_overrides[get_current_user] = lambda: _user(UserRole.ADMIN)
    app.dependency_overrides[get_db] = lambda: fake_db
    client = TestClient(app)

    try:
        approved = client.post(
            f"/api/accounts/{ACCOUNT_ID}/professional-application/review",
            json={"decision": "approved", "duration_months": 12},
        )
        rejected = client.post(
            f"/api/accounts/{ACCOUNT_ID}/professional-application/review",
            json={"decision": "rejected", "duration_months": 6},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_db, None)

    assert approved.status_code == 200
    assert approved.json()["professional_application_status"] == "approved"
    assert approved.json()["professional_application_duration_months"] == 12
    assert approved.json()["account_plan"] == "professional"
    assert approved.json()["professional_plan_expires_at"] is not None

    assert rejected.status_code == 200
    assert rejected.json()["professional_application_status"] == "rejected"
    assert rejected.json()["professional_application_duration_months"] == 6
    assert rejected.json()["account_plan"] == "basic"
    assert rejected.json()["professional_plan_expires_at"] is None
    assert fake_db.commit_count == 2
