from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import AuthenticatedUser
from app.api.reports import delete_report, restore_trial_report
from app.db.session import get_db
from app.enums.status import ProjectStatus, UserRole
from app.main import app


CUSTOMER = AuthenticatedUser(
    id=UUID("11111111-1111-4111-8111-111111111111"),
    username="fault_tolerance_customer",
    real_name="容错测试用户",
    phone="13800000009",
    role=UserRole.CUSTOMER.value,
    organization="测试单位",
)


def test_registration_idempotency_does_not_create_duplicate_account() -> None:
    class FakeDb:
        def __init__(self) -> None:
            self.add_count = 0

        def scalar(self, _: object) -> None:
            return None

        def add(self, _: object) -> None:
            self.add_count += 1

        def commit(self) -> None:
            return None

    fake_db = FakeDb()
    app.dependency_overrides[get_db] = lambda: fake_db
    payload = {
        "username": "idempotent_user",
        "password": "Trial123!",
        "phone": "13800000008",
    }
    try:
        with TestClient(app) as client:
            first = client.post(
                "/api/auth/trial-application",
                headers={"Idempotency-Key": "registration-request-1"},
                json=payload,
            )
            second = client.post(
                "/api/auth/trial-application",
                headers={"Idempotency-Key": "registration-request-1"},
                json=payload,
            )
    finally:
        app.dependency_overrides.clear()

    assert first.status_code == 201
    assert second.status_code == 201
    assert second.json() == first.json()
    assert fake_db.add_count == 1


def test_customer_can_delete_accessible_formal_report() -> None:
    report_id = UUID(int=1)
    task_id = UUID(int=3)
    report = SimpleNamespace(
        id=report_id,
        detection_task_id=task_id,
        docx_bucket=None,
        docx_object_key=None,
    )
    task = SimpleNamespace(id=task_id)
    project = SimpleNamespace(
        id=UUID(int=2),
        current_report_id=report_id,
        current_task_id=task_id,
        status=ProjectStatus.COMPLETED.value,
        started_at=datetime.now(UTC),
        completed_at=datetime.now(UTC),
        updated_at=None,
        deleted_at=None,
    )

    class Rows:
        def first(self):
            return report, project

    class FakeDb:
        def __init__(self) -> None:
            self.deleted: list[object] = []
            self.commit_count = 0

        def execute(self, _: object) -> Rows:
            return Rows()

        def get(self, _: type, item_id: UUID) -> object | None:
            return task if item_id == task_id else None

        def delete(self, value: object) -> None:
            self.deleted.append(value)

        def commit(self) -> None:
            self.commit_count += 1

    fake_db = FakeDb()
    delete_report(report_id, fake_db, CUSTOMER)

    assert fake_db.deleted == [report, task]
    assert fake_db.commit_count == 1
    assert project.current_report_id is None
    assert project.current_task_id is None
    assert project.status == ProjectStatus.COMPLETED.value
    assert isinstance(project.deleted_at, datetime)
    assert project.deleted_at.tzinfo == UTC


def test_trial_result_delete_is_recoverable(monkeypatch: pytest.MonkeyPatch) -> None:
    result_id = UUID("33333333-3333-4333-8333-333333333333")
    result = SimpleNamespace(id=result_id, deleted_at=None)

    class EmptyRows:
        def first(self):
            return None

    class FakeDb:
        commit_count = 0

        def execute(self, _: object) -> EmptyRows:
            return EmptyRows()

        def scalar(self, _: object):
            return result

        def commit(self) -> None:
            self.commit_count += 1

        def refresh(self, _: object) -> None:
            return None

    fake_db = FakeDb()
    delete_report(result_id, fake_db, CUSTOMER)
    assert isinstance(result.deleted_at, datetime)
    assert result.deleted_at.tzinfo == UTC

    monkeypatch.setattr("app.api.reports._trial_detail_item", lambda value, _request: {"id": str(value.id)})
    restored = restore_trial_report(SimpleNamespace(), result_id, fake_db, CUSTOMER)
    assert restored == {"id": str(result_id)}
    assert result.deleted_at is None
    assert fake_db.commit_count == 2
