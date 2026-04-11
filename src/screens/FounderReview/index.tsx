/**
 * Founder Review Screen — Peer review submission, results, and history.
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4, 17.5
 */

import { useEffect, useState } from "react";
import {
  ClipboardCheck,
  Clock,
  AlertTriangle,
  CheckCircle2,
  History,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { useReviewStore } from "@/stores/reviewStore";
import { useAuthStore } from "@/stores/authStore";
import { pb } from "@/lib/pocketbase";

/* ── Types ── */

interface Founder {
  id: string;
  name: string;
}

interface ReviewFormData {
  [revieweeId: string]: {
    output: number;
    reliability: number;
    initiative: number;
  };
}

/* ── Main Component ── */

export default function FounderReviewScreen() {
  const currentCycle = useReviewStore((s) => s.currentCycle);
  const results = useReviewStore((s) => s.results);
  const history = useReviewStore((s) => s.history);
  const warnings = useReviewStore((s) => s.warnings);
  const loading = useReviewStore((s) => s.loading);
  const refresh = useReviewStore((s) => s.refresh);
  const submitReview = useReviewStore((s) => s.submitReview);
  const currentUser = useAuthStore((s) => s.user);

  const [founders, setFounders] = useState<Founder[]>([]);
  const [formData, setFormData] = useState<ReviewFormData>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    refresh();
    loadFounders();
  }, [refresh]);

  async function loadFounders() {
    try {
      const users = await pb.collection("users").getFullList({
        filter: 'role ~ "founder" || role ~ "ceo" || role ~ "Founder" || role ~ "CEO"',
      });
      setFounders(users.map((u) => ({ id: u.id, name: (u.name as string) ?? u.id })));
    } catch {
      setFounders([]);
    }
  }

  const otherFounders = founders.filter((f) => f.id !== currentUser?.id);

  const cycleStatus = currentCycle?.status ?? null;
  const isOpen = cycleStatus === "open";
  const now = Math.floor(Date.now() / 1000);
  const deadlinePassed = currentCycle ? now > currentCycle.submissionDeadline : false;

  function handleScoreChange(revieweeId: string, dimension: "output" | "reliability" | "initiative", value: number) {
    setFormData((prev) => ({
      ...prev,
      [revieweeId]: {
        output: prev[revieweeId]?.output ?? 3,
        reliability: prev[revieweeId]?.reliability ?? 3,
        initiative: prev[revieweeId]?.initiative ?? 3,
        [dimension]: value,
      },
    }));
  }

  async function handleSubmit() {
    if (!currentCycle || submitted || submitting) return;
    setSubmitting(true);
    try {
      for (const founder of otherFounders) {
        const scores = formData[founder.id] ?? { output: 3, reliability: 3, initiative: 3 };
        await submitReview(founder.id, scores.output, scores.reliability, scores.initiative);
      }
      setSubmitted(true);
    } catch {
      // Error handled by store
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !currentCycle && history.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-[13px] text-muted-foreground animate-pulse">Loading reviews…</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto transition-all duration-200">
      <div className="space-y-6 px-6 py-6 pb-12">
        {/* Header */}
        <div className="mb-2">
          <div className="flex items-center gap-3 mb-1">
            <div className="h-8 w-1 rounded-full bg-gradient-to-b from-primary to-primary/30" />
            <div>
              <h1 className="text-[26px] font-extrabold tracking-tight leading-tight">Founder Review</h1>
              <p className="text-[13px] text-muted-foreground mt-0.5 font-medium">
                Biweekly peer review and accountability
              </p>
            </div>
          </div>
        </div>

        {/* Current Cycle Status (Req 17.1) */}
        <CycleStatusCard cycle={currentCycle} />

        {/* Submission Form or Confirmation (Req 17.2, 17.3) */}
        {currentCycle && isOpen && !deadlinePassed && !submitted ? (
          <section>
            <SectionLabel icon={<ClipboardCheck className="h-3.5 w-3.5" />} label="Submit Reviews" />
            <div className="space-y-3 mt-3">
              {otherFounders.map((founder) => (
                <ReviewFormCard
                  key={founder.id}
                  founder={founder}
                  scores={formData[founder.id] ?? { output: 3, reliability: 3, initiative: 3 }}
                  onChange={(dim, val) => handleScoreChange(founder.id, dim, val)}
                />
              ))}
              {otherFounders.length > 0 && (
                <Button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="w-full"
                >
                  {submitting ? "Submitting…" : "Submit All Reviews"}
                </Button>
              )}
              {otherFounders.length === 0 && (
                <p className="text-[12px] text-muted-foreground">No other founders to review</p>
              )}
            </div>
          </section>
        ) : currentCycle && (submitted || isOpen) ? (
          <Card className="p-5" glow>
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="h-5 w-5" />
              <span className="text-[13px] font-semibold">Reviews submitted for this cycle</span>
            </div>
            <p className="text-[12px] text-muted-foreground mt-1">
              Results will be available once the cycle closes.
            </p>
          </Card>
        ) : null}

        {/* Results for closed/resolved cycles (Req 17.4) */}
        {results.length > 0 && cycleStatus !== "open" && (
          <section>
            <SectionLabel icon={<ClipboardCheck className="h-3.5 w-3.5" />} label="Current Cycle Results" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              {results.map((result) => {
                const founder = founders.find((f) => f.id === result.founderId);
                return (
                  <ResultCard
                    key={result.founderId}
                    name={founder?.name ?? result.founderId}
                    result={result}
                  />
                );
              })}
            </div>
          </section>
        )}

        {/* Accountability Warnings (Req 17.5) */}
        {Object.keys(warnings).length > 0 && (
          <section>
            <SectionLabel icon={<ShieldAlert className="h-3.5 w-3.5 text-amber-400" />} label="Accountability Warnings" />
            <Card className="p-5 mt-3">
              <div className="space-y-2.5">
                {Object.entries(warnings).map(([founderId, count]) => {
                  const founder = founders.find((f) => f.id === founderId);
                  const isConsecutive = count >= 2;
                  return (
                    <div
                      key={founderId}
                      className={cn(
                        "flex items-center gap-2.5 text-[12px] rounded-lg border px-3 py-2.5",
                        isConsecutive
                          ? "border-rose-500/20 bg-rose-500/[0.03]"
                          : "border-amber-500/10 bg-amber-500/[0.03]",
                      )}
                    >
                      <AlertTriangle className={cn("h-3.5 w-3.5 shrink-0", isConsecutive ? "text-rose-400" : "text-amber-400")} />
                      <span className="font-medium">{founder?.name ?? founderId}</span>
                      <Badge variant={isConsecutive ? "danger" : "warning"} size="sm" className="ml-auto">
                        {count} warning{count !== 1 ? "s" : ""}
                      </Badge>
                      {isConsecutive && (
                        <Badge variant="danger" size="sm">consecutive</Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          </section>
        )}

        {/* Review History (Req 17.4) */}
        {history.length > 1 && (
          <section>
            <SectionLabel icon={<History className="h-3.5 w-3.5" />} label="Past Cycles" />
            <Card className="p-5 mt-3">
              <div className="space-y-2.5">
                {history.slice(1).map((cycle) => (
                  <div key={cycle.id} className="flex items-center gap-2 text-[12px]">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="font-medium">
                      {formatDate(cycle.startDate)} – {formatDate(cycle.endDate)}
                    </span>
                    <Badge
                      variant={cycle.status === "resolved" ? "success" : cycle.status === "closed" ? "warning" : "default"}
                      size="sm"
                      className="ml-auto"
                    >
                      {cycle.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </Card>
          </section>
        )}
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function SectionLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
        {label}
      </span>
    </div>
  );
}

function CycleStatusCard({ cycle }: { cycle: ReturnType<typeof useReviewStore.getState>["currentCycle"] }) {
  if (!cycle) {
    return (
      <Card className="p-5" glow>
        <p className="text-[13px] text-muted-foreground">No active review cycle</p>
      </Card>
    );
  }

  const statusColors: Record<string, string> = {
    open: "text-emerald-400",
    closed: "text-amber-400",
    resolved: "text-indigo-400",
  };

  return (
    <Card className="p-5" glow>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-[13px] font-semibold">Current Cycle</span>
          <Badge
            variant={cycle.status === "open" ? "success" : cycle.status === "closed" ? "warning" : "default"}
            size="sm"
          >
            {cycle.status}
          </Badge>
        </div>
        <span className={cn("text-[12px] font-medium", statusColors[cycle.status] ?? "")}>
          {formatDate(cycle.startDate)} – {formatDate(cycle.endDate)}
        </span>
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">
        Submission deadline: {formatDateTime(cycle.submissionDeadline)}
      </div>
    </Card>
  );
}

function ReviewFormCard({
  founder,
  scores,
  onChange,
}: {
  founder: Founder;
  scores: { output: number; reliability: number; initiative: number };
  onChange: (dim: "output" | "reliability" | "initiative", val: number) => void;
}) {
  return (
    <Card className="p-4">
      <div className="text-[13px] font-semibold mb-3">{founder.name}</div>
      <div className="space-y-2">
        <ScaleInput label="Output" value={scores.output} onChange={(v) => onChange("output", v)} />
        <ScaleInput label="Reliability" value={scores.reliability} onChange={(v) => onChange("reliability", v)} />
        <ScaleInput label="Initiative" value={scores.initiative} onChange={(v) => onChange("initiative", v)} />
      </div>
    </Card>
  );
}

function ScaleInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] text-muted-foreground w-20 shrink-0">{label}</span>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={cn(
              "h-8 w-8 rounded-md text-[12px] font-semibold transition-all",
              n === value
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-accent/40 text-muted-foreground hover:bg-accent",
            )}
            aria-label={`${label} score ${n}`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

function ResultCard({
  name,
  result,
}: {
  name: string;
  result: { outputAvg: number; reliabilityAvg: number; initiativeAvg: number; overallAvg: number };
}) {
  return (
    <Card className="p-4">
      <div className="text-[13px] font-semibold mb-2">{name}</div>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <span className="text-muted-foreground">Output</span>
          <span className="ml-2 font-semibold">{result.outputAvg.toFixed(1)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Reliability</span>
          <span className="ml-2 font-semibold">{result.reliabilityAvg.toFixed(1)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Initiative</span>
          <span className="ml-2 font-semibold">{result.initiativeAvg.toFixed(1)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Overall</span>
          <span className="ml-2 font-bold text-primary">{result.overallAvg.toFixed(1)}</span>
        </div>
      </div>
    </Card>
  );
}

/* ── Helpers ── */

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en", { month: "short", day: "numeric" });
}

function formatDateTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
