from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import UUID

from fastapi.testclient import TestClient

from app.api.dependencies import AuthenticatedUser, get_current_user
from app.db.session import get_db
from app.enums.status import UserRole
from app.main import app
from app.models.tables import SystemSetting
from app.services.local_qwen_lifecycle import LocalQwenLifecycleError
from app.services.trial_inference_provider import (
    get_trial_inference_provider,
    trial_inference_runtime,
)


class FakeSettingsDb:
    def __init__(self) -> None:
        setting = SystemSetting(
            key="trial_inference_provider",
            value="qwen",
            updated_by=None,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        self.settings = {setting.key: setting}
        self.committed = False

    def get(self, _model: object, key: str) -> SystemSetting | None:
        return self.settings.get(key)

    def add(self, setting: SystemSetting) -> None:
        self.settings[setting.key] = setting

    def delete(self, setting: SystemSetting) -> None:
        self.settings.pop(setting.key, None)

    def flush(self) -> None:
        return None

    def commit(self) -> None:
        self.committed = True


def _admin() -> AuthenticatedUser:
    return AuthenticatedUser(
        id=UUID("00000000-0000-0000-0000-000000000003"),
        username="admin",
        real_name="平台管理员",
        role=UserRole.ADMIN.value,
        organization=None,
    )


def _settings() -> SimpleNamespace:
    return SimpleNamespace(
        dashscope_api_key="qwen-key",
        qwen_api_base_url="https://qwen.test/v1",
        qwen_model="qwen3-vl-plus",
        qwen3_vl_flash_model="qwen3-vl-flash",
        local_qwen_api_key="",
        local_qwen_api_base_url="http://127.0.0.1:9005/v1",
        local_qwen_model="qwen3-vl-32b",
        local_qwen_max_concurrency=1,
        qwen_request_timeout_seconds=120,
        qwen_max_concurrency=5,
        zhipu_api_key="zhipu-key",
        zhipu_api_base_url="https://open.bigmodel.cn/api/paas/v4",
        zhipu_model="glm-4.6v",
        zhipu_request_timeout_seconds=120,
        zhipu_max_concurrency=5,
        trial_global_job_concurrency=4,
        trial_request_timeout_seconds=300,
        trial_request_concurrency=5,
        trial_daily_api_request_limit=800,
        trial_generate_limit_per_user=5,
        trial_generate_window_seconds=600,
        trial_upload_limit_per_user=30,
        trial_upload_window_seconds=600,
        trial_job_lock_seconds=900,
        auth_secret_key="test-auth-secret-key-that-is-long-enough",
    )


def test_system_setting_routes_require_authentication() -> None:
    response = TestClient(app).get("/api/system-settings/trial-inference")
    assert response.status_code == 401


def test_admin_can_switch_trial_inference_provider(monkeypatch) -> None:
    fake_db = FakeSettingsDb()
    settings = _settings()
    lifecycle_calls: list[str] = []
    monkeypatch.setattr("app.api.system_settings.get_settings", lambda: settings)
    monkeypatch.setattr("app.services.trial_inference_provider.get_settings", lambda: settings)
    monkeypatch.setattr(
        "app.api.system_settings.reconcile_local_qwen",
        lambda provider, _settings: lifecycle_calls.append(provider),
    )
    app.dependency_overrides[get_current_user] = _admin
    app.dependency_overrides[get_db] = lambda: fake_db

    try:
        response = TestClient(app).put(
            "/api/system-settings/trial-inference",
            json={"provider": "zhipu"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["provider"] == "zhipu"
    options = {option["provider"]: option for option in response.json()["options"]}
    assert options["qwen"]["label"] == "通义千问 Qwen3-VL-Plus"
    assert options["qwen"]["model"] == "qwen3-vl-plus"
    assert options["zhipu"]["label"] == "智谱GLM-4.6V"
    assert options["local_qwen"] == {
        "provider": "local_qwen",
        "label": "本地 Qwen3-VL-32B",
        "model": "qwen3-vl-32b",
        "configured": True,
        "runtime_status": "disabled",
        "runtime_message": "本地模型自动启停未启用。",
    }
    assert {option["provider"]: option["configured"] for option in response.json()["options"]} == {
        "qwen": True,
        "qwen3_vl_flash": True,
        "local_qwen": True,
        "zhipu": True,
    }
    assert fake_db.settings["trial_inference_provider"].value == "zhipu"
    assert fake_db.settings["trial_inference_provider"].updated_by == _admin().id
    assert fake_db.committed
    assert lifecycle_calls == ["zhipu"]


def test_admin_can_select_qwen3_vl_flash_with_existing_dashscope_key(monkeypatch) -> None:
    fake_db = FakeSettingsDb()
    settings = _settings()
    monkeypatch.setattr("app.api.system_settings.get_settings", lambda: settings)
    monkeypatch.setattr("app.services.trial_inference_provider.get_settings", lambda: settings)
    app.dependency_overrides[get_current_user] = _admin
    app.dependency_overrides[get_db] = lambda: fake_db

    try:
        response = TestClient(app).put(
            "/api/system-settings/trial-inference",
            json={"provider": "qwen3_vl_flash"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["provider"] == "qwen3_vl_flash"
    flash_option = next(
        option for option in response.json()["options"] if option["provider"] == "qwen3_vl_flash"
    )
    assert flash_option == {
        "provider": "qwen3_vl_flash",
        "label": "通义千问 Qwen3-VL-Flash",
        "model": "qwen3-vl-flash",
        "configured": True,
        "runtime_status": None,
        "runtime_message": None,
    }
    assert fake_db.settings["trial_inference_provider"].value == "qwen3_vl_flash"


def test_legacy_qwen_vl_max_selection_maps_to_qwen3_vl_flash() -> None:
    fake_db = FakeSettingsDb()
    fake_db.settings["trial_inference_provider"].value = "qwen_vl_max"

    assert get_trial_inference_provider(fake_db) == "qwen3_vl_flash"


def test_local_qwen_runtime_caps_shared_request_concurrency() -> None:
    fake_db = FakeSettingsDb()
    settings = _settings()
    settings.trial_request_concurrency = 5

    local_runtime = trial_inference_runtime("local_qwen", settings, fake_db)
    cloud_runtime = trial_inference_runtime("qwen", settings, fake_db)

    assert local_runtime.max_concurrency == 1
    assert cloud_runtime.max_concurrency == 5


def test_admin_can_select_unauthenticated_local_qwen(monkeypatch) -> None:
    fake_db = FakeSettingsDb()
    settings = _settings()
    lifecycle_calls: list[str] = []
    monkeypatch.setattr("app.api.system_settings.get_settings", lambda: settings)
    monkeypatch.setattr("app.services.trial_inference_provider.get_settings", lambda: settings)
    monkeypatch.setattr(
        "app.api.system_settings.reconcile_local_qwen",
        lambda provider, _settings: lifecycle_calls.append(provider),
    )
    app.dependency_overrides[get_current_user] = _admin
    app.dependency_overrides[get_db] = lambda: fake_db

    try:
        response = TestClient(app).put(
            "/api/system-settings/trial-inference",
            json={"provider": "local_qwen"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["provider"] == "local_qwen"
    assert fake_db.settings["trial_inference_provider"].value == "local_qwen"
    assert lifecycle_calls == ["local_qwen"]


def test_admin_cannot_select_local_qwen_without_endpoint(monkeypatch) -> None:
    fake_db = FakeSettingsDb()
    settings = _settings()
    settings.local_qwen_api_base_url = ""
    monkeypatch.setattr("app.api.system_settings.get_settings", lambda: settings)
    monkeypatch.setattr("app.services.trial_inference_provider.get_settings", lambda: settings)
    app.dependency_overrides[get_current_user] = _admin
    app.dependency_overrides[get_db] = lambda: fake_db

    try:
        response = TestClient(app).put(
            "/api/system-settings/trial-inference",
            json={"provider": "local_qwen"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 409
    assert "本地 Qwen3-VL-32B" in response.json()["message"]
    assert not fake_db.committed


def test_admin_cannot_select_local_qwen_when_process_start_fails(monkeypatch) -> None:
    fake_db = FakeSettingsDb()
    settings = _settings()
    monkeypatch.setattr("app.api.system_settings.get_settings", lambda: settings)
    monkeypatch.setattr("app.services.trial_inference_provider.get_settings", lambda: settings)
    monkeypatch.setattr(
        "app.api.system_settings.reconcile_local_qwen",
        lambda *_args: (_ for _ in ()).throw(LocalQwenLifecycleError("vLLM 启动失败")),
    )
    app.dependency_overrides[get_current_user] = _admin
    app.dependency_overrides[get_db] = lambda: fake_db

    try:
        response = TestClient(app).put(
            "/api/system-settings/trial-inference",
            json={"provider": "local_qwen"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 409
    assert "vLLM 启动失败" in response.json()["message"]
    assert not fake_db.committed


def test_admin_cannot_select_provider_without_server_key(monkeypatch) -> None:
    fake_db = FakeSettingsDb()
    settings = _settings()
    settings.zhipu_api_key = ""
    monkeypatch.setattr("app.api.system_settings.get_settings", lambda: settings)
    monkeypatch.setattr("app.services.trial_inference_provider.get_settings", lambda: settings)
    app.dependency_overrides[get_current_user] = _admin
    app.dependency_overrides[get_db] = lambda: fake_db

    try:
        response = TestClient(app).put(
            "/api/system-settings/trial-inference",
            json={"provider": "zhipu"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 409
    assert "API Key" in response.json()["message"]
    assert not fake_db.committed


def test_admin_updates_runtime_limits_and_prompts(monkeypatch) -> None:
    fake_db = FakeSettingsDb()
    settings = _settings()
    monkeypatch.setattr("app.api.system_settings.get_settings", lambda: settings)
    monkeypatch.setattr("app.services.trial_inference_provider.get_settings", lambda: settings)
    app.dependency_overrides[get_current_user] = _admin
    app.dependency_overrides[get_db] = lambda: fake_db
    try:
        response = TestClient(app).put(
            "/api/system-settings/trial-inference",
            json={
                "provider": "zhipu",
                "global_job_concurrency": 7,
                "request_concurrency": 3,
                "daily_api_request_limit": 1200,
                "generate_limit_per_user": 8,
                "visible_prompt": "可见光检测提示词，必须只输出符合约定的 JSON 数组。",
                "crack_prompt": "裂缝单独检测提示词，必须只输出符合约定的 JSON 数组。",
                "spalling_prompt": "剥落单独检测提示词，必须只输出符合约定的 JSON 数组。",
                "thermal_prompt": "热成像检测提示词，必须只输出符合约定的 JSON 数组。",
                "photo_guard_prompt": "建筑照片相关性判断提示词，必须只输出符合约定的 JSON 对象。",
                "formal_prompts": {
                    "tile_crack_prompt": "自定义面砖裂缝检测提示词，必须只输出符合约定的 JSON 数组。",
                },
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["global_job_concurrency"] == 7
    assert body["request_concurrency"] == 3
    assert body["daily_api_request_limit"] == 1200
    assert body["generate_limit_per_user"] == 8
    assert body["visible_prompt"].startswith("可见光检测提示词")
    assert body["crack_prompt"].startswith("裂缝单独检测提示词")
    assert body["spalling_prompt"].startswith("剥落单独检测提示词")
    assert body["photo_guard_prompt"].startswith("建筑照片相关性判断提示词")
    assert body["formal_prompts"]["tile_crack_prompt"].startswith("自定义面砖裂缝")
    assert fake_db.settings["trial_daily_api_request_limit"].value == "1200"
    assert fake_db.settings["trial_generate_limit_per_user"].value == "8"
    assert fake_db.settings["trial_crack_prompt"].value.startswith("裂缝单独检测提示词")
    assert fake_db.settings["trial_spalling_prompt"].value.startswith("剥落单独检测提示词")
    assert fake_db.settings["photo_guard_prompt"].value.startswith("建筑照片相关性判断提示词")
    assert fake_db.settings["formal_tile_crack_prompt"].value.startswith("自定义面砖裂缝")
    runtime = trial_inference_runtime("zhipu", settings, fake_db)
    assert runtime.max_concurrency == 3
    assert runtime.timeout_seconds == 300
    zhipu = next(option for option in body["options"] if option["provider"] == "zhipu")
    assert "api_key" not in zhipu
    assert "api_key_hint" not in zhipu
