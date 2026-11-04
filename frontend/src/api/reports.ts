import { queryOptions } from "@tanstack/react-query";

import { ApiError, apiFetch, apiRequest, apiUploadRequest, type ApiUploadProgress } from "@/api/client";
import type { AuthUser } from "@/types/auth";
import type { ModelOutputPhoto, ReportDetail, ReportListItem } from "@/types/reports";

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
    queryFn: () => apiRequest<ReportListItem[]>("/reports")
  });
}

export function reportQueryOptions(reportId: string, includeGenerated = false, viewer?: ReportViewer) {
  return queryOptions({
    queryKey: ["reports", "detail", reportId, { includeGenerated, viewer: viewerQueryKey(viewer) }],
    queryFn: () =>
      apiRequest<ReportDetail>(`/reports/${reportId}${generatedParam(includeGenerated)}`),
    enabled: Boolean(reportId)
  });
}

export function deleteReport(reportId: string) {
  return apiRequest<{ ok: boolean }>(`/reports/${reportId}`, {
    method: "DELETE"
  });
}

export function restoreTrialReport(reportId: string) {
  return apiRequest<ReportDetail>(`/reports/${reportId}/restore`, {
    method: "POST"
  });
}

export function updateTrialReportTitle(reportId: string, title: string) {
  return apiRequest<ReportDetail>(`/reports/${reportId}`, {
    method: "PATCH",
    body: JSON.stringify({ title })
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
    confidence?: number | null;
    bbox?: {
      x: number;
      y: number;
      width: number;
      height: number;
    } | null;
    image_width?: number | null;
    image_height?: number | null;
    detection_id?: string | null;
    description?: string | null;
  }>;
  raw_model_outputs?: ModelOutputPhoto[];
}

export interface TrialGeneratePayload {
  report_name?: string;
  models?: string[];
  photo_ids?: string[];
  archived_report_id?: string;
}

export type TrialGeneratedResult = TrialReportPayload & {
  archived_report_id?: string;
  archived_report_title?: string;
};

export interface TrialRequestStatus {
  request_id: string;
  status: "processing" | "completed" | "failed";
  result: TrialGeneratedResult | null;
  error: string | null;
}

export type TrialUploadProgress = ApiUploadProgress;

export interface TrialUploadedPhoto {
  id: string;
  original_filename: string;
  file_size: number | null;
  mime_type: string | null;
  metadata_json: Record<string, unknown>;
  thermal_imaging_available: boolean;
  precheck_status: "pending" | "running" | "passed" | "rejected" | "error";
  precheck_category: string | null;
  precheck_reason: string | null;
  precheck_model: string | null;
  precheck_error: string | null;
  precheck_attempts: number;
  prechecked_at: string | null;
  created_at: string;
}

function downloadErrorMessage(body: unknown, status: number) {
  if (typeof body === "object" && body !== null) {
    if ("message" in body) return String((body as { message: unknown }).message);
    if ("detail" in body) return String((body as { detail: unknown }).detail);
  }
  return `API request failed with status ${status}`;
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

export async function generateTrialResult(payload: TrialGeneratePayload, requestId?: string) {
  const headers = new Headers();
  if (requestId) headers.set("Idempotency-Key", requestId);
  return apiRequest<TrialGeneratedResult>("/trial/generate", {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
}

export function getTrialRequestStatus(requestId: string) {
  return apiRequest<TrialRequestStatus>(`/trial/requests/${encodeURIComponent(requestId)}`);
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

export async function downloadTrialReportPdf(reportId: string) {
  const response = await apiFetch(`/reports/${reportId}/pdf`);
  if (!response.ok) {
    const body = await readErrorPayload(response);
    const message = downloadErrorMessage(body, response.status);
    throw new ApiError(message, response.status, body);
  }
  return response.blob();
}
