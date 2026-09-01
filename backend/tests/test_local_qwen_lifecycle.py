import os
import signal
import socket
import time
from pathlib import Path

from app.core.config import Settings
from app.services.local_qwen_lifecycle import (
    _start_command,
    local_qwen_status,
    start_local_qwen,
    stop_local_qwen,
)


FAKE_VLLM = """#!/usr/bin/env python3
import http.server
import sys

host = sys.argv[sys.argv.index('--host') + 1]
port = int(sys.argv[sys.argv.index('--port') + 1])

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200 if self.path == '/health' else 404)
        self.end_headers()

    def log_message(self, *args):
        pass

http.server.ThreadingHTTPServer((host, port), Handler).serve_forever()
"""


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _lifecycle_settings(tmp_path: Path) -> Settings:
    executable = tmp_path / "fake-vllm"
    executable.write_text(FAKE_VLLM, encoding="utf-8")
    executable.chmod(0o755)
    model_path = tmp_path / "model"
    model_path.mkdir()
    port = _free_port()
    return Settings(
        _env_file=None,
        app_env="development",
        local_qwen_api_base_url=f"http://127.0.0.1:{port}/v1",
        local_qwen_model="test-qwen",
        local_qwen_control_enabled=True,
        local_qwen_vllm_executable=str(executable),
        local_qwen_model_path=str(model_path),
        local_qwen_tensor_parallel_size=1,
        local_qwen_runtime_dir=str(tmp_path / "runtime"),
        local_qwen_startup_timeout_seconds=30,
        local_qwen_stop_timeout_seconds=5,
    )


def test_local_qwen_lifecycle_starts_once_and_stops(tmp_path: Path) -> None:
    settings = _lifecycle_settings(tmp_path)
    try:
        started = start_local_qwen(settings)
        assert started.state == "running"
        assert started.pid is not None

        duplicate = start_local_qwen(settings)
        assert duplicate.state == "running"
        assert duplicate.pid == started.pid
        assert local_qwen_status(settings).state == "running"

        stopped = stop_local_qwen(settings)
        assert stopped.state == "stopped"
        assert local_qwen_status(settings).state == "stopped"
    finally:
        stop_local_qwen(settings)


def test_local_qwen_start_command_caps_vllm_active_sequences(tmp_path: Path) -> None:
    settings = _lifecycle_settings(tmp_path)
    settings.local_qwen_max_concurrency = 1

    command = _start_command(settings)

    option_index = command.index("--max-num-seqs")
    assert command[option_index + 1] == "1"


def test_local_qwen_lifecycle_is_disabled_in_tests(tmp_path: Path) -> None:
    settings = _lifecycle_settings(tmp_path)
    settings.app_env = "test"

    status = start_local_qwen(settings)

    assert status.state == "disabled"


def test_local_qwen_lifecycle_reports_unexpected_exit(tmp_path: Path) -> None:
    settings = _lifecycle_settings(tmp_path)
    try:
        started = start_local_qwen(settings)
        assert started.pid is not None
        os.kill(started.pid, signal.SIGTERM)
        deadline = time.monotonic() + 5
        status = local_qwen_status(settings)
        while status.state != "error" and time.monotonic() < deadline:
            time.sleep(0.05)
            status = local_qwen_status(settings)

        assert status.state == "error"
        assert "异常退出" in status.message
    finally:
        stop_local_qwen(settings)
