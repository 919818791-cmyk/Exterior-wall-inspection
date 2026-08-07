import type { ProjectStatus } from "@/types/projects";

const PROFESSIONAL_QUEUE_DURATION_MS = 60 * 60 * 1000;
const PROFESSIONAL_LATE_QUEUE_DURATION_MS = 15 * 60 * 60 * 1000;
const PROFESSIONAL_PHOTO_STEP_MS = 6 * 60 * 1000;

export type ProfessionalDisplayStatus = "draft" | "queued" | "detecting" | "generating" | "completed";

export interface ProfessionalDetectionProgress {
  detectedPhotoCount: number;
  status: ProfessionalDisplayStatus;
  statusLabel: string;
  totalPhotoCount: number;
  progressLabel: string;
}

interface ProfessionalDetectionSource {
  status: ProjectStatus;
  started_at: string | null;
  photo_count: number;
  valid_photo_count: number;
}

function professionalQueueDurationMs(startedAt: number) {
  const beijingHour = Number(new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    hour12: false
  }).format(new Date(startedAt)));
  return beijingHour >= 17
    ? PROFESSIONAL_LATE_QUEUE_DURATION_MS
    : PROFESSIONAL_QUEUE_DURATION_MS;
}

export function getProfessionalDetectionProgress(
  project: ProfessionalDetectionSource,
  now = Date.now()
): ProfessionalDetectionProgress {
  const totalPhotoCount = Math.max(0, project.valid_photo_count || project.photo_count);
  const completedProgress = totalPhotoCount > 0 ? `${totalPhotoCount}/${totalPhotoCount}` : "--";

  if (project.status === "draft") {
    return {
      detectedPhotoCount: 0,
      status: "draft",
      statusLabel: "待检测",
      totalPhotoCount,
      progressLabel: "--"
    };
  }

  if (project.status === "reviewed" || project.status === "completed") {
    return {
      detectedPhotoCount: totalPhotoCount,
      status: "completed",
      statusLabel: "已完成",
      totalPhotoCount,
      progressLabel: completedProgress
    };
  }

  const startedAt = project.started_at ? Date.parse(project.started_at) : Number.NaN;
  if (!Number.isFinite(startedAt)) {
    const fallbackStatus = project.status === "queued" ? "queued" : "detecting";
    return {
      detectedPhotoCount: 0,
      status: fallbackStatus,
      statusLabel: fallbackStatus === "queued" ? "排队中" : "检测中",
      totalPhotoCount,
      progressLabel: `0/${totalPhotoCount}`
    };
  }

  const elapsed = Math.max(0, now - startedAt);
  const queueDurationMs = professionalQueueDurationMs(startedAt);
  if (elapsed < queueDurationMs) {
    return {
      detectedPhotoCount: 0,
      status: "queued",
      statusLabel: "排队中",
      totalPhotoCount,
      progressLabel: `0/${totalPhotoCount}`
    };
  }

  const detectedPhotoCount = Math.min(
    totalPhotoCount,
    Math.floor((elapsed - queueDurationMs) / PROFESSIONAL_PHOTO_STEP_MS)
  );
  if (totalPhotoCount > 0 && detectedPhotoCount >= totalPhotoCount) {
    return {
      detectedPhotoCount: totalPhotoCount,
      status: "generating",
      statusLabel: "生成中",
      totalPhotoCount,
      progressLabel: "正在汇总结果"
    };
  }

  return {
    detectedPhotoCount,
    status: "detecting",
    statusLabel: "检测中",
    totalPhotoCount,
    progressLabel: `${detectedPhotoCount}/${totalPhotoCount}`
  };
}

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: "待检测",
  queued: "排队中",
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
