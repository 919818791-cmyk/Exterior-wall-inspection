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
  tile_spalling_prompt: string;
  tile_visible_prompt: string;
  tile_thermal_prompt: string;
  coating_crack_prompt: string;
  coating_spalling_prompt: string;
  coating_visible_prompt: string;
  coating_thermal_prompt: string;
  stone_crack_prompt: string;
  stone_spalling_prompt: string;
  stone_visible_prompt: string;
  stone_thermal_prompt: string;
}

export interface TrialInferenceSetting {
  provider: TrialInferenceProvider;
  global_job_concurrency: number;
  request_concurrency: number;
  daily_api_request_limit: number;
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

export interface TrialInferenceSettingUpdate {
  provider: TrialInferenceProvider;
  global_job_concurrency: number;
  request_concurrency: number;
  daily_api_request_limit: number;
  generate_limit_per_user: number;
  visible_prompt: string;
  crack_prompt: string;
  spalling_prompt: string;
  thermal_prompt: string;
  photo_guard_prompt: string;
  formal_prompts: FormalDetectionPromptSettings;
}
