import { useState, useEffect } from "react";
import { Clock, Zap } from "lucide-react";
import { startSession, getDeviceWakeTime } from "@/lib/db";
import { nowUtc, toDisplayTime } from "@/lib/timestamp";
import { useSessionStore } from "@/stores/sessionStore";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";

const MAX_BACKFILL_HOURS = 4;

/** Convert a Unix timestamp (seconds) to a datetime-local input value. */
function toDatetimeLocal(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Convert a datetime-local input value to a Unix timestamp (seconds). */
function fromDatetimeLocal(value: string): number {
  return Math.floor(new Date(value).getTime() / 1000);
}

interface StartSessionFlowProps {
  onCancel: () => void;
}

export default function StartSessionFlow({ onCancel }: StartSessionFlowProps) {
  const setSession = useSessionStore((s) => s.setSession);
  const userId = useAuthStore((s) => s.user?.id ?? "default-user");
  const [claimedTime, setClaimedTime] = useState(() => nowUtc());
  const [wakeTime, setWakeTime] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDeviceWakeTime()
      .then(setWakeTime)
      .catch(() => setWakeTime(null));
  }, []);

  function validate(): string | null {
    const now = nowUtc();
    if (claimedTime > now + 60) {
      return "Start time cannot be in the future.";
    }
    if (claimedTime < now - MAX_BACKFILL_HOURS * 3600) {
      return `Start time cannot be more than ${MAX_BACKFILL_HOURS} hours ago.`;
    }
    return null;
  }

  async function handleStart() {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const session = await startSession(userId, claimedTime);
      setSession(session);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleUseWakeTime() {
    if (wakeTime != null) {
      setClaimedTime(wakeTime);
      setError(null);
    }
  }

  function handleUseNow() {
    setClaimedTime(nowUtc());
    setError(null);
  }

  return (
    <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary" />
          When did you start?
        </h2>
        <p className="text-sm text-muted-foreground">
          Set your session start time. Defaults to now.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="start-time" className="text-sm font-medium text-foreground">
          Start time
        </label>
        <input
          id="start-time"
          type="datetime-local"
          className={cn(
            "rounded-md border border-input bg-background px-3 py-2 text-sm",
            "focus:outline-none focus:ring-2 focus:ring-ring",
          )}
          value={toDatetimeLocal(claimedTime)}
          onChange={(e) => {
            setClaimedTime(fromDatetimeLocal(e.target.value));
            setError(null);
          }}
        />
      </div>

      {/* Quick-pick buttons */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleUseNow}
          className={cn(
            "flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium",
            "hover:bg-accent transition-colors",
          )}
        >
          <Clock className="h-3.5 w-3.5" />
          Now
        </button>
        {wakeTime != null && (
          <button
            type="button"
            onClick={handleUseWakeTime}
            className={cn(
              "flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium",
              "hover:bg-accent transition-colors",
            )}
          >
            <Zap className="h-3.5 w-3.5" />
            Device woke at {toDisplayTime(wakeTime).split(",").pop()?.trim() ?? toDisplayTime(wakeTime)}
          </button>
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleStart}
          disabled={loading}
          className={cn(
            "flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground",
            "hover:bg-primary/90 disabled:opacity-50",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          )}
        >
          {loading ? "Starting…" : "Start session"}
        </button>
        <button
          onClick={onCancel}
          disabled={loading}
          className={cn(
            "rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground",
            "hover:bg-accent disabled:opacity-50",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          )}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
