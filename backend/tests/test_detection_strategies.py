import asyncio
import json
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api import reports, vision_models as vision_api
from app.api.dependencies import AuthenticatedUser, get_current_user
from app.db.session import get_db
from app.main import app
from app.models.tables import SystemSetting, UserAccount, YoloModel, YoloModelDetectionType, YoloModelFacadeType, YoloModelVersion
from app.schemas.detection_strategies import DetectionStrategyEdit
from app.services import detection_strategies as strategies, vision_models as models
from app.services.local_qwen_lifecycle import LocalQwenStatus
from app.services.trial_qwen_inference import TrialQwenImageInput
from test_system_settings import _settings


@pytest.fixture
def registry(monkeypatch):
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    UserAccount.metadata.create_all(engine, tables=[item.__table__ for item in (UserAccount, SystemSetting, YoloModel, YoloModelDetectionType, YoloModelFacadeType, YoloModelVersion)])
    db = Session(engine)
    user = UserAccount(id=uuid4(), username="strategy-admin", password_hash="test", role="admin")
    db.add(user)
    db.commit()
    settings = _settings()
    monkeypatch.setattr(models, "get_settings", lambda: settings)
    monkeypatch.setattr("app.services.trial_inference_provider.get_settings", lambda: settings)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser.from_model(user)
    try:
        yield SimpleNamespace(db=db, user=user, client=TestClient(app), settings=settings)
    finally:
        app.dependency_overrides.clear()
        db.close()
        engine.dispose()


def bind(registry, key, model_kind="cloud_api", model_id="qwen", version_id=None):
    item = next(item for item in strategies.read_strategies(registry.db) if item.key == key)
    return {"key": key, "model_kind": model_kind, "model_id": model_id, "version_id": version_id, "prompt": item.prompt}


def save(registry, *items):
    return registry.client.put("/api/detection-strategies", json={"items": items})


