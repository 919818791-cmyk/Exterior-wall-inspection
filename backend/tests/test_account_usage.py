from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import UUID

from fastapi.testclient import TestClient

from app.api.accounts import get_account_usage, get_current_account_usage, list_account_usage_summary
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
    assert TestClient(app).get("/api/accounts/usage-summary").status_code == 401
    assert TestClient(app).get("/api/accounts/me/usage").status_code == 401


def test_account_usage_summary_returns_all_time_formal_and_trial_totals() -> None:
    class FakeDb:
        statement: object | None = None

        def execute(self, statement: object) -> Rows:
            self.statement = statement
            return Rows([(ACCOUNT_ID, 2, 10, 1000, 900, 100, 1)])

    db = FakeDb()
    response = list_account_usage_summary(ADMIN, db)

    assert len(response) == 1
    assert "occurred_at" not in str(db.statement)
    assert response[0].account_id == ACCOUNT_ID
    assert response[0].task_count == 3
    assert response[0].formal_task_count == 2
    assert response[0].trial_task_count == 1
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
                                api_request_count=3,
                                token_count=400,
                                input_token_count=350,
                                output_token_count=50,
                                trial_task_count=1,
                            ),
                        ]
                    ),
                    Rows([(5, 20, 3000, 2700, 300, 2)]),
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
    assert response.current.api_request_count == 7
    assert response.current.token_count == 1000
    assert response.current.input_token_count == 900
    assert response.current.output_token_count == 100
    assert response.all_time.task_count == 7
    assert response.all_time.formal_task_count == 5
    assert response.all_time.trial_task_count == 2
    assert response.all_time.api_request_count == 20
    assert response.all_time.token_count == 3000


def test_current_account_usage_returns_month_usage_and_daily_balance() -> None:
    now = datetime.now(UTC)

    class FakeDb:
        def get(self, model: object, key: str) -> SystemSetting | None:
            if model is SystemSetting and key == "trial_daily_api_request_limit":
                return SimpleNamespace(value="1200")
            return None

        def execute(self, _: object) -> Rows:
            return Rows(
                [
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
    assert response.usage.api_request_count == 10
    assert response.usage.token_count == 1000
    assert response.trial_api_request_balance.used == 6
    assert response.trial_api_request_balance.limit == 1200
    assert response.trial_api_request_balance.remaining == 1194
