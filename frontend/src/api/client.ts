import { getAuthToken } from "@/auth/storage";

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000/api";

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL
).replace(/\/$/, "");

export interface ApiUploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export async function apiRequest<TResponse>(
  path: string,
  init: RequestInit = {}
): Promise<TResponse> {
  const response = await apiFetch(path, init);

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "message" in payload
        ? String((payload as { message: unknown }).message)
        : `API request failed with status ${response.status}`;

    throw new ApiError(message, response.status, payload);
  }

  return payload as TResponse;
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = getAuthToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  try {
    return await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  } catch (error) {
    throw new ApiError(
      `无法连接后端服务（${API_BASE_URL}），请确认后端已启动或 VITE_API_BASE_URL 配置正确。`,
      0,
      error
    );
  }
}

export function apiUploadRequest<TResponse>(
  path: string,
  body: FormData,
  init: {
    method?: string;
    onProgress?: (progress: ApiUploadProgress) => void;
  } = {}
): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(init.method ?? "POST", `${API_BASE_URL}${path}`);

    const token = getAuthToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = event.total > 0 ? Math.round((event.loaded / event.total) * 100) : 0;
      init.onProgress?.({
        loaded: event.loaded,
        total: event.total,
        percent: Math.min(100, Math.max(0, percent))
      });
    };

    xhr.onload = () => {
      const payload = parseXhrPayload(xhr);
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new ApiError(errorMessageFromPayload(payload, xhr.status), xhr.status, payload));
        return;
      }
      resolve(payload as TResponse);
    };

    xhr.onerror = () => {
      reject(new ApiError(
        `无法连接后端服务（${API_BASE_URL}），请确认后端已启动或 VITE_API_BASE_URL 配置正确。`,
        0,
        null
      ));
    };

    xhr.onabort = () => {
      reject(new ApiError("上传请求已取消。", 0, null));
    };

    xhr.send(body);
  });
}

function parseXhrPayload(xhr: XMLHttpRequest) {
  const contentType = xhr.getResponseHeader("content-type") ?? "";
  const text = xhr.responseText;
  if (!text) return null;
  if (!contentType.includes("application/json")) return text;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorMessageFromPayload(payload: unknown, status: number) {
  if (typeof payload === "object" && payload !== null) {
    if ("message" in payload) return String((payload as { message: unknown }).message);
    if ("detail" in payload) return readableDetail((payload as { detail: unknown }).detail);
  }
  return `API request failed with status ${status}`;
}

function readableDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => (
        typeof item === "object" && item !== null && "msg" in item
          ? String((item as { msg: unknown }).msg)
          : String(item)
      ))
      .join("；");
  }
  return String(detail);
}
