from hashlib import sha256
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api import yolo_models
from app.api.dependencies import AuthenticatedUser, get_current_user
from app.db.session import get_db
from app.enums.status import DefectType
from app.main import app
from app.models.tables import SystemSetting, UserAccount, YoloModel, YoloModelDetectionType, YoloModelFacadeType, YoloModelVersion


@pytest.fixture
def registry(monkeypatch):
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    UserAccount.metadata.create_all(engine, tables=[model.__table__ for model in (UserAccount, SystemSetting, YoloModel, YoloModelDetectionType, YoloModelFacadeType, YoloModelVersion)])
    db = Session(engine)
    user = UserAccount(id=uuid4(), username="model-admin", role="admin", password_hash="test")
    db.add(user)
    models = {kind.value: YoloModel(id=uuid4(), name=f"{kind.value}模型") for kind in DefectType}
    db.add_all(models.values())
    db.flush()
    db.add_all([YoloModelDetectionType(model_id=models[kind.value].id, detection_type=kind.value) for kind in DefectType])
    db.add_all([YoloModelFacadeType(model_id=model.id, facade_type=facade) for model in models.values() for facade in ("tile", "coating", "plaster", "panel", "curtain_wall")])
    db.commit()
    objects = {}

    def put(key, data, length, content_type):
        content = data.read()
        assert len(content) == length
        objects[key] = content
        return "models"

    def remove(bucket, key, **kwargs):
        objects.pop(key, None)

    monkeypatch.setattr(yolo_models.object_storage, "put_object", put)
    monkeypatch.setattr(yolo_models.object_storage, "remove_object", remove)
    monkeypatch.setattr(yolo_models, "get_settings", lambda: SimpleNamespace(yolo_model_max_upload_bytes=1024))
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser.from_model(user)
    client = TestClient(app)
    try:
        yield SimpleNamespace(client=client, db=db, user=user, objects=objects, models=models)
    finally:
        app.dependency_overrides.clear()
        db.close()
        engine.dispose()


def upload(registry, label="v1.0", kind="crack", content=b"test-weights", filename="weights.pt", **kwargs):
    return registry.client.post(f"{model_path(registry, kind)}/versions", data={
        "version": label, "description": "训练版本", **kwargs,
    }, files={"file": (filename, content, "application/octet-stream")})


def version_path(item):
    return f"/api/yolo-models/{item['model_id']}/versions/{item['id']}"


def model_path(registry, kind="crack"):
    return f"/api/yolo-models/{registry.models[kind].id if kind in registry.models else kind}"


def catalog_model(registry, kind="crack"):
    return next(item for item in registry.client.get("/api/yolo-models").json()["items"] if item["id"] == str(registry.models[kind].id))


def test_catalog_reports_models_without_applicability_metadata(registry):
    response = registry.client.get("/api/yolo-models")
    assert response.status_code == 200
    catalog = response.json()
    assert {item["id"] for item in catalog["items"]} == {str(model.id) for model in registry.models.values()}
    assert "detection_types" not in catalog
    assert all("detection_types" not in item and "facade_types" not in item for item in catalog["items"])
    assert all(item["versions"] == [] for item in catalog["items"])
    assert catalog["inference_ready"] is False
    assert catalog["max_upload_bytes"] == 1024


def test_upload_delete_and_persistence(registry):
    first_response = upload(registry, filename="裂缝模型.pt")
    assert first_response.status_code == 201
    first = first_response.json()
    assert "architecture" not in first
    assert "is_active" not in first
    assert first["runtime_status"] == "disabled"
    assert first["control_supported"] is False
    assert first["sha256"] == sha256(b"test-weights").hexdigest()
    second = upload(registry, "v2.0", content=b"new-weights").json()
    other = upload(registry, kind="hollow").json()
    stored = registry.db.get(YoloModelVersion, UUID(first["id"]))
    assert registry.objects[stored.storage_object_key] == b"test-weights"
    assert registry.client.put(f"{version_path(second)}/activate").status_code == 404
    assert len(catalog_model(registry)["versions"]) == 2
    assert registry.client.delete(version_path(first)).status_code == 204
    assert len(registry.objects) == 2
    assert catalog_model(registry)["versions"][0]["id"] == second["id"]


