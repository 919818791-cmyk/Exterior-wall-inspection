from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import UUID

from fastapi import HTTPException
from fastapi.testclient import TestClient
from pytest import fixture, raises

from app.api.dependencies import (
    AuthenticatedSession,
    AuthenticatedUser,
    ensure_project_access,
    ensure_project_write_access,
    get_current_session,
    get_current_user,
    get_optional_current_user,
    require_roles,
)
from app.api.projects import list_projects
from app.core.security import create_access_token, decode_access_token, hash_password, verify_password
from app.db.session import get_db
from app.enums.status import UserRole, UserStatus
from app.main import app
from app.services.sms_verification import SmsSendResult, get_sms_verification_service


class StubSmsVerificationService:
    def __init__(self) -> None:
        self.sent_phones: list[str] = []
        self.verification_attempts: list[tuple[str, str]] = []
        self.verification_result = True

    def send_code(self, phone: str) -> SmsSendResult:
        self.sent_phones.append(phone)
        return SmsSendResult(biz_id="test-biz-id", request_id="test-request-id")

    def verify_code(self, phone: str, code: str) -> bool:
        self.verification_attempts.append((phone, code))
        return self.verification_result


@fixture(autouse=True)
def stub_sms_verification_service() -> StubSmsVerificationService:
    service = StubSmsVerificationService()
    app.dependency_overrides[get_sms_verification_service] = lambda: service
    yield service
    app.dependency_overrides.pop(get_sms_verification_service, None)


def test_phase8_auth_routes_are_registered() -> None:
    paths = {route.path for route in app.routes}
    auth_me_methods = {
        method
        for route in app.routes
        if route.path == "/api/auth/me"
        for method in (route.methods or set())
    }

    assert "/api/auth/login" in paths
    assert "/api/auth/registration/username-availability" in paths
    assert "/api/auth/registration/sms-code" in paths
    assert "/api/auth/password-reset/sms-code" in paths
    assert "/api/auth/password-reset/verify" in paths
    assert "/api/auth/password-reset" in paths
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
                "verification_code": "1234",
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
                "verification_code": "1234",
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
                "verification_code": "1234",
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
                "verification_code": "1234",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 409
    assert response.json()["message"] == "用户名已存在。"


def test_registration_username_availability_is_case_insensitive() -> None:
    class FakeDb:
        def __init__(self) -> None:
            self.statements: list[object] = []

        def scalar(self, statement: object) -> UUID:
            self.statements.append(statement)
            return UUID("00000000-0000-0000-0000-000000000010")

    fake_db = FakeDb()
    app.dependency_overrides[get_db] = lambda: fake_db

    try:
        response = TestClient(app).get(
            "/api/auth/registration/username-availability",
            params={"username": "  TRIAL_USER  "},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"username": "TRIAL_USER", "available": False}
    assert "lower(user_account.username)" in str(fake_db.statements[0])


