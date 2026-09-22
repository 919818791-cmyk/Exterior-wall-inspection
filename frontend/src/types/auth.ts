export type UserRole = "customer" | "reviewer" | "admin";
export type UserStatus = "active" | "disabled";
export type AccountPlan = "basic" | "professional";
export type ProfessionalApplicationStatus = "pending" | "approved" | "rejected";

export interface AuthUser {
  id: string;
  username: string;
  real_name: string | null;
  phone: string | null;
  role: UserRole;
  account_plan: AccountPlan;
  professional_application_status: ProfessionalApplicationStatus | null;
  professional_plan_expires_at: string | null;
  organization: string | null;
}

export interface AccountUser extends AuthUser {
  detection_quota: number | null;
  status: UserStatus;
  professional_application_requested_at: string | null;
  professional_application_reviewed_at: string | null;
  professional_application_duration_months: 6 | 12 | null;
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
  account_plan: AccountPlan;
  detection_quota?: number | null;
  organization?: string | null;
  status: UserStatus;
}

export type AccountUpdatePayload = Partial<Omit<AccountCreatePayload, "password">>;

export interface ProfessionalApplicationResponse {
  ok: boolean;
  status: "pending";
  requested_at: string;
}

export interface ProfessionalApplicationReviewPayload {
  decision: "approved" | "rejected";
  duration_months: 6 | 12;
}

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
