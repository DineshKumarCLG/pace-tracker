import { cn } from "@/lib/utils";
import { useSessionStore } from "@/stores/sessionStore";
import { GitCommit } from "lucide-react";
import type { GitEvent } from "@/types";

interface ActivityTimelineProps {
  gitEvents?: GitEvent[];
}

export default function ActivityTimeline({ gitEvents = [] }: ActivityTimelineProps) {
  const session = useSessionStore((s) => s.session);
  const breakState = useSessionStore((s) => s.breakState);

  return (
    <div className="space-y-2.5">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
        Activity
      </h3>

      {/* Track — inset well for 3D depth */}
      <div className="rounded-lg p-[3px] inset-well">
        <div className="flex h-2 w-full overflow-hidden rounded-[5px]">
          {!session ? (
            <div className="h-full w-full" />
          ) : (
            <>
              <div className={cn(
                "h-full rounded-[5px] transition-all duration-700",
                "bg-gradient-to-r from-amber-400 to-amber-500",
                breakState.active ? "flex-[3]" : "flex-1",
              )} style={{ boxShadow: "0 0 6px rgba(200,150,30,0.35)" }} />
              {breakState.active && (
                <div className="h-full flex-1 rounded-[5px] bg-gradient-to-r from-orange-400 to-orange-500 ml-0.5 transition-all duration-700"
                  style={{ boxShadow: "0 0 6px rgba(220,100,20,0.35)" }} />
              )}
            </>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-4 text-[10px] font-medium text-muted-foreground/50">
        {[
          { label: "Work", color: "bg-amber-500" },
          { label: "Break", color: "bg-orange-500" },
          { label: "Away", color: "bg-muted-foreground/25" },
        ].map(({ label, color }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className={cn("inline-block h-1.5 w-1.5 rounded-full", color)} />
            {label}
          </div>
        ))}
      </div>

      {/* Git commit markers */}
      {gitEvents.length > 0 && (
        <div className="space-y-1 pt-1">
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
            Commits
          </h4>
          <div className="space-y-0.5">
            {gitEvents.map((event) => (
              <div
                key={event.id}
                className="flex items-start gap-1.5 text-[11px] text-muted-foreground"
              >
                <GitCommit className="h-3 w-3 mt-0.5 shrink-0 text-primary/60" />
                <span className="truncate">{event.message ?? "No message"}</span>
                <span className="shrink-0 text-muted-foreground/50 ml-auto text-[10px]">
                  {formatCommitTime(event.commitTime)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatCommitTime(unixSecs: number): string {
  const d = new Date(unixSecs * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
