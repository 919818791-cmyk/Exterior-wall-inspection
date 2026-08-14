import { CircleCheckBig, CircleDashed, Clock3, ScanSearch } from "lucide-react";

export type WorkbenchStatusVariant = "draft" | "queued" | "detecting" | "processing" | "completed";

const statusClassNames: Record<WorkbenchStatusVariant, string> = {
  draft: "project-status-draft",
  queued: "project-status-queued",
  detecting: "project-status-detecting",
  processing: "project-status-processing",
  completed: "project-status-completed"
};

const statusIcons = {
  draft: CircleDashed,
  queued: Clock3,
  detecting: ScanSearch,
  processing: ScanSearch,
  completed: CircleCheckBig
} satisfies Record<WorkbenchStatusVariant, typeof CircleCheckBig>;

interface WorkbenchStatusBadgeProps {
  className?: string;
  label: string;
  variant: WorkbenchStatusVariant;
}

export function WorkbenchStatusBadge({ className = "", label, variant }: WorkbenchStatusBadgeProps) {
  const StatusIcon = statusIcons[variant];
  const statusClassName = statusClassNames[variant];

  return <span
    aria-label={`当前状态：${label}`}
    className={`project-row-status ${statusClassName} ${className}`.trim()}
    title={label}
  >
    <span className={`project-row-status-icon ${statusClassName}`} aria-hidden="true">
      <StatusIcon />
    </span>
    <span className="project-status-label">{label}</span>
  </span>;
}
