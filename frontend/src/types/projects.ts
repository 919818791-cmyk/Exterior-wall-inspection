export type ProjectStatus =
  | "draft"
  | "queued"
  | "detecting"
  | "pending_review"
  | "reviewed"
  | "completed";

export type DefectType = "crack" | "spalling" | "moisture" | "hollow";
export type PhotoType = "visible" | "thermal" | "dji" | "other";
export type UploadMode = "dji" | "visible" | "thermal" | "mixed";
export type PhotoStatus = "uploaded" | "detecting" | "detected" | "failed";
export type PhotoPrecheckStatus = "pending" | "running" | "passed" | "rejected" | "error";
export type DetectionTaskStatus = "pending" | "running" | "success" | "failed" | "canceled";

export interface ProjectCreatePayload {
  name?: string | null;
  client_name?: string | null;
  province?: string | null;
  city?: string | null;
  district?: string | null;
  address?: string | null;
  longitude?: string | number | null;
  latitude?: string | number | null;
}

export interface ProjectDraftCreatePayload extends ProjectCreatePayload {
  client_draft_key: string;
}

export type ProjectUpdatePayload = Partial<ProjectCreatePayload>;

export interface ProjectListItem {
  id: string;
  created_by: string;
  project_no: string;
  name: string;
  client_name: string | null;
  province: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  longitude: string | null;
  latitude: string | null;
  status: ProjectStatus;
  current_report_id: string | null;
  photo_count: number;
  valid_photo_count: number;
  total_defects: number;
  by_defect_type: Record<string, number>;
  model_types: string[];
  first_photo_url: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectDetail extends ProjectListItem {
  current_task_id: string | null;
  current_task_status: DetectionTaskStatus | null;
  completed_at: string | null;
}

export interface UploadBatchPayload {
  drone_type?: string | null;
  upload_mode: UploadMode;
  remark?: string | null;
}

export interface UploadBatch {
  id: string;
  project_id: string;
  batch_no: string;
  drone_type: string | null;
  upload_mode: UploadMode;
  photo_count: number;
  uploaded_by: string;
  uploaded_at: string;
  remark: string | null;
}

export interface Photo {
  id: string;
  project_id: string;
  upload_batch_id: string;
  original_filename: string;
  file_ext: string | null;
  file_size: number | null;
  mime_type: string | null;
  storage_bucket: string;
  storage_object_key: string;
  thumbnail_object_key: string | null;
  image_width: number | null;
  image_height: number | null;
  relative_altitude: number | null;
  gimbal_yaw_degree: number | null;
  facade_orientation: string | null;
  photo_type: PhotoType;
  status: PhotoStatus;
  precheck_status: PhotoPrecheckStatus;
  precheck_category: string | null;
  precheck_reason: string | null;
  precheck_model: string | null;
  precheck_error: string | null;
  precheck_attempts: number;
  prechecked_at: string | null;
  preview_url: string | null;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface DetectionConfig {
  id: string | null;
  project_id: string;
  model_types: DefectType[];
  high_precision: boolean;
  config_json: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface DetectionConfigPayload {
  model_types: DefectType[];
  config_json?: Record<string, unknown> | null;
}

export interface DetectionTask {
  id: string;
  project_id: string;
  detection_config_id: string | null;
  task_no: string;
  status: DetectionTaskStatus;
  photo_count: number;
  worker_id: string | null;
  locked_at: string | null;
  worker_heartbeat_at: string | null;
  lease_expires_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  failed_reason: string | null;
  retry_count: number;
  model_version: string | null;
  result_summary: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface StartDetectionPayload {
  model_types: Array<"crack" | "spalling" | "hollow">;
  facade_type?: "tile" | "coating" | "stone";
}