def create_vision(registry, kind="cloud_api", **fields):
    payload = {"name": "专项视觉模型", "kind": kind, "model_name": "special-vl", "api_base_url": "https://special.test/v1", "api_key_env": "SPECIAL_API_KEY", **fields}
    response = registry.client.post("/api/vision-models", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def create_yolo(registry):
    response = registry.client.post("/api/yolo-models", json={"name": "涂饰专项模型"})
    assert response.status_code == 201, response.text
    return response.json()


def create_version(registry, yolo, label="v1"):
    version = YoloModelVersion(id=uuid4(), model_id=UUID(yolo["id"]), version=label, architecture="",
        original_filename="weights.pt", file_size=12, sha256="a" * 64,
        storage_bucket="models", storage_object_key=f"models/{uuid4()}/weights.pt", is_active=False)
    registry.db.add(version)
    registry.db.commit()
    return version


def test_model_routes_require_admin(registry):
    registry.user.role = "customer"
    for path in ("/api/detection-strategies", "/api/vision-models", "/api/yolo-models"):
        assert registry.client.get(path).status_code == 403


def test_all_items_save_and_combo_is_independent(registry, monkeypatch):
    monkeypatch.setenv("SPECIAL_API_KEY", "secret-test-key")
    cloud = create_vision(registry)
    items = [bind(registry, item.key, item.model_kind, item.model_id) for item in strategies.read_strategies(registry.db)]
    assert len(items) == 21
    assert save(registry, *items).status_code == 200
    assert save(registry, bind(registry, "coating_crack_prompt", model_id=cloud["id"])).status_code == 200
    combined = strategies.resolve_plan(registry.db, "coating", ["peeling", "crack"])
    assert [item.key for item in combined] == ["coating_crack_peeling_prompt"]
    assert combined[0].runtime.model == "qwen3-vl-plus"
    assert strategies.resolve_plan(registry.db, "coating", ["crack"])[0].runtime.model == "special-vl"
    assert save(registry, bind(registry, "coating_crack_peeling_prompt", "unconfigured", None)).status_code == 200
    with pytest.raises(HTTPException, match="尚未配置"):
        strategies.resolve_plan(registry.db, "coating", ["peeling", "crack"])
    assert strategies.selected_keys("panel", ["damage", "spalling"]) == ["panel_damage_spalling_prompt"]


def test_invalid_batch_is_atomic_and_duplicate_keys_rejected(registry):
    valid = bind(registry, "coating_crack_prompt", "local_vlm", "local_qwen")
    invalid = bind(registry, "coating_peeling_prompt", model_id="missing-model")
    assert save(registry, valid, invalid).status_code == 404
    assert strategies.binding(registry.db, valid["key"]) is None
    assert save(registry, valid, valid).status_code == 422
    assert strategies.binding(registry.db, valid["key"]) is None


@pytest.mark.parametrize("legacy_metadata", [False, True])
def test_yolo_bindings_ignore_applicability_but_protect_references(registry, legacy_metadata):
    yolo = create_yolo(registry)
    version = create_version(registry, yolo)
    if legacy_metadata:
        registry.db.add(YoloModelDetectionType(model_id=UUID(yolo["id"]), detection_type="crack"))
        registry.db.add(YoloModelFacadeType(model_id=UUID(yolo["id"]), facade_type="coating"))
        registry.db.commit()
    items = [bind(registry, key, "yolo", yolo["id"], str(version.id)) for key in strategies.DEFINITIONS]
    assert save(registry, *items).status_code == 200
    assert all(item.model_id == yolo["id"] for item in strategies.read_strategies(registry.db))
    assert save(registry, bind(registry, "coating_crack_prompt", "yolo", yolo["id"], str(uuid4()))).status_code == 422
    assert registry.client.delete(f"/api/yolo-models/{yolo['id']}").status_code == 409
    assert registry.client.patch(f"/api/yolo-models/{yolo['id']}", json={"name": "Changed"}).status_code == 200
    restored = registry.client.get("/api/yolo-models").json()["items"][0]
    assert restored["name"] == "Changed"
    assert "detection_types" not in restored and "facade_types" not in restored
    with pytest.raises(HTTPException, match="运行服务尚未接入"):
        strategies.resolve_plan(registry.db, "coating", ["crack", "peeling"])
    assert registry.client.post(f"/api/yolo-models/{yolo['id']}/versions/{version.id}/runtime/start").status_code == 409


def test_fixed_yolo_version_cannot_be_removed(registry):
    yolo = create_yolo(registry)
    version = YoloModelVersion(id=uuid4(), model_id=yolo["id"], version="v1", architecture="YOLO11", original_filename="weights.pt", file_size=12, sha256="a" * 64, storage_bucket="models", storage_object_key="model/weights.pt", is_active=False)
    from uuid import UUID
    version.model_id = UUID(version.model_id)
    registry.db.add(version)
    registry.db.commit()
    assert save(registry, bind(registry, "coating_crack_peeling_prompt", "yolo", yolo["id"], str(version.id))).status_code == 200
    assert registry.client.delete(f"/api/yolo-models/{yolo['id']}/versions/{version.id}").status_code == 409


def test_cloud_profiles_crud_and_never_return_key(registry, monkeypatch):
    monkeypatch.setenv("SPECIAL_API_KEY", "secret-test-key")
    model = create_vision(registry)
    assert model["configured"]
    assert "secret-test-key" not in registry.client.get("/api/vision-models").text
    assert save(registry, bind(registry, "crack_prompt", model_id=model["id"])).status_code == 200
    assert registry.client.delete(f"/api/vision-models/{model['id']}").status_code == 409
    assert save(registry, bind(registry, "crack_prompt")).status_code == 200
    assert registry.client.delete(f"/api/vision-models/{model['id']}").status_code == 204
    assert registry.client.delete("/api/vision-models/qwen").status_code == 409
    assert registry.client.post("/api/vision-models/qwen/runtime/start").status_code == 422


def test_yolo_requires_explicit_version_and_preserves_separate_bindings(registry):
    yolo = create_yolo(registry)
    first = create_version(registry, yolo)
    second = create_version(registry, yolo, "v2")
    assert save(registry, bind(registry, "coating_crack_prompt", "yolo", yolo["id"])).status_code == 422
    assert save(registry,
        bind(registry, "coating_crack_prompt", "yolo", yolo["id"], str(first.id)),
        bind(registry, "coating_crack_peeling_prompt", "yolo", yolo["id"], str(second.id))).status_code == 200
    assert strategies.binding(registry.db, "coating_crack_prompt")["version_id"] == str(first.id)
    assert strategies.binding(registry.db, "coating_crack_peeling_prompt")["version_id"] == str(second.id)
    other = create_yolo(registry)
    assert save(registry, bind(registry, "coating_crack_prompt", "yolo", other["id"], str(first.id))).status_code == 422


@pytest.mark.parametrize("fields", [{"api_base_url": "file:///models"}, {"api_base_url": "https://user:key@example.test/v1"}, {"api_key_env": "literal-secret"}, {"api_key": "should-not-be-stored"}])
def test_invalid_api_settings_return_validation_error(registry, fields):
    response = registry.client.post("/api/vision-models", json={"name": "Bad", "kind": "cloud_api", "model_name": "bad", "api_base_url": "https://valid.test/v1", **fields})
    assert response.status_code == 422


def test_local_configuration_is_saved_without_starting(registry, monkeypatch):
    calls = []
    monkeypatch.setattr(vision_api, "start_local_qwen", lambda *_: calls.append("start"))
    local = create_vision(registry, "local_vlm", api_base_url="http://127.0.0.1:9006/v1", api_key_env="", model_path="/models/special-vl")
    assert save(registry, bind(registry, "coating_crack_prompt", "local_vlm", local["id"])).status_code == 200
    assert calls == []
    assert not local["control_supported"]
    assert registry.client.post(f"/api/vision-models/{local['id']}/runtime/start").status_code == 409


@pytest.mark.parametrize("state,pid,active", [
    ("running", 123, True), ("starting", 123, True),
    ("error", 123, True), ("error", None, False), ("stopped", None, False),
])
def test_local_switch_reflects_process_presence_even_when_health_fails(registry, monkeypatch, state, pid, active):
    import os
    local = create_vision(registry, "local_vlm", model_path="/models/special-vl")
    monkeypatch.setattr(models, "os", SimpleNamespace(name="posix", environ=os.environ))
    monkeypatch.setattr(models, "local_model_settings", lambda *_: SimpleNamespace(
        local_qwen_control_enabled=True, app_env="development", local_qwen_model_path="/models/special-vl"))
    monkeypatch.setattr(models, "local_qwen_status", lambda *_: LocalQwenStatus(state, "服务状态", pid))
    model = models.model_read(registry.db, local["id"])
    assert model.runtime_status == state
    assert model.runtime_active is active
    assert model.control_supported


def test_local_control_only_runs_from_management_endpoint(registry, monkeypatch):
    local = create_vision(registry, "local_vlm", api_base_url="http://127.0.0.1:9006/v1", api_key_env="", model_path="/models/special-vl")
    original = models.model_read
    monkeypatch.setattr(models, "model_read", lambda db, identifier: original(db, identifier).model_copy(update={"control_supported": True, "runtime_status": "stopped"}))
    calls = []
    def start(settings):
        calls.append((settings.local_qwen_model_path, settings.local_qwen_api_base_url, settings.local_qwen_runtime_dir))
        return LocalQwenStatus("starting", "正在启动")
    monkeypatch.setattr(vision_api, "start_local_qwen", start)
    response = registry.client.post(f"/api/vision-models/{local['id']}/runtime/start")
    assert response.status_code == 200
    assert response.json()["state"] == "starting"
    assert calls[0][:2] == ("/models/special-vl", "http://127.0.0.1:9006/v1")
    assert calls[0][2].endswith("vision-" + local["id"])
    monkeypatch.setattr(vision_api, "stop_local_qwen", lambda *_: LocalQwenStatus("stopped", "已停止"))
    assert registry.client.post(f"/api/vision-models/{local['id']}/runtime/stop").json()["state"] == "stopped"


def test_profiles_execute_with_separate_calls_and_immutable_snapshot(registry, monkeypatch):
    monkeypatch.setenv("SPECIAL_API_KEY", "secret-test-key")
    custom = create_vision(registry)
    assert save(registry, bind(registry, "visible_prompt", model_id=custom["id"])).status_code == 200
    assert save(registry, bind(registry, "thermal_prompt", "local_vlm", "local_qwen")).status_code == 200
    plan = strategies.resolve_plan(registry.db, "general", ["crack", "spalling", "hollow"])
    snapshots = [item.snapshot for item in plan]
    assert "secret-test-key" not in json.dumps(snapshots)
    settings = registry.db.get(SystemSetting, models.VISION_PREFIX + custom["id"])
    data = json.loads(settings.value)
    data.update(model_name="updated-model", api_base_url="https://changed.test/v1")
    settings.value = json.dumps(data)
    registry.db.commit()
    restored = strategies.restore_plan(snapshots, registry.db)
    calls = []
    async def infer(images, **kwargs):
        calls.append((images, kwargs))
        return [{"detections": [{"type": "hollow" if image.thermal_imaging_available else "crack", "confidence": .9}], "inference": {"tile_count": 1}} for image in images]
    images = [TrialQwenImageInput(filename="visible.jpg", content=b"unused", content_type="image/jpeg"), TrialQwenImageInput(filename="thermal.jpg", content=b"unused", content_type="image/jpeg", thermal_imaging_available=True)]
    results = asyncio.run(strategies.execute_plan(restored, images, infer=infer))
    assert [call[1]["model"] for call in calls] == ["special-vl", "qwen3-vl-32b"]
    assert calls[0][1]["base_url"] == "https://special.test/v1"
    assert calls[0][1]["api_key"] == "secret-test-key"
    assert calls[0][1]["visible_defect_types"] == ["crack", "spalling"]
    assert calls[1][1]["max_concurrency"] == 1
    assert [len(call[0]) for call in calls] == [1, 1]
    assert results[0]["detections"][0]["strategy_key"] == "visible_prompt"
    assert results[1]["detections"][0]["model_provider"] == "local_qwen"


def test_quick_detection_keeps_actionable_strategy_error(registry):
    assert save(registry, bind(registry, "crack_prompt", "unconfigured", None)).status_code == 200
    image = TrialQwenImageInput(filename="visible.jpg", content=b"unused", content_type="image/jpeg")
    with pytest.raises(HTTPException) as raised:
        asyncio.run(reports._trial_outputs_for_images([image], [{"filename": image.filename}], db=registry.db, source="test", models=["裂缝"]))
    assert raised.value.status_code == 409
    assert "尚未配置" in raised.value.detail


def test_limits_save_without_global_model_configuration(registry, monkeypatch):
    registry.settings.dashscope_api_key = ""
    monkeypatch.setattr("app.api.system_settings.get_settings", lambda: registry.settings)
    response = registry.client.put("/api/system-settings/trial-inference", json={"request_concurrency": 2})
    assert response.status_code == 200
    assert response.json()["request_concurrency"] == 2


def test_cloud_strategy_uses_real_image_pipeline_and_custom_endpoint(registry, monkeypatch):
    import httpx
    from io import BytesIO
    from PIL import Image
    from app.services import trial_qwen_inference as qwen

    monkeypatch.setenv("SPECIAL_API_KEY", "secret-test-key")
    model = create_vision(registry)
    assert save(registry, bind(registry, "coating_crack_peeling_prompt", model_id=model["id"])).status_code == 200
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"choices": [{"message": {"content": '[{"type":"peeling","confidence":0.92,"bbox":[100,100,500,500],"description":"coating loss"}]'}}], "usage": {"prompt_tokens": 30, "completion_tokens": 12, "total_tokens": 42}})
    client_class = httpx.AsyncClient
    monkeypatch.setattr(qwen.httpx, "AsyncClient", lambda **kwargs: client_class(transport=httpx.MockTransport(handler), **kwargs))
    output = BytesIO()
    Image.new("RGB", (1280, 960)).save(output, format="PNG")
    image = TrialQwenImageInput(filename="wall.png", content=output.getvalue(), content_type="image/png")
    result = asyncio.run(strategies.execute_plan(strategies.resolve_plan(registry.db, "coating", ["crack", "peeling"]), [image], infer=qwen.infer_trial_images))[0]
    assert len(requests) == 1
    assert str(requests[0].url) == "https://special.test/v1/chat/completions"
    assert requests[0].headers["authorization"] == "Bearer secret-test-key"
    body = json.loads(requests[0].content)
    assert body["model"] == "special-vl"
    assert body["messages"][0]["content"][0]["image_url"]["url"].startswith("data:image/")
    assert result["detections"][0]["type"] == "peeling"
    assert result["detections"][0]["model_version"] == "special-vl"
    assert result["strategy_models"][0]["key"] == "coating_crack_peeling_prompt"
    assert result["token_usage"]["total_tokens"] == 42


