import { useIsFetching } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useAuthStore } from "@/stores/useAuthStore";

type LoaderStage = "loading" | "leaving" | "ready";

const BACKGROUND_URL_PATTERN = /url\((?:"([^"]+)"|'([^']+)'|([^)'"\s]+))\)/g;

function afterNextPaint() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

function collectVisualImageUrls(root: HTMLElement) {
  const urls = new Set<string>();
  const elements: HTMLElement[] = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];

  root.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    const source = image.currentSrc || image.src;
    if (source) urls.add(source);
  });

  elements.forEach((element) => {
    const backgroundImage = window.getComputedStyle(element).backgroundImage;
    if (!backgroundImage || backgroundImage === "none") return;

    BACKGROUND_URL_PATTERN.lastIndex = 0;
    let match = BACKGROUND_URL_PATTERN.exec(backgroundImage);
    while (match) {
      const source = match[1] || match[2] || match[3];
      if (source) urls.add(new URL(source, window.location.href).href);
      match = BACKGROUND_URL_PATTERN.exec(backgroundImage);
    }
  });

  return urls;
}

function preloadImage(source: string) {
  return new Promise<void>((resolve) => {
    const image = new Image();
    const finish = () => resolve();

    image.addEventListener("load", () => {
      if (typeof image.decode === "function") {
        void image.decode().catch(() => undefined).finally(finish);
        return;
      }
      finish();
    }, { once: true });
    image.addEventListener("error", finish, { once: true });
    image.src = source;

    if (image.complete) finish();
  });
}

function prepareVideo(video: HTMLVideoElement) {
  return new Promise<void>((resolve) => {
    if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      resolve();
      return;
    }

    const finish = () => {
      video.removeEventListener("canplay", finish);
      video.removeEventListener("error", finish);
      video.removeEventListener("abort", finish);
      resolve();
    };

    video.preload = "auto";
    video.addEventListener("canplay", finish, { once: true });
    video.addEventListener("error", finish, { once: true });
    video.addEventListener("abort", finish, { once: true });
    if (video.networkState === HTMLMediaElement.NETWORK_EMPTY) video.load();
  });
}

async function prepareCurrentPageVisuals() {
  await afterNextPaint();
  const root = document.getElementById("root");
  if (!root) return;

  const imageUrls = collectVisualImageUrls(root);
  const videos = Array.from(root.querySelectorAll<HTMLVideoElement>("video"));
  const fontReady = document.fonts?.ready ?? Promise.resolve();

  await Promise.allSettled([
    fontReady,
    ...Array.from(imageUrls, preloadImage),
    ...videos.map(prepareVideo)
  ]);
}

export function AppVisualLoader() {
  const activeRequestCount = useIsFetching();
  const authStatus = useAuthStore((state) => state.status);
  const [mayPrepareVisuals, setMayPrepareVisuals] = useState(false);
  const [stage, setStage] = useState<LoaderStage>("loading");

  useEffect(() => {
    if (mayPrepareVisuals || authStatus === "loading" || activeRequestCount > 0) return undefined;

    const settleTimer = window.setTimeout(() => {
      setMayPrepareVisuals(true);
    }, 160);

    return () => window.clearTimeout(settleTimer);
  }, [activeRequestCount, authStatus, mayPrepareVisuals]);

  useEffect(() => {
    if (!mayPrepareVisuals) return undefined;

    let cancelled = false;
    void prepareCurrentPageVisuals().then(() => {
      if (!cancelled) setStage("leaving");
    });
    return () => {
      cancelled = true;
    };
  }, [mayPrepareVisuals]);

  useEffect(() => {
    if (stage !== "leaving") return undefined;
    const leaveTimer = window.setTimeout(() => setStage("ready"), 220);
    return () => window.clearTimeout(leaveTimer);
  }, [stage]);

  if (stage === "ready") return null;

  return (
    <div
      aria-label="正在加载页面资源"
      aria-live="polite"
      className={`app-visual-loader${stage === "leaving" ? " is-leaving" : ""}`}
      role="status"
    >
      <span className="app-loading-spinner" aria-hidden="true" />
    </div>
  );
}
