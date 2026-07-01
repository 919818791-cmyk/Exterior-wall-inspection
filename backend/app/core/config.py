from functools import lru_cache
from typing import Any

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Building Exterior Inspection Platform"
    app_env: str = "development"
    debug: bool = True
    api_prefix: str = "/api"
    backend_cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:5174",
            "http://127.0.0.1:5174",
            "http://localhost:5175",
            "http://127.0.0.1:5175",
        ]
    )

    database_url: str = (
        "postgresql+psycopg://building_exterior:building_exterior_password"
        "@localhost:5433/building_exterior"
    )

    minio_endpoint: str = "localhost:9002"
    minio_public_url: str = "http://localhost:9002"
    minio_access_key: str = "building_exterior_minio"
    minio_secret_key: str = "building_exterior_minio_secret"
    minio_bucket: str = "building-exterior"

    redis_url: str = "redis://localhost:6379/0"
    rq_default_queue: str = "algorithm"

    worker_backend_base_url: str = "http://localhost:8000"
    worker_token: str = "change-this-worker-token"
    worker_lease_seconds: int = 600

    auth_secret_key: str = "change-this-auth-secret-key-before-production"
    auth_access_token_expire_minutes: int = 480
    auth_seed_demo_users: bool = True

    @field_validator("backend_cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: Any) -> list[str] | Any:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