def test_photo_guard_shows_default_cloud_flash_profile(registry):
    item = next(item for item in registry.client.get("/api/detection-strategies").json() if item["key"] == "photo_guard_prompt")
    assert item["routing_supported"]
    assert item["model_kind"] == "cloud_api"
    assert item["model_id"] == "photo_guard"
    profile = next(item for item in registry.client.get("/api/vision-models").json() if item["id"] == "photo_guard")
    assert profile["kind"] == "cloud_api"
    assert profile["effective_model_name"] == "qwen3-vl-flash"
    assert profile["effective_api_base_url"] == registry.settings.qwen_api_base_url


def test_photo_guard_preserves_existing_local_flash_environment(registry):
    from app.services.photo_guard_strategy import photo_guard_strategy_settings
    registry.settings.photo_guard_provider = "openai_compatible"
    registry.settings.photo_guard_model = "local-qwen3-vl-flash"
    registry.settings.photo_guard_api_base_url = "http://127.0.0.1:19006/v1"
    registry.settings.photo_guard_api_key = "guard-private-key"
    item = next(item for item in registry.client.get("/api/detection-strategies").json() if item["key"] == "photo_guard_prompt")
    assert item["model_kind"] == "local_vlm"
    assert item["model_id"] == "photo_guard"
    profile = next(item for item in registry.client.get("/api/vision-models").json() if item["id"] == "photo_guard")
    assert profile["effective_model_name"] == "local-qwen3-vl-flash"
    assert profile["effective_api_base_url"] == "http://127.0.0.1:19006/v1"
    assert "guard-private-key" not in json.dumps(profile)
    resolved, _ = photo_guard_strategy_settings(registry.db, registry.settings)
    assert resolved.photo_guard_api_key == "guard-private-key"
    assert resolved.photo_guard_model != registry.settings.local_qwen_model
    assert registry.settings.photo_guard_api_base_url == "http://127.0.0.1:19006/v1"


