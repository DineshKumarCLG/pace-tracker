import { AlertTriangle, Ban } from "lucide-react";
import type { StaleTask, BlockedTask } from "./reviewData";

interface NeedsAttentionProps {
  staleTasks: StaleTask[];
  blockedTasks: BlockedTask[];
}

export default function NeedsAttention({
  staleTasks,
  blockedTasks,
}: NeedsAttentionProps) {
  if (staleTasks.length === 0 && blockedTasks.length === 0) return null;

  return (
    <div
      className="glass noise rounded-xl p-4 animate-slide-up"
      style={{ animationDelay: "280ms" }}
    >
      <h3 className="text-[12px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
        Needs Attention
      </h3>
      <div className="space-y-2">
        {staleTasks.map((task) => (
          <div
            key={task.id}
            className="flex items-start gap-2.5 rounded-lg bg-amber-500/[0.06] border border-amber-500/10 px-3 py-2"
          >
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-[12px] font-medium truncate">{task.title}</p>
              <p className="text-[11px] text-muted-foreground">
                {task.projectName} · No activity in {task.daysSinceActivity} days
              </p>
            </div>
          </div>
        ))}
        {blockedTasks.map((task) => (
          <div
            key={task.id}
            className="flex items-start gap-2.5 rounded-lg bg-destructive/[0.06] border border-destructive/10 px-3 py-2"
          >
            <Ban className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-[12px] font-medium truncate">{task.title}</p>
              <p className="text-[11px] text-muted-foreground">
                {task.projectName} · Blocked
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
