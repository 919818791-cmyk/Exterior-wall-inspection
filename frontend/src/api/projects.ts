import { queryOptions } from "@tanstack/react-query";

import { ApiError, apiFetch, apiRequest, apiUploadRequest } from "@/api/client";
import type { ApiUploadProgress } from "@/api/client";
import type { ReportDetail } from "@/types/reports";
import type { AuthUser } from "@/types/auth";
import type {
  BuildingModel,
  DetectionConfig,
  DetectionConfigPayload,
  DetectionTask,
  Photo,
  ProjectCreatePayload,
  ProjectDraftCreatePayload,
  ProjectDetail,
  ProjectFinalizePayload,
  ProjectListItem,
  ProjectUpdatePayload,
  StartDetectionPayload,
  UploadBatch,
  UploadBatchPayload
} from "@/types/projects";

type ProjectViewer = Pick<AuthUser, "id" | "role"> | null | undefined;

function viewerQueryKey(viewer: ProjectViewer) {
  return {
    role: viewer?.role ?? "anonymous",
    userId: viewer?.id ?? "anonymous"
  };
}

export function projectsQueryOptions(viewer: ProjectViewer) {
  return queryOptions({
    queryKey: ["projects", "list", viewerQueryKey(viewer)],
    queryFn: () => apiRequest<ProjectListItem[]>("/projects"),
    refetchInterval: 30_000
  });
}

export function projectQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ["projects", projectId],
    queryFn: () => apiRequest<ProjectDetail>(`/projects/${projectId}`),
    enabled: Boolean(projectId),
    refetchInterval: 30_000
  });
}

export function createProject(payload: ProjectCreatePayload) {
  return apiRequest<ProjectDetail>("/projects", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function createProjectDraft(payload: ProjectDraftCreatePayload) {
  return apiRequest<ProjectDetail>("/projects/drafts", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateProject(projectId: string, payload: ProjectUpdatePayload) {
  return apiRequest<ProjectDetail>(`/projects/${projectId}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function deleteProject(projectId: string) {
  return apiRequest<{ ok: boolean }>(`/projects/${projectId}`, {
    method: "DELETE"
  });
}

export function finalizeProject(projectId: string, payload: ProjectFinalizePayload) {
  return apiRequest<ProjectDetail>(`/projects/${projectId}/finalize`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function buildingModelQueryKey(projectId: string) {
  return ["projects", projectId, "building-model"] as const;
}

export function buildingModelQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: buildingModelQueryKey(projectId),
    queryFn: () => apiRequest<BuildingModel | null>(`/projects/${projectId}/building-model`),
    enabled: Boolean(projectId)
  });
}

export function uploadBuildingModel(
  projectId: string,
  file: File,
  onProgress?: (progress: ApiUploadProgress) => void
) {
  const body = new FormData();
  body.append("file", file);
  return apiUploadRequest<BuildingModel>(`/projects/${projectId}/building-model`, body, {
    method: "PUT",
    onProgress
  });
}

export function deleteBuildingModel(projectId: string) {
  return apiRequest<{ ok: boolean }>(`/projects/${projectId}/building-model`, {
    method: "DELETE"
  });
}

export function projectPhotosQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ["projects", projectId, "photos"],
    queryFn: () => apiRequest<Photo[]>(`/projects/${projectId}/photos`),
    enabled: Boolean(projectId)
  });
}

export function projectReviewedResultQueryOptions(
  projectId: string,
  enabled: boolean
) {
  return queryOptions({
    queryKey: ["projects", projectId, "reviewed-result"],
    queryFn: () => apiRequest<ReportDetail>(
      `/projects/${projectId}/reviewed-result`
    ),
    enabled: Boolean(projectId && enabled)
  });
}

export function createUploadBatch(projectId: string, payload: UploadBatchPayload) {
  return apiRequest<UploadBatch>(`/projects/${projectId}/upload-batches`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function uploadPhoto(formData: FormData) {
  const response = await apiFetch("/photos/upload", {
    method: "POST",
    body: formData
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "message" in payload
        ? String((payload as { message: unknown }).message)
        : `API request failed with status ${response.status}`;
    throw new ApiError(message, response.status, payload);
  }

  return payload as Photo;
}

export function deletePhoto(photoId: string) {
  return apiRequest<{ ok: boolean }>(`/photos/${photoId}`, {
    method: "DELETE"
  });
}

export function detectionConfigQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ["projects", projectId, "detection-config"],
    queryFn: () => apiRequest<DetectionConfig>(`/projects/${projectId}/detection-config`),
    enabled: Boolean(projectId)
  });
}

export function updateDetectionConfig(projectId: string, payload: DetectionConfigPayload) {
  return apiRequest<DetectionConfig>(`/projects/${projectId}/detection-config`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function startDetection(projectId: string, payload: StartDetectionPayload) {
  return apiRequest<DetectionTask>(`/projects/${projectId}/start-detection`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
