from functools import lru_cache
from typing import Any, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env", ".env.local", "../.env.local"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Building Exterior Inspection Platform"
    app_env: str = "development"
    debug: bool = True
    api_prefix: str = "/api"
    api_docs_enabled: bool | None = None
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
    security_store_backend: Literal["redis", "memory"] = "redis"
    security_fail_closed: bool = True
    security_key_prefix: str = "exterior-wall"

    login_rate_limit_per_identity: int = Field(default=5, ge=1)
    login_rate_window_seconds: int = Field(default=900, ge=60)
    trial_application_limit_per_identity: int = Field(default=3, ge=1)
    trial_application_window_seconds: int = Field(default=86400, ge=60)

    trial_daily_api_request_limit: int = Field(default=800, ge=1)
    trial_max_file_size_bytes: int = Field(default=10 * 1024 * 1024, ge=1024)
    trial_max_image_pixels: int = Field(default=64_000_000, ge=1_000_000)
    trial_inference_max_image_pixels: int = Field(default=64_000_000, ge=1_000_000)
    trial_max_tiles_per_image: int = Field(default=100, ge=1)
    trial_max_tiles_per_request: int = Field(default=1000, ge=1)
    trial_generate_limit_per_user: int = Field(default=5, ge=1)
    trial_generate_window_seconds: int = Field(default=600, ge=60)
    trial_upload_limit_per_user: int = Field(default=30, ge=1)
    trial_upload_window_seconds: int = Field(default=600, ge=60)
    trial_global_job_concurrency: int = Field(default=4, ge=1, le=10)
    trial_request_timeout_seconds: float = Field(default=300, ge=5, le=600)
    trial_request_concurrency: int = Field(default=5, ge=1, le=10)
    trial_job_lock_seconds: int = Field(default=900, ge=60)

    photo_guard_enabled: bool = True
    photo_guard_provider: Literal["dashscope", "openai_compatible"] = "dashscope"
    photo_guard_api_base_url: str = ""
    photo_guard_model: str = ""
    photo_guard_api_key: str = ""
    photo_guard_request_timeout_seconds: float = Field(
        default=60,
        ge=5,
        le=300,
    )
    photo_guard_request_concurrency: int = Field(default=8, ge=1, le=32)
    photo_guard_max_source_pixels: int = Field(
        default=64_000_000,
        ge=1_000_000,
        le=200_000_000,
    )
    photo_guard_max_inference_pixels: int = Field(
        default=1_500_000,
        ge=100_000,
        le=8_000_000,
    )
    photo_guard_max_edge: int = Field(default=1280, ge=256, le=4096)
    photo_guard_jpeg_quality: int = Field(default=82, ge=50, le=95)
    photo_guard_fail_open: bool = False

    weather_rate_limit_per_user: int = Field(default=20, ge=1)
    weather_rate_window_seconds: int = Field(default=60, ge=1)
    weather_daily_upstream_limit_per_user: int = Field(default=100, ge=1)
    weather_cache_ttl_now_seconds: int = Field(default=300, ge=30)
    weather_cache_ttl_forecast_seconds: int = Field(default=900, ge=30)

    worker_backend_base_url: str = "http://localhost:8000"
    worker_token: str = "change-this-worker-token"
    worker_lease_seconds: int = 600
    dashscope_api_key: str = ""
    qwen_api_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    qwen_model: str = "qwen3-vl-plus"
    qwen3_vl_flash_model: str = "qwen3-vl-flash"
    local_qwen_api_key: str = ""
    local_qwen_api_base_url: str = ""
    local_qwen_model: str = ""
    local_qwen_control_enabled: bool = False
    local_qwen_vllm_executable: str = "vllm"
    local_qwen_model_path: str = ""
    local_qwen_cuda_visible_devices: str = ""
    local_qwen_cuda_home: str = ""
    local_qwen_use_deep_gemm: bool = False
    local_qwen_use_flashinfer_sampler: bool = False
    local_qwen_tensor_parallel_size: int = Field(default=1, ge=1, le=16)
    local_qwen_max_concurrency: int = Field(default=1, ge=1, le=10)
    local_qwen_gpu_memory_utilization: float = Field(default=0.9, gt=0, le=1)
    local_qwen_max_model_len: int = Field(default=32768, ge=1024)
    local_qwen_mm_encoder_tp_mode: Literal["data", "weights"] = "weights"
    local_qwen_disable_custom_all_reduce: bool = True
    local_qwen_max_images_per_prompt: int = Field(default=4, ge=1, le=64)
    local_qwen_startup_timeout_seconds: int = Field(default=300, ge=30, le=1800)
    local_qwen_stop_timeout_seconds: int = Field(default=30, ge=1, le=120)
    local_qwen_runtime_dir: str = ""
    qwen_request_timeout_seconds: float = 120
    qwen_max_concurrency: int = Field(default=5, ge=1, le=10)
    zhipu_api_key: str = ""
    zhipu_api_base_url: str = "https://open.bigmodel.cn/api/paas/v4"
    zhipu_model: str = "glm-4.6v"
    zhipu_request_timeout_seconds: float = 120
    zhipu_max_concurrency: int = Field(default=5, ge=1, le=10)

    auth_secret_key: str = "change-this-auth-secret-key-before-production"
    auth_access_token_expire_minutes: int = 480
    auth_seed_demo_users: bool = True

    qweather_api_host: str = ""
    qweather_api_key: str = ""
    qweather_developer_id: str = ""
    qweather_project_id: str = ""
    qweather_credential_id: str = ""
    qweather_public_key_path: str = ""
    qweather_public_key_sha256: str = ""
    qweather_private_key_path: str = ""
    qweather_test_location: str = "116.41,39.92"
    qweather_language: str = "zh"
    qweather_jwt_ttl_seconds: int = 900
    qweather_request_timeout_seconds: int = 10

    @property
    def effective_photo_guard_api_base_url(self) -> str:
        if self.photo_guard_provider == "dashscope":
            return self.photo_guard_api_base_url.strip() or self.qwen_api_base_url.strip()
        return self.photo_guard_api_base_url.strip()

    @property
    def effective_photo_guard_model(self) -> str:
        if self.photo_guard_provider == "dashscope":
            return self.photo_guard_model.strip() or self.qwen3_vl_flash_model.strip()
        return self.photo_guard_model.strip()

    @property
    def effective_photo_guard_api_key(self) -> str:
        if self.photo_guard_provider == "dashscope":
            return self.photo_guard_api_key.strip() or self.dashscope_api_key.strip()
        return self.photo_guard_api_key.strip()

    @property
    def docs_enabled(self) -> bool:
        if self.api_docs_enabled is not None:
            return self.api_docs_enabled
        return self.app_env.lower() != "production"

    @field_validator("backend_cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: Any) -> list[str] | Any:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @model_validator(mode="after")
    def validate_production_security(self) -> "Settings":
        if self.app_env.lower() != "production":
            return self
        problems: list[str] = []
        if self.debug:
            problems.append("DEBUG must be false")
        if self.auth_seed_demo_users:
            problems.append("AUTH_SEED_DEMO_USERS must be false")
        if (
            self.auth_secret_key == "change-this-auth-secret-key-before-production"
            or len(self.auth_secret_key) < 32
        ):
            problems.append("AUTH_SECRET_KEY must be a unique secret of at least 32 characters")
        if self.security_store_backend != "redis":
            problems.append("SECURITY_STORE_BACKEND must be redis")
        if not self.security_fail_closed:
            problems.append("SECURITY_FAIL_CLOSED must be true")
        if "*" in self.backend_cors_origins:
            problems.append("BACKEND_CORS_ORIGINS must not contain *")
        if self.photo_guard_enabled:
            if (
                not self.effective_photo_guard_api_base_url
                or not self.effective_photo_guard_model
            ):
                problems.append(
                    "PHOTO_GUARD_API_BASE_URL and PHOTO_GUARD_MODEL are required"
                )
            if (
                self.photo_guard_provider == "dashscope"
                and not self.effective_photo_guard_api_key
            ):
                problems.append(
                    "DASHSCOPE_API_KEY or PHOTO_GUARD_API_KEY is required for the photo guard"
                )
            if self.photo_guard_fail_open:
                problems.append("PHOTO_GUARD_FAIL_OPEN must be false")
        local_qwen_configured = bool(
            self.local_qwen_api_base_url.strip() and self.local_qwen_model.strip()
        )
        if (
            not self.dashscope_api_key.strip()
            and not self.zhipu_api_key.strip()
            and not local_qwen_configured
        ):
            problems.append(
                "DASHSCOPE_API_KEY, ZHIPU_API_KEY, or a local Qwen endpoint is required"
            )
        if problems:
            raise ValueError("Unsafe production configuration: " + "; ".join(problems))
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
