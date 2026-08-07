import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL("..", import.meta.url)), "");
  const amapSecurityCode = env.AMAP_SECURITY_JS_CODE?.trim();
  const backendApiTarget = env.BACKEND_DEV_SERVER_URL?.trim() || "http://127.0.0.1:8000";
  const withAmapSecurityCode = (path: string) => {
    const upstreamPath = path.replace(/^\/_AMapService/, "") || "/";
    if (!amapSecurityCode) return upstreamPath;
    return `${upstreamPath}${upstreamPath.includes("?") ? "&" : "?"}jscode=${encodeURIComponent(amapSecurityCode)}`;
  };

  return {
    envDir: "..",
    plugins: [react()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url))
      }
    },
    server: {
      port: 5175,
      strictPort: true,
      proxy: {
        "/api": {
          target: backendApiTarget,
          changeOrigin: true
        },
        ...(amapSecurityCode ? {
        "/_AMapService/v4/map/styles": {
          target: "https://webapi.amap.com",
          changeOrigin: true,
          rewrite: withAmapSecurityCode
        },
        "/_AMapService": {
          target: "https://restapi.amap.com",
          changeOrigin: true,
          rewrite: withAmapSecurityCode
        }
        } : {})
      }
    },
    preview: {
      port: 5175,
      strictPort: true,
      proxy: {
        "/api": {
          target: backendApiTarget,
          changeOrigin: true
        }
      }
    }
  };
});
