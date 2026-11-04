from __future__ import annotations

import json
import logging
import os
import shutil
import signal
import subprocess
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import IO, Iterator, Literal
from urllib.parse import urlsplit

import httpx

from app.core.config import Settings, get_settings

try:
    import fcntl
except ImportError:  # pragma: no cover - local vLLM control is Linux-only
    fcntl = None  # type: ignore[assignment]


logger = logging.getLogger(__name__)

LocalQwenState = Literal["running", "starting", "stopped", "disabled", "error"]


@dataclass(frozen=True, slots=True)
class LocalQwenStatus:
    state: LocalQwenState
    message: str
    pid: int | None = None


class LocalQwenLifecycleError(RuntimeError):
    pass


def _control_enabled(settings: Settings) -> bool:
    return bool(getattr(settings, "local_qwen_control_enabled", False)) and getattr(
        settings,
        "app_env",
        "development",
    ).lower() != "test"


def _runtime_dir(settings: Settings) -> Path:
    configured = settings.local_qwen_runtime_dir.strip()
    path = (
        Path(configured).expanduser()
        if configured
        else Path(__file__).resolve().parents[3] / ".runtime"
    )
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    return path


def _pid_path(settings: Settings) -> Path:
    return _runtime_dir(settings) / "local-qwen.pid.json"


def _log_path(settings: Settings) -> Path:
    return _runtime_dir(settings) / "local-qwen.log"


