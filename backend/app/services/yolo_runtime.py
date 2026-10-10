"""Version-scoped runtime integration point for the future YOLO server adapter.

Runtime adapters must identify each instance by version.id, report real process
state, and start/stop only that instance. Uploading or binding never starts it.
"""
from dataclasses import dataclass

from fastapi import HTTPException


@dataclass(frozen=True)
class YoloVersionStatus:
    state: str
    message: str
    control_supported: bool = False


def version_status(version) -> YoloVersionStatus:
    return YoloVersionStatus("disabled", "YOLO 运行服务尚未接入，请在模型服务器完成接入。")


def control_version(version, action: str) -> YoloVersionStatus:
    # Do not treat the old is_active selection flag as evidence of a running process.
    raise HTTPException(409, version_status(version).message)
