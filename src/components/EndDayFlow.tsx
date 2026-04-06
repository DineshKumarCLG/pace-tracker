import { useState } from "react";
import { CheckCircle2, Clock, ListChecks, Coffee, X } from "lucide-react";
import { useSessionStore } from "@/stores/sessionStore";
import { useTaskStore } from "@/stores/taskStore";
import { useElapsedTime, formatDuration } from "@/components/Timer";
import { endSession } from "@/lib/db";
import { nowUtc } from "@/lib/timestamp";
import { cn } from "@/lib/utils";

type Step = "summary" | "output" | "goodbye";

interface EndDayFlowProps {
  onCancel: () => void;
}

export default function EndDayFlow({ onCancel }: EndDayFlowProps) {
  const session = useSessionStore((s) => s.session);
  const clearSession = useSessionStore((s) => s.clearSession);
  const tasks = useTaskStore((s) => s.tasks);
  const elapsed = useElapsedTime();

  const [step, setStep] = useState<Step>("summary");
  const [outputNote, setOutputNote] = useState(session?.outputNote ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Capture facts before session is cleared
  const hoursWorked = (elapsed / 3600).toFixed(1);
  const tasksClosed = tasks.filter((t) => t.status === "done").length;
  const breaksCount = 0; // Breaks are tracked in DB; placeholder until break store exists

  // Snapshot facts for goodbye screen (persists after clearSession)
  const [facts, setFacts] = useState<{
    hours: string;
    tasks: number;
    breaks: number;
  } | null>(null);

  async function handleConfirm() {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      // Snapshot facts before clearing
      setFacts({ hours: hoursWorked, tasks: tasksClosed, breaks: breaksCount });
      await endSession(session.id, nowUtc(), outputNote || undefined);
      clearSession();
      setStep("goodbye");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  if (!session && step !== "goodbye") return null;

  if (step === "goodbye") {
    return (
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-lg flex flex-col items-center gap-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <CheckCircle2 className="h-7 w-7 text-primary" />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold text-foreground">
            Great work today.
          </h2>
          <p className="text-sm text-muted-foreground">
            See you tomorrow.
          </p>
        </div>
        <div className="grid w-full grid-cols-3 gap-3">
          <FactCard label="Hours" value={`${facts?.hours ?? hoursWorked}h`} />
          <FactCard label="Tasks done" value={String(facts?.tasks ?? tasksClosed)} />
          <FactCard label="Breaks" value={String(facts?.breaks ?? breaksCount)} />
        </div>
        <button
          onClick={onCancel}
          className={cn(
            "w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground",
            "hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          )}
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">
          {step === "summary" ? "Day Summary" : "Output Note"}
        </h2>
        <button
          onClick={onCancel}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          aria-label="Cancel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {step === "summary" && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <SummaryCard
              icon={<Clock className="h-4 w-4" />}
              label="Total time"
              value={formatDuration(elapsed)}
            />
            <SummaryCard
              icon={<ListChecks className="h-4 w-4" />}
              label="Tasks closed"
              value={String(tasksClosed)}
            />
            <SummaryCard
              icon={<Coffee className="h-4 w-4" />}
              label="Breaks"
              value={String(breaksCount)}
            />
          </div>
          <button
            onClick={() => setStep("output")}
            className={cn(
              "w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground",
              "hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
            )}
          >
            Continue
          </button>
        </>
      )}

      {step === "output" && (
        <>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="end-day-note"
              className="text-sm font-medium text-foreground"
            >
              What did you ship today?
            </label>
            <textarea
              id="end-day-note"
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              rows={4}
              placeholder="Summarize your output…"
              value={outputNote}
              onChange={(e) => setOutputNote(e.target.value)}
              aria-label="Output note"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => setStep("summary")}
              disabled={loading}
              className={cn(
                "rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground",
                "hover:bg-accent disabled:opacity-50",
                "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
              )}
            >
              Back
            </button>
            <button
              onClick={handleConfirm}
              disabled={loading}
              className={cn(
                "flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground",
                "hover:bg-primary/90 disabled:opacity-50",
                "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
              )}
            >
              {loading ? "Ending…" : "End my day"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-border bg-muted/50 p-3">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-lg font-semibold">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function FactCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/50 p-3 text-center">
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
