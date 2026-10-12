import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import { ApiError, apiFetch, apiRequest } from "@/api/client";
import type { AuthUser } from "@/types/auth";
import type { PhotoLibraryData, PhotoLibraryFilters } from "@/types/photoLibrary";
import type { FacadeType } from "@/types/projects";

export function fetchPhotoLibrary(filters: PhotoLibraryFilters, page: number, pageSize = 24, signal?: AbortSignal) {
  const search = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  Object.entries(filters).forEach(([key, value]) => { if (value) search.set(key, value); });
  return apiRequest<PhotoLibraryData>(`/photos/library?${search}`, { signal });
}

export function fetchPhotoSelection(filters: PhotoLibraryFilters) {
  const search = new URLSearchParams({ selection_only: "true" });
  Object.entries(filters).forEach(([key, value]) => { if (value) search.set(key, value); });
  return apiRequest<{ photo_ids: string[]; total: number }>(`/photos/library?${search}`);
}

export function updatePhotoFacadeType(payload: { photo_ids: string[]; facade_type: FacadeType }) {
  return apiRequest<{ updated_count: number; facade_type: FacadeType }>("/photos/facade-type", {
    method: "PATCH", body: JSON.stringify(payload)
  });
}

export function photoLibraryQueryOptions(user: AuthUser | null, filters: PhotoLibraryFilters, page: number) {
  return queryOptions({
    queryKey: ["photo-library", { userId: user?.id, role: user?.role }, filters, page],
    queryFn: ({ signal }) => fetchPhotoLibrary(filters, page, 24, signal),
    enabled: Boolean(user),
    placeholderData: keepPreviousData,
    staleTime: 30_000
  });
}

export async function exportPhotos(photoIds: string[]) {
  const response = await apiFetch("/photos/export", {
    method: "POST",
    body: JSON.stringify({ photo_ids: photoIds })
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(payload?.message ?? payload?.detail ?? "照片导出失败，请稍后重试。", response.status, payload);
  }
  return response.blob();
}
