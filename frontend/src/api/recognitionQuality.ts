import { queryOptions } from "@tanstack/react-query";
import { apiFetch, apiRequest } from "@/api/client";
import type { QualityCatalog, QualityDetail } from "@/types/recognitionQuality";

export function qualityCatalogOptions(page: number, search: string, sort: string) {
  const query = new URLSearchParams({ page: String(page), search, sort });
  return queryOptions({ queryKey: ["recognition-quality", "catalog", page, search, sort],
    queryFn: () => apiRequest<QualityCatalog>(`/recognition-quality?${query}`) });
}
export function qualityDetailOptions(projectId: string, version: string) {
  const query = version ? `?${new URLSearchParams({ version })}` : "";
  return queryOptions({ queryKey: ["recognition-quality", projectId, version],
    queryFn: () => apiRequest<QualityDetail>(`/recognition-quality/projects/${projectId}${query}`),
    enabled: Boolean(projectId) });
}
export async function exportQuality(projectId?: string, version?: string) {
  const query = version ? `?${new URLSearchParams({ version })}` : "";
  const path = projectId ? `/recognition-quality/projects/${projectId}/export${query}` : "/recognition-quality/export";
  const response = await apiFetch(path);
  if (!response.ok) throw new Error("导出失败，请稍后重试。");
  return response.blob();
}