def test_versions_start_together_and_stop_independently(registry, monkeypatch):
    first = upload(registry).json()
    second = upload(registry, "v2").json()
    other = upload(registry, kind="spalling").json()
    states, calls = {}, []
    def status(version):
        state = states.get(version.id, "stopped")
        return yolo_models.yolo_runtime.YoloVersionStatus(state, state, True)
    def control(version, action):
        calls.append((str(version.model_id), str(version.id), action))
        states[version.id] = "running" if action == "start" else "stopped"
        return status(version)
    monkeypatch.setattr(yolo_models.yolo_runtime, "version_status", status)
    monkeypatch.setattr(yolo_models.yolo_runtime, "control_version", control)
    for item in (first, second, other):
        response = registry.client.post(f"{version_path(item)}/runtime/start")
        assert response.status_code == 200
        assert response.json()["state"] == "running"
    assert [item["runtime_status"] for item in catalog_model(registry)["versions"]] == ["running", "running"]
    assert registry.client.delete(version_path(first)).status_code == 409
    assert registry.client.delete(model_path(registry)).status_code == 409
    assert registry.client.post(f"{version_path(first)}/runtime/stop").json()["state"] == "stopped"
    assert states[UUID(second["id"])] == states[UUID(other["id"])] == "running"
    assert registry.client.delete(version_path(first)).status_code == 204
    assert calls == [(item["model_id"], item["id"], "start") for item in (first, second, other)] + [(first["model_id"], first["id"], "stop")]


def test_unavailable_runtime_never_fakes_running_state(registry):
    item = upload(registry).json()
    for action in ("start", "stop"):
        response = registry.client.post(f"{version_path(item)}/runtime/{action}")
        assert response.status_code == 409
        assert "尚未接入" in response.text
    assert registry.client.post(f"{version_path(item)}/runtime/invalid").status_code == 422
    assert catalog_model(registry)["versions"][0]["runtime_status"] == "disabled"


@pytest.mark.parametrize("kwargs,status", [
    ({"filename": "model.exe"}, 422), ({"content": b""}, 422),
    ({"content": b"x" * 1025}, 413), ({"label": "   "}, 422),
    ({"label": "x" * 65}, 422), ({"kind": "unknown"}, 422),
    ({"filename": "x" * 256 + ".pt"}, 422),
])
def test_invalid_uploads_do_not_store_files(registry, kwargs, status):
    assert upload(registry, **kwargs).status_code == status
    assert registry.objects == {}


def test_duplicate_version_is_normalized_and_scoped_to_model(registry):
    assert upload(registry).status_code == 201
    assert upload(registry, " v1.0 ").status_code == 409
    assert len(registry.objects) == 1
    assert upload(registry, kind="damage").status_code == 201


def test_cross_model_and_missing_versions_are_rejected(registry):
    item = upload(registry).json()
    for suffix, method in (("/runtime/start", "post"), ("/runtime/stop", "post"), ("", "delete")):
        assert getattr(registry.client, method)(version_path(item).replace(str(registry.models["crack"].id), str(registry.models["peeling"].id)) + suffix).status_code == 404
    assert registry.client.post(f"{model_path(registry)}/versions/{uuid4()}/runtime/start").status_code == 404
    assert len(registry.objects) == 1


@pytest.mark.parametrize("role", ["customer", "reviewer"])
def test_all_management_endpoints_require_admin(registry, role):
    item = upload(registry).json()
    registry.user.role = role
    assert registry.client.get("/api/yolo-models").status_code == 403
    assert upload(registry, "v2").status_code == 403
    assert registry.client.post(f"{version_path(item)}/runtime/start").status_code == 403
    assert registry.client.post(f"{version_path(item)}/runtime/stop").status_code == 403
    assert registry.client.delete(version_path(item)).status_code == 403


