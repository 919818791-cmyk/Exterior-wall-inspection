import { create } from "zustand";

import { getCurrentUser } from "@/api/auth";
import { clearAuthToken, getAuthToken, setAuthToken } from "@/auth/storage";
import type { AuthUser } from "@/types/auth";

type AuthStatus = "loading" | "authenticated" | "anonymous";

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  restoring: boolean;
  restoreSession: () => Promise<void>;
  setAuthenticated: (user: AuthUser, token: string) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "loading",
  user: null,
  restoring: false,
  restoreSession: async () => {
    if (get().restoring || get().status !== "loading") return;
    if (!getAuthToken()) {
      set({ status: "anonymous", user: null });
      return;
    }

    set({ restoring: true });
    try {
      const user = await getCurrentUser();
      set({ status: "authenticated", user });
    } catch {
      clearAuthToken();
      set({ status: "anonymous", user: null });
    } finally {
      set({ restoring: false });
    }
  },
  setAuthenticated: (user, token) => {
    setAuthToken(token);
    set({ status: "authenticated", user, restoring: false });
  },
  clearSession: () => {
    clearAuthToken();
    set({ status: "anonymous", user: null, restoring: false });
  }
}));
