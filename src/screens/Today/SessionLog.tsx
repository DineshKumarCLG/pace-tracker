import { Play, Coffee, Clock } from "lucide-react";
import { useSessionStore } from "@/stores/sessionStore";

interface LogEntry { id: string; icon: React.ReactNode; label: string; time: string; color: string }

function fmtTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function SessionLog() {
  const session = useSessionStore((s) => s.session);
  const breakState = useSessionStore((s) => s.breakState);

  if (!session) {
    return (
      <div className="space-y-2.5">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Log</h3>
        <div className="glass rounded-xl p-4 text-center">
          <p className="text-[13px] text-muted-foreground/40 font-medium">No active session</p>
        </div>
      </div>
    );
  }

  const entries: LogEntry[] = [
    { id: "start", icon: <Play className="h-3 w-3" />, label: `Started · ${session.startType}`, time: fmtTime(session.startTime), color: "text-amber-400 bg-amber-400/10" },
  ];
  if (breakState.active && breakState.startTime) {
    entries.push({ id: "break", icon: <Coffee className="h-3 w-3" />, label: `Break${breakState.type ? ` · ${breakState.type}` : ""}`, time: fmtTime(breakState.startTime), color: "text-orange-400 bg-orange-400/10" });
  }
  if (session.endTime) {
    entries.push({ id: "end", icon: <Clock className="h-3 w-3" />, label: "Ended", time: fmtTime(session.endTime), color: "text-muted-foreground bg-muted/50" });
  }

  return (
    <div className="space-y-2.5">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Log</h3>
      <div className="glass rounded-xl overflow-hidden">
        <ul className="divide-y divide-border/40">
          {entries.map((e) => (
            <li key={e.id} className="group flex items-center gap-3 px-3.5 py-2.5 transition-colors duration-150 hover:bg-accent/30 cursor-default">
              <div className={`flex h-6 w-6 items-center justify-center rounded-md ${e.color} transition-transform duration-150 group-hover:scale-105`}
                style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.1)" }}>
                {e.icon}
              </div>
              <span className="flex-1 text-[13px] font-medium">{e.label}</span>
              <span className="font-mono text-[10px] text-muted-foreground/40 tabular-nums font-semibold">{e.time}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
