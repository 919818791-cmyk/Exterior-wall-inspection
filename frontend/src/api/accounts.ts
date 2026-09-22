import { queryOptions } from "@tanstack/react-query";

import { apiRequest } from "@/api/client";
import type { AccountUsageDetailResponse, AccountUsagePeriod, CurrentAccountUsageResponse } from "@/types/accountUsage";
import type {
  AccountCreatePayload,
  AccountPasswordResetResponse,
  AccountUpdatePayload,
  AccountUser,
  ProfessionalApplicationResponse,
  ProfessionalApplicationReviewPayload
} from "@/types/auth";

export const accountsQueryOptions = queryOptions({
  queryKey: ["accounts"],
  queryFn: () => apiRequest<AccountUser[]>("/accounts")
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
  return apiRequest<AccountPasswordResetResponse>(`/accounts/${accountId}/reset-password`, {
    method: "POST"
  });
}

export function submitProfessionalApplication() {
  return apiRequest<ProfessionalApplicationResponse>("/accounts/me/professional-application", {
    method: "POST"
  });
}

export function reviewProfessionalApplication(accountId: string, payload: ProfessionalApplicationReviewPayload) {
  return apiRequest<AccountUser>(`/accounts/${accountId}/professional-application/review`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function resetAccountQuotas(accountId: string) {
  return apiRequest<{ ok: boolean; reset_at: string }>(`/accounts/${accountId}/reset-quotas`, {
    method: "POST"
  });
}
