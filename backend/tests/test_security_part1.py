"""Regression evidence for the 34 findings in the Part 1 remediation plan."""
import importlib.util
import logging
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.api import reports
from app.api.dependencies import get_current_user
from app.core.config import Settings
from app.core.model_security import PHOTO_GUARD_SERVICE, build_model_runtime_dir
from app.models.tables import SystemSetting, TrialDetectionResult
from app.schemas.vision_models import VisionModelEdit
from app.services import vision_models as models
from app.services.local_qwen_lifecycle import LocalQwenLifecycleError, LocalQwenStatus
from app.services.qweather import QWeatherAPIError, QWeatherConfigError
from app.services.trial_qwen_inference import TrialQwenImageInput
from test_detection_strategies import registry
from test_phase7_routes import JsonTrialRequest, UploadedPhotoDb, _trial_customer, _uploaded_photo


INVALID_IDENTIFIERS = ["", "../outside", "a/../../outside", "/tmp/outside", "a\\outside",
    "%2e%2e%2f", "a%252f", "a" * 65, "a\n", ".hidden", "a\x00", "模型"]


@pytest.mark.parametrize("identifier", INVALID_IDENTIFIERS)
def test_runtime_path_rejects_invalid_identifiers_before_filesystem_write(tmp_path, identifier):
    with pytest.raises(ValueError, match="标识"):
        build_model_runtime_dir(tmp_path, identifier)
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("identifier", ["local_qwen", "photo_guard", "a", "A0_-", "a" * 64, str(uuid4())])
def test_runtime_path_stays_in_configured_root(tmp_path, identifier):
    root = tmp_path / "root"
    result = Path(build_model_runtime_dir(root, identifier))
    assert result.parent == root.resolve()
    assert result.name == "vision-" + identifier
    assert not root.exists()


def test_runtime_path_rejects_symlink_to_outside_or_another_model(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    target = root / "vision-safe"
    target.symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError, match="符号链接"):
        build_model_runtime_dir(root, "safe")
    target.unlink()
    target.symlink_to(root / "vision-other", target_is_directory=True)
    with pytest.raises(ValueError, match="符号链接"):
        build_model_runtime_dir(root, "safe")


def test_runtime_path_expands_home_and_does_not_modify_settings(registry, monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path))
    registry.settings.local_qwen_runtime_dir = "~/models-runtime"
    config = VisionModelEdit(name="Local", kind="local_vlm", model_path="/models/local")
    copied = models.local_model_settings("custom", config, registry.settings)
    assert copied.local_qwen_runtime_dir == str(tmp_path / "models-runtime" / "vision-custom")
    assert registry.settings.local_qwen_runtime_dir == "~/models-runtime"
    assert models.local_model_settings("local_qwen", config, registry.settings).local_qwen_runtime_dir == "~/models-runtime"


@pytest.mark.parametrize("configured,expected", [("", "/models/deployed"), ("/models/explicit", "/models/explicit")])
def test_builtin_model_path_preserves_explicit_then_deployment_priority(registry, configured, expected):
    registry.settings.local_qwen_model_path = "/models/deployed"
    config = VisionModelEdit(name="Local", kind="local_vlm", model_path=configured)
    assert models.local_model_settings("local_qwen", config, registry.settings).local_qwen_model_path == expected
    assert registry.settings.local_qwen_model_path == "/models/deployed"


@pytest.mark.parametrize("identifier", INVALID_IDENTIFIERS)
def test_saved_model_lookup_validates_identifier(registry, identifier):
    with pytest.raises(HTTPException) as raised:
        models.model_config(registry.db, identifier)
    assert raised.value.status_code == 422


def test_invalid_saved_identifier_cannot_reach_lifecycle(registry, monkeypatch):
    registry.db.add(SystemSetting(key=models.VISION_PREFIX + "bad/../../escape",
        value=VisionModelEdit(name="Bad", kind="local_vlm").model_dump_json()))
    registry.db.commit()
    monkeypatch.setattr(models, "local_qwen_status", lambda *_: LocalQwenStatus("disabled", "测试环境"))
    response = registry.client.get("/api/vision-models")
    assert response.status_code == 422


