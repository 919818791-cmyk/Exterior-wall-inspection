from uuid import UUID

from fastapi import HTTPException
from fastapi.testclient import TestClient
from pytest import raises

from app.api.dependencies import AuthenticatedUser, require_roles
from app.core.security import create_access_token, decode_access_token, hash_password, verify_password
from app.enums.status import UserRole
from app.main import app


def test_phase8_auth_routes_are_registered() -> None:
    paths = {route.path for route in app.routes}

    assert "/api/auth/login" in paths
    assert "/api/auth/me" in paths
    assert "/api/auth/logout" in paths


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
