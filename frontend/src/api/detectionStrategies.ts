import { queryOptions } from "@tanstack/react-query";
import { apiFetch, apiRequest } from "@/api/client";

export type ModelKind = "cloud_api" | "local_vlm" | "yolo" | "unconfigured";
export interface DetectionStrategy {
  key: string; facade_type: string; facade_label: string; label: string; defect_types: string[];
  routing_supported: boolean; model_kind: ModelKind; model_id: string | null; version_id: string | null; prompt: string;
}
export interface VisionModelEdit {
  name: string; kind: "cloud_api" | "local_vlm"; model_name: string; api_base_url: string; api_key_env: string; model_path: string;
}
export interface VisionModel extends VisionModelEdit {
  id: string; builtin: boolean; effective_model_name: string; effective_api_base_url: string; configured: boolean;
  runtime_status: string; runtime_message: string; control_supported: boolean;
  runtime_active?: boolean;
}
export const strategiesQueryOptions = queryOptions({ queryKey: ["detection-strategies"], queryFn: () => apiRequest<DetectionStrategy[]>("/detection-strategies") });
export const visionModelsQueryOptions = queryOptions({ queryKey: ["vision-models"], queryFn: () => apiRequest<VisionModel[]>("/vision-models"), refetchInterval: query => query.state.data?.some(model => model.kind === "local_vlm" && model.control_supported) ? 3000 : false });
export function saveStrategies(items: DetectionStrategy[]) {
  return apiRequest<DetectionStrategy[]>("/detection-strategies", { method: "PUT", body: JSON.stringify({ items: items.map(({ key, model_kind, model_id, version_id, prompt }) => ({ key, model_kind, model_id, version_id, prompt })) }) });
}
export function saveVisionModel(model: VisionModel | null, payload: VisionModelEdit) {
  return apiRequest<VisionModel>(`/vision-models${model ? `/${model.id}` : ""}`, { method: model ? "PATCH" : "POST", body: JSON.stringify(payload) });
}
export async function deleteVisionModel(model: VisionModel) {
  const response = await apiFetch(`/vision-models/${model.id}`, { method: "DELETE" });
  if (!response.ok) { const payload = await response.json(); throw new Error(payload.message || "删除失败。"); }
}
export function controlVisionModel(model: VisionModel, action: "start" | "stop") {
  return apiRequest<{ state: string; message: string }>(`/vision-models/${model.id}/runtime/${action}`, { method: "POST" });
}