def test_model_api_rejects_symlinked_runtime_directory_before_control(registry, monkeypatch, tmp_path):
    registry.settings.local_qwen_runtime_dir = str(tmp_path)
    registry.settings.local_qwen_control_enabled = True
    registry.settings.app_env = "development"
    monkeypatch.setattr(models, "local_qwen_status", lambda *_: LocalQwenStatus("stopped", "已停止"))
    response = registry.client.post("/api/vision-models", json={"name": "Local", "kind": "local_vlm", "model_path": "/models/local"})
    assert response.status_code == 201
    identifier = response.json()["id"]
    (tmp_path / ("vision-" + identifier)).symlink_to(tmp_path.parent, target_is_directory=True)
    monkeypatch.setattr(models.subprocess, "run", lambda *_args, **_kwargs: pytest.fail("Unsafe control"))
    response = registry.client.post(f"/api/vision-models/{identifier}/runtime/start")
    assert response.status_code == 422
    assert str(tmp_path) not in response.text


def test_local_model_status_does_not_disclose_filesystem_errors(registry, monkeypatch):
    monkeypatch.setattr(models, "local_qwen_status", lambda *_: LocalQwenStatus("error", "SECRET_KEY=private /private/path"))
    result = models.model_read(registry.db, "local_qwen")
    assert result.runtime_status == "error"
    assert "private" not in result.runtime_message


@pytest.mark.parametrize("identifier", ["a%20b", "a%252f", "a" * 65, ".hidden"])
def test_model_api_rejects_invalid_identifiers(registry, identifier):
    # Some ASGI clients decode an encoded slash into a different (unmatched) route.
    expected = {404, 422} if identifier == "a%252f" else {422}
    assert registry.client.post(f"/api/vision-models/{identifier}/runtime/start").status_code in expected
    assert registry.client.delete(f"/api/vision-models/{identifier}").status_code in expected
    assert registry.client.patch(f"/api/vision-models/{identifier}", json={"name": "test", "kind": "local_vlm"}).status_code in expected


@pytest.mark.parametrize("role", [None, "customer", "reviewer"])
def test_model_control_requires_admin_before_any_command(registry, monkeypatch, role):
    monkeypatch.setattr(models.subprocess, "run", lambda *_args, **_kwargs: pytest.fail("Unauthorized command"))
    if role is None:
        from app.main import app
        app.dependency_overrides.pop(get_current_user)
    else:
        registry.user.role = role
    expected = 401 if role is None else 403
    for action in ("start", "stop"):
        assert registry.client.post(f"/api/vision-models/photo_guard/runtime/{action}").status_code == expected


@pytest.fixture
def managed_settings(registry):
    registry.settings.photo_guard_systemd_user_service = PHOTO_GUARD_SERVICE
    return registry.settings


@pytest.mark.parametrize("service", ["", "ssh.service", "--help.service", "../building-photo-guard.service",
    "building-photo-guard.service;id", "building-photo-guard.service\nssh.service", "*.service"])
def test_unapproved_units_never_invoke_systemctl(managed_settings, monkeypatch, service):
    monkeypatch.setattr(models.subprocess, "run", lambda *_args, **_kwargs: pytest.fail("Unapproved unit"))
    with pytest.raises(LocalQwenLifecycleError, match="不允许"):
        models.managed_photo_guard_status(service, None)
    with pytest.raises(LocalQwenLifecycleError, match="不允许"):
        models.control_managed_photo_guard(service, None, "start")


def test_disabled_unit_and_invalid_action_never_invoke_systemctl(registry, monkeypatch):
    monkeypatch.setattr(models.subprocess, "run", lambda *_args, **_kwargs: pytest.fail("Unexpected command"))
    with pytest.raises(LocalQwenLifecycleError, match="不允许"):
        models.control_managed_photo_guard(PHOTO_GUARD_SERVICE, None, "start")
    with pytest.raises(LocalQwenLifecycleError, match="未知"):
        models.control_managed_photo_guard(PHOTO_GUARD_SERVICE, None, "restart")


