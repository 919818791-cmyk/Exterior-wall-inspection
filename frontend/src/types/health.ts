export type HealthStatus = "ok" | "degraded";

export interface HealthResponse {
  status: HealthStatus;
  service: string;
  environment: string;
  api_prefix: string;
  database_configured: boolean;
  minio_configured: boolean;
  redis_configured: boolean;
  worker_contract: {
    backend_base_url: string;
    minio_public_url: string;
    worker_token_configured: boolean;
    lease_seconds: number;
  };
}