@contextmanager
def _control_lock(settings: Settings) -> Iterator[None]:
    if fcntl is None:
        raise LocalQwenLifecycleError("本地模型自动启停仅支持 Linux。")
    lock_path = _runtime_dir(settings) / "local-qwen.lock"
    with lock_path.open("a+", encoding="utf-8") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def _read_pid_record(settings: Settings) -> dict[str, object] | None:
    try:
        payload = json.loads(_pid_path(settings).read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def _write_pid_record(settings: Settings, *, pid: int, owned: bool) -> None:
    pid_path = _pid_path(settings)
    temporary_path = pid_path.with_suffix(".tmp")
    temporary_path.write_text(
        json.dumps(
            {"pid": pid, "owned": owned, "recorded_at": time.time()},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    temporary_path.replace(pid_path)


def _remove_pid_record(settings: Settings) -> None:
    try:
        _pid_path(settings).unlink()
    except FileNotFoundError:
        pass


def _process_state(pid: int) -> str | None:
    try:
        fields = (Path("/proc") / str(pid) / "stat").read_text(encoding="utf-8").split()
    except (FileNotFoundError, OSError, ValueError):
        return None
    return fields[2] if len(fields) > 2 else None


def _process_exists(pid: int) -> bool:
    return pid > 1 and _process_state(pid) not in (None, "Z")


def _process_args(pid: int) -> list[str]:
    try:
        raw = (Path("/proc") / str(pid) / "cmdline").read_bytes()
    except (FileNotFoundError, OSError):
        return []
    return [part.decode("utf-8", errors="replace") for part in raw.split(b"\0") if part]


def _matches_local_qwen(pid: int, settings: Settings) -> bool:
    args = _process_args(pid)
    model_path = settings.local_qwen_model_path.strip()
    model_name = settings.local_qwen_model.strip()
    if not args or "serve" not in args or not model_path or model_path not in args:
        return False
    try:
        name_index = args.index("--served-model-name")
    except ValueError:
        return False
    return name_index + 1 < len(args) and args[name_index + 1] == model_name


def _recorded_process(settings: Settings) -> tuple[int, bool, float] | None:
    record = _read_pid_record(settings)
    if record is None:
        return None
    try:
        pid = int(record["pid"])
        owned = bool(record.get("owned"))
        recorded_at = float(record.get("recorded_at", time.time()))
    except (KeyError, TypeError, ValueError):
        _remove_pid_record(settings)
        return None
    if not _process_exists(pid) or not _matches_local_qwen(pid, settings):
        _remove_pid_record(settings)
        return None
    return pid, owned, recorded_at


def _adopt_existing_process(settings: Settings) -> tuple[int, bool, float] | None:
    recorded = _recorded_process(settings)
    if recorded is not None:
        return recorded
    proc_root = Path("/proc")
    for entry in proc_root.iterdir():
        if not entry.name.isdigit():
            continue
        pid = int(entry.name)
        try:
            if entry.stat().st_uid != os.getuid():
                continue
        except (FileNotFoundError, OSError):
            continue
        if _matches_local_qwen(pid, settings):
            _write_pid_record(settings, pid=pid, owned=False)
            return pid, False, time.time()
    return None


def _health_url(settings: Settings) -> str:
    parsed = urlsplit(settings.local_qwen_api_base_url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.port is None:
        raise LocalQwenLifecycleError("本地模型服务地址必须包含协议、主机和端口。")
    return f"{parsed.scheme}://{parsed.netloc}/health"


def _is_healthy(settings: Settings) -> bool:
    try:
        with httpx.Client(timeout=0.75, trust_env=False) as client:
            response = client.get(_health_url(settings))
    except (httpx.HTTPError, LocalQwenLifecycleError):
        return False
    return response.is_success


def _status_unlocked(settings: Settings) -> LocalQwenStatus:
    record = _read_pid_record(settings)
    if record is not None:
        try:
            recorded_pid = int(record["pid"])
        except (KeyError, TypeError, ValueError):
            recorded_pid = 0
        if not _process_exists(recorded_pid) or not _matches_local_qwen(
            recorded_pid,
            settings,
        ):
            return LocalQwenStatus(
                "error",
                f"本地模型进程异常退出，请检查日志：{_log_path(settings)}",
            )
    process = _adopt_existing_process(settings)
    if process is None:
        return LocalQwenStatus("stopped", "本地模型未运行。")
    pid, _, recorded_at = process
    if _is_healthy(settings):
        return LocalQwenStatus("running", "本地模型正在运行。", pid)
    elapsed = max(0.0, time.time() - recorded_at)
    if elapsed > settings.local_qwen_startup_timeout_seconds:
        return LocalQwenStatus("error", "本地模型进程存在，但未在预期时间内就绪。", pid)
    return LocalQwenStatus("starting", "本地模型正在加载，请稍候。", pid)


def local_qwen_status(settings: Settings | None = None) -> LocalQwenStatus:
    settings = settings or get_settings()
    if not _control_enabled(settings):
        return LocalQwenStatus("disabled", "本地模型自动启停未启用。")
    try:
        with _control_lock(settings):
            return _status_unlocked(settings)
    except (OSError, LocalQwenLifecycleError) as exc:
        return LocalQwenStatus("error", str(exc))


def _resolved_executable(settings: Settings) -> str:
    configured = settings.local_qwen_vllm_executable.strip()
    executable = (
        str(Path(configured).expanduser())
        if os.path.sep in configured
        else shutil.which(configured) or ""
    )
    if not executable or not Path(executable).is_file():
        raise LocalQwenLifecycleError("未找到本地模型的 vLLM 可执行文件。")
    return executable


def _start_command(settings: Settings) -> list[str]:
    model_path = Path(settings.local_qwen_model_path.strip()).expanduser()
    if not model_path.exists():
        raise LocalQwenLifecycleError(f"本地模型目录不存在：{model_path}")
    parsed = urlsplit(settings.local_qwen_api_base_url.strip())
    if parsed.scheme != "http" or not parsed.hostname or parsed.port is None:
        raise LocalQwenLifecycleError("自动启停要求本地模型地址使用包含端口的 http URL。")
    command = [
        _resolved_executable(settings),
        "serve",
        str(model_path),
        "--served-model-name",
        settings.local_qwen_model.strip(),
        "--tensor-parallel-size",
        str(settings.local_qwen_tensor_parallel_size),
        "--max-num-seqs",
        str(settings.local_qwen_max_concurrency),
        "--mm-encoder-tp-mode",
        settings.local_qwen_mm_encoder_tp_mode,
        "--host",
        parsed.hostname,
        "--port",
        str(parsed.port),
        "--gpu-memory-utilization",
        str(settings.local_qwen_gpu_memory_utilization),
        "--max-model-len",
        str(settings.local_qwen_max_model_len),
        "--limit-mm-per-prompt",
        json.dumps(
            {"image": settings.local_qwen_max_images_per_prompt, "video": 0},
            separators=(",", ":"),
        ),
    ]
    if settings.local_qwen_disable_custom_all_reduce:
        command.append("--disable-custom-all-reduce")
    return command


def start_local_qwen(settings: Settings | None = None) -> LocalQwenStatus:
    settings = settings or get_settings()
    if not _control_enabled(settings):
        return LocalQwenStatus("disabled", "本地模型自动启停未启用。")
    with _control_lock(settings):
        existing = _adopt_existing_process(settings)
        if existing is not None:
            return _status_unlocked(settings)

        command = _start_command(settings)
        environment = os.environ.copy()
        cuda_devices = settings.local_qwen_cuda_visible_devices.strip()
        if cuda_devices:
            environment["CUDA_VISIBLE_DEVICES"] = cuda_devices
        cuda_home = settings.local_qwen_cuda_home.strip()
        if cuda_home:
            cuda_path = Path(cuda_home).expanduser()
            if not (cuda_path / "bin" / "nvcc").is_file():
                raise LocalQwenLifecycleError(f"CUDA_HOME 中未找到 nvcc：{cuda_path}")
            environment["CUDA_HOME"] = str(cuda_path)
            environment["PATH"] = f"{cuda_path / 'bin'}:{environment.get('PATH', '')}"
            environment["LD_LIBRARY_PATH"] = (
                f"{cuda_path / 'lib'}:{environment.get('LD_LIBRARY_PATH', '')}"
            )
        environment["VLLM_USE_DEEP_GEMM"] = (
            "1" if settings.local_qwen_use_deep_gemm else "0"
        )
        environment["VLLM_MOE_USE_DEEP_GEMM"] = environment["VLLM_USE_DEEP_GEMM"]
        environment["VLLM_USE_FLASHINFER_SAMPLER"] = (
            "1" if settings.local_qwen_use_flashinfer_sampler else "0"
        )
        log_path = _log_path(settings)
        log_file: IO[bytes] | None = None
        try:
            log_file = log_path.open("ab", buffering=0)
            process = subprocess.Popen(
                command,
                stdin=subprocess.DEVNULL,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                cwd=str(Path(__file__).resolve().parents[3]),
                env=environment,
                start_new_session=True,
                close_fds=True,
            )
        except OSError as exc:
            raise LocalQwenLifecycleError(f"本地模型启动失败：{exc}") from exc
        finally:
            if log_file is not None:
                log_file.close()
        _write_pid_record(settings, pid=process.pid, owned=True)
        time.sleep(0.5)
        if process.poll() is not None:
            _remove_pid_record(settings)
            raise LocalQwenLifecycleError(
                f"本地模型进程启动后立即退出，请检查日志：{log_path}"
            )
        logger.info("local_qwen_started pid=%d log=%s", process.pid, log_path)
        return _status_unlocked(settings)


def _descendant_pids(root_pid: int) -> set[int]:
    descendants: set[int] = set()
    parents = {root_pid}
    while parents:
        next_parents: set[int] = set()
        for entry in Path("/proc").iterdir():
            if not entry.name.isdigit():
                continue
            pid = int(entry.name)
            try:
                lines = (entry / "status").read_text(encoding="utf-8").splitlines()
                ppid = int(
                    next(line.split()[1] for line in lines if line.startswith("PPid:"))
                )
            except (FileNotFoundError, OSError, StopIteration, ValueError):
                continue
            if ppid in parents and pid not in descendants:
                descendants.add(pid)
                next_parents.add(pid)
        parents = next_parents
    return descendants


def _signal_process_tree(pid: int, sig: signal.Signals, *, owned: bool) -> None:
    if owned:
        try:
            if os.getpgid(pid) == pid:
                os.killpg(pid, sig)
                return
        except (ProcessLookupError, PermissionError):
            return
    targets = [*_descendant_pids(pid), pid]
    for target in targets:
        try:
            os.kill(target, sig)
        except (ProcessLookupError, PermissionError):
            continue


def stop_local_qwen(settings: Settings | None = None) -> LocalQwenStatus:
    settings = settings or get_settings()
    if not _control_enabled(settings):
        return LocalQwenStatus("disabled", "本地模型自动启停未启用。")
    with _control_lock(settings):
        process = _adopt_existing_process(settings)
        if process is None:
            return LocalQwenStatus("stopped", "本地模型已停止。")
        pid, owned, _ = process
        tracked_pids = {pid, *_descendant_pids(pid)}
        _signal_process_tree(pid, signal.SIGTERM, owned=owned)
        deadline = time.monotonic() + settings.local_qwen_stop_timeout_seconds
        while (
            any(_process_exists(target) for target in tracked_pids)
            and time.monotonic() < deadline
        ):
            time.sleep(0.2)
        remaining_pids = {target for target in tracked_pids if _process_exists(target)}
        if remaining_pids:
            for target in remaining_pids:
                try:
                    os.kill(target, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    continue
            time.sleep(0.2)
        remaining_pids = {target for target in tracked_pids if _process_exists(target)}
        if remaining_pids:
            pid_list = ", ".join(str(target) for target in sorted(remaining_pids))
            raise LocalQwenLifecycleError(f"无法停止本地模型进程 PID：{pid_list}。")
        _remove_pid_record(settings)
        logger.info("local_qwen_stopped pid=%d", pid)
        return LocalQwenStatus("stopped", "本地模型已停止。")


def reconcile_local_qwen(
    selected_provider: str,
    settings: Settings | None = None,
) -> LocalQwenStatus:
    settings = settings or get_settings()
    return (
        start_local_qwen(settings)
        if selected_provider == "local_qwen"
        else stop_local_qwen(settings)
    )
