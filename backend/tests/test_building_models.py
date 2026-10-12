from io import BytesIO
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException, UploadFile
from PIL import Image
from starlette.datastructures import Headers

from app.api import building_models
from app.api.dependencies import AuthenticatedUser
from app.enums.status import UserRole
from app.main import app
from app.models.tables import BuildingModel, BuildingModelImage


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


class FakeImageDb(FakeDb):
    def __init__(self) -> None:
        super().__init__()
        self.added_images: list[BuildingModelImage] = []

    def flush(self) -> None:
        self.events.append("flush")

    def add_all(self, values: list[BuildingModelImage]) -> None:
        self.added_images.extend(values)
        self.events.append("add-all")


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


def _image_upload(filename: str = "east.png") -> UploadFile:
    content = BytesIO()
    Image.new("RGB", (24, 18), "blue").save(content, format="PNG")
    content.seek(0)
    return UploadFile(
        file=content,
        filename=filename,
        headers=Headers({"content-type": "image/png"}),
    )


def test_building_model_routes_are_registered() -> None:
    paths = {route.path for route in app.routes}
    assert "/api/projects/{project_id}/building-model" in paths
    assert "/api/projects/{project_id}/building-model-images" in paths


def test_model_report_image_upload_accepts_png() -> None:
    filename, content, mime_type, object_key = building_models._validated_image_upload(
        _image_upload(),
        ("east", "elevation"),
    )

    assert filename == "east.png"
    assert content.startswith(b"\x89PNG")
    assert mime_type == "image/png"
    assert "east-elevation" in object_key


def test_complete_model_report_images_requires_all_nine_slots() -> None:
    project_id = uuid4()
    images = [
        SimpleNamespace(orientation=orientation, image_kind=image_kind)
        for orientation, image_kind in building_models.MODEL_IMAGE_SLOTS
    ]
    db = SimpleNamespace(scalars=lambda _: images)

    assert building_models.has_complete_building_model_images(db, project_id) is True
    db.scalars = lambda _: images[:-1]
    assert building_models.has_complete_building_model_images(db, project_id) is False


def test_model_overview_upload_uses_dedicated_slot() -> None:
    filename, _, mime_type, object_key = building_models._validated_image_upload(
        _image_upload("model-overview.png"),
        ("overview", "model"),
    )

    assert filename == "model-overview.png"
    assert mime_type == "image/png"
    assert "overview-model" in object_key


def test_partial_image_upload_replaces_only_submitted_slot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project_id = uuid4()
    project = SimpleNamespace(id=project_id, is_example=False, updated_at=None)
    old_elevation = SimpleNamespace(
        orientation="east",
        image_kind="elevation",
        storage_bucket="inspection",
        storage_object_key="old/east.jpg",
    )
    retained_annotation = SimpleNamespace(
        orientation="north",
        image_kind="annotated",
        storage_bucket="inspection",
        storage_object_key="old/north-annotated.jpg",
    )
    db = FakeImageDb()
    removed: list[tuple[str, str]] = []
    monkeypatch.setattr(building_models, "_get_project_or_404", lambda *_: project)
    monkeypatch.setattr(
        building_models,
        "_get_building_model_images",
        lambda *_: [old_elevation, retained_annotation],
    )
    monkeypatch.setattr(building_models, "put_object", lambda **_: "inspection")
    monkeypatch.setattr(building_models, "remove_object", lambda *value: removed.append(value))
    monkeypatch.setattr(building_models, "_image_to_read", lambda _, image: image)

    result = building_models.upload_building_model_images(
        project_id,
        SimpleNamespace(),
        [_image_upload("new-east.png")],
        ["east:elevation"],
        db,
        _reviewer(),
    )

    assert db.deleted == [old_elevation]
    assert len(db.added_images) == 1
    assert db.added_images[0].orientation == "east"
    assert retained_annotation in result
    assert db.added_images[0] in result
    assert removed == [("inspection", "old/east.jpg")]


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