@pytest.mark.parametrize("kind", ["cloud_api", "local_vlm"])
def test_uploaded_photo_precheck_calls_bound_cloud_or_local_profile(registry, monkeypatch, kind):
    from io import BytesIO
    import httpx
    from PIL import Image
    from app.services import photo_guard, photo_precheck
    from test_photo_guard import _settings as guard_settings
    from test_photo_precheck import _photo

    monkeypatch.setenv("SPECIAL_API_KEY", "guard-api-key")
    model = create_vision(registry, kind, api_base_url="http://127.0.0.1:19007/v1" if kind == "local_vlm" else "https://special.test/v1")
    assert save(registry, bind(registry, "photo_guard_prompt", kind, model["id"])).status_code == 200
    row = next(item for item in registry.client.get("/api/detection-strategies").json() if item["key"] == "photo_guard_prompt")
    assert row["model_id"] == model["id"]
    assert registry.client.delete(f"/api/vision-models/{model['id']}").status_code == 409
    monkeypatch.setattr(photo_precheck, "get_settings", guard_settings)
    image = BytesIO()
    Image.new("RGB", (640, 480)).save(image, format="PNG")
    original = image.getvalue()
    monkeypatch.setattr(photo_precheck, "get_object_bytes", lambda *_: original)
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"category":"BUILDING"}'}}]})
    client_class = httpx.Client
    monkeypatch.setattr(photo_guard.httpx, "Client", lambda **kwargs: client_class(transport=httpx.MockTransport(handler), **kwargs))
    photo = _photo()
    photo.metadata_json = {}
    # The photo source is already persisted by the upload workflow; this test
    # keeps its storage object independent of SQL photo table setup.
    class PhotoDb:
        def get(self, model, key):
            return registry.db.get(model, key)
        def commit(self):
            registry.db.commit()
        def refresh(self, _):
            pass
    photo_precheck.run_stored_photo_precheck(PhotoDb(), photo)
    assert photo.precheck_status == "passed"
    assert photo.precheck_model == "special-vl"
    assert len(requests) == 1
    assert str(requests[0].url) == model["api_base_url"] + "/chat/completions"
    assert requests[0].headers["authorization"] == "Bearer guard-api-key"
    payload = json.loads(requests[0].content)
    assert payload["model"] == "special-vl"
    assert '"category"' in payload["messages"][0]["content"][1]["text"]
    assert payload["response_format"] == {"type": "json_object"}
    assert ("enable_thinking" in payload) == (kind == "cloud_api")
    metadata = photo.metadata_json["photo_precheck"]["result"]
    assert metadata["model_id"] == model["id"] and metadata["model_kind"] == kind
    assert "guard-api-key" not in json.dumps(metadata)
    assert original == image.getvalue()


