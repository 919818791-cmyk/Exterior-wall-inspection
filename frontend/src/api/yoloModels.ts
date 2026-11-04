import { queryOptions } from "@tanstack/react-query";

import { apiFetch, apiRequest, apiUploadRequest, ApiError, type ApiUploadProgress } from "@/api/client";
import type { YoloModel, YoloModelCatalog, YoloModelCreate, YoloModelEdit, YoloModelVersion, YoloVersionEdit } from "@/types/yoloModels";

export const yoloModelsQueryOptions = queryOptions({
  queryKey: ["yolo-models"],
  queryFn: () => apiRequest<YoloModelCatalog>("/yolo-models"),
  refetchInterval: query => query.state.data?.items.some(model => model.versions.some(version => version.control_supported)) ? 3000 : false
});

export function controlYoloVersion(version: YoloModelVersion, action: "start" | "stop") {
  return apiRequest<{ state: string; message: string }>(`/yolo-models/${version.model_id}/versions/${version.id}/runtime/${action}`, { method: "POST" });
}

export function uploadYoloVersion(modelId: string, body: FormData, onProgress: (progress: ApiUploadProgress) => void) {
  return apiUploadRequest<YoloModelVersion>(`/yolo-models/${modelId}/versions`, body, { onProgress });
}

export function createYoloModel(payload: YoloModelCreate) {
  return apiRequest<YoloModel>("/yolo-models", { method: "POST", body: JSON.stringify(payload) });
}

export function editYoloModel(modelId: string, payload: YoloModelEdit) {
  return apiRequest<YoloModel>(`/yolo-models/${modelId}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export async function deleteYoloModel(model: YoloModel) {
  await checkedResponse(`/yolo-models/${model.id}`, { method: "DELETE" });
}

export function editYoloVersion(item: YoloModelVersion, payload: YoloVersionEdit) {
  return apiRequest<YoloModelVersion>(`/yolo-models/${item.model_id}/versions/${item.id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

async function checkedResponse(path: string, init?: RequestInit) {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(payload?.message || "模型操作失败，请稍后重试。", response.status, payload);
  }
  return response;
}

export async function deleteYoloVersion(version: YoloModelVersion) {
  await checkedResponse(`/yolo-models/${version.model_id}/versions/${version.id}`, { method: "DELETE" });
}
