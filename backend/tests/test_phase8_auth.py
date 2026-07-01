from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException
from fastapi.testclient import TestClient
from pytest import raises

from app.api.dependencies import AuthenticatedSession, AuthenticatedUser, get_current_session, get_current_user, require_roles
from app.core.security import create_access_token, decode_access_token, hash_password, verify_password
from app.db.session import get_db
from app.enums.status import UserRole
from app.main import app


def test_phase8_auth_routes_are_registered() -> None:
    paths = {route.path for route in app.routes}

    assert "/api/auth/login" in paths
    assert "/api/auth/me" in paths
    assert "/api/auth/change-password" in paths
    assert "/api/auth/logout" in paths
    assert "/api/accounts" in paths
    assert "/api/accounts/{account_id}" in paths
    assert "/api/accounts/{account_id}/reset-password" in paths


def test_password_and_signed_session_contract() -> None:
    password_hash = hash_password("Customer123!")
    token, _, _ = create_access_token(
        user_id="00000000-0000-0000-0000-000000000001",
        role=UserRole.CUSTOMER.value,
    )

    assert verify_password("Customer123!", password_hash)
    assert not verify_password("wrong-password", password_hash)
    assert decode_access_token(token)["role"] == UserRole.CUSTOMER.value
    assert decode_access_token(f"{token}tampered") is None


def test_customer_is_rejected_from_review_boundary() -> None:
    customer = AuthenticatedUser(
        id=UUID("00000000-0000-0000-0000-000000000001"),
        username="customer",
        real_name="演示客户",
        role=UserRole.CUSTOMER.value,
        organization=None,
    )
    reviewer_guard = require_roles(UserRole.REVIEWER, UserRole.ADMIN)

    with raises(HTTPException) as raised:
        reviewer_guard(customer)

    assert raised.value.status_code == 403


def test_review_api_requires_authenticated_reviewer() -> None:
    response = TestClient(app).get("/api/review/projects")

    assert response.status_code == 401


def test_change_password_updates_hash_and_revokes_current_session() -> None:
    class FakeUser:
        password_hash = hash_password("Customer123!")

    class FakeDb:
        def __init__(self) -> None:
            self.user = FakeUser()
            self.committed = False

        def get(self, _model: object, _user_id: UUID) -> FakeUser:
            return self.user

        def commit(self) -> None:
            self.committed = True

    fake_db = FakeDb()
    user = AuthenticatedUser(
        id=UUID("00000000-0000-0000-0000-000000000001"),
        username="customer",
        real_name="演示客户",
        role=UserRole.CUSTOMER.value,
        organization=None,
    )
    session = AuthenticatedSession(user=user, token_id="change-password-test", expires_at=4_102_444_800)
    app.dependency_overrides[get_current_session] = lambda: session
    app.dependency_overrides[get_db] = lambda: fake_db

    try:
        response = TestClient(app).post(
            "/api/auth/change-password",
            json={"current_password": "Customer123!", "new_password": "Changed123!"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert fake_db.committed
    assert verify_password("Changed123!", fake_db.user.password_hash)
    assert not verify_password("Customer123!", fake_db.user.password_hash)


def test_admin_reset_account_password_uses_default_password() -> None:
    class FakeAccount:
        id = UUID("00000000-0000-0000-0000-000000000001")
        username = "customer"
        real_name = "演示客户"
        phone = None
        role = UserRole.CUSTOMER.value
        organization = None
        status = "active"
        last_login_at = None
        created_at = datetime.now(UTC)
        updated_at = datetime.now(UTC)
        password_hash = hash_password("OldPassword123!")

    class FakeDb:
        def __init__(self) -> None:
            self.account = FakeAccount()
            self.committed = False

        def scalar(self, _: object) -> FakeAccount:
            return self.account

        def commit(self) -> None:
            self.committed = True

        def refresh(self, _: object) -> None:
            return None

    fake_db = FakeDb()
    admin = AuthenticatedUser(
        id=UUID("00000000-0000-0000-0000-000000000003"),
        username="admin",
        real_name="平台管理员",
        role=UserRole.ADMIN.value,
        organization=None,
    )
    app.dependency_overrides[get_current_user] = lambda: admin
    app.dependency_overrides[get_db] = lambda: fake_db

    try:
        response = TestClient(app).post("/api/accounts/00000000-0000-0000-0000-000000000001/reset-password")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert fake_db.committed
    assert verify_password("123456", fake_db.account.password_hash)
    assert not verify_password("OldPassword123!", fake_db.account.password_hash)
