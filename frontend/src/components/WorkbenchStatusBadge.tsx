import { CircleCheckBig, CircleDashed, Clock3, FileOutput, ScanSearch } from "lucide-react";

export type WorkbenchStatusVariant = "draft" | "queued" | "detecting" | "processing" | "generating" | "completed";

const statusClassNames: Record<WorkbenchStatusVariant, string> = {
  draft: "project-status-draft",
  queued: "project-status-queued",
  detecting: "project-status-detecting",
  processing: "project-status-processing",
  generating: "project-status-generating",
  completed: "project-status-completed"
};

const statusIcons = {
  draft: CircleDashed,
  queued: Clock3,
  detecting: ScanSearch,
  processing: ScanSearch,
  generating: FileOutput,
  completed: CircleCheckBig
} satisfies Record<WorkbenchStatusVariant, typeof CircleCheckBig>;

interface WorkbenchStatusBadgeProps {
  className?: string;
  label: string;
  variant: WorkbenchStatusVariant;
}

export function WorkbenchStatusBadge({ className = "", label, variant }: WorkbenchStatusBadgeProps) {
  const StatusIcon = statusIcons[variant];

  return <span
    aria-label={`当前状态：${label}`}
    className={`project-row-status-icon ${statusClassNames[variant]} ${className}`.trim()}
    title={label}
  >
    <StatusIcon aria-hidden="true" />
    <span className="project-status-label">{label}</span>
  </span>;
}