@pytest.mark.parametrize("action", ["start", "stop"])
def test_approved_control_uses_arguments_option_separator_and_timeouts(managed_settings, monkeypatch, action):
    calls = []
    def run(args, **kwargs):
        calls.append((args, kwargs))
        return SimpleNamespace(stdout="ActiveState=inactive\nSubState=dead\nMainPID=0\nIgnored=secret\n")
    monkeypatch.setattr(models.subprocess, "run", run)
    assert models.control_managed_photo_guard(PHOTO_GUARD_SERVICE, None, action).state == "stopped"
    assert calls[0][0] == ["systemctl", "--user", action, "--", PHOTO_GUARD_SERVICE]
    assert calls[1][0] == ["systemctl", "--user", "show", "--property=ActiveState,SubState,MainPID", "--", PHOTO_GUARD_SERVICE]
    assert [kwargs["timeout"] for _, kwargs in calls] == [50, 5]
    assert all(kwargs["shell"] is False and kwargs["check"] is True for _, kwargs in calls)


@pytest.mark.parametrize("output", ["ActiveState=unexpected\nMainPID=10", "ActiveState=inactive\nMainPID=-1",
    "ActiveState=inactive\nMainPID=bad", "ActiveState=inactive\nMainPID=1"])
def test_invalid_service_state_is_rejected(managed_settings, monkeypatch, output):
    monkeypatch.setattr(models.subprocess, "run", lambda *_args, **_kwargs: SimpleNamespace(stdout=output))
    assert models.managed_photo_guard_status(PHOTO_GUARD_SERVICE, None).state == "error"


def test_service_failures_do_not_disclose_exception_contents(managed_settings, monkeypatch, caplog):
    secret = "/private/runtime SECRET_KEY=abc\nforged-log-line"
    def fail(*_args, **_kwargs):
        raise OSError(secret)
    monkeypatch.setattr(models.subprocess, "run", fail)
    with caplog.at_level(logging.WARNING):
        result = models.managed_photo_guard_status(PHOTO_GUARD_SERVICE, None)
        with pytest.raises(LocalQwenLifecycleError) as raised:
            models.control_managed_photo_guard(PHOTO_GUARD_SERVICE, None, "start")
    assert secret not in result.message + str(raised.value) + caplog.text
    assert "OSError" in caplog.text


def test_management_api_audits_operator_and_sanitizes_failure(registry, monkeypatch, caplog):
    profile = SimpleNamespace(kind="local_vlm", control_supported=True)
    monkeypatch.setattr(models, "model_read", lambda *_: profile)
    monkeypatch.setattr(models, "managed_photo_guard_service", lambda *_: PHOTO_GUARD_SERVICE)
    monkeypatch.setattr(models, "control_managed_photo_guard", lambda *_: LocalQwenStatus("stopped", "已停止"))
    with caplog.at_level(logging.INFO):
        assert registry.client.post("/api/vision-models/photo_guard/runtime/stop").status_code == 200
    assert str(registry.user.id) in caplog.text
    assert "unit=building-photo-guard.service action=stop result=stopped" in caplog.text
    def fail(*_):
        raise LocalQwenLifecycleError("/private/path SECRET_KEY=abc\nforged")
    monkeypatch.setattr(models, "control_managed_photo_guard", fail)
    response = registry.client.post("/api/vision-models/photo_guard/runtime/start")
    assert response.status_code == 409
    assert "SECRET_KEY" not in response.text + caplog.text
    assert "action=start result=failed" in caplog.text


@pytest.mark.parametrize("field,low,high", [("trial_max_image_pixels", 1_000_000, 64_000_000),
    ("trial_inference_max_image_pixels", 1_000_000, 64_000_000),
    ("trial_max_tiles_per_image", 1, 100), ("trial_max_tiles_per_request", 1, 1000)])
