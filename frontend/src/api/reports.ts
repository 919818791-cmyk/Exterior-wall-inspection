import { queryOptions } from "@tanstack/react-query";

import { ApiError, apiFetch, apiRequest } from "@/api/client";
import type { ReportDetail, ReportListItem } from "@/types/reports";

function generatedParam(includeGenerated: boolean) {
  return includeGenerated ? "?include_generated=true" : "";
}

export const reportsQueryOptions = queryOptions({
  queryKey: ["reports"],
  queryFn: () => apiRequest<ReportListItem[]>("/reports")
});

export function reportQueryOptions(reportId: string, includeGenerated = false) {
  return queryOptions({
    queryKey: ["reports", reportId, { includeGenerated }],
    queryFn: () =>
      apiRequest<ReportDetail>(`/reports/${reportId}${generatedParam(includeGenerated)}`),
    enabled: Boolean(reportId)
  });
}

export function pushReport(reportId: string) {
  return apiRequest<ReportDetail>(`/reports/${reportId}/push`, {
    method: "POST"
  });
}

export interface TrialReportPayload {
  generated_at: string;
  models: string[];
  files: Array<{
    filename: string;
    size: number;
  }>;
  findings: Array<{
    filename: string;
    model: string;
    confidence: string;
  }>;
}

export async function downloadTrialReportDocx(payload: TrialReportPayload) {
  const response = await apiFetch("/trial/report/docx", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json")
      ? await response.json()
      : await response.text();
    const message =
      typeof body === "object" && body !== null && "message" in body
        ? String((body as { message: unknown }).message)
        : `API request failed with status ${response.status}`;
    throw new ApiError(message, response.status, body);
  }

  return response.blob();
}

export async function downloadReportDocx(reportId: string, includeGenerated = false) {
  const response = await apiFetch(`/reports/${reportId}/docx${generatedParam(includeGenerated)}`);
  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json")
      ? await response.json()
      : await response.text();
    const message =
      typeof body === "object" && body !== null && "message" in body
        ? String((body as { message: unknown }).message)
        : `API request failed with status ${response.status}`;
    throw new ApiError(message, response.status, body);
  }
  return response.blob();
}
