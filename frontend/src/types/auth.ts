export type UserRole = "customer" | "reviewer" | "admin";

export interface AuthUser {
  id: string;
  username: string;
  real_name: string | null;
  role: UserRole;
  organization: string | null;
}

export interface LoginResponse {
  access_token: string;
  token_type: "bearer";
  expires_at: string;
  user: AuthUser;
}
