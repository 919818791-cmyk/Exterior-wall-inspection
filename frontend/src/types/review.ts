import type {
  DefectType,
  DetectionTaskStatus,
  PhotoStatus,
  PhotoType,
  ProjectStatus
} from "@/types/projects";

export type ReviewResultStatus = "pending" | "confirmed" | "modified" | "deleted" | "added";
export type InspectionReportStatus = "draft" | "generated" | "pushed" | "revoked";

export interface ReviewBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReviewProjectListItem {
  id: string;
  project_no: string;
  name: string;
  client_name: string | null;
  address: string | null;
  status: ProjectStatus;
  current_task_id: string | null;
  current_report_id: string | null;
  current_task_status: DetectionTaskStatus | null;
  photo_count: number;
  ai_result_count: number;
  review_result_count: number;
  updated_at: string;
}

export interface ReviewProjectDetail extends ReviewProjectListItem {
  contact_name: string | null;
  contact_phone: string | null;
  province: string | null;
  city: string | null;
  district: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface ReviewPhoto {
  id: string;
  project_id: string;
  building_id: string | null;
  facade_id: string | null;
  original_filename: string;
  image_width: number | null;
  image_height: number | null;
  photo_type: PhotoType;
  status: PhotoStatus;
  preview_url: string | null;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface AiDetectionResult {
  id: string;
  project_id: string;
  detection_task_id: string;
  photo_id: string;
  defect_type: DefectType;
  confidence: string | null;
  bbox_json: ReviewBBox;
  polygon_json: Record<string, unknown> | null;
  severity: string | null;
  area: string | null;
  length: string | null;
  model_version: string | null;
  raw_result_json: Record<string, unknown> | null;
  status: "pending";
  created_at: string;
}

export interface ReviewResult {
  id: string;
  project_id: string;
  detection_task_id: string;
  photo_id: string;
  ai_result_id: string | null;
  defect_type: DefectType;
  bbox_json: ReviewBBox;
  polygon_json: Record<string, unknown> | null;
  severity: string | null;
  area: string | null;
  length: string | null;
  status: ReviewResultStatus;
  reviewer_id: string;
  review_note: string | null;
  reviewed_at: string;
  created_at: string;
  updated_at: string;
}

export interface ReviewProjectResults {
  project: ReviewProjectDetail;
  photos: ReviewPhoto[];
  ai_results: AiDetectionResult[];
  review_results: ReviewResult[];
}

export interface ReviewResultCreatePayload {
  project_id?: string | null;
  photo_id?: string | null;
  ai_result_id?: string | null;
  defect_type: DefectType;
  bbox: ReviewBBox;
  polygon_json?: Record<string, unknown> | null;
  severity?: string | null;
  area?: string | null;
  length?: string | null;
  status: Exclude<ReviewResultStatus, "pending">;
  review_note?: string | null;
}

export interface ReviewResultUpdatePayload {
  defect_type?: DefectType;
  bbox?: ReviewBBox;
  polygon_json?: Record<string, unknown> | null;
  severity?: string | null;
  area?: string | null;
  length?: string | null;
  status?: Exclude<ReviewResultStatus, "pending">;
  review_note?: string | null;
}

export interface InspectionReport {
  id: string;
  project_id: string;
  detection_task_id: string | null;
  report_no: string;
  title: string;
  status: InspectionReportStatus;
  report_data_json: Record<string, unknown> | null;
  generated_by: string;
  generated_at: string;
  created_at: string;
  updated_at: string;
}
