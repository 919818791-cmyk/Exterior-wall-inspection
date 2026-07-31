import { apiRequest } from "@/api/client";
import type {
  AuthUser,
  CurrentUserUpdatePayload,
  LoginResponse,
  TrialApplicationPayload,
  TrialApplicationResponse
} from "@/types/auth";

export function login(payload: { identity: string; password: string }) {
  return apiRequest<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getCurrentUser() {
  return apiRequest<AuthUser>("/auth/me");
}

export function updateCurrentUser(payload: CurrentUserUpdatePayload) {
  return apiRequest<AuthUser>("/auth/me", {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function createTrialApplication(payload: TrialApplicationPayload, idempotencyKey?: string) {
  const headers = new Headers();
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  return apiRequest<TrialApplicationResponse>("/auth/trial-application", {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
}

export function changePassword(payload: { current_password: string; new_password: string }) {
  return apiRequest<{ ok: boolean }>("/auth/change-password", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function logout() {
  return apiRequest<{ ok: boolean }>("/auth/logout", { method: "POST" });
}