@pytest.mark.parametrize("kind", ["unconfigured", "yolo"])
def test_photo_guard_missing_runtime_does_not_fall_back(registry, monkeypatch, kind):
    from app.services import photo_precheck
    from test_photo_guard import _settings as guard_settings
    from test_photo_precheck import _photo
    yolo = create_yolo(registry) if kind == "yolo" else None
    version = create_version(registry, yolo) if yolo else None
    assert save(registry, bind(registry, "photo_guard_prompt", kind, yolo["id"] if yolo else None, str(version.id) if version else None)).status_code == 200
    monkeypatch.setattr(photo_precheck, "get_settings", guard_settings)
    monkeypatch.setattr(photo_precheck, "classify_building_photo", lambda *_args, **_kwargs: pytest.fail("Unconfigured guard silently fell back"))
    class PhotoDb:
        def get(self, model, key):
            return registry.db.get(model, key)
        def commit(self):
            registry.db.commit()
        def refresh(self, _):
            pass
    photo = _photo()
    photo_precheck.run_stored_photo_precheck(PhotoDb(), photo)
    assert photo.precheck_status == "error"
    assert photo.precheck_category == "SERVICE_ERROR"


def test_health_uses_selected_photo_guard_profile(registry, monkeypatch):
    from app.api import health
    from test_photo_guard import _settings as guard_settings
    monkeypatch.setenv("SPECIAL_API_KEY", "guard-api-key")
    model = create_vision(registry)
    assert save(registry, bind(registry, "photo_guard_prompt", model_id=model["id"])).status_code == 200
    monkeypatch.setattr(health, "get_settings", guard_settings)
    response = registry.client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["photo_guard"]["ready"]
    assert response.json()["photo_guard"]["model"] == "special-vl"
    assert response.json()["photo_guard"]["endpoint"] == "https://special.test/v1"


