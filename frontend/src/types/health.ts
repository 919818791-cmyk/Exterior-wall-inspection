// Public liveness response. Internal diagnostics require administrator access.
export type HealthStatus = "ok";

export interface HealthResponse {
  status: HealthStatus;
}
