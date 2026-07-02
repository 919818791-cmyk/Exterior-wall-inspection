import { queryOptions } from "@tanstack/react-query";

import { ApiError, apiFetch, apiRequest, apiUploadRequest, type ApiUploadProgress } from "@/api/client";
import type { AuthUser } from "@/types/auth";
import type { ReportDetail, ReportListItem } from "@/types/reports";

function generatedParam(includeGenerated: boolean) {
  return includeGenerated ? "?include_generated=true" : "";
}

type ReportViewer = Pick<AuthUser, "id" | "role"> | null | undefined;

function viewerQueryKey(viewer: ReportViewer) {
  return {
    role: viewer?.role ?? "anonymous",
    userId: viewer?.id ?? "anonymous"
  };
}

export function reportsQueryOptions(viewer: ReportViewer) {
  return queryOptions({
    queryKey: ["reports", "list", viewerQueryKey(viewer)],
    queryFn: () => apiRequest<ReportListItem[]>("/reports"),
    enabled: Boolean(viewer?.id)
  });
}

export function reportQueryOptions(reportId: string, includeGenerated = false, viewer?: ReportViewer) {
  return queryOptions({
    queryKey: ["reports", "detail", reportId, { includeGenerated, viewer: viewerQueryKey(viewer) }],
    queryFn: () =>
      apiRequest<ReportDetail>(`/reports/${reportId}${generatedParam(includeGenerated)}`),
    enabled: Boolean(reportId && viewer?.id)
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
    photo_id?: string;
    filename: string;
    size: number;
  }>;
  findings: Array<{
    photo_id?: string;
    filename: string;
    model: string;
  }>;
}

export interface TrialGeneratePayload {
  report_name?: string;
  models?: string[];
  photo_ids?: string[];
}

export type TrialGeneratedResult = TrialReportPayload;

export type TrialUploadProgress = ApiUploadProgress;

export interface TrialUploadedPhoto {
  id: string;
  original_filename: string;
  file_size: number | null;
  mime_type: string | null;
  metadata_json: Record<string, unknown>;
  thermal_imaging_available: boolean;
  created_at: string;
}

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

export async function archiveTrialResult(payload: TrialReportPayload) {
  return apiRequest<ReportDetail>("/trial/results", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function uploadTrialPhoto(file: File, onUploadProgress?: (progress: TrialUploadProgress) => void) {
  const formData = new FormData();
  formData.append("file", file);
  return apiUploadRequest<TrialUploadedPhoto>("/trial/photos", formData, {
    method: "POST",
    onProgress: onUploadProgress
  });
}

export async function deleteTrialPhoto(photoId: string) {
  return apiRequest<{ ok: boolean }>(`/trial/photos/${photoId}`, {
    method: "DELETE"
  });
}

export async function generateTrialResult(payload: TrialGeneratePayload) {
  return apiRequest<TrialGeneratedResult>("/trial/generate", {
    method: "POST",
    body: JSON.stringify(payload)
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
