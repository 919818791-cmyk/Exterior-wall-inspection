from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
import json
from types import SimpleNamespace
from uuid import uuid4

from fastapi import HTTPException
import pytest

from app.services import yolo_runtime


@pytest.fixture
def version():
    content = b"uploaded-weights"
    return SimpleNamespace(id=uuid4(), model_id=uuid4(), version="V1", file_size=len(content),
                           sha256=sha256(content).hexdigest(), storage_bucket="models", storage_object_key="weights.pt")


@pytest.fixture
def enabled(monkeypatch, tmp_path):
    monkeypatch.setattr(yolo_runtime, "get_settings", lambda: SimpleNamespace(
        app_env="production", yolo_runtime_enabled=True, yolo_runtime_device="cuda:0",
        yolo_runtime_image="test-runtime:cuda", yolo_runtime_startup_timeout_seconds=180))
    monkeypatch.setattr(yolo_runtime.shutil, "which", lambda _: "/usr/bin/docker")
    monkeypatch.setattr(yolo_runtime, "RUNTIME_ROOT", tmp_path)


def container(version, running=True, exit_code=0):
    return {"Config": {"Labels": {f"{yolo_runtime.LABEL_PREFIX}.version-id": str(version.id),
                                  f"{yolo_runtime.LABEL_PREFIX}.sha256": version.sha256}},
            "State": {"Running": running, "ExitCode": exit_code,
                      "StartedAt": datetime.now(timezone.utc).isoformat()},
            "NetworkSettings": {"Ports": {"9002/tcp": [{"HostIp": "127.0.0.1", "HostPort": "19002"}]}}}


def test_other_version_container_cannot_be_controlled(version, enabled, monkeypatch):
    foreign = container(version)
    foreign["Config"]["Labels"][f"{yolo_runtime.LABEL_PREFIX}.version-id"] = str(uuid4())
    calls = []
    def docker(*args, **kwargs):
        calls.append(args)
        return SimpleNamespace(returncode=0, stdout=json.dumps([foreign]))
    monkeypatch.setattr(yolo_runtime, "_docker", docker)
    with pytest.raises(HTTPException, match="标识") as error:
        yolo_runtime.control_version(version, "stop")
    assert error.value.status_code == 502
    assert all(args[:2] == ("container", "inspect") for args in calls)


def test_weights_are_verified_and_cached(version, monkeypatch, tmp_path):
    response = BytesIO(b"uploaded-weights")
    response.release_conn = lambda: None
    calls = []
    def get(*args):
        calls.append(args)
        return response
    monkeypatch.setattr(yolo_runtime.object_storage, "open_object", get)
    yolo_runtime._weights(version, tmp_path)
    yolo_runtime._weights(version, tmp_path)
    assert len(calls) == 1
    assert (tmp_path / "weights.pt").read_bytes() == b"uploaded-weights"


def test_corrupt_weights_never_replace_cache(version, monkeypatch, tmp_path):
    response = BytesIO(b"corrupt")
    response.release_conn = lambda: None
    monkeypatch.setattr(yolo_runtime.object_storage, "open_object", lambda *args: response)
    with pytest.raises(RuntimeError, match="校验失败"):
        yolo_runtime._weights(version, tmp_path)
    assert not (tmp_path / "weights.pt").exists()
    assert not (tmp_path / "weights.pt.part").exists()
    assert response.closed


