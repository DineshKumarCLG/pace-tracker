import { cn } from "@/lib/utils";
import type { TeamMemberStatus } from "@/types";

const dotColors: Record<TeamMemberStatus, string> = {
  active: "bg-emerald-400 shadow-emerald-400/40",
  on_break: "bg-amber-400 shadow-amber-400/40",
  away: "bg-gray-400 shadow-gray-400/20",
  offline: "bg-muted-foreground/30",
};

interface StatusDotProps {
  status: TeamMemberStatus;
  size?: "sm" | "md";
  pulse?: boolean;
}

export default function StatusDot({ status, size = "sm", pulse = false }: StatusDotProps) {
  const dim = size === "md" ? "h-2.5 w-2.5" : "h-1.5 w-1.5";
  const shouldPulse = pulse && status === "active";

  return (
    <span className={cn("relative inline-flex", dim)}>
      {shouldPulse && (
        <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-40", dotColors[status])} />
      )}
      <span className={cn("relative inline-flex rounded-full shadow-sm", dim, dotColors[status])} />
    </span>
  );
}
