import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL("..", import.meta.url)), "");
  const amapSecurityCode = env.AMAP_SECURITY_JS_CODE?.trim();
  const configuredTarget = (name: string) => {
    const value = env[name]?.trim();
    if (!value) return "";
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw new Error(`${name} must be an HTTP(S) URL without embedded credentials.`);
    }
    return value;
  };
  const backendApiTarget = configuredTarget("BACKEND_DEV_SERVER_URL");
  const amapWebApiTarget = configuredTarget("AMAP_WEB_API_URL");
  const amapRestApiTarget = configuredTarget("AMAP_REST_API_URL");
  if (command === "serve" && !backendApiTarget) {
    throw new Error("Configure BACKEND_DEV_SERVER_URL in the root .env before starting Vite.");
  }
  if (command === "serve" && amapSecurityCode && (!amapWebApiTarget || !amapRestApiTarget)) {
    throw new Error("Configure AMAP_WEB_API_URL and AMAP_REST_API_URL when the AMap proxy is enabled.");
  }
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
        ...(backendApiTarget ? {
          "/api": { target: backendApiTarget, changeOrigin: true }
        } : {}),
        ...(amapSecurityCode && amapWebApiTarget && amapRestApiTarget ? {
          "/_AMapService/v4/map/styles": {
            target: amapWebApiTarget,
            changeOrigin: true,
            rewrite: withAmapSecurityCode
          },
          "/_AMapService": {
            target: amapRestApiTarget,
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
        ...(backendApiTarget ? {
          "/api": { target: backendApiTarget, changeOrigin: true }
        } : {})
      }
    }
  };
});