def test_unauthenticated_access_is_rejected(registry):
    app.dependency_overrides.pop(get_current_user)
    assert registry.client.get("/api/yolo-models").status_code == 401


def test_storage_failure_does_not_create_version(registry, monkeypatch):
    def fail(*args, **kwargs):
        raise OSError("offline")

    monkeypatch.setattr(yolo_models.object_storage, "put_object", fail)
    assert upload(registry).status_code == 502
    assert registry.db.scalar(select(YoloModelVersion)) is None


def test_failed_delete_reports_error_and_keeps_record(registry, monkeypatch):
    item = upload(registry).json()

    def fail(*args, **kwargs):
        raise OSError("offline")

    monkeypatch.setattr(yolo_models.object_storage, "remove_object", fail)
    assert registry.client.delete(version_path(item)).status_code == 502
    assert registry.db.get(YoloModelVersion, UUID(item["id"])) is not None


def test_failed_db_commit_removes_uploaded_blob(registry, monkeypatch):
    def fail():
        raise IntegrityError("commit", {}, Exception("conflict"))

    monkeypatch.setattr(registry.db, "commit", fail)
    assert upload(registry).status_code == 409
    assert registry.objects == {}
    assert registry.db.scalar(select(YoloModelVersion)) is None


def test_upload_does_not_start_or_select_any_version(registry, monkeypatch):
    calls = []
    monkeypatch.setattr(yolo_models.yolo_runtime, "control_version", lambda *args: calls.append(args))
    first = upload(registry).json()
    upload(registry, "v2")
    assert calls == []
    assert registry.db.get(YoloModelVersion, UUID(first["id"])).is_active is False


def test_model_edit_preserves_versions_and_recreate_is_independent(registry):
    item = upload(registry).json()
    edited = registry.client.patch(model_path(registry), json={"name": "  外墙裂缝模型  ", "description": " 专用模型 "})
    assert edited.status_code == 200
    assert edited.json()["name"] == "外墙裂缝模型"
    assert edited.json()["description"] == "专用模型"
    assert edited.json()["id"] == item["model_id"]
    assert edited.json()["versions"][0]["id"] == item["id"]
    stored = registry.db.get(YoloModelVersion, UUID(item["id"]))
    assert registry.objects[stored.storage_object_key] == b"test-weights"
    assert registry.client.delete(model_path(registry)).status_code == 204
    catalog = registry.client.get("/api/yolo-models").json()
    assert len(catalog["items"]) == 5
    assert registry.objects
    assert registry.client.put(f"{version_path(item)}/activate").status_code == 404
    assert upload(registry, "v2").status_code == 404
    assert registry.client.patch(model_path(registry), json={"name": "新名称"}).status_code == 404
    assert registry.client.delete(model_path(registry)).status_code == 404
    created = registry.client.post("/api/yolo-models", json={"name": "新的模型"})
    assert created.status_code == 201
    assert created.json()["id"] != item["model_id"]
    assert created.json()["versions"] == []
    assert registry.db.get(YoloModelVersion, UUID(item["id"])) is not None