@pytest.mark.parametrize("kind,setting_name", [("cloud_api", "qwen_api_base_url"), ("local_vlm", "local_qwen_api_base_url")])
def test_model_without_service_address_uses_server_config(registry, kind, setting_name):
    setattr(registry.settings, setting_name, "http://configured.test/v1")
    payload = {"name": "默认地址模型", "kind": kind, "model_name": "test-vl"}
    response = registry.client.post("/api/vision-models", json=payload)
    assert response.status_code == 201
    model = response.json()
    assert model["api_base_url"] == ""
    assert model["effective_api_base_url"] == "http://configured.test/v1"
    payload["name"] = "更新名称"
    updated = registry.client.patch(f"/api/vision-models/{model['id']}", json=payload)
    assert updated.status_code == 200
    assert updated.json()["effective_api_base_url"] == "http://configured.test/v1"


@pytest.mark.parametrize("kind,prefix", [("cloud_api", "qwen"), ("local_vlm", "local_qwen")])
def test_model_without_service_model_name_uses_server_config(registry, kind, prefix):
    setattr(registry.settings, prefix + "_model", "server-model")
    setattr(registry.settings, prefix + "_api_base_url", "http://configured.test/v1")
    payload = {"name": "显示名称", "kind": kind}
    response = registry.client.post("/api/vision-models", json=payload)
    assert response.status_code == 201
    model = response.json()
    assert model["model_name"] == ""
    assert model["effective_model_name"] == "server-model"
    payload["name"] = "修改显示名称"
    updated = registry.client.patch(f"/api/vision-models/{model['id']}", json=payload)
    assert updated.status_code == 200
    assert updated.json()["effective_model_name"] == "server-model"
