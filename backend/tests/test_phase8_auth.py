from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException
from fastapi.testclient import TestClient
from pytest import raises

from app.api.dependencies import AuthenticatedSession, AuthenticatedUser, get_current_session, get_current_user, require_roles
from app.core.security import create_access_token, decode_access_token, hash_password, verify_password
from app.db.session import get_db
from app.enums.status import UserRole, UserStatus
from app.main import app


def test_phase8_auth_routes_are_registered() -> None:
    paths = {route.path for route in app.routes}
    auth_me_methods = {
        method
        for route in app.routes
        if route.path == "/api/auth/me"
        for method in (route.methods or set())
    }

    assert "/api/auth/login" in paths
    assert "/api/auth/trial-application" in paths
    assert "/api/auth/me" in paths
    assert "/api/auth/me/data-export" not in paths
    assert {"GET", "PATCH", "DELETE"}.issubset(auth_me_methods)
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


def test_trial_application_creates_active_customer_account() -> None:
    class FakeDb:
        def __init__(self) -> None:
            self.created_account = None
            self.committed = False

        def scalar(self, _: object) -> None:
            return None

        def add(self, account: object) -> None:
            self.created_account = account

        def commit(self) -> None:
            self.committed = True

    fake_db = FakeDb()
    app.dependency_overrides[get_db] = lambda: fake_db

    try:
        response = TestClient(app).post(
            "/api/auth/trial-application",
            json={
                "username": "trial_user",
                "password": "Trial123!",
                "phone": "13800000000",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201
    assert response.json() == {"ok": True, "username": "trial_user", "status": "active"}
    assert fake_db.committed
    assert fake_db.created_account.username == "trial_user"
    assert fake_db.created_account.real_name is None
    assert fake_db.created_account.phone == "13800000000"
    assert fake_db.created_account.organization is None
    assert fake_db.created_account.role == UserRole.CUSTOMER.value
    assert fake_db.created_account.status == UserStatus.ACTIVE.value
    assert verify_password("Trial123!", fake_db.created_account.password_hash)


def test_trial_application_rejects_invalid_china_mobile_phone() -> None:
    class FakeDb:
        def scalar(self, _: object) -> None:
            return None

    app.dependency_overrides[get_db] = lambda: FakeDb()

    try:
        response = TestClient(app).post(
            "/api/auth/trial-application",
            json={
                "username": "invalid_phone_user",
                "password": "Trial123!",
                "phone": "12800000000",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400
    assert response.json()["message"] == "请输入正确的中国大陆11位手机号码。"


def test_trial_application_treats_blank_optional_profile_fields_as_missing() -> None:
    class FakeDb:
        def __init__(self) -> None:
            self.created_account = None

        def scalar(self, _: object) -> None:
            return None

        def add(self, account: object) -> None:
            self.created_account = account

        def commit(self) -> None:
            return None

    fake_db = FakeDb()
    app.dependency_overrides[get_db] = lambda: fake_db

    try:
        response = TestClient(app).post(
            "/api/auth/trial-application",
            json={
                "username": "blank_name_user",
                "password": "Trial123!",
                "real_name": "   ",
                "phone": "13900000000",
                "organization": "   ",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201
    assert fake_db.created_account.real_name is None
    assert fake_db.created_account.organization is None


def test_trial_application_rejects_duplicate_username_case_insensitively() -> None:
    class FakeDb:
        def scalar(self, _: object) -> UUID:
            return UUID("00000000-0000-0000-0000-000000000010")

    app.dependency_overrides[get_db] = lambda: FakeDb()

    try:
        response = TestClient(app).post(
            "/api/auth/trial-application",
            json={
                "username": "TRIAL_USER",
                "password": "Trial123!",
                "phone": "13700000000",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 409
    assert response.json()["message"] == "用户名已存在。"


def test_disabled_account_login_reports_not_opened() -> None:
    class FakeUser:
        id = UUID("00000000-0000-0000-0000-000000000010")
        username = "trial_user"
        real_name = "试用客户"
        role = UserRole.CUSTOMER.value
        organization = "示例单位"
        phone = "13800000000"
        status = UserStatus.DISABLED.value
        password_hash = hash_password("Trial123!")
        last_login_at = None

    class FakeDb:
        last_statement = None

        def get(self, _model: object, _user_id: UUID) -> FakeUser:
            return FakeUser()

        def add(self, _user: object) -> None:
            return None

        def flush(self) -> None:
            return None

        def scalar(self, statement: object) -> FakeUser:
            self.last_statement = statement
            return FakeUser()

    fake_db = FakeDb()
    app.dependency_overrides[get_db] = lambda: fake_db

    try:
        response = TestClient(app).post(
            "/api/auth/login",
            json={"identity": "13800000000", "password": "Trial123!"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 403
    assert response.json()["message"] == "账号尚未开通，请等待管理员审核。"
    assert "user_account.phone" in str(fake_db.last_statement)


def test_login_requires_username_or_phone() -> None:
    response = TestClient(app).post(
        "/api/auth/login",
        json={"password": "Trial123!"},
    )

    assert response.status_code == 400
    assert response.json()["message"] == "用户名或手机号不能为空。"


def test_unified_login_falls_back_from_phone_to_username() -> None:
    class FakeUser:
        id = UUID("00000000-0000-0000-0000-000000000010")
        username = "trial_user"
        real_name = "试用客户"
        role = UserRole.CUSTOMER.value
        organization = "示例单位"
        phone = "13800000000"
        status = UserStatus.DISABLED.value
        password_hash = hash_password("Trial123!")
        last_login_at = None

    class FakeDb:
        def __init__(self) -> None:
            self.statements: list[object] = []

        def get(self, _model: object, _user_id: UUID) -> FakeUser:
            return FakeUser()

        def flush(self) -> None:
            return None

        def scalar(self, statement: object) -> FakeUser | None:
            self.statements.append(statement)
            return None if len(self.statements) == 1 else FakeUser()

    fake_db = FakeDb()
    app.dependency_overrides[get_db] = lambda: fake_db

    try:
        response = TestClient(app).post(
            "/api/auth/login",
            json={"identity": "trial_user", "password": "Trial123!"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 403
    assert len(fake_db.statements) == 2
    assert "user_account.phone" in str(fake_db.statements[0])
    assert "lower(user_account.username)" in str(fake_db.statements[1])


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


def test_all_authenticated_roles_can_access_project_workbench() -> None:
    class EmptyProjectDb:
        def scalars(self, _: object) -> list[object]:
            return []

    client = TestClient(app)
    for index, role in enumerate(
        (UserRole.CUSTOMER, UserRole.REVIEWER, UserRole.ADMIN),
        start=1,
    ):
        current_user = AuthenticatedUser(
            id=UUID(f"00000000-0000-0000-0000-00000000000{index}"),
            username=f"{role.value}_user",
            real_name=None,
            role=role.value,
            organization=None,
        )
        app.dependency_overrides[get_current_user] = lambda user=current_user: user
        app.dependency_overrides[get_db] = EmptyProjectDb

        try:
            response = client.get("/api/projects")
        finally:
            app.dependency_overrides.clear()

        assert response.status_code == 200
        assert response.json() == []


def test_customer_can_reach_project_photo_config_and_detection_apis() -> None:
    class MissingProjectDb:
        def get(self, _model: object, _item_id: UUID) -> None:
            return None

    customer = AuthenticatedUser(
        id=UUID("00000000-0000-0000-0000-000000000001"),
        username="customer",
        real_name="演示客户",
        role=UserRole.CUSTOMER.value,
        organization=None,
    )
    missing_project_id = "00000000-0000-0000-0000-000000000099"
    app.dependency_overrides[get_current_user] = lambda: customer
    app.dependency_overrides[get_db] = MissingProjectDb

    try:
        client = TestClient(app)
        responses = [
            client.get(f"/api/projects/{missing_project_id}/photos"),
            client.get(f"/api/projects/{missing_project_id}/detection-config"),
            client.post(f"/api/projects/{missing_project_id}/start-detection"),
        ]
    finally:
        app.dependency_overrides.clear()

    assert [response.status_code for response in responses] == [404, 404, 404]


def test_current_user_response_includes_phone() -> None:
    customer = AuthenticatedUser(
        id=UUID("00000000-0000-0000-0000-000000000001"),
        username="customer",
        real_name="演示客户",
        role=UserRole.CUSTOMER.value,
        organization="示例委托单位",
        phone="13800000001",
    )
    app.dependency_overrides[get_current_user] = lambda: customer

    try:
        response = TestClient(app).get("/api/auth/me")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["phone"] == "13800000001"


def test_current_user_can_update_name_and_organization() -> None:
    class FakeUser:
        id = UUID("00000000-0000-0000-0000-000000000001")
        username = "customer"
        real_name = "原姓名"
        phone = "13800000001"
        role = UserRole.CUSTOMER.value
        organization = "原单位"
        deleted_at = None

    class FakeDb:
        def __init__(self) -> None:
            self.user = FakeUser()
            self.committed = False

        def get(self, _model: object, _user_id: UUID) -> FakeUser:
            return self.user

        def commit(self) -> None:
            self.committed = True

        def refresh(self, _user: FakeUser) -> None:
            return None

    current_user = AuthenticatedUser.from_model(FakeUser())
    fake_db = FakeDb()
    app.dependency_overrides[get_current_user] = lambda: current_user
    app.dependency_overrides[get_db] = lambda: fake_db

    try:
        response = TestClient(app).patch(
            "/api/auth/me",
            json={"real_name": " 新姓名 ", "organization": " 新单位 "},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["real_name"] == "新姓名"
    assert response.json()["organization"] == "新单位"
    assert fake_db.committed


def test_current_user_can_update_phone() -> None:
    class FakeUser:
        id = UUID("00000000-0000-0000-0000-000000000001")
        username = "customer"
        real_name = "演示客户"
        phone = "13800000001"
        role = UserRole.CUSTOMER.value
        organization = "示例委托单位"
        deleted_at = None

    class FakeDb:
        def __init__(self) -> None:
            self.user = FakeUser()
            self.committed = False

        def get(self, _model: object, _user_id: UUID) -> FakeUser:
            return self.user

        def scalar(self, _statement: object) -> None:
            return None

        def commit(self) -> None:
            self.committed = True

        def refresh(self, _user: FakeUser) -> None:
            return None

    current_user = AuthenticatedUser.from_model(FakeUser())
    fake_db = FakeDb()
    app.dependency_overrides[get_current_user] = lambda: current_user
    app.dependency_overrides[get_db] = lambda: fake_db

    try:
        response = TestClient(app).patch(
            "/api/auth/me",
            json={"phone": "13900000001"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["phone"] == "13900000001"
    assert fake_db.committed


def test_account_deletion_anonymizes_account() -> None:
    class FakeUser:
        id = UUID("00000000-0000-0000-0000-000000000001")
        username = "customer"
        real_name = "演示客户"
        phone = "13800000001"
        role = UserRole.CUSTOMER.value
        organization = "示例委托单位"
        status = UserStatus.ACTIVE.value
        password_hash = hash_password("Customer123!")
        last_login_at = datetime.now(UTC)
        deleted_at = None

    class FakeDb:
        def __init__(self) -> None:
            self.user = FakeUser()
            self.committed = False

        def get(self, _model: object, _user_id: UUID) -> FakeUser:
            return self.user

        def scalars(self, _statement: object) -> list[object]:
            return []

        def execute(self, _statement: object) -> None:
            return None

        def delete(self, _item: object) -> None:
            return None

        def commit(self) -> None:
            self.committed = True

    fake_db = FakeDb()
    session = AuthenticatedSession(
        user=AuthenticatedUser.from_model(fake_db.user),
        token_id="delete-account-test",
        expires_at=4_102_444_800,
    )
    app.dependency_overrides[get_current_session] = lambda: session
    app.dependency_overrides[get_db] = lambda: fake_db

    try:
        response = TestClient(app).request(
            "DELETE",
            "/api/auth/me",
            json={"password": "Customer123!"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["deleted_trial_photos"] == 0
    assert response.json()["deleted_trial_results"] == 0
    assert fake_db.committed
    assert fake_db.user.username == "deleted-00000000000000000000000000000001"
    assert fake_db.user.real_name is None
    assert fake_db.user.phone is None
    assert fake_db.user.organization is None
    assert fake_db.user.status == UserStatus.DISABLED.value
    assert fake_db.user.deleted_at is not None
    assert not verify_password("Customer123!", fake_db.user.password_hash)


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
