import type { ReportDetail } from "@/types/reports";

export interface AnnotationBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ManagedAnnotation {
  id: string;
  source_annotation_id: string | null;
  defect_type: string;
  bbox: AnnotationBBox;
  confidence: number | null;
}

export interface AnnotationPhotoEdit {
  id: string;
  source_type: "formal";
  result_id: string;
  photo_key: string;
  annotations: ManagedAnnotation[];
  edited_by: string;
  created_at: string;
  updated_at: string;
}

export interface ReviewAnnotationDetail {
  result: ReportDetail;
  edits: AnnotationPhotoEdit[];
}

export interface SaveReviewAnnotationsPayload {
  photo_key: string;
  annotations: ManagedAnnotation[];
}
