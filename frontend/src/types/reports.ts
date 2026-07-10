import type { InspectionReportStatus } from "@/types/review";

export interface ReportListItem {
  id: string;
  source_type: "formal" | "trial";
  project_id: string | null;
  detection_task_id: string | null;
  report_no: string;
  title: string;
  status: InspectionReportStatus;
  project_name: string;
  client_name: string | null;
  address: string | null;
  total_defects: number;
  generated_at: string;
  pushed_at: string | null;
  updated_at: string;
}

export interface ReportProjectSnapshot {
  id?: string;
  project_no?: string;
  name?: string;
  client_name?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  province?: string | null;
  city?: string | null;
  district?: string | null;
  address?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface ReportFacadeSnapshot {
  id?: string;
  name?: string;
  area?: string | null;
  floors_range?: string | null;
  description?: string | null;
}

export interface ReportBuildingSnapshot {
  id?: string;
  name?: string;
  building_no?: string | null;
  floors?: number | null;
  height?: string | null;
  structure_type?: string | null;
  usage_type?: string | null;
  built_year?: number | null;
  facades?: ReportFacadeSnapshot[];
}

export interface ReportPhotoSnapshot {
  id?: string;
  original_filename?: string | null;
  file_size?: number | null;
  mime_type?: string | null;
  image_width?: number | null;
  image_height?: number | null;
  photo_type?: string | null;
  metadata_json?: {
    xmp_drone_dji_image_source?: string | null;
    ifd0_image_description?: string | null;
    thermal_imaging_available?: boolean | null;
    [key: string]: unknown;
  } | null;
  thermal_imaging_available?: boolean | null;
  preview_url?: string | null;
  thumbnail_url?: string | null;
}

export interface ReportDefectSnapshot {
  id?: string;
  photo_id?: string;
  photo_filename?: string | null;
  photo_preview_url?: string | null;
  photo_thumbnail_url?: string | null;
  building_name?: string | null;
  facade_name?: string | null;
  defect_type?: string;
  bbox_json?: {
    x?: number | string;
    y?: number | string;
    width?: number | string;
    height?: number | string;
  };
  severity?: string | null;
  area?: string | null;
  length?: string | null;
  status?: string;
  confidence?: string | null;
  model_version?: string | null;
  raw_result_json?: {
    finding?: {
      image_width?: number | string | null;
      image_height?: number | string | null;
      [key: string]: unknown;
    } | null;
    [key: string]: unknown;
  } | null;
  review_note?: string | null;
  reviewed_at?: string | null;
}

export interface ModelOutputDetection {
  id?: string | null;
  detection_id?: string | null;
  type?: string | null;
  type_name?: string | null;
  model?: string | null;
  confidence?: number | string | null;
  bbox?: {
    x?: number | string | null;
    y?: number | string | null;
    width?: number | string | null;
    height?: number | string | null;
  } | null;
  severity?: string | null;
  description?: string | null;
  visible?: boolean | null;
}

export interface ModelOutputPhoto {
  photo_id?: string | null;
  filename?: string | null;
  image_width?: number | string | null;
  image_height?: number | string | null;
  model_version?: string | null;
  requested_models?: string[];
  executed_models?: string[];
  tile_width?: number | string | null;
  tile_height?: number | string | null;
  tile_overlap_ratio?: number | string | null;
  tile_count?: number | string | null;
  deduplication_method?: string | null;
  nms_iou_threshold?: number | string | null;
  detections?: ModelOutputDetection[];
}

export interface ReportDetail {
  id: string;
  source_type: "formal" | "trial";
  project_id: string | null;
  detection_task_id: string | null;
  report_no: string;
  title: string;
  status: InspectionReportStatus;
  report_data_json: Record<string, unknown> | null;
  project: ReportProjectSnapshot;
  buildings: ReportBuildingSnapshot[];
  detection_config: {
    model_types?: string[];
    high_precision?: boolean;
    config_json?: Record<string, unknown> | null;
  } | null;
  detection_task: {
    id?: string | null;
    task_no?: string | null;
    model_version?: string | null;
    finished_at?: string | null;
  } | null;
  summary: {
    total_review_results?: number;
    by_defect_type?: Record<string, number>;
    by_status?: Record<string, number>;
    photo_count?: number;
    thermal_available_photo_count?: number;
    building_count?: number;
    facade_count?: number;
  };
  defects: ReportDefectSnapshot[];
  photos: ReportPhotoSnapshot[];
  raw_model_outputs: ModelOutputPhoto[];
  docx_bucket: string | null;
  docx_object_key: string | null;
  generated_by: string;
  generated_at: string;
  pushed_at: string | null;
  created_at: string;
  updated_at: string;
}
