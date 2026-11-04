import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import { prepareHeroMedia } from "./scripts/prepare-hero-media.mjs";

export default defineConfig(async ({ command, mode }) => {
  const heroMediaVersion = await prepareHeroMedia();
  const env = loadEnv(mode, fileURLToPath(new URL("..", import.meta.url)), "");
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
  if (command === "serve" && !backendApiTarget) {
    throw new Error("Configure BACKEND_DEV_SERVER_URL in the root .env before starting Vite.");
  }
  const backendProxy = backendApiTarget ? {
    "/api": { target: backendApiTarget },
    "/_AMapService": { target: backendApiTarget }
  } : {};

  return {
    envDir: "..",
    plugins: [react(), {
      name: "hero-poster-version",
      transformIndexHtml(html) {
        return html.replace('href="/images/optimized/hero-poster.webp"',
          `href="/images/optimized/hero-poster.webp?v=${heroMediaVersion}"`);
      }
    }],
    define: {
      "import.meta.env.VITE_HERO_MEDIA_VERSION": JSON.stringify(heroMediaVersion)
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url))
      }
    },
    server: {
      port: 5175,
      strictPort: true,
      proxy: backendProxy
    },
    preview: {
      port: 5175,
      strictPort: true,
      proxy: backendProxy
    }
  };
});
