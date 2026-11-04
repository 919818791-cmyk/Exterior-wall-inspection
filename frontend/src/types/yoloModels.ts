export interface YoloModelVersion {
  id: string;
  model_id: string;
  version: string;
  description: string | null;
  original_filename: string;
  file_size: number;
  sha256: string;
  runtime_status: string;
  runtime_message: string;
  control_supported: boolean;
  created_at: string;
}

export interface YoloModel {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  versions: YoloModelVersion[];
}

export interface YoloModelCatalog {
  items: YoloModel[];
  max_upload_bytes: number;
  accepted_extensions: string[];
  inference_ready: boolean;
}

export interface YoloModelEdit {
  name: string;
  description: string;
}

export type YoloModelCreate = YoloModelEdit;

export interface YoloVersionEdit {
  version: string;
  description: string;
}
