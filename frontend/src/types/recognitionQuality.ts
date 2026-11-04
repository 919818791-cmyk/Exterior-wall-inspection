import type { AnnotationBBox } from "@/types/reviewAnnotations";

export interface QualityMetrics {
  tp: number; fp: number; fn: number; iou_sum: number;
  precision: number | null; recall: number | null; score: number | null; mean_iou: number | null;
}
export interface QualityRule { version: string; iou_threshold: number; matching: string; score: string }
export interface QualitySummary {
  metrics: QualityMetrics; by_type: Record<string, QualityMetrics>;
  total_photos: number; reviewed_photos: number; excluded_photos: number; pending_photos: number;
  coverage: number | null; empty_truth_photos: number; empty_correct_photos: number;
  complete: boolean; rule: QualityRule;
}
export interface QualityVersion {
  id: string; version: number; rule_version: string; summary: QualitySummary;
  created_at: string; created_by: string; input_revision: number;
}
export interface QualityProject {
  project_id: string; project_no: string; project_name: string; task_id: string; task_status: string;
  total_photos: number; reviewed_photos: number; excluded_photos: number; pending_photos: number;
  coverage: number | null; evaluation: QualityVersion | null; updated_at: string;
}
export interface QualityOverview {
  total_projects: number; evaluated_projects: number; evaluated_photos: number;
  total_photos: number; reviewed_photos: number; excluded_photos: number; coverage: number | null;
  metrics: QualityMetrics; by_type: Record<string, QualityMetrics>; rule: QualityRule;
  empty_truth_photos: number; empty_correct_photos: number;
}
export interface QualityCatalog {
  overview: QualityOverview; items: QualityProject[]; total: number; page: number; page_size: number;
}
export interface QualityBox {
  id: string; defect_type: string; bbox: AnnotationBBox; confidence?: number | null;
  model_version?: string | null; strategy_key?: string | null;
}
export interface QualityMatch {
  kind: "tp" | "fp" | "fn"; prediction: QualityBox | null; truth: QualityBox | null; iou: number | null;
}
export interface QualityPhoto {
  photo_key: string; photo_id: string; filename: string; width: number | null; height: number | null;
  predictions: QualityBox[]; truth: QualityBox[]; image_url: string | null;
  review_state: "pending" | "reviewed" | "excluded"; exclusion_reason: string | null;
  reviewed_by: string | null; reviewed_at: string | null;
  metrics: QualityMetrics | null; by_type: Record<string, QualityMetrics>; details: QualityMatch[];
}
export interface QualityDetail {
  project_id: string; project_name: string; project_no: string; task_id: string;
  evaluation: QualityVersion | null; history: QualityVersion[]; summary: QualitySummary | null;
  photos: QualityPhoto[]; unavailable_reason: string | null; needs_completion: boolean; rule: QualityRule;
}
