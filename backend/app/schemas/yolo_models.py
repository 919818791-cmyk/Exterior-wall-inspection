from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class YoloVersionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    model_id: UUID
    version: str
    description: str | None
    original_filename: str
    file_size: int
    sha256: str
    runtime_status: str = "disabled"
    runtime_message: str = "YOLO 运行服务尚未接入，请在模型服务器完成接入。"
    control_supported: bool = False
    created_at: datetime


class YoloModelRead(BaseModel):
    id: UUID
    name: str
    description: str | None = None
    created_at: datetime
    updated_at: datetime
    versions: list[YoloVersionRead]


class YoloModelEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=2000)

    @field_validator("name", mode="before")
    @classmethod
    def trim_name(cls, value):
        return value.strip() if isinstance(value, str) else value


class YoloModelCreate(YoloModelEdit):
    pass


class YoloVersionEdit(BaseModel):
    version: str = Field(min_length=1, max_length=64)
    description: str = Field(default="", max_length=2000)

    @field_validator("version", mode="before")
    @classmethod
    def trim_field(cls, value):
        return value.strip() if isinstance(value, str) else value


class YoloModelCatalog(BaseModel):
    items: list[YoloModelRead]
    max_upload_bytes: int
    accepted_extensions: list[str] = [".pt"]
    inference_ready: bool = False
