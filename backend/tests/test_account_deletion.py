from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.dependencies import AuthenticatedUser, get_current_user
from app.core.security import hash_password, verify_password
from app.db.session import get_db
from app.main import app
from app.models.tables import UserAccount

from sample_data import synthetic_phone


@pytest.fixture
def account_client():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    UserAccount.__table__.create(engine)
    with Session(engine) as db:
        admin = UserAccount(username="delete-admin", password_hash=hash_password("Admin123!"), role="admin", status="active")
        target = UserAccount(username="delete-customer", password_hash=hash_password("Customer123!"), role="customer", status="active", phone=synthetic_phone(5), real_name="客户", organization="单位")
        db.add_all([admin, target])
        db.commit()
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser.from_model(admin)
        try:
            yield TestClient(app), db, admin, target
        finally:
            app.dependency_overrides.pop(get_db, None)
            app.dependency_overrides.pop(get_current_user, None)
    engine.dispose()


def test_deleted_account_is_retained_but_unavailable(account_client):
    client, db, _, target = account_client
    target_id = target.id
    response = client.delete(f"/api/accounts/{target_id}")
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    db.refresh(target)
    assert db.get(UserAccount, target_id) is target
    assert target.deleted_at is not None
    assert target.status == "disabled"
    assert target.username == f"deleted-{target_id.hex}"
    assert target.phone is None and target.real_name is None and target.organization is None
    assert not verify_password("Customer123!", target.password_hash)
    assert all(item["id"] != str(target_id) for item in client.get("/api/accounts").json())
    assert client.get(f"/api/accounts/{target_id}/usage").status_code == 404
    assert client.delete(f"/api/accounts/{target_id}").status_code == 404


def test_cannot_delete_current_admin(account_client):
    client, db, admin, _ = account_client
    response = client.delete(f"/api/accounts/{admin.id}")
    assert response.status_code == 400
    assert response.json()["message"] == "不能删除当前登录账号。"
    db.refresh(admin)
    assert admin.deleted_at is None and admin.status == "active"


def test_cannot_delete_last_active_admin(account_client):
    client, db, admin, target = account_client
    target.role = "admin"
    admin.status = "disabled"
    db.commit()
    response = client.delete(f"/api/accounts/{target.id}")
    assert response.status_code == 400
    assert "至少需要保留" in response.json()["message"]
    db.refresh(target)
    assert target.deleted_at is None and target.status == "active"


def test_can_delete_other_admin_when_active_admin_remains(account_client):
    client, db, _, target = account_client
    target.role = "admin"
    db.commit()
    assert client.delete(f"/api/accounts/{target.id}").status_code == 200


def test_delete_missing_account(account_client):
    client, _, _, _ = account_client
    assert client.delete(f"/api/accounts/{uuid4()}").status_code == 404


@pytest.mark.parametrize("role", ["customer", "reviewer"])
def test_delete_requires_admin(account_client, role):
    client, _, _, target = account_client
    user = AuthenticatedUser(id=uuid4(), username="non-admin", real_name=None, role=role, organization=None)
    app.dependency_overrides[get_current_user] = lambda: user
    assert client.delete(f"/api/accounts/{target.id}").status_code == 403


def test_delete_requires_authentication():
    assert TestClient(app).delete(f"/api/accounts/{uuid4()}").status_code == 401
