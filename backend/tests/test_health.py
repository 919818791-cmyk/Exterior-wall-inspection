from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.api import health
from app.api.dependencies import revoke_token
from app.core.config import get_settings
from app.core.security import create_access_token
from app.db.session import get_db
from app.main import app


@pytest.mark.parametrize("query,headers", [
    ("", {}),
    ("?details=true&verbose=true", {"X-User-Role": "admin", "X-Forwarded-For": "127.0.0.1"}),
    ("", {"Authorization": "Bearer invalid-token"}),
])
def test_public_health_is_minimal_and_does_not_inspect_dependencies(monkeypatch, query, headers):
    def forbidden(*args, **kwargs):
        pytest.fail("Public liveness must not read internal configuration or dependencies")

    app.dependency_overrides[get_db] = forbidden
    monkeypatch.setattr(health, "get_settings", forbidden)
    monkeypatch.setattr(health, "photo_guard_health", forbidden)
    monkeypatch.setattr(health, "photo_guard_strategy_settings", forbidden)
    try:
        response = TestClient(app).get(f"/api/health{query}", headers=headers)
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}
        assert response.headers["cache-control"] == "no-store"
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def diagnostics(monkeypatch):
    user = SimpleNamespace(id=UUID(int=1), username="health-admin", real_name=None,
                           role="admin", organization=None, phone=None)
    database = SimpleNamespace(scalar=lambda _: user)
    app.dependency_overrides[get_db] = lambda: database
    settings = SimpleNamespace(
        photo_guard_enabled=False, app_name="internal-service", app_env="production",
        api_prefix="/api", database_url="postgresql://private-db:5432/internal",
        minio_endpoint="private-minio:9000", minio_bucket="internal-bucket",
        redis_url="redis://private-redis:6379/0", worker_backend_base_url="http://private-worker:8000",
        minio_public_url="http://private-minio:9000", worker_token="test-configured-token", worker_lease_seconds=777,
    )
    inspections = []
    monkeypatch.setattr(health, "get_settings", lambda: settings)
    monkeypatch.setattr(health, "photo_guard_model_name", lambda _: "internal-model")
    monkeypatch.setattr(health, "photo_guard_api_base_url", lambda _: "http://private-model:9002")
    monkeypatch.setattr(health, "photo_guard_health", lambda _: (inspections.append(True) or True, "ready"))
    try:
        yield TestClient(app), user, database, inspections
    finally:
        app.dependency_overrides.pop(get_db, None)


def authorization(user):
    token, _, token_id = create_access_token(user_id=str(user.id), role=user.role)
    return {"Authorization": f"Bearer {token}"}, token_id


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer invalid"}, {"X-User-Role": "admin"}])
def test_diagnostics_reject_anonymous_and_invalid_tokens_before_inspection(diagnostics, headers):
    client, _, _, inspections = diagnostics
    response = client.get("/api/health/details", headers=headers)
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert "private-" not in response.text
    assert "worker_contract" not in response.json()
    assert inspections == []


@pytest.mark.parametrize("role", ["customer", "reviewer"])
def test_diagnostics_require_administrator_role(diagnostics, role):
    client, user, _, inspections = diagnostics
    user.role = role
    headers, _ = authorization(user)
    response = client.get("/api/health/details", headers=headers)
    assert response.status_code == 403
    assert "private-" not in response.text
    assert inspections == []
    assert client.get("/api/health", headers=headers).json() == {"status": "ok"}


def test_administrator_can_read_non_cached_diagnostics(diagnostics):
    client, user, _, inspections = diagnostics
    headers, _ = authorization(user)
    response = client.get("/api/health/details", headers=headers)
    assert response.status_code == 200
    assert response.json()["environment"] == "production"
    assert response.json()["photo_guard"]["model"] == "internal-model"
    assert response.json()["worker_contract"]["lease_seconds"] == 777
    assert "test-configured-token" not in response.text
    assert response.headers["cache-control"] == "private, no-store"
    assert inspections == [True]
    assert client.get("/api/health", headers=headers).json() == {"status": "ok"}


@pytest.mark.parametrize("reason", ["revoked", "expired", "disabled", "demoted"])
def test_diagnostics_recheck_session_and_account_status(diagnostics, monkeypatch, reason):
    client, user, database, inspections = diagnostics
    if reason == "expired":
        monkeypatch.setattr(get_settings(), "auth_access_token_expire_minutes", -1)
    headers, token_id = authorization(user)
    if reason == "revoked":
        revoke_token(token_id, 9999999999)
    elif reason == "disabled":
        database.scalar = lambda _: None
    elif reason == "demoted":
        user.role = "customer"
    response = client.get("/api/health/details", headers=headers)
    assert response.status_code == (403 if reason == "demoted" else 401)
    assert inspections == []


def test_model_degradation_is_reported_only_in_admin_diagnostics(diagnostics, monkeypatch):
    client, user, _, _ = diagnostics
    monkeypatch.setattr(health, "photo_guard_health", lambda _: (False, "internal-model unavailable"))
    headers, _ = authorization(user)
    response = client.get("/api/health/details", headers=headers)
    assert response.status_code == 200
    assert response.json()["status"] == "degraded"
    assert response.json()["photo_guard"]["ready"] is False
    assert client.get("/api/health").json() == {"status": "ok"}