def test_start_creates_only_requested_version_on_loopback(version, enabled, monkeypatch):
    monkeypatch.setattr(yolo_runtime, "version_status", lambda _: yolo_runtime.YoloVersionStatus("stopped", "", True))
    monkeypatch.setattr(yolo_runtime, "_inspect", lambda _: None)
    monkeypatch.setattr(yolo_runtime, "_weights", lambda *args: None)
    monkeypatch.setattr(yolo_runtime, "_status", lambda _: yolo_runtime.YoloVersionStatus("starting", "", True))
    calls = []
    monkeypatch.setattr(yolo_runtime, "_docker", lambda *args, **kwargs: calls.append(args) or SimpleNamespace(returncode=0))
    assert yolo_runtime.control_version(version, "start").state == "starting"
    assert len(calls) == 1
    command = calls[0]
    assert command[command.index("--name") + 1] == yolo_runtime._name(version)
    assert command[command.index("--publish") + 1] == "127.0.0.1::9002"
    assert f"YOLO_VERSION_ID={version.id}" in command
    assert f"YOLO_WEIGHTS_SHA256={version.sha256}" in command
    assert "--gpus" in command


def test_stop_targets_only_requested_container(version, enabled, monkeypatch):
    monkeypatch.setattr(yolo_runtime, "version_status", lambda _: yolo_runtime.YoloVersionStatus("running", "", True))
    monkeypatch.setattr(yolo_runtime, "_inspect", lambda _: container(version))
    monkeypatch.setattr(yolo_runtime, "_status", lambda _: yolo_runtime.YoloVersionStatus("stopped", "", True))
    calls = []
    monkeypatch.setattr(yolo_runtime, "_docker", lambda *args, **kwargs: calls.append(args) or SimpleNamespace(returncode=0))
    assert yolo_runtime.control_version(version, "stop").state == "stopped"
    assert calls == [("stop", "--time", "30", yolo_runtime._name(version))]


def test_exited_or_unready_container_does_not_report_running(version, enabled, monkeypatch):
    monkeypatch.setattr(yolo_runtime, "_inspect", lambda _: container(version, False, 1))
    assert yolo_runtime.version_status(version).state == "failed"
    monkeypatch.setattr(yolo_runtime, "_inspect", lambda _: container(version))
    class Client:
        def __init__(self, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def get(self, url):
            return SimpleNamespace(is_success=True, json=lambda: {"ready": False})
    monkeypatch.setattr(yolo_runtime.httpx, "Client", Client)
    assert yolo_runtime.version_status(version).state == "starting"


def test_ready_response_must_match_weight_identity(version, enabled, monkeypatch):
    monkeypatch.setattr(yolo_runtime, "_inspect", lambda _: container(version))
    health = {"version_id": str(version.id), "sha256": "wrong", "ready": True, "device": "cuda:0"}
    class Client:
        def __init__(self, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def get(self, url):
            return SimpleNamespace(is_success=True, json=lambda: health)
    monkeypatch.setattr(yolo_runtime.httpx, "Client", Client)
    assert yolo_runtime.version_status(version).state != "running"
    health["sha256"] = version.sha256
    assert yolo_runtime.version_status(version).state == "running"


def test_public_model_port_is_rejected(version):
    value = container(version)
    value["NetworkSettings"]["Ports"]["9002/tcp"][0]["HostIp"] = "0.0.0.0"
    with pytest.raises(RuntimeError, match="回环"):
        yolo_runtime._url(value)


def test_missing_gpu_driver_reports_actual_startup_failure(version, enabled, monkeypatch):
    value = container(version, False, 128)
    value["State"]["Error"] = "nvidia-container-cli: initialization error: nvml error: driver not loaded"
    monkeypatch.setattr(yolo_runtime, "_inspect", lambda _: value)
    status = yolo_runtime.version_status(version)
    assert status.state == "failed"
    assert "NVIDIA 驱动未加载" in status.message


def test_failed_health_does_not_allow_deleting_a_live_container(version, enabled, monkeypatch):
    monkeypatch.setattr(yolo_runtime, "_inspect", lambda _: container(version, True, 1))
    with pytest.raises(HTTPException) as error:
        yolo_runtime.ensure_stopped(version)
    assert error.value.status_code == 409
    monkeypatch.setattr(yolo_runtime, "_inspect", lambda _: container(version, False, 1))
    yolo_runtime.ensure_stopped(version)
