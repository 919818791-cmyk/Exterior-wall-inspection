import { queryOptions } from "@tanstack/react-query";

import { apiRequest } from "@/api/client";
import type {
  AnnotationManagementDetail,
  AnnotationPhotoEdit,
  AnnotationResultListItem,
  AnnotationSourceType,
  SavePhotoAnnotationsPayload
} from "@/types/annotationManagement";

function sourceQuery(sourceType: AnnotationSourceType) {
  return new URLSearchParams({ source_type: sourceType }).toString();
}

export const annotationResultsQueryOptions = queryOptions({
  queryKey: ["annotation-management", "results"],
  queryFn: () => apiRequest<AnnotationResultListItem[]>("/annotation-management/results")
});

export function annotationResultQueryOptions(
  resultId: string,
  sourceType: AnnotationSourceType
) {
  return queryOptions({
    queryKey: ["annotation-management", "results", resultId, sourceType],
    queryFn: () => apiRequest<AnnotationManagementDetail>(
      `/annotation-management/results/${resultId}?${sourceQuery(sourceType)}`
    ),
    enabled: Boolean(resultId)
  });
}

export function savePhotoAnnotations(
  resultId: string,
  sourceType: AnnotationSourceType,
  payload: SavePhotoAnnotationsPayload
) {
  return apiRequest<AnnotationPhotoEdit>(
    `/annotation-management/results/${resultId}/photos?${sourceQuery(sourceType)}`,
    { method: "PUT", body: JSON.stringify(payload) }
  );
}

export function resetPhotoAnnotations(
  resultId: string,
  sourceType: AnnotationSourceType,
  photoKey: string
) {
  const query = new URLSearchParams({ source_type: sourceType, photo_key: photoKey });
  return apiRequest<{ ok: boolean }>(
    `/annotation-management/results/${resultId}/photos?${query.toString()}`,
    { method: "DELETE" }
  );
}
