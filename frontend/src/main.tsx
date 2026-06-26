import { HeroUIProvider } from "@heroui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { AuthBootstrap } from "@/components/auth/AuthBootstrap";
import { router } from "@/router";
import "@/styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000
    }
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HeroUIProvider>
      <QueryClientProvider client={queryClient}>
        <AuthBootstrap>
          <RouterProvider router={router} />
        </AuthBootstrap>
      </QueryClientProvider>
    </HeroUIProvider>
  </React.StrictMode>
);
