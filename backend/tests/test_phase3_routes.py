from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from app.api import projects
from app.api.dependencies import AuthenticatedUser
from app.enums.status import (
    DroneType,
    FacadeType,
    PhotoPrecheckStatus,
    ProjectStatus,
    UserRole,
)
from app.main import app
from app.schemas.projects import (
    ProjectCreateRequest,
    ProjectDraftCreateRequest,
    ProjectFinalizeRequest,
    ProjectUpdateRequest,
)


def test_phase3_project_routes_are_registered() -> None:
    paths = {route.path for route in app.routes}

    assert "/api/projects" in paths
    assert "/api/projects/drafts" in paths
    assert "/api/projects/{project_id}/finalize" in paths
    assert "/api/projects/{project_id}" in paths
    assert "/api/buildings" not in paths
    assert all("facade" not in path for path in paths)


def test_phase3_create_project_uses_server_owned_fields() -> None:
    fields = ProjectCreateRequest.model_fields

    assert "status" not in fields
    assert "created_by" not in fields
    assert "project_no" not in fields
    assert fields["name"].is_required()
    assert "drone_type" in fields
    assert "facade_type" in fields
    assert "description" in fields
    assert "longitude" in fields
    assert "latitude" in fields


def test_project_name_is_required_for_creation() -> None:
    with pytest.raises(ValueError):
        ProjectCreateRequest()
    assert ProjectUpdateRequest(name="   ").name == "   "


def test_finalize_project_does_not_require_drone_type() -> None:
    payload = ProjectFinalizeRequest(
        name="科技园 A 栋",
        facade_type=FacadeType.COATING,
    )

    assert payload.drone_type is None


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

    def scalar(self, _: object) -> None:
        return None

    def delete(self, _: object) -> None:
        return None


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


class FakeProjectFinalizeDb(FakeProjectUpdateDb):
    def __init__(self, photos: list[object], batches: dict[object, object] | None = None) -> None:
        super().__init__()
        self.photos = photos
        self.batches = batches or {}

    def scalars(self, _: object) -> list[object]:
        return self.photos

    def get(self, _: object, model_id: object) -> object | None:
        return self.batches.get(model_id)


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


