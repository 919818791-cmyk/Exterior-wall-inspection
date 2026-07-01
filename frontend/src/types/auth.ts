export type UserRole = "customer" | "reviewer" | "admin";
export type UserStatus = "active" | "disabled";

export interface AuthUser {
  id: string;
  username: string;
  real_name: string | null;
  role: UserRole;
  organization: string | null;
}

export interface AccountUser extends AuthUser {
  phone: string | null;
  status: UserStatus;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
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
