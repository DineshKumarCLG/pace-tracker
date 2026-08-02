import { useEffect } from "react";
import { UtensilsCrossed, Coffee, X } from "lucide-react";
import { useSessionStore } from "@/stores/sessionStore";
import type { IdleInfo } from "@/stores/sessionStore";
import { isTauri } from "@/lib/tauri";
import { nowUtc } from "@/lib/timestamp";
import { cn } from "@/lib/utils";

type IdleResolution = "lunch" | "short" | "discarded";

interface UserReturnedPayload {
  away_duration_secs: number;
  away_since: number;
}

const resolutionOptions: {
  type: IdleResolution;
  label: string;
  icon: React.ReactNode;
}[] = [
  { type: "lunch", label: "Lunch break", icon: <UtensilsCrossed className="h-4 w-4" /> },
  { type: "short", label: "Short break", icon: <Coffee className="h-4 w-4" /> },
  { type: "discarded", label: "Discard", icon: <X className="h-4 w-4" /> },
];

function formatAwayDuration(secs: number): string {
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins !== 1 ? "s" : ""}`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function IdleModal() {
  const idleModalVisible = useSessionStore((s) => s.idleModalVisible);
  const idleInfo = useSessionStore((s) => s.idleInfo);
  const setIdleModalVisible = useSessionStore((s) => s.setIdleModalVisible);
  const setIdleInfo = useSessionStore((s) => s.setIdleInfo);
  const setPaused = useSessionStore((s) => s.setPaused);

  // Listen for user_returned Tauri event
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;

    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<UserReturnedPayload>("user_returned", (event) => {
        const { away_duration_secs, away_since } = event.payload;
        const info: IdleInfo = {
          awayDurationSecs: away_duration_secs,
          awaySince: away_since,
          returnedAt: nowUtc(),
        };
        setIdleInfo(info);
        setIdleModalVisible(true);
      }).then((fn) => {
        unlisten = fn;
      });
    });

    return () => { unlisten?.(); };
  }, [setIdleInfo, setIdleModalVisible]);

  function handleResolve(_resolution: IdleResolution) {
    // For now, dismiss the modal and resume the timer.
    // Actual break record creation and idle_event update will be wired in task 7.6.
    setPaused(false);
    setIdleModalVisible(false);
    setIdleInfo(null);
  }

  if (!idleModalVisible || !idleInfo) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div
        className={cn(
          "w-full max-w-sm border bg-card p-6 shadow-lg",
          "flex flex-col gap-5",
        )}
        style={{
          borderRadius: "var(--radius-idle-modal)",
          background: "hsl(var(--glass-bg))",
          borderColor: "hsl(var(--glass-border))",
          backdropFilter: "blur(var(--glass-blur))",
          WebkitBackdropFilter: "blur(var(--glass-blur))",
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Idle resolution"
      >
        {/* Header */}
        <div className="flex flex-col gap-1 text-center">
          <h2 className="text-lg font-semibold text-foreground">
            You were away for {formatAwayDuration(idleInfo.awayDurationSecs)}
          </h2>
          <p className="text-sm text-muted-foreground">
            {formatTime(idleInfo.awaySince)} – {formatTime(idleInfo.returnedAt)}
          </p>
        </div>

        {/* Resolution buttons */}
        <div className="grid grid-cols-2 gap-3">
          {resolutionOptions.map((opt) => (
            <button
              key={opt.type}
              onClick={() => handleResolve(opt.type)}
              className={cn(
                "flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-medium transition-colors",
                "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                opt.type === "discarded"
                  ? "border border-input bg-background text-foreground hover:bg-accent"
                  : "bg-primary text-primary-foreground hover:bg-primary/90",
              )}
            >
              {opt.icon}
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
