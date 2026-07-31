import { queryOptions } from "@tanstack/react-query";

import { apiRequest } from "@/api/client";
import type { AccountUsageDetailResponse, AccountUsagePeriod, AccountUsageSummaryItem, CurrentAccountUsageResponse } from "@/types/accountUsage";
import type { AccountCreatePayload, AccountUpdatePayload, AccountUser } from "@/types/auth";

export const accountsQueryOptions = queryOptions({
  queryKey: ["accounts"],
  queryFn: () => apiRequest<AccountUser[]>("/accounts")
});

export const accountUsageSummaryQueryOptions = queryOptions({
  queryKey: ["account-usage-summary"],
  queryFn: () => apiRequest<AccountUsageSummaryItem[]>("/accounts/usage-summary")
});

export const currentAccountUsageQueryOptions = queryOptions({
  queryKey: ["current-account-usage"],
  queryFn: () => apiRequest<CurrentAccountUsageResponse>("/accounts/me/usage"),
  staleTime: 0
});

export function accountUsageDetailQueryOptions(accountId: string, period: AccountUsagePeriod) {
  return queryOptions({
    queryKey: ["account-usage", accountId, period],
    queryFn: () => apiRequest<AccountUsageDetailResponse>(`/accounts/${accountId}/usage?period=${period}`)
  });
}

export function createAccount(payload: AccountCreatePayload) {
  return apiRequest<AccountUser>("/accounts", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateAccount(accountId: string, payload: AccountUpdatePayload) {
  return apiRequest<AccountUser>(`/accounts/${accountId}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function resetAccountPassword(accountId: string) {
  return apiRequest<AccountUser>(`/accounts/${accountId}/reset-password`, {
    method: "POST"
  });
}
