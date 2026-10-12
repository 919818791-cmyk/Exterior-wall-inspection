from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator
from pydantic_core import PydanticCustomError
from urllib.parse import urlsplit

from app.core.model_security import MODEL_IDENTIFIER_PATTERN


ModelIdentifier = Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=MODEL_IDENTIFIER_PATTERN)]


class VisionModelEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=128)
    kind: Literal["cloud_api", "local_vlm"]
    model_name: str = Field(default="", max_length=128)
    api_base_url: str = Field(default="", max_length=512)
    api_key_env: str = Field(default="", max_length=128, pattern=r"^$|^[A-Z][A-Z0-9_]*_API_KEY$")
    model_path: str = Field(default="", max_length=512)

    @field_validator("name", "model_name", "api_base_url", "api_key_env", "model_path", mode="before")
    @classmethod
    def trim(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("api_base_url")
    @classmethod
    def validate_url(cls, value):
        try:
            parsed = urlsplit(value)
            _ = parsed.port
        except ValueError as error:
            raise PydanticCustomError("invalid_model_url", "模型服务地址无效。") from error
        if value and (parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment):
            raise PydanticCustomError("invalid_model_url", "服务地址须为不含密码、查询参数的 HTTP 或 HTTPS URL。")
        return value.rstrip("/")


class VisionModelRead(VisionModelEdit):
    id: str
    builtin: bool
    effective_model_name: str
    effective_api_base_url: str
    configured: bool
    runtime_status: str
    runtime_active: bool = False
    runtime_message: str
    control_supported: bool


class ModelRuntimeRead(BaseModel):
    state: str
    message: str
