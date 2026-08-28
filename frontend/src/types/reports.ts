import type { InspectionReportStatus } from "@/types/review";

export interface ReportListItem {
  id: string;
  source_type: "formal" | "trial";
  project_id: string | null;
  detection_task_id: string | null;
  report_no: string;
  title: string;
  status: InspectionReportStatus;
  is_example: boolean;
  project_name: string;
  client_name: string | null;
  address: string | null;
  total_defects: number;
  by_defect_type: Record<string, number>;
  model_types: string[];
  photo_count: number;
  first_photo_url: string | null;
  generated_at: string;
  pushed_at: string | null;
  updated_at: string;
}

export interface ReportProjectSnapshot {
  id?: string;
  project_no?: string;
  name?: string;
  client_name?: string | null;
  province?: string | null;
  city?: string | null;
  district?: string | null;
  address?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface ReportPhotoSnapshot {
  id?: string;
  original_filename?: string | null;
  file_size?: number | null;
  mime_type?: string | null;
  image_width?: number | null;
  image_height?: number | null;
  camera_make?: string | null;
  camera_model?: string | null;
  camera_product_name?: string | null;
  drone_model?: string | null;
  camera_image_source?: string | null;
  relative_altitude?: number | string | null;
  gimbal_yaw_degree?: number | string | null;
  calibrated_focal_length?: number | string | null;
  focal_length_mm?: number | string | null;
  focal_length_35mm?: number | string | null;
  lrf_target_distance?: number | string | null;
  facade_orientation?: string | null;
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
  defect_no?: string | null;
  photo_id?: string;
  photo_filename?: string | null;
  photo_preview_url?: string | null;
  photo_thumbnail_url?: string | null;
  defect_type?: string;
  bbox_json?: {
    x?: number | string;
    y?: number | string;
    width?: number | string;
    height?: number | string;
  };
  severity?: string | null;
  area?: number | string | null;
  area_estimated?: boolean;
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

export interface ModelTokenDetails {
  text_tokens?: number | null;
  image_tokens?: number | null;
  video_tokens?: number | null;
  cached_tokens?: number | null;
  reasoning_tokens?: number | null;
}

export interface ModelTokenUsage {
  request_count?: number | null;
  reported_request_count?: number | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  prompt_tokens_details?: ModelTokenDetails | null;
  completion_tokens_details?: ModelTokenDetails | null;
}

export interface ModelTileTokenUsage {
  tile_index?: number | null;
  x?: number | null;
  y?: number | null;
  valid_width?: number | null;
  valid_height?: number | null;
  token_usage?: ModelTokenUsage | null;
}

export interface ModelOutputPhoto {
  photo_id?: string | null;
  filename?: string | null;
  image_width?: number | string | null;
  image_height?: number | string | null;
  upstream_model?: string | null;
  model_version?: string | null;
  requested_models?: string[];
  executed_models?: string[];
  tile_width?: number | string | null;
  tile_height?: number | string | null;
  tile_overlap_ratio?: number | string | null;
  tile_count?: number | string | null;
  task_duration_seconds?: number | string | null;
  token_usage?: ModelTokenUsage | null;
  tile_token_usages?: ModelTileTokenUsage[];
  deduplication_method?: string | null;
  cross_tile_merge_method?: string | null;
  cross_tile_merge_ios_threshold?: number | string | null;
  pre_merge_detection_count?: number | string | null;
  post_merge_detection_count?: number | string | null;
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
  is_example: boolean;
  report_data_json: Record<string, unknown> | null;
  project: ReportProjectSnapshot;
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
