import { queryOptions } from "@tanstack/react-query";

import { apiRequest } from "@/api/client";
import type { DataUsagePeriod, DataUsageResponse } from "@/types/dataManagement";

export function dataUsageQueryOptions(period: DataUsagePeriod) {
  return queryOptions({
    queryKey: ["data-usage", period],
    queryFn: () => apiRequest<DataUsageResponse>(`/data-management/usage?period=${period}`)
  });
}

