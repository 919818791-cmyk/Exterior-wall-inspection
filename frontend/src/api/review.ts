import { queryOptions } from "@tanstack/react-query";

import { apiRequest } from "@/api/client";
import type {
  AnnotationPhotoEdit,
  ReviewAnnotationDetail,
  SaveReviewAnnotationsPayload
} from "@/types/reviewAnnotations";
import type {
  InspectionReport,
  ReviewDetectionListItem,
  ReviewProjectDetail,
  ReviewProjectListItem,
  ReviewProjectResults,
  ReviewResult,
  ReviewResultCreatePayload,
  ReviewResultUpdatePayload
} from "@/types/review";
import type { ReportDetail } from "@/types/reports";

export const reviewProjectsQueryOptions = queryOptions({
  queryKey: ["review", "projects"],
  queryFn: () => apiRequest<ReviewProjectListItem[]>("/review/projects")
});

export const reviewDetectionsQueryOptions = queryOptions({
  queryKey: ["review", "detections"],
  queryFn: () => apiRequest<ReviewDetectionListItem[]>("/review/detections")
});

export function reviewDetectionQueryOptions(taskId: string) {
  return queryOptions({
    queryKey: ["review", "detections", taskId],
    queryFn: () => apiRequest<ReviewDetectionListItem>(`/review/detections/${taskId}`),
    enabled: Boolean(taskId)
  });
}

export function reviewDetectionAnnotationsQueryOptions(taskId: string) {
  return queryOptions({
    queryKey: ["review", "detections", taskId, "annotations"],
    queryFn: () => apiRequest<ReviewAnnotationDetail>(
      `/review/detections/${taskId}/annotations`
    ),
    enabled: Boolean(taskId)
  });
}

export function reviewDetectionPreviewQueryOptions(taskId: string) {
  return queryOptions({
    queryKey: ["review", "detections", taskId, "preview"],
    queryFn: () => apiRequest<ReportDetail>(
      `/review/detections/${taskId}/preview`
    ),
    enabled: Boolean(taskId)
  });
}

export function saveReviewDetectionAnnotations(
  taskId: string,
  payload: SaveReviewAnnotationsPayload
) {
  return apiRequest<AnnotationPhotoEdit>(
    `/review/detections/${taskId}/annotations/photos`,
    { method: "PUT", body: JSON.stringify(payload) }
  );
}

export function resetReviewDetectionAnnotations(taskId: string, photoKey: string) {
  const query = new URLSearchParams({ photo_key: photoKey });
  return apiRequest<{ ok: boolean }>(
    `/review/detections/${taskId}/annotations/photos?${query.toString()}`,
    { method: "DELETE" }
  );
}

export function completeDetectionReview(taskId: string) {
  return apiRequest<InspectionReport>(`/review/detections/${taskId}/complete`, {
    method: "POST"
  });
}

export function reviewProjectQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ["review", "projects", projectId],
    queryFn: () => apiRequest<ReviewProjectDetail>(`/review/projects/${projectId}`),
    enabled: Boolean(projectId)
  });
}

export function reviewProjectResultsQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ["review", "projects", projectId, "results"],
    queryFn: () => apiRequest<ReviewProjectResults>(`/review/projects/${projectId}/results`),
    enabled: Boolean(projectId)
  });
}

export function createReviewResult(payload: ReviewResultCreatePayload) {
  return apiRequest<ReviewResult>("/review/results", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateReviewResult(resultId: string, payload: ReviewResultUpdatePayload) {
  return apiRequest<ReviewResult>(`/review/results/${resultId}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function deleteReviewResult(resultId: string) {
  return apiRequest<ReviewResult>(`/review/results/${resultId}`, {
    method: "DELETE"
  });
}
