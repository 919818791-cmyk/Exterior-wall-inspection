from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.api import auth
from app.core.config import Settings, get_settings
from app.core.security import hash_password
from app.db.session import get_db
from app.main import app
from app.services.usage_control import UsageControlStore

from sample_data import synthetic_phone


@pytest.fixture
def login_client(monkeypatch):
    settings = get_settings().model_copy(update={
        "login_rate_limit_enabled": True,
        "login_rate_limit_per_identity": 5,
        "login_rate_window_seconds": 900,
    })
    store = UsageControlStore(settings)
    user = SimpleNamespace(
        id=UUID("00000000-0000-0000-0000-000000000010"),
        username="rate_limit_user",
        real_name=None,
        phone=synthetic_phone(1),
        role="customer",
        organization=None,
        status="active",
        password_hash=hash_password("LoginTest123!"),
    )
    db = SimpleNamespace(
        scalar=lambda _: user,
        flush=lambda: None,
        commit=lambda: None,
    )
    monkeypatch.setattr(auth, "get_settings", lambda: settings)
    monkeypatch.setattr(auth, "get_usage_store", lambda: store)
    monkeypatch.setattr(auth, "ensure_demo_users", lambda _: None)
    monkeypatch.setitem(app.dependency_overrides, get_db, lambda: db)
    return SimpleNamespace(client=TestClient(app), settings=settings, store=store, user=user, db=db)


def test_login_rate_limit_is_enabled_by_default(monkeypatch):
    monkeypatch.delenv("LOGIN_RATE_LIMIT_ENABLED", raising=False)
    assert Settings(_env_file=None).login_rate_limit_enabled is True


@pytest.mark.parametrize("enabled", [True, False])
@pytest.mark.parametrize("valid_password", [True, False])
def test_login_rate_limit_switch(login_client, enabled, valid_password):
    login_client.settings.login_rate_limit_enabled = enabled
    client = login_client.client
    expected_status = 200 if valid_password else 401
    for attempt in range(7):
        response = client.post("/api/auth/login", json={
            "username": login_client.user.username,
            "password": "LoginTest123!" if valid_password else "wrong-password",
        })
        limited = enabled and not valid_password and attempt >= 5
        assert response.status_code == (429 if limited else expected_status)
        if response.status_code == 429:
            assert 0 < int(response.headers["Retry-After"]) <= 900

    # Disabling also bypasses a counter already exhausted before the reload.
    login_client.settings.login_rate_limit_enabled = False
    response = client.post("/api/auth/login", json={
        "username": login_client.user.username,
        "password": "LoginTest123!" if valid_password else "wrong-password",
    })
    assert response.status_code == expected_status


def test_successful_login_preserves_previous_failures_without_consuming_an_attempt(login_client):
    client = login_client.client
    payload = {"username": login_client.user.username, "password": "wrong-password"}
    for _ in range(4):
        assert client.post("/api/auth/login", json=payload).status_code == 401
    for _ in range(7):
        response = client.post("/api/auth/login", json={**payload, "password": "LoginTest123!"})
        assert response.status_code == 200
    assert client.post("/api/auth/login", json=payload).status_code == 401
    response = client.post("/api/auth/login", json=payload)
    assert response.status_code == 429
    # Correct credentials must not bypass an already exhausted limit.
    assert client.post("/api/auth/login", json={**payload, "password": "LoginTest123!"}).status_code == 429


def test_failed_login_window_expires(login_client, monkeypatch):
    from app.services import usage_control

    now = [1_800_000_000.0]
    monkeypatch.setattr(usage_control.time, "time", lambda: now[0])
    payload = {"username": login_client.user.username, "password": "wrong-password"}
    for _ in range(5):
        assert login_client.client.post("/api/auth/login", json=payload).status_code == 401
    response = login_client.client.post("/api/auth/login", json=payload)
    assert response.status_code == 429
    assert response.headers["Retry-After"] == "900"
    now[0] += 901
    assert login_client.client.post("/api/auth/login", json=payload).status_code == 401


def test_unknown_account_is_rate_limited(login_client):
    login_client.db.scalar = lambda _: None
    payload = {"identity": "nonexistent_rate_limit_user", "password": "wrong-password"}
    for _ in range(5):
        assert login_client.client.post("/api/auth/login", json=payload).status_code == 401
    assert login_client.client.post("/api/auth/login", json=payload).status_code == 429


def test_login_identity_normalizes_case_and_whitespace(login_client):
    for attempt in range(6):
        username = "  RATE_LIMIT_USER  " if attempt % 2 else "rate_limit_user"
        response = login_client.client.post("/api/auth/login", json={
            "identity": username,
            "password": "wrong-password",
        })
        assert response.status_code == (401 if attempt < 5 else 429)


def test_sms_login_refunds_only_the_account_attempt(login_client, monkeypatch):
    monkeypatch.setitem(
        app.dependency_overrides,
        auth.get_sms_verification_service,
        lambda: SimpleNamespace(verify_code=lambda *_: True),
    )
    login_client.settings.sms_verification_check_limit_per_phone = 6
    login_client.settings.sms_verification_check_limit_per_ip = 30
    payload = {"phone": login_client.user.phone, "verification_code": "1234"}
    for _ in range(6):
        assert login_client.client.post("/api/auth/login", json=payload).status_code == 200
    response = login_client.client.post("/api/auth/login", json=payload)
    assert response.status_code == 429
    assert response.json()["message"] == "验证码核验尝试过于频繁，请稍后重试。"
