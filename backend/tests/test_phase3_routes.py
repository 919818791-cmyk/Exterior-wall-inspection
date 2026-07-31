from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from app.api import projects
from app.api.dependencies import AuthenticatedUser
from app.enums.status import ProjectStatus, UserRole
from app.main import app
from app.schemas.projects import (
    ProjectCreateRequest,
    ProjectDraftCreateRequest,
    ProjectUpdateRequest,
)


def test_phase3_project_routes_are_registered() -> None:
    paths = {route.path for route in app.routes}

    assert "/api/projects" in paths
    assert "/api/projects/drafts" in paths
    assert "/api/projects/{project_id}" in paths
    assert all("building" not in path for path in paths)
    assert all("facade" not in path for path in paths)


def test_phase3_create_project_uses_server_owned_fields() -> None:
    fields = ProjectCreateRequest.model_fields

    assert "status" not in fields
    assert "created_by" not in fields
    assert "project_no" not in fields
    assert not fields["name"].is_required()
    assert "longitude" in fields
    assert "latitude" in fields


def test_blank_project_names_use_the_project_number_timestamp() -> None:
    project_no = "PRJ-20260729-001"

    assert projects._generated_project_name(project_no) == "未命名项目-20260729"
    assert ProjectCreateRequest().name is None
    assert ProjectUpdateRequest(name="   ").name == "   "


def test_project_draft_requires_a_client_idempotency_key() -> None:
    fields = ProjectDraftCreateRequest.model_fields

    assert fields["client_draft_key"].is_required()
    assert fields["client_draft_key"].metadata


class FakeProjectUpdateDb:
    def __init__(self) -> None:
        self.commit_count = 0
        self.refreshed: object | None = None

    def commit(self) -> None:
        self.commit_count += 1

    def refresh(self, model: object) -> None:
        self.refreshed = model


class FakeProjectCreateDb:
    def __init__(self) -> None:
        self.records: list[object] = []
        self.flush_count = 0

    def add(self, model: object) -> None:
        self.records.append(model)

    def flush(self) -> None:
        self.flush_count += 1


class FakeProjectNumberDb:
    def __init__(self, existing_numbers: list[str]) -> None:
        self.existing_numbers = existing_numbers
        self.execute_count = 0

    def execute(self, _: object) -> None:
        self.execute_count += 1

    def scalars(self, _: object) -> list[str]:
        return self.existing_numbers


class FakeDraftCreateDb(FakeProjectUpdateDb):
    def __init__(self) -> None:
        super().__init__()
        self.rollback_count = 0

    def rollback(self) -> None:
        self.rollback_count += 1


class FakeDraftRaceDb(FakeDraftCreateDb):
    def commit(self) -> None:
        self.commit_count += 1
        raise IntegrityError("insert project", {}, RuntimeError("duplicate draft key"))


def _admin() -> AuthenticatedUser:
    return AuthenticatedUser(
        id=uuid4(),
        username="admin",
        real_name="平台管理员",
        role=UserRole.ADMIN.value,
        organization=None,
    )


@pytest.mark.parametrize(
    ("existing_numbers", "expected"),
    [
        ([], "PRJ-20260729-001"),
        (
            ["PRJ-20260729-001", "PRJ-20260729-007"],
            "PRJ-20260729-008",
        ),
    ],
)
def test_project_numbers_use_a_daily_three_digit_sequence(
    monkeypatch: pytest.MonkeyPatch,
    existing_numbers: list[str],
    expected: str,
) -> None:
    db = FakeProjectNumberDb(existing_numbers)
    monkeypatch.setattr(projects, "_project_number_date", lambda: "20260729")

    assert projects._now_project_no(db) == expected
    assert db.execute_count == 1


@pytest.mark.parametrize(
    "project_status",
    [
        ProjectStatus.DRAFT.value,
        ProjectStatus.DETECTING.value,
        ProjectStatus.PENDING_REVIEW.value,
        ProjectStatus.REVIEWED.value,
        ProjectStatus.COMPLETED.value,
    ],
)
def test_update_project_allows_basic_fields_in_every_status(
    monkeypatch: pytest.MonkeyPatch,
    project_status: str,
) -> None:
    project = SimpleNamespace(
        id=uuid4(),
        status=project_status,
        name="旧项目名称",
        address="旧项目位置",
    )
    db = FakeProjectUpdateDb()

    monkeypatch.setattr(projects, "_get_project_or_404", lambda *_: project)
    monkeypatch.setattr(projects, "ensure_project_access", lambda *_: None)
    monkeypatch.setattr(projects, "_project_detail", lambda *_: project)

    result = projects.update_project(
        project.id,
        ProjectUpdateRequest(name="新项目名称", address="新项目位置"),
        db,
        _admin(),
    )

    assert result is project
    assert project.name == "新项目名称"
    assert project.address == "新项目位置"
    assert db.commit_count == 1
    assert db.refreshed is project