def test_resource_settings_accept_budgets_and_reject_bypass(field, low, high):
    for valid in (low, high):
        assert getattr(Settings(_env_file=None, **{field: valid}), field) == valid
    for invalid in (0, -1, high + 1, 10**100, "invalid"):
        with pytest.raises(ValidationError):
            Settings(_env_file=None, **{field: invalid})


def test_environment_and_service_settings_fail_closed():
    assert Settings(_env_file=None, app_env=" TeSt ").app_env == "test"
    with pytest.raises(ValidationError):
        Settings(_env_file=None, app_env="prodution")
    with pytest.raises(ValidationError):
        Settings(_env_file=None, photo_guard_systemd_user_service="ssh.service")
    assert Settings(_env_file=None, photo_guard_systemd_user_service=PHOTO_GUARD_SERVICE).photo_guard_systemd_user_service == PHOTO_GUARD_SERVICE


@pytest.mark.parametrize("bindings", [[], [{"HostIp": "::", "HostPort": "19002"}],
    [{"HostIp": "0.0.0.0", "HostPort": "19002"}], [{"HostIp": "192.0.2.1", "HostPort": "19002"}],
    [{"HostIp": "127.0.0.1", "HostPort": "19002"}, {"HostIp": "0.0.0.0", "HostPort": "19003"}]])
def test_yolo_rejects_public_or_ambiguous_host_port_mappings(bindings):
    from app.services import yolo_runtime
    container = {"NetworkSettings": {"Ports": {"9002/tcp": bindings}}}
    with pytest.raises(RuntimeError, match="回环"):
        yolo_runtime._url(container)


@pytest.mark.parametrize("precheck_status,category,expected", [(None, "BUILDING", 409),
    ("pending", "BUILDING", 409), ("running", "BUILDING", 409), ("error", "BUILDING", 409),
    ("rejected", "BUILDING", 422), ("unknown", "BUILDING", 422), ("passed", None, 422),
    ("passed", "OTHER", 422), ("passed", "BUILDING", None)])
def test_trial_precheck_cannot_be_bypassed(precheck_status, category, expected):
    photo = _uploaded_photo(uuid4())
    photo.precheck_status, photo.precheck_category = precheck_status, category
    db = UploadedPhotoDb([photo])
    if expected is None:
        assert reports._quick_detection_photos_for_user(db, _trial_customer(), [photo.id]) == [photo]
    else:
        with pytest.raises(HTTPException) as raised:
            reports._quick_detection_photos_for_user(db, _trial_customer(), [photo.id])
        assert raised.value.status_code == expected


def test_trial_precheck_counts_pending_running_error_and_none():
    photos = [_uploaded_photo(uuid4()) for _ in range(4)]
    for photo, state in zip(photos, ["pending", "running", "error", None]):
        photo.precheck_status = state
    with pytest.raises(HTTPException) as raised:
        reports._quick_detection_photos_for_user(UploadedPhotoDb(photos), _trial_customer(), [p.id for p in photos])
    assert raised.value.status_code == 409
    assert "待处理 1 张、处理中 1 张、预检失败 1 张" in raised.value.detail


def test_inference_and_estimation_use_identical_validated_limits(monkeypatch):
    import asyncio
    from app.services import detection_strategies
    settings = Settings(_env_file=None, trial_max_image_pixels=2_000_000,
        trial_inference_max_image_pixels=1_000_000, trial_max_tiles_per_image=3, trial_max_tiles_per_request=7)
    monkeypatch.setattr(reports, "get_settings", lambda: settings)
    captured = []
    def estimate(_images, **kwargs):
        captured.append(kwargs)
        return 1
    async def execute(_plan, _images, **kwargs):
        kwargs.pop("infer")
        captured.append(kwargs)
        return []
    monkeypatch.setattr(reports, "estimate_trial_api_request_count", estimate)
    monkeypatch.setattr(reports, "_trial_strategy_plan", lambda *_: [])
    monkeypatch.setattr(detection_strategies, "execute_plan", execute)
    images = [TrialQwenImageInput(filename="test.jpg", content=b"test", content_type="image/jpeg")]
    assert reports._trial_estimated_api_request_count(images) == 1
    asyncio.run(reports._trial_inference_requests(images, None, ["裂缝"]))
    assert captured == [dict(max_image_pixels=2_000_000, inference_max_image_pixels=1_000_000,
        max_tiles_per_image=3, max_tiles_per_request=7)] * 2


