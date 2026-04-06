import {
  Circle,
  ArrowRight,
  Check,
  Ban,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTaskStore } from "@/stores/taskStore";
import type { Task } from "@/types";

const statusIcons = {
  open: Circle,
  inprogress: ArrowRight,
  done: Check,
  blocked: Ban,
} as const;

const statusColors = {
  open: "text-muted-foreground",
  inprogress: "text-primary",
  done: "text-emerald-400",
  blocked: "text-destructive",
} as const;

const priorityColors = {
  high: "bg-red-400",
  medium: "bg-amber-400",
  low: "bg-emerald-400",
} as const;

interface TaskRowProps {
  task: Task;
  onClick?: (taskId: string) => void;
}

export default function TaskRow({ task, onClick }: TaskRowProps) {
  const activeTaskId = useTaskStore((s) => s.activeTaskId);
  const isActive = activeTaskId === task.id;

  const StatusIcon = statusIcons[task.status];

  return (
    <div
      onClick={() => onClick?.(task.id)}
      className={cn(
        "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-150",
        "hover:bg-accent/50 cursor-pointer",
        isActive && "bg-primary/[0.08]",
      )}
    >
      {/* Active task indicator — pulsing amber dot */}
      {isActive && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1">
          <span className="block h-2 w-2 rounded-full bg-primary animate-breathe" />
        </span>
      )}

      {/* Status icon */}
      <StatusIcon
        className={cn("h-4 w-4 shrink-0", statusColors[task.status])}
      />

      {/* Title */}
      <span
        className={cn(
          "flex-1 truncate text-[13px] font-medium",
          task.status === "done" && "line-through text-muted-foreground",
        )}
      >
        {task.title}
      </span>

      {/* Priority dot */}
      <span
        className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          priorityColors[task.priority],
        )}
        title={task.priority}
      />

      {/* Time logged placeholder */}
      {task.estimatedMinutes != null && (
        <span className="text-[11px] tabular-nums text-muted-foreground font-medium">
          {task.estimatedMinutes}m
        </span>
      )}
    </div>
  );
}
