from typing import Literal

from pydantic import BaseModel


class WorkerContractHealth(BaseModel):
    backend_base_url: str
    minio_public_url: str
    worker_token_configured: bool
    lease_seconds: int


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    service: str
    environment: str
    api_prefix: str
    database_configured: bool
    minio_configured: bool
    redis_configured: bool
    worker_contract: WorkerContractHealth
