/**
 * Startup Health Screen — Runway, founder balance, decisions, burn rate, settings, investor PDF.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 13.1, 13.2, 13.3, 13.4,
 *               14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 15.1–15.5
 */

import { useEffect, useState } from "react";
import {
  Users,
  Zap,
  Settings,
  Plus,
  Check,
  FileDown,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { useHealthStore } from "@/stores/healthStore";
import type { Decision, StartupHealthConfig } from "@/lib/startupHealth";
import { generateInvestorPdf } from "@/lib/investorPdf";

/* ── Helpers ── */

function statusBadgeVariant(status: "normal" | "amber" | "red"): "success" | "warning" | "danger" {
  if (status === "red") return "danger";
  if (status === "amber") return "warning";
  return "success";
}

function statusLabel(status: "normal" | "amber" | "red"): string {
  if (status === "red") return "Critical";
  if (status === "amber") return "Warning";
  return "Healthy";
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

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

/* ── Main Component ── */

export default function StartupHealthScreen() {
  const data = useHealthStore((s) => s.data);
  const config = useHealthStore((s) => s.config);
  const decisions = useHealthStore((s) => s.decisions);
  const loading = useHealthStore((s) => s.loading);
  const refresh = useHealthStore((s) => s.refresh);
  const updateConfig = useHealthStore((s) => s.updateConfig);
  const logDecision = useHealthStore((s) => s.logDecision);
  const resolveDecision = useHealthStore((s) => s.resolveDecision);

  /* Settings form state */
  const [cashBalance, setCashBalance] = useState("");
  const [expense1, setExpense1] = useState("");
  const [expense2, setExpense2] = useState("");
  const [expense3, setExpense3] = useState("");
  const [plannedBudget, setPlannedBudget] = useState("");
  const [settingsSaved, setSettingsSaved] = useState(false);

  /* Decision form state */
  const [decTitle, setDecTitle] = useState("");
  const [decDescription, setDecDescription] = useState("");

  /* Investor PDF state */
  const [pdfStartDate, setPdfStartDate] = useState("");
  const [pdfEndDate, setPdfEndDate] = useState("");
  const [pdfGenerating, setPdfGenerating] = useState(false);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /* Populate settings form from config */
  useEffect(() => {
    if (config) {
      setCashBalance(String(config.cashBalance || ""));
      const exp = config.monthlyExpenses;
      setExpense1(String(exp[0] ?? ""));
      setExpense2(String(exp[1] ?? ""));
      setExpense3(String(exp[2] ?? ""));
      setPlannedBudget(String(config.plannedMonthlyBudget || ""));
    }
  }, [config]);

  async function handleSaveSettings() {
    const newConfig: StartupHealthConfig = {
      cashBalance: parseFloat(cashBalance) || 0,
      monthlyExpenses: [
        parseFloat(expense1) || 0,
        parseFloat(expense2) || 0,
        parseFloat(expense3) || 0,
      ].filter((e) => e > 0),
      plannedMonthlyBudget: parseFloat(plannedBudget) || 0,
    };
    await updateConfig(newConfig);
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2000);
  }

  async function handleLogDecision() {
    if (!decTitle.trim()) return;
    await logDecision(decTitle.trim(), decDescription.trim());
    setDecTitle("");
    setDecDescription("");
  }

  async function handleResolveDecision(id: string) {
    await resolveDecision(id);
  }

  async function handleGeneratePdf() {
    if (!data) return;
    setPdfGenerating(true);
    try {
      const start = pdfStartDate
        ? Math.floor(new Date(pdfStartDate).getTime() / 1000)
        : Math.floor(Date.now() / 1000) - 30 * 86400;
      const end = pdfEndDate
        ? Math.floor(new Date(pdfEndDate).getTime() / 1000)
        : Math.floor(Date.now() / 1000);

      await generateInvestorPdf({
        dateRange: { start, end },
        runwayMonths: data.runwayMonths,
        burnRateAlignment: data.burnRateAlignment,
        founderHoursSummary: data.founderBalance.founders.map((f) => ({
          name: f.name,
          hours: f.weeklyHours,
        })),
        decisionVelocity: data.decisionVelocity,
        taskCompletionVelocity: 0,
        teamSize: data.founderBalance.founders.length,
      });
    } catch {
      // PDF generation error handled in the lib
    } finally {
      setPdfGenerating(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-[13px] text-muted-foreground animate-pulse">Loading health data…</div>
      </div>
    );
  }

  const openDecisions = decisions.filter((d) => d.resolvedAt === null);
  const resolvedDecisions = decisions.filter((d) => d.resolvedAt !== null);

  return (
    <div className="h-full overflow-y-auto transition-all duration-200">
      <div className="space-y-6 px-6 py-6 pb-12">
        {/* Header */}
        <div className="mb-2">
          <div className="flex items-center gap-3 mb-1">
            <div className="h-8 w-1 rounded-full bg-gradient-to-b from-primary to-primary/30" />
            <div>
              <h1 className="text-[26px] font-extrabold tracking-tight leading-tight">Startup Health</h1>
              <p className="text-[13px] text-muted-foreground mt-0.5 font-medium">
                Runway, balance, decisions, and burn rate
              </p>
            </div>
          </div>
        </div>

        {/* Top metrics row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Runway (Req 12.1, 12.2, 12.3, 12.4) */}
          <Card className="p-4" glow>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Runway</span>
              <Badge variant={statusBadgeVariant(data?.runwayStatus ?? "normal")} size="sm">
                {statusLabel(data?.runwayStatus ?? "normal")}
              </Badge>
            </div>
            <div className="flex items-baseline gap-1">
              <span className={cn(
                "text-[28px] font-extrabold tracking-tight",
                data?.runwayStatus === "red" && "text-rose-500",
                data?.runwayStatus === "amber" && "text-amber-500",
              )}>
                {data?.runwayMonths === Infinity ? "∞" : (data?.runwayMonths ?? 0).toFixed(1)}
              </span>
              <span className="text-[12px] text-muted-foreground">months</span>
            </div>
          </Card>

          {/* Decision Velocity (Req 14.1, 14.2) */}
          <Card className="p-4" glow>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Decision Velocity</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-[28px] font-extrabold tracking-tight">
                {data?.decisionVelocity != null ? data.decisionVelocity.toFixed(1) : "0.0"}
              </span>
              <span className="text-[12px] text-muted-foreground">days avg</span>
            </div>
          </Card>

          {/* Burn Rate (Req 14.3, 14.4, 14.5) */}
          <Card className="p-4" glow>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Burn Rate</span>
              <Badge variant={statusBadgeVariant(data?.burnRateStatus ?? "normal")} size="sm">
                {statusLabel(data?.burnRateStatus ?? "normal")}
              </Badge>
            </div>
            <div className="flex items-baseline gap-1">
              <span className={cn(
                "text-[28px] font-extrabold tracking-tight",
                data?.burnRateStatus === "red" && "text-rose-500",
                data?.burnRateStatus === "amber" && "text-amber-500",
              )}>
                {data?.burnRateAlignment === Infinity ? "∞" : (data?.burnRateAlignment ?? 0).toFixed(1)}
              </span>
              <span className="text-[12px] text-muted-foreground">% of budget</span>
            </div>
          </Card>

          {/* Team Average Hours */}
          <Card className="p-4" glow>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Team Avg Hours</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-[28px] font-extrabold tracking-tight">
                {(data?.founderBalance.teamAvgHours ?? 0).toFixed(1)}
              </span>
              <span className="text-[12px] text-muted-foreground">hrs/week</span>
            </div>
          </Card>
        </div>

        {/* Founder Balance (Req 13.1, 13.2, 13.3, 13.4) */}
        <section>
          <SectionLabel icon={<Users className="h-3.5 w-3.5" />} label="Founder Balance" />
          <Card className="p-5 mt-3" glow>
            {data?.founderBalance.founders && data.founderBalance.founders.length > 0 ? (
              <div className="space-y-3">
                {data.founderBalance.founders.map((f) => (
                  <div key={f.founderId} className="flex items-center gap-3">
                    <span className="text-[13px] font-semibold w-28 truncate">{f.name}</span>
                    <div className="flex-1">
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                        <span>{f.weeklyHours.toFixed(1)} hrs</span>
                        <span>avg {data.founderBalance.teamAvgHours.toFixed(1)} hrs</span>
                      </div>
                      <div className="h-2 rounded-full inset-well overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-700",
                            f.hasAlert ? "bg-amber-500" : "bg-primary",
                          )}
                          style={{
                            width: `${Math.min(100, data.founderBalance.teamAvgHours > 0 ? (f.weeklyHours / (data.founderBalance.teamAvgHours * 2)) * 100 : 50)}%`,
                          }}
                        />
                      </div>
                    </div>
                    {f.hasAlert && (
                      <Badge variant="warning" size="sm">
                        <AlertTriangle className="h-3 w-3 mr-1 inline" />
                        Hours gap detected
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground">No founder data available</p>
            )}
          </Card>
        </section>

        {/* Decision Log (Req 14.1, 14.6) */}
        <section>
          <SectionLabel icon={<Zap className="h-3.5 w-3.5" />} label="Decision Log" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-3">
            {/* Log decision form */}
            <Card className="p-5">
              <h3 className="text-[13px] font-semibold mb-3">Log Decision</h3>
              <div className="space-y-2">
                <Input
                  placeholder="Decision title"
                  value={decTitle}
                  onChange={(e) => setDecTitle(e.target.value)}
                  inputSize="sm"
                  aria-label="Decision title"
                />
                <Input
                  placeholder="Description (optional)"
                  value={decDescription}
                  onChange={(e) => setDecDescription(e.target.value)}
                  inputSize="sm"
                  aria-label="Decision description"
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleLogDecision}
                  disabled={!decTitle.trim()}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Log Decision
                </Button>
              </div>
            </Card>

            {/* Open decisions */}
            <Card className="p-5">
              <h3 className="text-[13px] font-semibold mb-3">
                Open Decisions ({openDecisions.length})
              </h3>
              {openDecisions.length > 0 ? (
                <div className="space-y-2">
                  {openDecisions.map((d) => (
                    <DecisionRow
                      key={d.id}
                      decision={d}
                      onResolve={handleResolveDecision}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-muted-foreground">No open decisions</p>
              )}
            </Card>
          </div>

          {/* Resolved decisions */}
          {resolvedDecisions.length > 0 && (
            <Card className="p-5 mt-3">
              <h3 className="text-[13px] font-semibold mb-3">
                Resolved Decisions ({resolvedDecisions.length})
              </h3>
              <div className="space-y-2">
                {resolvedDecisions.map((d) => (
                  <DecisionRow key={d.id} decision={d} />
                ))}
              </div>
            </Card>
          )}
        </section>

        {/* Settings (Req 12.5) */}
        <section>
          <SectionLabel icon={<Settings className="h-3.5 w-3.5" />} label="Health Settings" />
          <Card className="p-5 mt-3" glow>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 block mb-2">
                  Cash Balance
                </label>
                <Input
                  type="number"
                  placeholder="Current cash balance"
                  value={cashBalance}
                  onChange={(e) => setCashBalance(e.target.value)}
                  inputSize="sm"
                  min={0}
                  aria-label="Cash balance"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 block mb-2">
                  Planned Monthly Budget
                </label>
                <Input
                  type="number"
                  placeholder="Monthly budget"
                  value={plannedBudget}
                  onChange={(e) => setPlannedBudget(e.target.value)}
                  inputSize="sm"
                  min={0}
                  aria-label="Planned monthly budget"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 block mb-2">
                  Monthly Expenses (Last 3 Months)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <Input
                    type="number"
                    placeholder="Month 1"
                    value={expense1}
                    onChange={(e) => setExpense1(e.target.value)}
                    inputSize="sm"
                    min={0}
                    aria-label="Month 1 expenses"
                  />
                  <Input
                    type="number"
                    placeholder="Month 2"
                    value={expense2}
                    onChange={(e) => setExpense2(e.target.value)}
                    inputSize="sm"
                    min={0}
                    aria-label="Month 2 expenses"
                  />
                  <Input
                    type="number"
                    placeholder="Month 3"
                    value={expense3}
                    onChange={(e) => setExpense3(e.target.value)}
                    inputSize="sm"
                    min={0}
                    aria-label="Month 3 expenses"
                  />
                </div>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <Button variant="primary" size="sm" onClick={handleSaveSettings}>
                Save Settings
              </Button>
              {settingsSaved && (
                <span className="text-[12px] text-emerald-500 font-medium flex items-center gap-1">
                  <Check className="h-3.5 w-3.5" /> Saved
                </span>
              )}
            </div>
          </Card>
        </section>

        {/* Investor PDF Export (Req 15.1–15.5) */}
        <section>
          <SectionLabel icon={<FileDown className="h-3.5 w-3.5" />} label="Investor Summary" />
          <Card className="p-5 mt-3">
            <p className="text-[12px] text-muted-foreground mb-3">
              Generate a branded PDF summary for investors with key startup health metrics.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 block mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={pdfStartDate}
                  onChange={(e) => setPdfStartDate(e.target.value)}
                  className="rounded-md border border-border bg-background px-2 py-1 text-[12px]"
                  aria-label="PDF start date"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 block mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  value={pdfEndDate}
                  onChange={(e) => setPdfEndDate(e.target.value)}
                  className="rounded-md border border-border bg-background px-2 py-1 text-[12px]"
                  aria-label="PDF end date"
                />
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleGeneratePdf}
                disabled={pdfGenerating || !data}
              >
                <FileDown className="h-3.5 w-3.5 mr-1" />
                {pdfGenerating ? "Generating…" : "Export PDF"}
              </Button>
            </div>
          </Card>
        </section>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function DecisionRow({
  decision,
  onResolve,
}: {
  decision: Decision;
  onResolve?: (id: string) => void;
}) {
  const isOpen = decision.resolvedAt === null;

  return (
    <div className={cn(
      "rounded-lg border px-3 py-2.5",
      isOpen
        ? "border-amber-500/20 bg-amber-500/[0.03]"
        : "border-border/50 bg-muted/30",
    )}>
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium">{decision.title}</span>
        <div className="flex items-center gap-2">
          {isOpen ? (
            <Badge variant="warning" size="sm">Open</Badge>
          ) : (
            <Badge variant="success" size="sm">Resolved</Badge>
          )}
          {isOpen && onResolve && (
            <Button variant="ghost" size="sm" onClick={() => onResolve(decision.id)}>
              <Check className="h-3.5 w-3.5 mr-1" />
              Resolve
            </Button>
          )}
        </div>
      </div>
      {decision.description && (
        <p className="text-[11px] text-muted-foreground mt-1">{decision.description}</p>
      )}
      <div className="flex gap-3 mt-1.5 text-[10px] text-muted-foreground">
        <span>Created: {formatDate(decision.createdAt)}</span>
        {decision.resolvedAt && <span>Resolved: {formatDate(decision.resolvedAt)}</span>}
      </div>
    </div>
  );
}
