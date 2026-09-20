export type TrialInferenceProvider = "qwen" | "qwen3_vl_flash" | "zhipu" | "local_qwen";
export type LocalQwenRuntimeStatus = "running" | "starting" | "stopped" | "disabled" | "error";

export interface TrialInferenceProviderOption {
  provider: TrialInferenceProvider;
  label: string;
  model: string;
  configured: boolean;
  runtime_status: LocalQwenRuntimeStatus | null;
  runtime_message: string | null;
}

export interface FormalDetectionPromptSettings {
  tile_crack_prompt: string;
  tile_detachment_prompt: string;
  tile_crack_detachment_prompt: string;
  tile_thermal_prompt: string;
  coating_crack_prompt: string;
  coating_peeling_prompt: string;
  coating_crack_peeling_prompt: string;
  coating_thermal_prompt: string;
  plaster_crack_prompt: string;
  plaster_spalling_prompt: string;
  plaster_visible_prompt: string;
  plaster_thermal_prompt: string;
  panel_damage_prompt: string;
  panel_detachment_prompt: string;
  curtain_wall_damage_prompt: string;
}

export interface TrialInferenceSetting {
  provider: TrialInferenceProvider;
  global_job_concurrency: number;
  request_concurrency: number;
  monthly_photo_upload_limit: number;
  basic_formal_monthly_photo_upload_limit: number;
  professional_monthly_photo_upload_limit: number;
  professional_trial_monthly_photo_upload_limit: number;
  generate_limit_per_user: number;
  visible_prompt: string;
  crack_prompt: string;
  spalling_prompt: string;
  thermal_prompt: string;
  photo_guard_prompt: string;
  formal_prompts: FormalDetectionPromptSettings;
  options: TrialInferenceProviderOption[];
  updated_at: string | null;
}

export interface TrialInferenceDisclosure {
  provider: TrialInferenceProvider;
  label: string;
  is_cloud: boolean;
  recipient: string;
  privacy_policy_url: string | null;
}

export interface PricingQuotaSetting {
  monthly_photo_upload_limit: number;
  basic_formal_monthly_photo_upload_limit: number;
  professional_monthly_photo_upload_limit: number;
  professional_trial_monthly_photo_upload_limit: number;
}

export interface TrialInferenceSettingUpdate {
  provider: TrialInferenceProvider;
  global_job_concurrency: number;
  request_concurrency: number;
  monthly_photo_upload_limit: number;
  basic_formal_monthly_photo_upload_limit: number;
  professional_monthly_photo_upload_limit: number;
  professional_trial_monthly_photo_upload_limit: number;
  generate_limit_per_user: number;
  visible_prompt: string;
  crack_prompt: string;
  spalling_prompt: string;
  thermal_prompt: string;
  photo_guard_prompt: string;
  formal_prompts: FormalDetectionPromptSettings;
}
