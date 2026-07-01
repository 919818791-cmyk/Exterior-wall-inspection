import { Spinner } from "@heroui/react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuthStore } from "@/stores/useAuthStore";
import type { UserRole } from "@/types/auth";

function LoadingScreen() {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 text-slate-600">
      <div className="flex items-center gap-3 text-sm font-bold">
        <Spinner color="primary" size="sm" />
        正在恢复登录状态…
      </div>
    </div>
  );
}

export function RequireAuth() {
  const location = useLocation();
  const status = useAuthStore((state) => state.status);

  if (status === "loading") return <LoadingScreen />;
  if (status !== "authenticated") {
    const redirect = `${location.pathname}${location.search}${location.hash}`;
    const search = new URLSearchParams({ login: "1", redirect }).toString();
    return <Navigate replace state={{ from: location }} to={`/?${search}`} />;
  }
  return <Outlet />;
}

export function RequireRole({ fallbackTo = "/", roles }: { fallbackTo?: string; roles: UserRole[] }) {
  const user = useAuthStore((state) => state.user);
  const status = useAuthStore((state) => state.status);

  if (status === "loading") return <LoadingScreen />;
  if (!user || !roles.includes(user.role)) return <Navigate replace to={fallbackTo} />;
  return <Outlet />;
}
