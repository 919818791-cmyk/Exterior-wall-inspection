from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import UUID

from fastapi.testclient import TestClient

from app.api.accounts import (
    get_account_usage,
    get_current_account_usage,
    list_account_usage_summary,
    reset_account_quotas,
)
from app.api.dependencies import AuthenticatedUser
from app.main import app
from app.models.tables import SystemSetting


ACCOUNT_ID = UUID("00000000-0000-0000-0000-000000000001")
ADMIN = AuthenticatedUser(
    id=UUID("00000000-0000-0000-0000-000000000003"),
    username="admin",
    real_name="平台管理员",
    role="admin",
    organization=None,
)


class Rows:
    def __init__(self, values: list[object]) -> None:
        self.values = values

    def all(self) -> list[object]:
        return self.values

    def one(self) -> object:
        return self.values[0]


def test_account_usage_routes_are_registered_before_dynamic_account_route() -> None:
    paths = {route.path for route in app.routes}

    assert "/api/accounts/usage-summary" in paths
    assert "/api/accounts/me/usage" in paths
    assert "/api/accounts/{account_id}/usage" in paths
    assert "/api/accounts/{account_id}/reset-quotas" in paths
    assert TestClient(app).get("/api/accounts/usage-summary").status_code == 401
    assert TestClient(app).get("/api/accounts/me/usage").status_code == 401


def test_account_usage_summary_returns_all_time_formal_and_trial_totals() -> None:
    class FakeDb:
        statement: object | None = None

        def execute(self, statement: object) -> Rows:
            self.statement = statement
            return Rows([(ACCOUNT_ID, 2, 12, 10, 1000, 900, 100, 1)])

    db = FakeDb()
    response = list_account_usage_summary(ADMIN, db)

    assert len(response) == 1
    assert "occurred_at" not in str(db.statement)
    assert response[0].account_id == ACCOUNT_ID
    assert response[0].task_count == 3
    assert response[0].formal_task_count == 2
    assert response[0].trial_task_count == 1
    assert response[0].detected_photo_count == 12
    assert response[0].api_request_count == 10
    assert response[0].token_count == 1000


def test_account_usage_detail_buckets_events_and_returns_all_time_totals() -> None:
    now = datetime.now(UTC)

    class FakeDb:
        def __init__(self) -> None:
            self.results = iter(
                [
                    Rows(
                        [
                            SimpleNamespace(
                                occurred_at=now,
                                event_type="inference",
                                source_type="formal",
                                photo_count=8,
                                api_request_count=4,
                                token_count=600,
                                input_token_count=550,
                                output_token_count=50,
                                trial_task_count=0,
                            ),
                            SimpleNamespace(
                                occurred_at=now,
                                event_type="inference",
                                source_type="trial",
                                photo_count=5,
                                api_request_count=3,
                                token_count=400,
                                input_token_count=350,
                                output_token_count=50,
                                trial_task_count=1,
                            ),
                            SimpleNamespace(
                                occurred_at=now,
                                event_type="photo_detection",
                                source_type="formal",
                                photo_count=8,
                                api_request_count=0,
                                token_count=0,
                                input_token_count=0,
                                output_token_count=0,
                                trial_task_count=0,
                            ),
                        ]
                    ),
                    Rows([(5, 42, 20, 3000, 2700, 300, 2)]),
                ]
            )

        def scalar(self, _: object) -> object:
            return object()

        def execute(self, _: object) -> Rows:
            return next(self.results)

    response = get_account_usage(ACCOUNT_ID, "week", ADMIN, FakeDb())

    assert response.current.task_count == 2
    assert response.current.formal_task_count == 1
    assert response.current.trial_task_count == 1
    assert response.current.detected_photo_count == 8
    assert response.current.api_request_count == 7
    assert response.current.token_count == 1000
    assert response.current.input_token_count == 900
    assert response.current.output_token_count == 100
    assert response.all_time.task_count == 7
    assert response.all_time.formal_task_count == 5
    assert response.all_time.trial_task_count == 2
    assert response.all_time.detected_photo_count == 42
    assert response.all_time.api_request_count == 20
    assert response.all_time.token_count == 3000


