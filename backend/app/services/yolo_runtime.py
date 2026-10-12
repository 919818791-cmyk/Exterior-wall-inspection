"""Docker-backed, version-isolated lifecycle for uploaded YOLO weights."""
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import logging
from pathlib import Path
import shutil
import subprocess
from uuid import UUID

from fastapi import HTTPException
import httpx
from minio.error import S3Error

from app.core.config import get_settings
from app.services import object_storage

try:
    import fcntl
except ImportError:
    fcntl = None

logger = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parents[3]
RUNTIME_ROOT = ROOT / ".runtime" / "yolo"
SERVER = ROOT / "algorithm-model" / "version_server.py"
LABEL_PREFIX = "building-exterior.yolo"


@dataclass(frozen=True)
class YoloVersionStatus:
    state: str
    message: str
    control_supported: bool = False


def _name(version):
    return "building-exterior-yolo-" + UUID(str(version.id)).hex


def _enabled():
    settings = get_settings()
    return getattr(settings, "yolo_runtime_enabled", False) and settings.app_env != "test"


def _docker(*args, timeout=10):
    return subprocess.run(["docker", *args], capture_output=True, text=True, timeout=timeout)


def _inspect(version):
    result = _docker("container", "inspect", _name(version))
    if result.returncode:
        if "No such container" in result.stderr or "No such object" in result.stderr:
            return None
        raise RuntimeError("无法查询 Docker 容器状态，请检查 Docker 服务和账号权限。")
    container = json.loads(result.stdout)[0]
    labels = container["Config"].get("Labels") or {}
    if labels.get(f"{LABEL_PREFIX}.version-id") != str(version.id) or labels.get(f"{LABEL_PREFIX}.sha256") != version.sha256:
        raise RuntimeError("容器标识与模型版本不一致，已拒绝控制该容器。")
    return container


def _url(container):
    ports = container["NetworkSettings"]["Ports"].get("9002/tcp") or []
    if len(ports) != 1 or ports[0]["HostIp"] != "127.0.0.1":
        raise RuntimeError("模型容器必须仅通过本机回环端口访问。")
    return f"http://127.0.0.1:{int(ports[0]['HostPort'])}"


def _status(version):
    container = _inspect(version)
    if container is None:
        return YoloVersionStatus("stopped", "该权重版本尚未启动。", True)
    state = container["State"]
    if state.get("Restarting"):
        return YoloVersionStatus("failed", f"模型进程反复重启，请查看容器 {_name(version)} 的日志。", True)
    if not state["Running"]:
        if state.get("ExitCode", 0) != 0 or state.get("OOMKilled"):
            if "driver not loaded" in state.get("Error", "").lower():
                return YoloVersionStatus("failed", "NVIDIA 驱动未加载，GPU 模型无法启动，请为当前内核安装驱动后重新启动该版本。", True)
            return YoloVersionStatus("failed", f"模型进程异常退出，请查看容器 {_name(version)} 的日志。", True)
        return YoloVersionStatus("stopped", "该权重版本已停止。", True)
    try:
        with httpx.Client(timeout=1, trust_env=False) as client:
            response = client.get(_url(container) + "/health")
            payload = response.json() if response.is_success else {}
        if payload.get("version_id") == str(version.id) and payload.get("sha256") == version.sha256 and payload.get("ready") is True:
            return YoloVersionStatus("running", f"权重版本正在运行（{payload.get('device', '未知设备')}）。", True)
    except (httpx.HTTPError, ValueError):
        pass
    started = datetime.fromisoformat(state["StartedAt"].replace("Z", "+00:00"))
    elapsed = (datetime.now(timezone.utc) - started).total_seconds()
    if elapsed > get_settings().yolo_runtime_startup_timeout_seconds:
        return YoloVersionStatus("failed", f"模型服务未按时就绪，请查看容器 {_name(version)} 的日志。", True)
    return YoloVersionStatus("starting", "模型正在加载和预热，请稍候。", True)