def test_registration_username_availability_reports_unused_username() -> None:
    class FakeDb:
        def scalar(self, _: object) -> None:
            return None

    app.dependency_overrides[get_db] = lambda: FakeDb()

    try:
        response = TestClient(app).get(
            "/api/auth/registration/username-availability",
            params={"username": "new_trial_user"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"username": "new_trial_user", "available": True}


def test_registration_sms_code_is_sent_to_available_phone(
    stub_sms_verification_service: StubSmsVerificationService,
) -> None:
    class FakeDb:
        def scalar(self, _: object) -> None:
            return None

    app.dependency_overrides[get_db] = lambda: FakeDb()

    try:
        response = TestClient(app).post(
            "/api/auth/registration/sms-code",
            json={"phone": "13800000000"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"ok": True, "retry_after_seconds": 60}
    assert stub_sms_verification_service.sent_phones == ["13800000000"]


def test_password_reset_verification_can_set_a_new_password(
    stub_sms_verification_service: StubSmsVerificationService,
) -> None:
    class FakeUser:
        id = UUID("00000000-0000-0000-0000-000000000010")
        username = "reset_user"
        real_name = "找回密码用户"
        phone = "13800000000"
        role = UserRole.CUSTOMER.value
        organization = None
        status = UserStatus.ACTIVE.value
        deleted_at = None
        password_hash = hash_password("OldPassword123!")

    class FakeDb:
        def __init__(self) -> None:
            self.user = FakeUser()
            self.committed = False

        def get(self, _model: object, _user_id: UUID) -> FakeUser:
            return self.user

        def scalar(self, _statement: object) -> FakeUser:
            return self.user

        def flush(self) -> None:
            return None

        def commit(self) -> None:
            self.committed = True

    fake_db = FakeDb()
    app.dependency_overrides[get_db] = lambda: fake_db

    try:
        client = TestClient(app)
        send_response = client.post(
            "/api/auth/password-reset/sms-code",
            json={"phone": "13800000000"},
        )
        verify_response = client.post(
            "/api/auth/password-reset/verify",
            json={"phone": "13800000000", "verification_code": "1234"},
        )
        reset_token = verify_response.json()["reset_token"]
        reset_response = client.post(
            "/api/auth/password-reset",
            json={"reset_token": reset_token, "new_password": "NewPassword123!"},
        )
        reused_token_response = client.post(
            "/api/auth/password-reset",
            json={"reset_token": reset_token, "new_password": "AnotherPassword123!"},
        )
    finally:
        app.dependency_overrides.clear()

    assert send_response.status_code == 200
    assert stub_sms_verification_service.sent_phones == ["13800000000"]
    assert verify_response.status_code == 200
    assert stub_sms_verification_service.verification_attempts == [("13800000000", "1234")]
    assert reset_response.status_code == 200
    assert reset_response.json() == {"ok": True}
    assert reused_token_response.status_code == 400
    assert fake_db.committed
    assert verify_password("NewPassword123!", fake_db.user.password_hash)
    assert not verify_password("OldPassword123!", fake_db.user.password_hash)


def test_trial_application_rejects_invalid_sms_code(
    stub_sms_verification_service: StubSmsVerificationService,
) -> None:
    class FakeDb:
        def __init__(self) -> None:
            self.add_count = 0

        def scalar(self, _: object) -> None:
            return None

        def add(self, _: object) -> None:
            self.add_count += 1

    fake_db = FakeDb()
    stub_sms_verification_service.verification_result = False
    app.dependency_overrides[get_db] = lambda: fake_db

    try:
        response = TestClient(app).post(
            "/api/auth/trial-application",
            json={
                "username": "invalid_code_user",
                "password": "Trial123!",
                "phone": "13800000000",
                "verification_code": "9999",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400
    assert response.json()["message"] == "验证码错误或已过期。"
    assert fake_db.add_count == 0
    assert stub_sms_verification_service.verification_attempts == [("13800000000", "9999")]


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


def test_reviewer_can_read_but_cannot_mutate_another_users_project() -> None:
    project = SimpleNamespace(created_by=UUID("00000000-0000-0000-0000-000000000001"))
    reviewer = AuthenticatedUser(
        id=UUID("00000000-0000-0000-0000-000000000002"),
        username="reviewer",
        real_name="审核员",
        role=UserRole.REVIEWER.value,
        organization=None,
    )

    ensure_project_access(project, reviewer)
    with raises(HTTPException) as raised:
        ensure_project_write_access(project, reviewer)

    assert raised.value.status_code == 404


def test_project_owner_and_admin_have_project_write_access() -> None:
    owner_id = UUID("00000000-0000-0000-0000-000000000001")
    project = SimpleNamespace(created_by=owner_id)
    owner = AuthenticatedUser(
        id=owner_id,
        username="owner",
        real_name=None,
        role=UserRole.CUSTOMER.value,
        organization=None,
    )
    admin = AuthenticatedUser(
        id=UUID("00000000-0000-0000-0000-000000000003"),
        username="admin",
        real_name=None,
        role=UserRole.ADMIN.value,
        organization=None,
    )

    ensure_project_write_access(project, owner)
    ensure_project_write_access(project, admin)


def test_customer_can_read_shared_example_project() -> None:
    project = SimpleNamespace(
        created_by=UUID("00000000-0000-0000-0000-000000000003"),
        is_example=True,
    )
    customer = AuthenticatedUser(
        id=UUID("00000000-0000-0000-0000-000000000001"),
        username="customer",
        real_name=None,
        role=UserRole.CUSTOMER.value,
        organization=None,
    )

    ensure_project_access(project, customer)


def test_anonymous_viewer_can_only_read_shared_example_projects() -> None:
    ensure_project_access(SimpleNamespace(is_example=True), None)

    with raises(HTTPException) as raised:
        ensure_project_access(SimpleNamespace(is_example=False), None)

    assert raised.value.status_code == 404


def test_shared_example_project_is_read_only_for_owner_and_admin() -> None:
    owner_id = UUID("00000000-0000-0000-0000-000000000001")
    project = SimpleNamespace(created_by=owner_id, is_example=True)
    owner = AuthenticatedUser(
        id=owner_id,
        username="owner",
        real_name=None,
        role=UserRole.CUSTOMER.value,
        organization=None,
    )
    admin = AuthenticatedUser(
        id=UUID("00000000-0000-0000-0000-000000000003"),
        username="admin",
        real_name=None,
        role=UserRole.ADMIN.value,
        organization=None,
    )

    for user in (owner, admin):
        with raises(HTTPException) as raised:
            ensure_project_write_access(project, user)
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
        app.dependency_overrides[get_optional_current_user] = lambda user=current_user: user
        app.dependency_overrides[get_db] = EmptyProjectDb

        try:
            response = client.get("/api/projects")
        finally:
            app.dependency_overrides.clear()

        assert response.status_code == 200
        assert response.json() == []


def test_anonymous_project_list_only_includes_shared_example() -> None:
    class CapturingProjectDb:
        def __init__(self) -> None:
            self.statements: list[object] = []

        def scalars(self, statement: object) -> list[object]:
            self.statements.append(statement)
            return []

    fake_db = CapturingProjectDb()

    assert list_projects(request=None, db=fake_db, current_user=None) == []
    assert len(fake_db.statements) == 1
    project_query = str(fake_db.statements[0])
    assert "project.is_example IS true" in project_query
    assert "project.created_by =" not in project_query


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


def test_admin_reset_account_password_returns_random_temporary_password() -> None:
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
    payload = response.json()
    temporary_password = payload["temporary_password"]
    assert payload["account"]["id"] == "00000000-0000-0000-0000-000000000001"
    assert len(temporary_password) >= 20
    assert temporary_password != "123456"
    assert response.headers["cache-control"] == "no-store"
    assert verify_password(temporary_password, fake_db.account.password_hash)
    assert not verify_password("123456", fake_db.account.password_hash)
    assert not verify_password("OldPassword123!", fake_db.account.password_hash)
