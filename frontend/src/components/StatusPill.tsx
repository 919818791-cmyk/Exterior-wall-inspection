import { Chip } from "@heroui/react";
import { CheckCircle2, Clock3, ServerOff } from "lucide-react";

type StatusPillTone = "success" | "warning" | "danger";

interface StatusPillProps {
  tone: StatusPillTone;
  children: string;
}

const iconMap = {
  success: CheckCircle2,
  warning: Clock3,
  danger: ServerOff
};

export function StatusPill({ tone, children }: StatusPillProps) {
  const Icon = iconMap[tone];

  return (
    <Chip
      classNames={{
        base: "rounded-md border px-2",
        content: "font-semibold"
      }}
      color={tone}
      size="sm"
      startContent={<Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      variant="flat"
    >
      {children}
    </Chip>
  );
}