def version_status(version):
    if not _enabled() or fcntl is None or shutil.which("docker") is None:
        return YoloVersionStatus("disabled", "YOLO 运行服务尚未接入或未启用，请配置 Linux Docker GPU 运行环境。")
    try:
        return _status(version)
    except (OSError, subprocess.SubprocessError, RuntimeError, ValueError, KeyError) as error:
        logger.warning("yolo_runtime_status_failed: %s", error)
        return YoloVersionStatus("failed", str(error), True)


@contextmanager
def _lock(version):
    folder = RUNTIME_ROOT / UUID(str(version.id)).hex
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (folder / "control.lock").open("a+") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        try:
            yield folder
        finally:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def _weights(version, folder):
    target = folder / "weights.pt"
    def matches(path):
        if not path.is_file() or path.stat().st_size != version.file_size:
            return False
        with path.open("rb") as source:
            return hashlib.file_digest(source, "sha256").hexdigest() == version.sha256
    if matches(target):
        return
    temporary = folder / "weights.pt.part"
    response = object_storage.open_object(version.storage_bucket, version.storage_object_key)
    try:
        with temporary.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        if not matches(temporary):
            raise RuntimeError("模型权重大小或 SHA256 校验失败，已拒绝启动。")
        temporary.replace(target)
    finally:
        response.close()
        response.release_conn()
        temporary.unlink(missing_ok=True)


def control_version(version, action):
    if action not in {"start", "stop"}:
        raise HTTPException(422, "未知模型运行操作。")
    status = version_status(version)
    if not status.control_supported:
        raise HTTPException(409, status.message)
    try:
        with _lock(version) as folder:
            container = _inspect(version)
            if action == "stop":
                if container is not None:
                    result = _docker("stop", "--time", "30", _name(version), timeout=40)
                    if result.returncode:
                        raise RuntimeError("停止模型容器失败，请查看 Docker 日志。")
                return _status(version)
            if container is not None and container["State"]["Running"]:
                return _status(version)
            _weights(version, folder)
            if container is not None:
                result = _docker("start", _name(version), timeout=40)
            else:
                settings = get_settings()
                args = ["run", "-d", "--name", _name(version), "--restart", "unless-stopped",
                        "--publish", "127.0.0.1::9002", "--label", f"{LABEL_PREFIX}.version-id={version.id}",
                        "--label", f"{LABEL_PREFIX}.sha256={version.sha256}",
                        "--mount", f"type=bind,src={folder},dst=/weights,readonly",
                        "--mount", f"type=bind,src={SERVER},dst=/runtime/version_server.py,readonly",
                        "--env", f"YOLO_VERSION_ID={version.id}", "--env", f"YOLO_MODEL_ID={version.model_id}",
                        "--env", f"YOLO_VERSION={version.version}", "--env", f"YOLO_WEIGHTS_SHA256={version.sha256}",
                        "--env", f"YOLO_DEVICE={settings.yolo_runtime_device}", "--env", "ULTRALYTICS_SETTINGS_DIR=/tmp/ultralytics"]
                if settings.yolo_runtime_device.startswith("cuda"):
                    args += ["--gpus", "all"]
                args += [settings.yolo_runtime_image, "python", "-m", "uvicorn", "version_server:app",
                         "--app-dir", "/runtime", "--host", "0.0.0.0", "--port", "9002"]
                result = _docker(*args, timeout=60)
            if result.returncode:
                logger.error("yolo_runtime_start_failed: %s", result.stderr)
                raise RuntimeError("启动模型容器失败，请检查 GPU、运行镜像和 Docker 服务。")
            return _status(version)
    except (OSError, subprocess.SubprocessError, RuntimeError, ValueError, KeyError, S3Error) as error:
        raise HTTPException(502, str(error)) from error


def runtime_url(version):
    status = version_status(version)
    if status.state != "running":
        raise HTTPException(409, status.message)
    return _url(_inspect(version))


def ensure_stopped(version):
    """Protect a live container even when its health endpoint reports failure."""
    if not _enabled():
        return
    try:
        container = _inspect(version)
    except (OSError, subprocess.SubprocessError, RuntimeError, ValueError, KeyError) as error:
        raise HTTPException(409, "无法确认模型进程已停止，请检查 Docker 服务后重试。") from error
    if container is not None and (container["State"]["Running"] or container["State"].get("Restarting")):
        raise HTTPException(409, "模型容器仍在运行，请先停止该版本。")
