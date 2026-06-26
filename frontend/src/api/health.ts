import { queryOptions } from "@tanstack/react-query";

import { apiRequest } from "@/api/client";
import type { HealthResponse } from "@/types/health";

export const healthQueryOptions = queryOptions({
  queryKey: ["health"],
  queryFn: () => apiRequest<HealthResponse>("/health")
});