def test_create_models_without_capabilities_with_independent_versions(registry):
    created = []
    for name in ("A模型", "B模型", "C模型"):
        response = registry.client.post("/api/yolo-models", json={"name": name})
        assert response.status_code == 201
        model = response.json()
        assert "detection_types" not in model and "facade_types" not in model
        assert registry.db.scalars(select(YoloModelDetectionType).where(YoloModelDetectionType.model_id == UUID(model["id"]))).all() == []
        assert registry.db.scalars(select(YoloModelFacadeType).where(YoloModelFacadeType.model_id == UUID(model["id"]))).all() == []
        assert model["versions"] == []
        registry.models[name] = registry.db.get(YoloModel, UUID(model["id"]))
        created.append(upload(registry, kind=name).json())
    assert len({item["model_id"] for item in created}) == 3
    assert all(item["runtime_status"] == "disabled" for item in created)
    assert len({key.split("/")[1] for key in registry.objects}) == 3
    assert len(registry.client.get("/api/yolo-models").json()["items"]) == 9
    second = upload(registry, kind="A模型", label="v2").json()
    registry.db.expire_all()
    assert registry.db.get(YoloModelVersion, UUID(created[0]["id"])).is_active is False
    assert all(registry.db.get(YoloModelVersion, UUID(item["id"])).is_active is False for item in created[1:])
    assert registry.db.get(YoloModelVersion, UUID(second["id"])).is_active is False


@pytest.mark.parametrize("payload", [
    {"detection_types": ["unknown"], "name": "模型"},
    {"name": "   "},
    {"name": "x" * 129},
    {"detection_types": [], "name": "模型"},
    {"detection_types": ["crack", "crack"], "name": "模型"},
    {"detection_types": "crack", "name": "模型"},
    {"detection_type": "crack", "name": "旧格式模型"},
    {"name": "模型", "facade_types": ["coating"]},
    {"name": "模型", "description": "x" * 2001},
    {"description": "缺少名称"},
])
def test_invalid_model_metadata(registry, payload):
    assert registry.client.post("/api/yolo-models", json=payload).status_code == 422
    assert registry.client.patch(model_path(registry), json=payload).status_code == 422
    assert catalog_model(registry)["name"] == registry.models["crack"].name


def test_edit_version_metadata_preserves_weights(registry):
    first = upload(registry).json()
    # Older versions can retain their historical metadata without exposing or requiring it.
    registry.db.get(YoloModelVersion, UUID(first["id"])).architecture = "YOLO11"
    registry.db.commit()
    other = upload(registry, "v2").json()
    payload = {"version": " v1.1 ", "description": " 已更新说明 "}
    edited = registry.client.patch(version_path(first), json=payload)
    assert edited.status_code == 200
    assert edited.json()["version"] == "v1.1"
    assert "architecture" not in edited.json()
    assert registry.db.get(YoloModelVersion, UUID(first["id"])).architecture == "YOLO11"
    assert "architecture" not in catalog_model(registry)["versions"][0]
    assert edited.json()["description"] == "已更新说明"
    assert edited.json()["sha256"] == first["sha256"]
    stored = registry.db.get(YoloModelVersion, UUID(first["id"]))
    assert registry.objects[stored.storage_object_key] == b"test-weights"
    assert edited.json()["runtime_status"] == "disabled"
    payload["version"] = other["version"]
    assert registry.client.patch(version_path(first), json=payload).status_code == 409
    assert registry.db.get(YoloModelVersion, UUID(first["id"])).version == "v1.1"
    payload["version"] = "   "
    assert registry.client.patch(version_path(first), json=payload).status_code == 422
    payload["version"] = "v3"
    assert registry.client.patch(version_path(first).replace(str(registry.models["crack"].id), str(registry.models["damage"].id)), json=payload).status_code == 404


@pytest.mark.parametrize("role", ["customer", "reviewer"])
def test_catalog_and_version_editing_require_admin(registry, role):
    item = upload(registry).json()
    registry.user.role = role
    assert registry.client.post("/api/yolo-models", json={"name": "模型"}).status_code == 403
    assert registry.client.patch(model_path(registry), json={"name": "模型"}).status_code == 403
    assert registry.client.delete(model_path(registry)).status_code == 403
    assert registry.client.patch(version_path(item), json={"version": "v2"}).status_code == 403


def test_version_download_is_not_available(registry):
    item = upload(registry).json()
    assert registry.client.get(f"{version_path(item)}/download").status_code == 404
    assert not any("/yolo-models/" in route.path and route.path.endswith("/download") for route in app.routes)
