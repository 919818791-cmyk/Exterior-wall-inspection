import type { ProjectStatus } from "@/types/projects";

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: "待检测",
  detecting: "AI检测中",
  pending_review: "结果处理中",
  reviewed: "报告生成中",
  completed: "已完成"
};

export const PROJECT_STATUS_TONES: Record<ProjectStatus, "success" | "warning" | "danger"> = {
  draft: "warning",
  detecting: "warning",
  pending_review: "warning",
  reviewed: "warning",
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
