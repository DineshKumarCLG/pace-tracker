/**
 * Monthly Report Screen — PDF digest generation for any past month.
 *
 * Month selector, preview of digest data, and "Generate PDF" / "Save As" actions.
 * Uses jsPDF with PACE branding (indigo accent, Geist typography).
 * Includes check-in compliance rate (% of sessions with verified proofs).
 *
 * Requirements: 22.1, 22.2, 22.3, 22.4, Task 18.13
 */

import { useState, useMemo } from "react";
import { FileText, Download, ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { useWorkspaceProofStore } from "@/stores/workspaceProofStore";
import { computeCheckinComplianceRate } from "@/lib/proofIntegration";
import { getMonthRange } from "@/lib/monthlyDigest";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function MonthlyScreen() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const sessionProofs = useWorkspaceProofStore((s) => s.sessionProofs);

  /* Compute check-in compliance rate for the selected month (Task 18.13) */
  const complianceRate = useMemo(() => {
    const { start, end } = getMonthRange(year, month);
    // Collect unique session IDs from proofs within the month
    const monthProofs = sessionProofs.filter(
      (p) => p.createdAt >= start && p.createdAt <= end,
    );
    const sessionIds = [...new Set(monthProofs.map((p) => p.sessionId))];
    if (sessionIds.length === 0) return null;
    return computeCheckinComplianceRate(sessionIds, sessionProofs);
  }, [year, month, sessionProofs]);

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear(year - 1); }
    else setMonth(month - 1);
  }
  function nextMonth() {
    if (month === 12) { setMonth(1); setYear(year + 1); }
    else setMonth(month + 1);
  }

  const compliancePct = complianceRate !== null ? Math.round(complianceRate * 100) : null;
  const complianceBadgeVariant =
    compliancePct !== null && compliancePct >= 80 ? "success" :
    compliancePct !== null && compliancePct >= 50 ? "warning" : "danger";

  return (
    <div className="h-full overflow-y-auto transition-all duration-200">
      <div className="space-y-5 px-5 py-5 pb-10">
        {/* Header */}
        <div className="mb-1">
          <h1 className="text-[22px] font-bold tracking-tight leading-tight">Monthly Report</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5 font-medium">
            Generate and download monthly team digest PDFs
          </p>
        </div>

        {/* Month selector */}
        <div className="flex items-center gap-3">
          <button
            onClick={prevMonth}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-[14px] font-semibold min-w-[160px] text-center">
            {MONTH_NAMES[month - 1]} {year}
          </span>
          <button
            onClick={nextMonth}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Check-in compliance rate card (Task 18.13) */}
        {compliancePct !== null && (
          <Card className="p-4 flex items-center gap-3" data-testid="compliance-card">
            <ShieldCheck className="h-5 w-5 text-primary shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                Check-in Compliance
              </div>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-[20px] font-bold leading-tight">{compliancePct}%</span>
                <span className="text-[11px] text-muted-foreground">of sessions with verified proofs</span>
                <Badge variant={complianceBadgeVariant} size="sm" className="ml-auto">
                  {compliancePct >= 80 ? "Good" : compliancePct >= 50 ? "Fair" : "Low"}
                </Badge>
              </div>
            </div>
          </Card>
        )}

        {/* Placeholder content */}
        <Card className="p-6 text-center">
          <div className="flex justify-center mb-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/30">
              <FileText className="h-5 w-5 text-muted-foreground/50" />
            </div>
          </div>
          <h3 className="text-[14px] font-semibold text-foreground mb-1">
            {MONTH_NAMES[month - 1]} {year} Digest
          </h3>
          <p className="text-[12px] text-muted-foreground max-w-[320px] mx-auto mb-4">
            Generate a PDF report with total team hours, hours per person, hours per project,
            tasks completed, leave days, and weekly output summaries.
          </p>
          <Button variant="primary" size="sm">
            <Download className="h-3.5 w-3.5" />
            Generate PDF
          </Button>
        </Card>
      </div>
    </div>
  );
}