def test_trial_generation_rolls_back_real_session_before_storage_reads(monkeypatch):
    import asyncio
    engine = create_engine("sqlite://")
    SystemSetting.__table__.create(engine)
    try:
        with Session(engine) as db:
            setting = SystemSetting(key="security-regression", value="before")
            db.add(setting)
            db.commit()
            setting.value = "uncommitted"
            db.flush()
            photo = _uploaded_photo(uuid4())
            monkeypatch.setattr(reports, "_quick_detection_photos_for_user", lambda *_: [photo])
            class StorageReadReached(Exception):
                pass
            async def read_storage(sources):
                assert not db.in_transaction()
                assert db.get(SystemSetting, "security-regression").value == "before"
                assert sources[0].photo_id == photo.id
                assert sources[0].storage_object_key == photo.storage_object_key
                raise StorageReadReached()
            monkeypatch.setattr(reports, "_trial_images_for_quick_photos", read_storage)
            request = JsonTrialRequest({"models": ["裂缝"], "photo_ids": [str(photo.id)]})
            with pytest.raises(StorageReadReached):
                asyncio.run(reports.generate_trial_result(request, db, _trial_customer()))
    finally:
        engine.dispose()


def test_orm_example_result_remains_read_only():
    with pytest.raises(HTTPException) as raised:
        reports._ensure_trial_result_writable(TrialDetectionResult(is_example=True))
    assert raised.value.status_code == 403
    reports._ensure_trial_result_writable(TrialDetectionResult(is_example=False))


@pytest.mark.parametrize("error_type", [QWeatherAPIError, QWeatherConfigError])
def test_qweather_cli_failure_hides_credentials_and_newlines(monkeypatch, capsys, caplog, error_type):
    path = Path(__file__).resolve().parents[1] / "scripts" / "qweather_connectivity_test.py"
    spec = importlib.util.spec_from_file_location("qweather_connectivity_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module.sys, "argv", [str(path), "--raw"])
    monkeypatch.setattr(module, "get_settings", lambda: SimpleNamespace(qweather_test_location="test"))
    def fail(**_kwargs):
        raise error_type("API_KEY=private\nforged-log-line")
    monkeypatch.setattr(module, "QWeatherClient", lambda **_: SimpleNamespace(get_weather_now=fail))
    assert module.main() == 1
    output = capsys.readouterr()
    assert output.out == ""
    assert output.err == "QWeather connectivity test failed\n"
    assert "private" not in caplog.text and "forged" not in caplog.text


def test_qweather_cli_success_and_raw_mode_remain_available(monkeypatch, capsys):
    path = Path(__file__).resolve().parents[1] / "scripts" / "qweather_connectivity_test.py"
    spec = importlib.util.spec_from_file_location("qweather_connectivity_success", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module.sys, "argv", [str(path), "--raw"])
    monkeypatch.setattr(module, "get_settings", lambda: SimpleNamespace(qweather_test_location="test"))
    weather = SimpleNamespace(to_connectivity_summary=lambda _: {"location": "test"}, model_dump=lambda **_: {"temperature": "23"})
    monkeypatch.setattr(module, "QWeatherClient", lambda **_: SimpleNamespace(get_weather_now=lambda **_: weather))
    assert module.main() == 0
    output = capsys.readouterr()
    assert '"location": "test"' in output.out and '"temperature": "23"' in output.out
    assert output.err == ""
