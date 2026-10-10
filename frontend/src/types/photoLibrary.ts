import type { DefectType, FacadeType, PhotoStatus, PhotoType } from "@/types/projects";

export type PhotoResult = "defects" | "clear" | "pending" | "failed";

export interface LibraryPhoto {
  id: string;
  source_type: "professional" | "trial";
  project_id: string | null;
  project_name: string;
  project_no: string;
  facade_type: FacadeType | null;
  original_filename: string;
  file_size: number | null;
  image_width: number | null;
  image_height: number | null;
  photo_type: PhotoType;
  status: PhotoStatus;
  result: PhotoResult;
  defect_counts: Partial<Record<DefectType, number>>;
  preview_url: string | null;
  thumbnail_url: string | null;
  created_at: string;
}

export interface PhotoLibraryFilters {
  search: string;
  date_from: string;
  date_to: string;
  facade_type: FacadeType | "";
  defect_type: DefectType | "";
  result: PhotoResult | "";
  photo_type: PhotoType | "";
  source_type: "professional" | "trial" | "";
  sort: "newest" | "oldest" | "filename";
}

export interface PhotoLibraryData {
  items: LibraryPhoto[];
  projects: Array<{ id: string; name: string }>;
  summary: Record<PhotoResult | "total", number>;
  total: number;
  page: number;
  page_size: number;
}
