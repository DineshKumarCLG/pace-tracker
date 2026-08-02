/**
 * Daily Digest — End-of-day reports.
 *
 * Displays today's team activity summary:
 * 1. End-of-day reports: tasks, hours, breaks, git commits
 *
 * Requirements: 11.3
 */

import {
  FileText,
  CheckCircle2,
  Coffee,
  GitCommit,
} from "lucide-react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import type { DailyReport } from "@/types";

export interface DigestScreenProps {
  eodReports: (DailyReport & { userName: string })[];
}

/* ── Main Component ── */

export default function DigestScreen({
  eodReports = [],
}: Partial<DigestScreenProps> = {}) {
  const hasContent = eodReports.length > 0;

  return (
    <div className="h-full overflow-y-auto transition-all duration-200">
      <div className="space-y-5 px-5 py-5 pb-10">
        {/* Header */}
        <div className="mb-1">
          <h1 className="text-[22px] font-bold tracking-tight leading-tight">Daily Digest</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5 font-medium">
            Today's team activity at a glance
          </p>
        </div>

        {!hasContent && (
          <Card className="p-6 text-center">
            <p className="text-[13px] text-muted-foreground">No digest data available for today</p>
          </Card>
        )}

        {/* End-of-Day Reports (Req 11.3) */}
        {eodReports.length > 0 && (
          <EodReportsSection reports={eodReports} />
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

/* ── End-of-Day Reports Section ── */

function EodReportsSection({
  reports,
}: {
  reports: (DailyReport & { userName: string })[];
}) {
  return (
    <section>
      <SectionLabel
        icon={<FileText className="h-3.5 w-3.5 text-emerald-400" />}
        label="End-of-Day Reports"
      />
      <div className="space-y-3 mt-2">
        {reports.map((report) => (
          <EodReportCard key={report.id} report={report} />
        ))}
      </div>
    </section>
  );
}

function EodReportCard({
  report,
}: {
  report: DailyReport & { userName: string };
}) {
  const hours = Math.floor(report.totalMinutes / 60);
  const mins = report.totalMinutes % 60;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[13px] font-semibold">{report.userName}</span>
        <Badge variant="muted" size="sm">
          {hours}h {mins}m
        </Badge>
      </div>

      <div className="space-y-2 text-[11px]">
        {/* Tasks */}
        <div>
          <span className="font-semibold text-muted-foreground">Tasks</span>
          <div className="mt-1 space-y-0.5">
            {report.tasksWorked.map((task, i) => (
              <div key={`${task.taskId}-${i}`} className="flex items-center gap-1.5 text-muted-foreground">
                <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />
                <span className="truncate">{task.title}</span>
                {task.minutes > 0 && (
                  <span className="shrink-0 ml-auto">{task.minutes}m</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Breaks */}
        {report.breaks.length > 0 && (
          <div>
            <span className="font-semibold text-muted-foreground">Breaks</span>
            <div className="mt-1 space-y-0.5">
              {report.breaks.map((b, i) => (
                <div key={`break-${i}`} className="flex items-center gap-1.5 text-muted-foreground">
                  <Coffee className="h-3 w-3 shrink-0 text-amber-400" />
                  <span>{b.type}</span>
                  <span className="ml-auto">{b.minutes}m</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Git Commits */}
        {report.gitCommits.length > 0 && (
          <div>
            <span className="font-semibold text-muted-foreground">Git Commits</span>
            <div className="mt-1 space-y-0.5">
              {report.gitCommits.map((c, i) => (
                <div key={`commit-${i}`} className="flex items-center gap-1.5 text-muted-foreground">
                  <GitCommit className="h-3 w-3 shrink-0 text-violet-400" />
                  <code className="text-[10px] shrink-0">{c.hash.slice(0, 7)}</code>
                  <span className="truncate">{c.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Output Note */}
        {report.outputNote && (
          <div className="pt-1 border-t border-border/30">
            <span className="font-semibold text-muted-foreground">Output Note</span>
            <p className="mt-0.5 text-muted-foreground italic">{report.outputNote}</p>
          </div>
        )}
      </div>
    </Card>
  );
}
