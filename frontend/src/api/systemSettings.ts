import { queryOptions } from "@tanstack/react-query";

import { apiRequest } from "@/api/client";
import type { TrialInferenceDisclosure, TrialInferenceSetting, TrialInferenceSettingUpdate } from "@/types/systemSettings";

export const trialInferenceSettingQueryOptions = queryOptions({
  queryKey: ["system-settings", "trial-inference"],
  queryFn: () => apiRequest<TrialInferenceSetting>("/system-settings/trial-inference"),
  refetchInterval: (query) => query.state.data?.options.some((option) => option.runtime_status === "starting") ? 3000 : false
});

export const trialInferenceDisclosureQueryOptions = queryOptions({
  queryKey: ["system-settings", "trial-inference-disclosure"],
  queryFn: () => apiRequest<TrialInferenceDisclosure>("/system-settings/trial-inference-disclosure"),
  staleTime: 30_000
});

export function updateTrialInferenceSettings(payload: TrialInferenceSettingUpdate) {
  return apiRequest<TrialInferenceSetting>("/system-settings/trial-inference", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}
