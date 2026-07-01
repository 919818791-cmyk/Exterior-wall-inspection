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

export function deleteReport(reportId: string) {
  return apiRequest<{ ok: boolean }>(`/reports/${reportId}`, {
    method: "DELETE"
  });
}

export interface TrialReportPayload {
  report_name?: string;
  generated_at: string;
  models: string[];
  files: Array<{
    filename: string;
    size: number;
  }>;
  findings: Array<{
    filename: string;
    model: string;
  }>;
}

export interface TrialGeneratePayload {
  report_name?: string;
  models?: string[];
}

export type TrialGeneratedResult = TrialReportPayload;

function downloadErrorMessage(body: unknown, status: number) {
  return typeof body === "object" && body !== null && "message" in body
    ? String((body as { message: unknown }).message)
    : `API request failed with status ${status}`;
}

async function readErrorPayload(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("application/json")
    ? response.json()
    : response.text();
}

export async function archiveTrialResult(payload: TrialReportPayload, files: File[]) {
  const formData = new FormData();
  formData.append("payload", JSON.stringify(payload));
  files.forEach((file) => formData.append("files", file));
  return apiRequest<ReportDetail>("/trial/results", {
    method: "POST",
    body: formData
  });
}

export async function generateTrialResult(payload: TrialGeneratePayload, files: File[]) {
  const formData = new FormData();
  formData.append("payload", JSON.stringify(payload));
  files.forEach((file) => formData.append("files", file));
  return apiRequest<TrialGeneratedResult>("/trial/generate", {
    method: "POST",
    body: formData
  });
}

export async function downloadReportDocx(reportId: string, includeGenerated = false) {
  const response = await apiFetch(`/reports/${reportId}/docx${generatedParam(includeGenerated)}`);
  if (!response.ok) {
    const body = await readErrorPayload(response);
    const message = downloadErrorMessage(body, response.status);
    throw new ApiError(message, response.status, body);
  }
  return response.blob();
}
