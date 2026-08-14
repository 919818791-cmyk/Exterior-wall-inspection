export type UserRole = "customer" | "reviewer" | "admin";
export type UserStatus = "active" | "disabled";

export interface AuthUser {
  id: string;
  username: string;
  real_name: string | null;
  phone: string | null;
  role: UserRole;
  organization: string | null;
}

export interface AccountUser extends AuthUser {
  status: UserStatus;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountPasswordResetResponse {
  account: AccountUser;
  temporary_password: string;
}

export interface AccountCreatePayload {
  username: string;
  password: string;
  real_name?: string | null;
  phone?: string | null;
  role: UserRole;
  organization?: string | null;
  status: UserStatus;
}

export type AccountUpdatePayload = Partial<Omit<AccountCreatePayload, "password">>;

export interface LoginResponse {
  access_token: string;
  token_type: "bearer";
  expires_at: string;
  user: AuthUser;
}

export interface CurrentUserUpdatePayload {
  real_name: string | null;
  phone: string | null;
  organization: string | null;
}

export interface TrialApplicationPayload {
  username: string;
  password: string;
  phone: string;
  verification_code: string;
}

export interface TrialApplicationResponse {
  ok: boolean;
  username: string;
  status: "active";
}

export interface UsernameAvailabilityResponse {
  username: string;
  available: boolean;
}

export interface RegistrationSmsCodeResponse {
  ok: boolean;
  retry_after_seconds: number;
}

export interface PasswordResetVerifyResponse {
  reset_token: string;
  expires_in_seconds: number;
}
