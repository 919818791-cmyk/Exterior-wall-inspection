"""Security boundaries shared by model configuration and lifecycle operations."""
from pathlib import Path
import re


MODEL_IDENTIFIER_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"
MODEL_IDENTIFIER_RE = re.compile(MODEL_IDENTIFIER_PATTERN)
# This is the user unit shipped in deploy/systemd and installed by the deploy script.
# Adding another managed unit requires a reviewed code/deployment change.
PHOTO_GUARD_SERVICE = "building-photo-guard.service"
ALLOWED_PHOTO_GUARD_UNITS = frozenset({PHOTO_GUARD_SERVICE})


def validate_model_identifier(identifier: str) -> str:
    if not isinstance(identifier, str) or not MODEL_IDENTIFIER_RE.fullmatch(identifier):
        raise ValueError("非法模型标识。")
    return identifier


def build_model_runtime_dir(root: str | Path, identifier: str) -> str:
    validate_model_identifier(identifier)
    base = Path(root).expanduser().resolve()
    candidate = base / f"vision-{identifier}"
    # A model directory must not alias another model's PID/lock/log directory.
    if candidate.is_symlink():
        raise ValueError("模型运行目录不能使用符号链接。")
    target = candidate.resolve()
    if not target.is_relative_to(base):
        raise ValueError("模型运行目录超出授权范围。")
    return str(target)
