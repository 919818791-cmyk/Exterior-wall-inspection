import { queryOptions } from "@tanstack/react-query";

import { apiRequest } from "@/api/client";
import type {
  InspectionReport,
  ReviewProjectDetail,
  ReviewProjectListItem,
  ReviewProjectResults,
  ReviewResult,
  ReviewResultCreatePayload,
  ReviewResultUpdatePayload
} from "@/types/review";

export const reviewProjectsQueryOptions = queryOptions({
  queryKey: ["review", "projects"],
  queryFn: () => apiRequest<ReviewProjectListItem[]>("/review/projects")
});

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

export function completeProjectReview(projectId: string) {
  return apiRequest<InspectionReport>(`/review/projects/${projectId}/complete`, {
    method: "POST"
  });
}
