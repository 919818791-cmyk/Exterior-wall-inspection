export type DataUsagePeriod = "week" | "month";

export interface UsagePeriodMetrics {
  label: string;
  start_date: string;
  end_date: string;
  photo_count: number;
  storage_bytes: number;
  storage_mb: number;
  api_request_count: number;
  token_count: number;
  input_token_count: number;
  output_token_count: number;
  trial_task_count: number;
}

export interface DataUsageResponse {
  period: DataUsagePeriod;
  current: UsagePeriodMetrics;
  history: UsagePeriodMetrics[];
  all_time: {
    photo_count: number;
    storage_bytes: number;
    storage_mb: number;
    api_request_count: number;
    token_count: number;
    input_token_count: number;
    output_token_count: number;
    trial_task_count: number;
  };
}
