from io import BytesIO
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

from app.api import building_models
from app.api.dependencies import AuthenticatedUser
from app.enums.status import UserRole
from app.main import app
from app.models.tables import BuildingModel


class FakeDb:
    def __init__(self, model: BuildingModel | None = None, *, fail_commit: bool = False) -> None:
        self.model = model
        self.fail_commit = fail_commit
        self.added: list[object] = []
        self.deleted: list[object] = []
        self.events: list[str] = []

    def scalar(self, _: object) -> BuildingModel | None:
        return self.model

    def add(self, value: object) -> None:
        self.added.append(value)
        if isinstance(value, BuildingModel):
            self.model = value

    def delete(self, value: object) -> None:
        self.deleted.append(value)
        self.events.append("db-delete")

    def commit(self) -> None:
        self.events.append("commit")
        if self.fail_commit:
            raise RuntimeError("commit failed")

    def rollback(self) -> None:
        self.events.append("rollback")

    def refresh(self, _: object) -> None:
        return None


def _reviewer() -> AuthenticatedUser:
    return AuthenticatedUser(
        id=uuid4(),
        username="reviewer",
        real_name="审核员",
        role=UserRole.REVIEWER.value,
        organization=None,
    )


def _customer() -> AuthenticatedUser:
    return AuthenticatedUser(
        id=uuid4(),
        username="customer",
        real_name="客户",
        role=UserRole.CUSTOMER.value,
        organization=None,
    )


def _upload(filename: str = "tower.glb", content: bytes = b"glTF-model") -> UploadFile:
    return UploadFile(
        file=BytesIO(content),
        filename=filename,
        headers=Headers({"content-type": "model/gltf-binary"}),
    )


def test_building_model_routes_are_registered() -> None:
    paths = {route.path for route in app.routes}
    assert "/api/projects/{project_id}/building-model" in paths


def test_upload_replaces_project_model_and_removes_old_object_after_commit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project_id = uuid4()
    project = SimpleNamespace(id=project_id, is_example=False, updated_at=None)
    existing = BuildingModel(
        id=uuid4(),
        project_id=project_id,
        original_filename="old.glb",
        file_size=3,
        mime_type="model/gltf-binary",
        storage_bucket="inspection",
        storage_object_key="old/model.glb",
        uploaded_by=uuid4(),
    )
    db = FakeDb(existing)
    removed: list[tuple[str, str]] = []
    monkeypatch.setattr(building_models, "_get_project_or_404", lambda *_: project)
    monkeypatch.setattr(building_models, "put_object", lambda **_: "inspection")
    monkeypatch.setattr(building_models, "remove_object", lambda *value: removed.append(value))
    monkeypatch.setattr(building_models, "_to_read", lambda _, model: model)

    result = building_models.upload_building_model(
        project_id,
        SimpleNamespace(),
        _upload(),
        db,
        _reviewer(),
    )

    assert result is existing
    assert existing.original_filename == "tower.glb"
    assert existing.storage_object_key.startswith(f"projects/{project_id}/building-models/")
    assert db.events == ["commit"]
    assert removed == [("inspection", "old/model.glb")]


def test_failed_upload_commit_removes_the_new_object(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project_id = uuid4()
    project = SimpleNamespace(id=project_id, is_example=False, updated_at=None)
    db = FakeDb(fail_commit=True)
    removed: list[tuple[str, str]] = []
    monkeypatch.setattr(building_models, "_get_project_or_404", lambda *_: project)
    monkeypatch.setattr(building_models, "put_object", lambda **_: "inspection")
    monkeypatch.setattr(building_models, "remove_object", lambda *value: removed.append(value))

    with pytest.raises(RuntimeError, match="commit failed"):
        building_models.upload_building_model(
            project_id,
            SimpleNamespace(),
            _upload(),
            db,
            _reviewer(),
        )

    assert db.events == ["commit", "rollback"]
    assert len(removed) == 1
    assert removed[0][0] == "inspection"


def test_delete_removes_database_record_before_storage_object(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project_id = uuid4()
    project = SimpleNamespace(id=project_id, is_example=False, updated_at=None)
    model = BuildingModel(
        id=uuid4(),
        project_id=project_id,
        original_filename="tower.glb",
        file_size=10,
        mime_type="model/gltf-binary",
        storage_bucket="inspection",
        storage_object_key="models/tower.glb",
        uploaded_by=uuid4(),
    )
    db = FakeDb(model)
    monkeypatch.setattr(building_models, "_get_project_or_404", lambda *_: project)
    monkeypatch.setattr(
        building_models,
        "remove_object",
        lambda *_: db.events.append("storage-delete"),
    )

    result = building_models.delete_building_model(project_id, db, _reviewer())

    assert result.ok is True
    assert db.deleted == [model]
    assert db.events == ["db-delete", "commit", "storage-delete"]


def test_example_project_model_is_read_only() -> None:
    project = SimpleNamespace(id=uuid4(), is_example=True, created_by=uuid4())
    with pytest.raises(HTTPException) as exc_info:
        building_models._ensure_model_write_access(project, _reviewer())
    assert exc_info.value.status_code == 403


def test_customer_cannot_manage_building_model() -> None:
    customer = _customer()
    project = SimpleNamespace(id=uuid4(), is_example=False, created_by=customer.id)
    with pytest.raises(HTTPException) as exc_info:
        building_models._ensure_model_write_access(project, customer)
    assert exc_info.value.status_code == 403
    assert "审核员" in exc_info.value.detail
