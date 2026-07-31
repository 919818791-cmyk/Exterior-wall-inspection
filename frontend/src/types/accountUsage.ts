export type AccountUsagePeriod = "week" | "month";

export interface AccountUsageTotals {
  task_count: number;
  formal_task_count: number;
  trial_task_count: number;
  api_request_count: number;
  token_count: number;
  input_token_count: number;
  output_token_count: number;
}

export interface AccountUsagePeriodMetrics extends AccountUsageTotals {
  label: string;
  start_date: string;
  end_date: string;
}

export interface AccountUsageSummaryItem extends AccountUsageTotals {
  account_id: string;
}

export interface AccountUsageDetailResponse {
  account_id: string;
  period: AccountUsagePeriod;
  current: AccountUsagePeriodMetrics;
  history: AccountUsagePeriodMetrics[];
  all_time: AccountUsageTotals;
}

export interface AccountQuotaBalance {
  limit: number;
  used: number;
  remaining: number;
}

export interface CurrentAccountUsageResponse {
  account_id: string;
  period_start: string;
  period_end: string;
  usage: AccountUsageTotals;
  trial_api_request_balance: AccountQuotaBalance;
}
