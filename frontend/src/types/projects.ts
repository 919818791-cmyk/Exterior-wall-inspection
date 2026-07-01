export type ProjectStatus =
  | "draft"
  | "detecting"
  | "pending_review"
  | "reviewed"
  | "completed";

export type DefectType = "crack" | "spalling" | "hollowing" | "leakage" | "corrosion";
export type PhotoType = "visible" | "thermal" | "dji" | "other";
export type UploadMode = "dji" | "visible" | "thermal" | "mixed";
export type PhotoStatus = "uploaded" | "detecting" | "detected" | "failed";
export type DetectionTaskStatus = "pending" | "running" | "success" | "failed" | "canceled";

export interface FacadePayload {
  name: string;
  area?: string | null;
  floors_range?: string | null;
  description?: string | null;
  sort_order?: number | null;
}

export interface BuildingPayload {
  name: string;
  building_no?: string | null;
  floors?: number | null;
  height?: string | null;
  structure_type?: string | null;
  usage_type?: string | null;
  built_year?: number | null;
  remark?: string | null;
  sort_order?: number | null;
  facades?: FacadePayload[];
}

export interface ProjectCreatePayload {
  name: string;
  client_name?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  province?: string | null;
  city?: string | null;
  district?: string | null;
  address?: string | null;
  longitude?: string | number | null;
  latitude?: string | number | null;
  buildings?: BuildingPayload[];
}

export type ProjectUpdatePayload = Partial<Omit<ProjectCreatePayload, "buildings">>;
export type BuildingUpdatePayload = Partial<Omit<BuildingPayload, "facades">>;
export type FacadeUpdatePayload = Partial<FacadePayload>;

export interface Facade {
  id: string;
  project_id: string;
  building_id: string;
  name: string;
  area: string | null;
  floors_range: string | null;
  description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Building {
  id: string;
  project_id: string;
  name: string;
  building_no: string | null;
  floors: number | null;
  height: string | null;
  structure_type: string | null;
  usage_type: string | null;
  built_year: number | null;
  remark: string | null;
  sort_order: number;
  facade_count: number;
  facades: Facade[];
  created_at: string;
  updated_at: string;
}

export interface ProjectListItem {
  id: string;
  project_no: string;
  name: string;
  client_name: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  province: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  longitude: string | null;
  latitude: string | null;
  status: ProjectStatus;
  building_count: number;
  photo_count: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectDetail extends ProjectListItem {
  current_task_id: string | null;
  current_report_id: string | null;
  current_task_status: DetectionTaskStatus | null;
  started_at: string | null;
  completed_at: string | null;
  buildings: Building[];
}

export interface UploadBatchPayload {
  building_id?: string | null;
  facade_id?: string | null;
  drone_type?: string | null;
  upload_mode: UploadMode;
  remark?: string | null;
}

export interface UploadBatch {
  id: string;
  project_id: string;
  building_id: string | null;
  facade_id: string | null;
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
  building_id: string | null;
  facade_id: string | null;
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
  photo_type: PhotoType;
  status: PhotoStatus;
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
  high_precision: boolean;
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
