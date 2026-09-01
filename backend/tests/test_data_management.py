from datetime import UTC, date, datetime
from uuid import UUID

from fastapi.testclient import TestClient

from app.api.data_management import (
    _api_request_count,
    _period_ranges,
    _token_count,
    _token_counts,
    get_data_usage,
)
from app.api.dependencies import AuthenticatedUser
from app.main import app


def test_data_management_route_is_registered() -> None:
    assert "/api/data-management/usage" in {route.path for route in app.routes}


def test_data_management_route_requires_admin_authentication() -> None:
    response = TestClient(app).get("/api/data-management/usage")

    assert response.status_code == 401


def test_week_ranges_use_natural_monday_to_sunday_weeks() -> None:
    ranges = _period_ranges("week", date(2026, 7, 13))

    assert len(ranges) == 8
    assert ranges[-1] == (date(2026, 7, 13), date(2026, 7, 20), "07月13日-07月19日")
    assert ranges[0][0] == date(2026, 5, 25)


def test_month_ranges_include_current_and_previous_eleven_months() -> None:
    ranges = _period_ranges("month", date(2026, 1, 20))

    assert len(ranges) == 12
    assert ranges[0] == (date(2025, 2, 1), date(2025, 3, 1), "2025年02月")
    assert ranges[-1] == (date(2026, 1, 1), date(2026, 2, 1), "2026年01月")


def test_api_request_count_supports_archived_and_raw_inference_shapes() -> None:
    report_data = {
        "raw_model_outputs": [
            {"tile_count": 4},
            {"inference": {"api_request_count": 3, "tile_count": 99}},
            {"api_request_count": "2"},
            {"tile_count": "invalid"},
        ]
    }

    assert _api_request_count(report_data) == 9


def test_token_count_prefers_photo_totals_and_falls_back_to_tile_details() -> None:
    report_data = {
        "raw_model_outputs": [
            {
                "token_usage": {
                    "prompt_tokens": 1000,
                    "completion_tokens": 200,
                    "total_tokens": 1200,
                },
                "tile_token_usages": [
                    {"token_usage": {"prompt_tokens": 500, "completion_tokens": 100, "total_tokens": 600}},
                    {"token_usage": {"prompt_tokens": 500, "completion_tokens": 100, "total_tokens": 600}},
                ],
            },
            {
                "tile_token_usages": [
                    {"token_usage": {"prompt_tokens": 600, "completion_tokens": 100, "total_tokens": "700"}},
                    {"token_usage": {"prompt_tokens": 700, "completion_tokens": 100, "total_tokens": 800}},
                ]
            },
            {"token_usage": {"total_tokens": -1}},
            {"token_usage": {"total_tokens": "invalid"}},
        ]
    }

    assert _token_count(report_data) == 2700
    assert _token_counts(report_data) == (2300, 400, 2700)


def test_current_period_combines_formal_and_trial_photos() -> None:
    now = datetime.now(UTC)

    class Rows:
        def __init__(self, values: list[tuple]) -> None:
            self.values = values

        def all(self) -> list[tuple]:
            return self.values

        def one(self) -> tuple:
            return self.values[0]

    class FakeDb:
        def __init__(self) -> None:
            self.results = iter(
                [
                    Rows(
                        [
                            (now, 1, 1024 * 1024, 0, 0, 0, 0, 0),
                            (now, 1, 512 * 1024, 0, 0, 0, 0, 0),
                            (now, 0, 0, 5, 4321, 4000, 321, 1),
                        ]
                    ),
                    Rows([(7, 10 * 1024 * 1024, 5, 4321, 4000, 321, 1)]),
                ]
            )

        def execute(self, _: object) -> Rows:
            return next(self.results)

    admin = AuthenticatedUser(
        id=UUID("00000000-0000-0000-0000-000000000003"),
        username="admin",
        real_name="平台管理员",
        role="admin",
        organization=None,
    )

    response = get_data_usage("week", admin, FakeDb())

    assert response.current.photo_count == 2
    assert response.current.storage_bytes == 1572864
    assert response.current.storage_mb == 1.5
    assert response.current.api_request_count == 5
    assert response.current.token_count == 4321
    assert response.current.input_token_count == 4000
    assert response.current.output_token_count == 321
    assert response.current.trial_task_count == 1
    assert response.all_time.photo_count == 7
    assert response.all_time.storage_mb == 10
    assert response.all_time.api_request_count == 5
    assert response.all_time.token_count == 4321
    assert response.all_time.input_token_count == 4000
    assert response.all_time.output_token_count == 321
    assert response.all_time.trial_task_count == 1


def test_data_management_reads_only_the_durable_usage_ledger() -> None:
    class Rows:
        def all(self) -> list[tuple]:
            return []

        def one(self) -> tuple:
            return (0, 0, 0, 0, 0, 0, 0)

    class CapturingDb:
        def __init__(self) -> None:
            self.statements: list[str] = []

        def execute(self, statement: object) -> Rows:
            self.statements.append(str(statement))
            return Rows()

    admin = AuthenticatedUser(
        id=UUID("00000000-0000-0000-0000-000000000003"),
        username="admin",
        real_name="平台管理员",
        role="admin",
        organization=None,
    )
    db = CapturingDb()

    get_data_usage("week", admin, db)

    assert len(db.statements) == 2
    assert all("usage_event" in statement for statement in db.statements)
    assert all("trial_detection_result" not in statement for statement in db.statements)
    assert all("quick_detection_photo" not in statement for statement in db.statements)
