/**
 * Daily Digest — Morning digest + standup responses + end-of-day reports.
 *
 * Displays today's team activity summary:
 * 1. Morning digest: member summaries (hours, tasks, output notes), on-leave/WFH lists
 * 2. Standup responses: each member's "What are you working on today?"
 * 3. End-of-day reports: tasks, hours, breaks, meetings, git commits
 *
 * Requirements: 11.3, 12.2, 18.3
 */

import {
  Sun,
  MessageSquare,
  FileText,
  Clock,
  CheckCircle2,
  Coffee,
  GitCommit,
  Users,
  CalendarOff,
  Home,
} from "lucide-react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import type { MorningDigest, DailyReport } from "@/types";

/* ── Types for standup responses ── */

export interface StandupEntry {
  userId: string;
  name: string;
  response: string;
}

export interface DigestScreenProps {
  digest: MorningDigest | null;
  standupResponses: StandupEntry[];
  eodReports: (DailyReport & { userName: string })[];
}

/* ── Main Component ── */

export default function DigestScreen({
  digest = null,
  standupResponses = [],
  eodReports = [],
}: Partial<DigestScreenProps> = {}) {
  const hasContent = digest || standupResponses.length > 0 || eodReports.length > 0;

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

        {/* Morning Digest (Req 12.2) */}
        {digest && <MorningDigestSection digest={digest} />}

        {/* Standup Responses (Req 18.3) */}
        {standupResponses.length > 0 && (
          <StandupSection responses={standupResponses} />
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

/* ── Morning Digest Section ── */

function MorningDigestSection({ digest }: { digest: MorningDigest }) {
  return (
    <section>
      <SectionLabel icon={<Sun className="h-3.5 w-3.5 text-amber-400" />} label="Morning Digest" />

      {/* On-leave / WFH status */}
      {(digest.onLeaveToday.length > 0 || digest.onWfhToday.length > 0) && (
        <Card className="p-4 mt-2 mb-3">
          <div className="space-y-2">
            {digest.onLeaveToday.length > 0 && (
              <div className="flex items-center gap-2 text-[12px]">
                <CalendarOff className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                <span className="font-medium">On Leave:</span>
                <span className="text-muted-foreground">{digest.onLeaveToday.join(", ")}</span>
              </div>
            )}
            {digest.onWfhToday.length > 0 && (
              <div className="flex items-center gap-2 text-[12px]">
                <Home className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                <span className="font-medium">WFH:</span>
                <span className="text-muted-foreground">{digest.onWfhToday.join(", ")}</span>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Member summaries */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-2">
        {digest.memberSummaries.map((member) => (
          <MemberSummaryCard key={member.userId} member={member} />
        ))}
        {digest.memberSummaries.length === 0 && (
          <p className="text-[12px] text-muted-foreground col-span-full">No member summaries</p>
        )}
      </div>
    </section>
  );
}

function MemberSummaryCard({
  member,
}: {
  member: MorningDigest["memberSummaries"][number];
}) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 mb-2">
        <Users className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
        <span className="text-[13px] font-semibold truncate">{member.name}</span>
      </div>
      <div className="space-y-1 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3 w-3 shrink-0" />
          <span>{member.totalHours.toFixed(1)}h logged</span>
        </div>
        {member.tasksCompleted.length > 0 && (
          <div className="flex items-start gap-1.5">
            <CheckCircle2 className="h-3 w-3 shrink-0 mt-0.5" />
            <span>{member.tasksCompleted.join(", ")}</span>
          </div>
        )}
        {member.outputNote && (
          <div className="flex items-start gap-1.5">
            <FileText className="h-3 w-3 shrink-0 mt-0.5" />
            <span className="italic">{member.outputNote}</span>
          </div>
        )}
      </div>
    </Card>
  );
}

/* ── Standup Responses Section ── */

function StandupSection({ responses }: { responses: StandupEntry[] }) {
  return (
    <section>
      <SectionLabel
        icon={<MessageSquare className="h-3.5 w-3.5 text-indigo-400" />}
        label="Standup Responses"
      />
      <div className="space-y-3 mt-2">
        {responses.map((entry) => (
          <Card key={entry.userId} className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[13px] font-semibold">{entry.name}</span>
            </div>
            <p className="text-[12px] text-muted-foreground">{entry.response}</p>
          </Card>
        ))}
      </div>
    </section>
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

        {/* Meetings */}
        {report.meetings.length > 0 && (
          <div>
            <span className="font-semibold text-muted-foreground">Meetings</span>
            <div className="mt-1 space-y-0.5">
              {report.meetings.map((m, i) => (
                <div key={`meeting-${i}`} className="flex items-center gap-1.5 text-muted-foreground">
                  <MessageSquare className="h-3 w-3 shrink-0 text-indigo-400" />
                  <span className="truncate">{m.title}</span>
                  <span className="ml-auto">{m.minutes}m</span>
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