def test_update_project_generates_a_name_when_the_submitted_name_is_blank(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project = SimpleNamespace(
        id=uuid4(),
        project_no="PRJ-20260729-001",
        status=ProjectStatus.DRAFT.value,
        name="旧项目名称",
        address="旧项目位置",
    )
    db = FakeProjectUpdateDb()

    monkeypatch.setattr(projects, "_get_project_or_404", lambda *_: project)
    monkeypatch.setattr(projects, "ensure_project_access", lambda *_: None)
    monkeypatch.setattr(projects, "_project_detail", lambda *_: project)

    result = projects.update_project(
        project.id,
        ProjectUpdateRequest(name="   "),
        db,
        _admin(),
    )

    assert result is project
    assert project.name == "未命名项目-20260729"
    assert db.commit_count == 1


def test_create_project_generates_a_name_when_the_submitted_name_is_blank(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project_no = "PRJ-20260729-001"
    db = FakeProjectCreateDb()
    monkeypatch.setattr(projects, "_now_project_no", lambda _db: project_no)

    project = projects._create_project_record(
        db,
        ProjectCreateRequest(name="   "),
        _admin(),
    )

    assert project.project_no == project_no
    assert project.name == "未命名项目-20260729"
    assert db.records == [project]
    assert db.flush_count == 1


def test_create_project_draft_reuses_the_existing_idempotent_draft(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    current_user = _admin()
    project = SimpleNamespace(id=uuid4(), created_by=current_user.id)
    db = FakeDraftCreateDb()
    payload = ProjectDraftCreateRequest(
        client_draft_key="browser-draft-key",
        name="自动草稿项目",
    )

    monkeypatch.setattr(projects, "_find_project_by_draft_key", lambda *_: project)
    monkeypatch.setattr(projects, "_project_detail", lambda *_: project)
    monkeypatch.setattr(
        projects,
        "_create_project_record",
        lambda *_args, **_kwargs: pytest.fail("existing draft must be reused"),
    )

    result = projects.create_project_draft(payload, db, current_user)

    assert result is project
    assert db.commit_count == 0
    assert db.refreshed is None


def test_create_project_draft_persists_a_new_draft_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    current_user = _admin()
    project = SimpleNamespace(id=uuid4(), created_by=current_user.id)
    db = FakeDraftCreateDb()
    payload = ProjectDraftCreateRequest(
        client_draft_key="browser-draft-key",
        name="自动草稿项目",
    )
    captured_key: list[str | None] = []

    monkeypatch.setattr(projects, "_find_project_by_draft_key", lambda *_: None)
    monkeypatch.setattr(projects, "_project_detail", lambda *_: project)

    def create_record(*_args: object, client_draft_key: str | None = None, **_kwargs: object):
        captured_key.append(client_draft_key)
        return project

    monkeypatch.setattr(projects, "_create_project_record", create_record)

    result = projects.create_project_draft(payload, db, current_user)

    assert result is project
    assert captured_key == ["browser-draft-key"]
    assert db.commit_count == 1
    assert db.refreshed is project


def test_create_project_draft_resolves_a_concurrent_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    current_user = _admin()
    attempted_project = SimpleNamespace(id=uuid4(), created_by=current_user.id)
    winning_project = SimpleNamespace(id=uuid4(), created_by=current_user.id)
    db = FakeDraftRaceDb()
    payload = ProjectDraftCreateRequest(
        client_draft_key="shared-browser-draft-key",
        name="并发创建草稿",
    )
    lookup_results = iter([None, winning_project])

    monkeypatch.setattr(
        projects,
        "_find_project_by_draft_key",
        lambda *_: next(lookup_results),
    )
    monkeypatch.setattr(
        projects,
        "_create_project_record",
        lambda *_args, **_kwargs: attempted_project,
    )
    monkeypatch.setattr(projects, "_project_detail", lambda _db, project: project)

    result = projects.create_project_draft(payload, db, current_user)

    assert result is winning_project
    assert db.commit_count == 1
    assert db.rollback_count == 1
    assert db.refreshed is None