def test_current_account_usage_returns_month_usage_and_photo_balances() -> None:
    now = datetime.now(UTC)

    class FakeDb:
        def get(self, model: object, key: str) -> SystemSetting | None:
            if model is SystemSetting and key in {
                "trial_monthly_photo_upload_limit",
                "basic_formal_monthly_photo_upload_limit",
            }:
                return SimpleNamespace(value="50")
            if model is SystemSetting and key == "professional_monthly_photo_upload_limit":
                return SimpleNamespace(value="1000")
            if model is SystemSetting and key == "professional_trial_monthly_photo_upload_limit":
                return SimpleNamespace(value="500")
            return None

        def execute(self, _: object) -> Rows:
            return Rows(
                [
                    SimpleNamespace(
                        occurred_at=now.replace(day=1) - timedelta(days=1),
                        event_type="photo_detection",
                        source_type="formal",
                        photo_count=4,
                        api_request_count=0,
                        token_count=0,
                        input_token_count=0,
                        output_token_count=0,
                        trial_task_count=0,
                    ),
                    SimpleNamespace(
                        occurred_at=now.replace(day=1) - timedelta(days=1),
                        event_type="photo_detection",
                        source_type="trial",
                        photo_count=3,
                        api_request_count=0,
                        token_count=0,
                        input_token_count=0,
                        output_token_count=0,
                        trial_task_count=0,
                    ),
                    SimpleNamespace(
                        occurred_at=now,
                        event_type="photo_detection",
                        source_type="formal",
                        photo_count=1,
                        api_request_count=0,
                        token_count=0,
                        input_token_count=0,
                        output_token_count=0,
                        trial_task_count=0,
                    ),
                    SimpleNamespace(
                        occurred_at=now,
                        event_type="photo_detection",
                        source_type="trial",
                        photo_count=2,
                        api_request_count=0,
                        token_count=0,
                        input_token_count=0,
                        output_token_count=0,
                        trial_task_count=0,
                    ),
                    SimpleNamespace(
                        occurred_at=now,
                        event_type="inference",
                        source_type="formal",
                        photo_count=2,
                        api_request_count=4,
                        token_count=600,
                        input_token_count=550,
                        output_token_count=50,
                        trial_task_count=0,
                    ),
                    SimpleNamespace(
                        occurred_at=now,
                        event_type="inference",
                        source_type="trial",
                        photo_count=3,
                        api_request_count=6,
                        token_count=400,
                        input_token_count=350,
                        output_token_count=50,
                        trial_task_count=1,
                    ),
                ]
            )

    response = get_current_account_usage(ADMIN, FakeDb())
    assert response.account_id == ADMIN.id
    assert response.usage.task_count == 2
    assert response.usage.detected_photo_count == 3
    assert response.usage.api_request_count == 10
    assert response.usage.token_count == 1000
    assert response.trial_monthly_photo_upload_balance.used == 5
    assert response.trial_monthly_photo_upload_balance.limit == 50
    assert response.basic_formal_monthly_photo_upload_balance.used == 5
    assert response.basic_formal_monthly_photo_upload_balance.limit == 50
    assert response.professional_formal_monthly_photo_upload_balance.used == 1
    assert response.professional_formal_monthly_photo_upload_balance.limit == 1000
    assert response.professional_trial_monthly_photo_upload_balance.used == 2
    assert response.professional_trial_monthly_photo_upload_balance.limit == 500


def test_admin_can_reset_all_account_quotas_without_deleting_usage_history(monkeypatch) -> None:
    account = SimpleNamespace(id=ACCOUNT_ID, quota_reset_at=None)
    reset_ids: list[UUID] = []

    class FakeDb:
        committed = False

        def scalar(self, _: object) -> object:
            return account

        def commit(self) -> None:
            self.committed = True

    fake_db = FakeDb()
    monkeypatch.setattr(
        "app.api.accounts.reset_account_quota_counters",
        lambda account_id: reset_ids.append(account_id),
    )

    response = reset_account_quotas(ACCOUNT_ID, ADMIN, fake_db)

    assert response.ok is True
    assert account.quota_reset_at == response.reset_at
    assert reset_ids == [ACCOUNT_ID]
    assert fake_db.committed is True
