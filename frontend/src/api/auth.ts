import { apiRequest } from "@/api/client";
import type { AuthUser, LoginResponse } from "@/types/auth";

export function login(payload: { username: string; password: string }) {
  return apiRequest<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getCurrentUser() {
  return apiRequest<AuthUser>("/auth/me");
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
