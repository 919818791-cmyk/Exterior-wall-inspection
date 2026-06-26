import { type ReactNode, useEffect } from "react";

import { useAuthStore } from "@/stores/useAuthStore";

export function AuthBootstrap({ children }: { children: ReactNode }) {
  const restoreSession = useAuthStore((state) => state.restoreSession);

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  return <>{children}</>;
}
