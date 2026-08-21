import type { ProjectStatus } from "@/types/projects";

export type ProfessionalDisplayStatus = "draft" | "detecting" | "completed";

export interface ProfessionalDisplayState {
  status: ProfessionalDisplayStatus;
  statusLabel: string;
}

interface ProfessionalEstimatedCompletionSource {
  id: string;
  photo_count: number;
  created_at: string;
  started_at: string | null;
}

interface ProfessionalDetectionSource {
  status: ProjectStatus;
}

export function getProfessionalDisplayState(project: ProfessionalDetectionSource): ProfessionalDisplayState {
  if (project.status === "draft") {
    return {
      status: "draft",
      statusLabel: "等待开始"
    };
  }

  if (project.status === "reviewed" || project.status === "completed") {
    return {
      status: "completed",
      statusLabel: "已完成"
    };
  }

  return {
    status: "detecting",
    statusLabel: "检测中"
  };
}

export function getProfessionalEstimatedCompletionAt(
  project: ProfessionalEstimatedCompletionSource
): string | null {
  const photoCount = Math.max(0, project.photo_count);
  const durationHours = photoCount <= 50
    ? 24
    : photoCount <= 100
      ? 48
      : photoCount <= 200
        ? 72
        : 96;
  const referenceTime = project.started_at ?? project.created_at;
  const referenceTimestamp = Date.parse(referenceTime);
  if (!Number.isFinite(referenceTimestamp)) return null;

  const variationMinutes = getStableEstimateVariationMinutes(project.id);
  const estimatedTimestamp = referenceTimestamp
    + durationHours * 60 * 60 * 1000
    + variationMinutes * 60 * 1000;
  return new Date(estimatedTimestamp).toISOString();
}

function getStableEstimateVariationMinutes(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 121 - 60;
}

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: "待检测",
  queued: "检测中",
  detecting: "检测中",
  pending_review: "检测中",
  reviewed: "已完成",
  completed: "已完成"
};

export const PROJECT_STATUS_TONES: Record<ProjectStatus, "success" | "warning" | "danger"> = {
  draft: "warning",
  queued: "warning",
  detecting: "warning",
  pending_review: "warning",
  reviewed: "success",
  completed: "success"
};

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  })
    .format(new Date(value))
    .replace(/\//g, "-");
}

export function formatEstimatedRemainingTime(value: string | null | undefined, now = Date.now()) {
  const estimatedTimestamp = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(estimatedTimestamp)) return "--";

  const remainingMinutes = Math.max(1, Math.ceil((estimatedTimestamp - now) / (60 * 1000)));
  if (remainingMinutes < 60) return "预计等待少于1小时";

  const hours = Math.floor(remainingMinutes / 60);
  return `预计等待超过${hours}小时`;
}

export function formatLocation(project: {
  province?: string | null;
  city?: string | null;
  district?: string | null;
  address?: string | null;
}) {
  const region = [project.province, project.city, project.district]
    .filter(Boolean)
    .join(" ");
  return [region, project.address].filter(Boolean).join(" · ") || "-";
}
