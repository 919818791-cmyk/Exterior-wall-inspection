import { queryOptions } from "@tanstack/react-query";

import { apiRequest } from "@/api/client";
import type { AccountCreatePayload, AccountUpdatePayload, AccountUser } from "@/types/auth";

export const accountsQueryOptions = queryOptions({
  queryKey: ["accounts"],
  queryFn: () => apiRequest<AccountUser[]>("/accounts")
});

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