def test_update_project_allows_basic_fields_while_draft(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project = SimpleNamespace(
        id=uuid4(),
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
        ProjectUpdateRequest(name="新项目名称", address="新项目位置"),
        db,
        _admin(),
    )

    assert result is project
    assert project.name == "新项目名称"
    assert project.address == "新项目位置"
    assert db.commit_count == 1
    assert db.refreshed is project


def test_update_project_rejects_a_blank_name(
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

    with pytest.raises(HTTPException) as exc_info:
        projects.update_project(
            project.id,
            ProjectUpdateRequest(name="   "),
            db,
            _admin(),
        )

    assert exc_info.value.status_code == 400
    assert project.name == "旧项目名称"
    assert db.commit_count == 0


@pytest.mark.parametrize(
    "project_status",
    [
        ProjectStatus.DRAFT.value,
        ProjectStatus.REVIEWED.value,
        ProjectStatus.COMPLETED.value,
    ],
)
def test_delete_project_allows_draft_and_completed_statuses(
    monkeypatch: pytest.MonkeyPatch,
    project_status: str,
) -> None:
    project = SimpleNamespace(id=uuid4(), status=project_status, deleted_at=None)
    db = FakeProjectUpdateDb()

    monkeypatch.setattr(projects, "_get_project_or_404", lambda *_: project)
    monkeypatch.setattr(projects, "ensure_project_access", lambda *_: None)

    result = projects.delete_project(project.id, db, _admin())

    assert result.ok is True
    assert project.deleted_at is not None
    assert db.commit_count == 1


@pytest.mark.parametrize(
    "project_status",
    [
        ProjectStatus.QUEUED.value,
        ProjectStatus.DETECTING.value,
        ProjectStatus.PENDING_REVIEW.value,
    ],
)
def test_delete_project_rejects_active_statuses(
    monkeypatch: pytest.MonkeyPatch,
    project_status: str,
) -> None:
    project = SimpleNamespace(id=uuid4(), status=project_status, deleted_at=None)
    db = FakeProjectUpdateDb()

    monkeypatch.setattr(projects, "_get_project_or_404", lambda *_: project)
    monkeypatch.setattr(projects, "ensure_project_access", lambda *_: None)

    with pytest.raises(HTTPException) as exc_info:
        projects.delete_project(project.id, db, _admin())

    assert exc_info.value.status_code == 409
    assert project.deleted_at is None
    assert db.commit_count == 0


def test_create_project_rejects_a_blank_name() -> None:
    db = FakeProjectCreateDb()

    with pytest.raises(HTTPException) as exc_info:
        projects._create_project_record(
            db,
            ProjectCreateRequest(name="   "),
            _admin(),
        )

    assert exc_info.value.status_code == 400
    assert db.records == []
    assert db.flush_count == 0


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


def test_create_project_draft_persists_an_active_step_two_project_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    current_user = _admin()
    project = SimpleNamespace(id=uuid4(), created_by=current_user.id)
    db = FakeDraftCreateDb()
    payload = ProjectDraftCreateRequest(
        client_draft_key="browser-draft-key",
        name="自动草稿项目",
    )
    captured_options: list[tuple[str | None, bool, int]] = []

    monkeypatch.setattr(projects, "_find_project_by_draft_key", lambda *_: None)
    monkeypatch.setattr(projects, "_project_detail", lambda *_: project)

    def create_record(
        *_args: object,
        client_draft_key: str | None = None,
        setup_completed: bool = True,
        setup_step: int = 3,
        **_kwargs: object,
    ):
        captured_options.append((client_draft_key, setup_completed, setup_step))
        return project

    monkeypatch.setattr(projects, "_create_project_record", create_record)

    result = projects.create_project_draft(payload, db, current_user)

    assert result is project
    assert captured_options == [("browser-draft-key", True, 2)]
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


def test_finalize_project_advances_to_confirmation_without_discarding_photos(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project_id = uuid4()
    batch_id = uuid4()
    project = SimpleNamespace(
        id=project_id,
        status=ProjectStatus.DRAFT.value,
        setup_completed_at=None,
        setup_step=2,
        name="自动草稿项目",
        drone_type=None,
        description=None,
        updated_at=None,
    )
    passed_photo = SimpleNamespace(
        id=uuid4(),
        upload_batch_id=batch_id,
        precheck_status=PhotoPrecheckStatus.PASSED.value,
        deleted_at=None,
        updated_at=None,
        storage_bucket="photos",
        storage_object_key="projects/passed.jpg",
        thumbnail_object_key="thumbnails/passed.webp",
    )
    rejected_photo = SimpleNamespace(
        id=uuid4(),
        upload_batch_id=batch_id,
        precheck_status=PhotoPrecheckStatus.REJECTED.value,
        deleted_at=None,
        updated_at=None,
        storage_bucket="photos",
        storage_object_key="projects/rejected.jpg",
        thumbnail_object_key="thumbnails/rejected.webp",
    )
    batch = SimpleNamespace(photo_count=2)
    db = FakeProjectFinalizeDb(
        [passed_photo, rejected_photo],
        batches={batch_id: batch},
    )
    removed_objects: list[tuple[str, str | None]] = []

    monkeypatch.setattr(projects, "_get_project_or_404", lambda *_: project)
    monkeypatch.setattr(projects, "ensure_project_write_access", lambda *_: None)
    monkeypatch.setattr(projects, "_project_detail", lambda *_: project)
    monkeypatch.setattr(
        projects,
        "remove_object",
        lambda bucket, object_key: removed_objects.append((bucket, object_key)),
    )

    result = projects.finalize_project(
        project_id,
        ProjectFinalizeRequest(
            name="  科技园 A 栋  ",
            drone_type=DroneType.DJI_MAVIC_3_ENTERPRISE,
            facade_type=FacadeType.COATING,
            description="  北立面与东立面  ",
        ),
        db,
        _admin(),
    )

    assert result is project
    assert project.name == "科技园 A 栋"
    assert project.drone_type == DroneType.DJI_MAVIC_3_ENTERPRISE.value
    assert project.facade_type == FacadeType.COATING.value
    assert project.description == "北立面与东立面"
    assert project.setup_completed_at is not None
    assert project.setup_step == 3
    assert passed_photo.deleted_at is None
    assert rejected_photo.deleted_at is None
    assert batch.photo_count == 2
    assert removed_objects == []
    assert db.commit_count == 1
    assert db.refreshed is project


@pytest.mark.parametrize(
    "project_status",
    [
        ProjectStatus.QUEUED.value,
        ProjectStatus.DETECTING.value,
        ProjectStatus.PENDING_REVIEW.value,
        ProjectStatus.REVIEWED.value,
        ProjectStatus.COMPLETED.value,
    ],
)
def test_update_project_rejects_changes_after_detection_starts(
    monkeypatch: pytest.MonkeyPatch,
    project_status: str,
) -> None:
    project = SimpleNamespace(
        id=uuid4(),
        status=project_status,
        name="锁定项目",
    )
    db = FakeProjectUpdateDb()

    monkeypatch.setattr(projects, "_get_project_or_404", lambda *_: project)
    monkeypatch.setattr(projects, "ensure_project_write_access", lambda *_: None)

    with pytest.raises(HTTPException) as exc_info:
        projects.update_project(
            project.id,
            ProjectUpdateRequest(name="不应保存"),
            db,
            _admin(),
        )

    assert exc_info.value.status_code == 409
    assert project.name == "锁定项目"
    assert db.commit_count == 0


def test_finalize_project_waits_for_all_photo_prechecks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project = SimpleNamespace(
        id=uuid4(),
        status=ProjectStatus.DRAFT.value,
        setup_completed_at=None,
        setup_step=2,
    )
    pending_photo = SimpleNamespace(
        precheck_status=PhotoPrecheckStatus.RUNNING.value,
    )
    db = FakeProjectFinalizeDb([pending_photo])

    monkeypatch.setattr(projects, "_get_project_or_404", lambda *_: project)
    monkeypatch.setattr(projects, "ensure_project_write_access", lambda *_: None)

    with pytest.raises(HTTPException) as exc_info:
        projects.finalize_project(
            project.id,
            ProjectFinalizeRequest(
                name="科技园 A 栋",
                drone_type=DroneType.DJI_MATRICE_4E,
                facade_type=FacadeType.TILE,
            ),
            db,
            _admin(),
        )

    assert exc_info.value.status_code == 409
    assert db.commit_count == 0
