import { queryOptions } from "@tanstack/react-query";

import { ApiError, apiFetch, apiRequest } from "@/api/client";
import type {
  Building,
  BuildingPayload,
  BuildingUpdatePayload,
  DetectionConfig,
  DetectionConfigPayload,
  DetectionTask,
  Facade,
  FacadePayload,
  FacadeUpdatePayload,
  Photo,
  ProjectCreatePayload,
  ProjectDetail,
  ProjectListItem,
  ProjectUpdatePayload,
  UploadBatch,
  UploadBatchPayload
} from "@/types/projects";

export const projectsQueryOptions = queryOptions({
  queryKey: ["projects"],
  queryFn: () => apiRequest<ProjectListItem[]>("/projects")
});

export function projectQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ["projects", projectId],
    queryFn: () => apiRequest<ProjectDetail>(`/projects/${projectId}`),
    enabled: Boolean(projectId)
  });
}

export function createProject(payload: ProjectCreatePayload) {
  return apiRequest<ProjectDetail>("/projects", {
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

export function createBuilding(projectId: string, payload: BuildingPayload) {
  return apiRequest<Building>(`/projects/${projectId}/buildings`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateBuilding(buildingId: string, payload: BuildingUpdatePayload) {
  return apiRequest<Building>(`/buildings/${buildingId}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function deleteBuilding(buildingId: string) {
  return apiRequest<{ ok: boolean }>(`/buildings/${buildingId}`, {
    method: "DELETE"
  });
}

export function createFacade(buildingId: string, payload: FacadePayload) {
  return apiRequest<Facade>(`/buildings/${buildingId}/facades`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateFacade(facadeId: string, payload: FacadeUpdatePayload) {
  return apiRequest<Facade>(`/facades/${facadeId}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function deleteFacade(facadeId: string) {
  return apiRequest<{ ok: boolean }>(`/facades/${facadeId}`, {
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

export function startDetection(projectId: string) {
  return apiRequest<DetectionTask>(`/projects/${projectId}/start-detection`, {
    method: "POST"
  });
}
