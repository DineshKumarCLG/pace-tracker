import { useState } from "react";
import type { Session } from "@/types";
import { recoverStaleSession } from "@/lib/db";
import { toDisplayTime } from "@/lib/timestamp";
import { cn } from "@/lib/utils";

interface CrashRecoveryProps {
  session: Session;
  onRecovered: () => void;
}

/**
 * Recovery prompt shown when a stale session is detected on app launch.
 *
 * Displays the last known session state and lets the user confirm or
 * adjust the end time before closing the orphaned session.
 */
export default function CrashRecovery({
  session,
  onRecovered,
}: CrashRecoveryProps) {
  const defaultEndTime = session.lastHeartbeat ?? session.startTime;
  const [confirmedEndTime, setConfirmedEndTime] = useState(defaultEndTime);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionDurationMin = Math.round(
    (defaultEndTime - session.startTime) / 60,
  );
  const hours = Math.floor(sessionDurationMin / 60);
  const mins = sessionDurationMin % 60;

  async function handleRecover() {
    setLoading(true);
    setError(null);
    try {
      await recoverStaleSession(session.id, confirmedEndTime);
      onRecovered();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleDiscard() {
    // Discard = close at lastHeartbeat time (the default)
    setLoading(true);
    setError(null);
    try {
      await recoverStaleSession(session.id, defaultEndTime);
      onRecovered();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  /** Convert a Unix timestamp to a datetime-local input value. */
  function toDatetimeLocal(ts: number): string {
    const d = new Date(ts * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fromDatetimeLocal(value: string): number {
    return Math.floor(new Date(value).getTime() / 1000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div
        className={cn(
          "w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg",
          "flex flex-col gap-4",
        )}
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-foreground">
            Session interrupted
          </h2>
          <p className="text-sm text-muted-foreground">
            It looks like your last session wasn't closed properly. Here's what
            we recovered — does this look right?
          </p>
        </div>

        <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Started</span>
            <span className="font-mono text-foreground">
              {toDisplayTime(session.startTime)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Last heartbeat</span>
            <span className="font-mono text-foreground">
              {session.lastHeartbeat
                ? toDisplayTime(session.lastHeartbeat)
                : "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Duration</span>
            <span className="font-mono text-foreground">
              {hours > 0 ? `${hours}h ` : ""}
              {mins}m
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="end-time"
            className="text-sm font-medium text-foreground"
          >
            Confirm end time
          </label>
          <input
            id="end-time"
            type="datetime-local"
            className={cn(
              "rounded-md border border-input bg-background px-3 py-2 text-sm",
              "focus:outline-none focus:ring-2 focus:ring-ring",
            )}
            value={toDatetimeLocal(confirmedEndTime)}
            onChange={(e) =>
              setConfirmedEndTime(fromDatetimeLocal(e.target.value))
            }
            min={toDatetimeLocal(session.startTime)}
          />
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={handleRecover}
            disabled={loading}
            className={cn(
              "flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground",
              "hover:bg-primary/90 disabled:opacity-50",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
            )}
          >
            {loading ? "Recovering…" : "Recover session"}
          </button>
          <button
            onClick={handleDiscard}
            disabled={loading}
            className={cn(
              "rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground",
              "hover:bg-accent disabled:opacity-50",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
            )}
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
