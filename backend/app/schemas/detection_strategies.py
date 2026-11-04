from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class DetectionStrategyEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str = Field(min_length=1, max_length=64)
    model_kind: Literal["cloud_api", "local_vlm", "yolo", "unconfigured"]
    model_id: str | None = Field(default=None, max_length=128)
    version_id: UUID | None = None
    prompt: str = Field(max_length=20_000)


class DetectionStrategyRead(DetectionStrategyEdit):
    facade_type: str
    facade_label: str
    label: str
    defect_types: list[str]
    routing_supported: bool = True


class DetectionStrategyUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[DetectionStrategyEdit] = Field(min_length=1, max_length=32)
