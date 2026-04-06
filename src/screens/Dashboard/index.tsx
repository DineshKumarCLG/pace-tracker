/**
 * Founder Dashboard — Command centre with live team status, approvals,
 * project health, velocity, upcoming leave, and alerts.
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 14.1, 14.2, 14.3, 14.4, 18.13
 */

import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import {
  Users,
  Clock,
  FileCheck,
  TrendingUp,
  TrendingDown,
  CalendarDays,
  AlertTriangle,
  ShieldAlert,
  Heart,
  Milestone,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { useDashboardStore } from "@/stores/dashboardStore";
import { useWorkspaceProofStore } from "@/stores/workspaceProofStore";
import { getCheckinStatus, getCheckinStatusLabel, getCheckinStatusEmoji, getCheckinBadgeVariant } from "@/lib/proofIntegration";
import type { DashboardData } from "@/types";

/* ── Status color mapping ── */

type DashboardStatus = DashboardData["teamStatus"][number]["status"];

const STATUS_COLORS: Record<DashboardStatus, string> = {
  Active: "bg-emerald-400 shadow-emerald-400/40",
  "On Break": "bg-amber-400 shadow-amber-400/40",
  Away: "bg-gray-400 shadow-gray-400/20",
  Offline: "bg-muted-foreground/30",
  "On Leave": "bg-indigo-400 shadow-indigo-400/40",
  WFH: "bg-sky-400 shadow-sky-400/40",
};

const STATUS_BADGE_VARIANT: Record<DashboardStatus, "success" | "warning" | "muted" | "default" | "danger"> = {
  Active: "success",
  "On Break": "warning",
  Away: "muted",
  Offline: "muted",
  "On Leave": "default",
  WFH: "default",
};

/* ── Main Component ── */

export default function DashboardScreen() {
  const data = useDashboardStore((s) => s.data);
  const loading = useDashboardStore((s) => s.loading);
  const refresh = useDashboardStore((s) => s.refresh);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading && !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-[13px] text-muted-foreground animate-pulse">Loading dashboard…</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-[13px] text-muted-foreground">No dashboard data available</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto transition-all duration-200">
      <div className="space-y-6 px-6 py-6 pb-12">
        {/* Header with gradient accent */}
        <div className="mb-2">
          <div className="flex items-center gap-3 mb-1">
            <div className="h-8 w-1 rounded-full bg-gradient-to-b from-primary to-primary/30" />
            <div>
              <h1 className="text-[26px] font-extrabold tracking-tight leading-tight">Dashboard</h1>
              <p className="text-[13px] text-muted-foreground mt-0.5 font-medium">
                Team operations at a glance
              </p>
            </div>
          </div>
        </div>

        {/* Hero metrics row — larger, accent-bordered */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard
            icon={<Clock className="h-5 w-5 text-amber-400" />}
            label="Today's Team Hours"
            value={data.todayTeamHours.toFixed(1)}
            suffix="hrs"
            accentColor="#d97706"
          />
          <Link to="/requests" className="block">
            <MetricCard
              icon={<FileCheck className="h-5 w-5 text-indigo-400" />}
              label="Pending Approvals"
              value={String(data.pendingApprovals)}
              highlight={data.pendingApprovals > 0}
              clickable
              accentColor="#6366f1"
            />
          </Link>
          <MetricCard
            icon={<Activity className="h-5 w-5 text-emerald-400" />}
            label="Weekly Velocity"
            value={String(data.weeklyVelocity.current)}
            suffix="tasks"
            trend={data.weeklyVelocity.previous > 0
              ? data.weeklyVelocity.current - data.weeklyVelocity.previous
              : undefined}
            accentColor="#10b981"
          />
        </div>

        {/* Team Status Cards (Req 13.1) — 2 column on larger screens */}
        <section>
          <SectionLabel icon={<Users className="h-3.5 w-3.5" />} label="Team Status" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            {data.teamStatus.map((member) => (
              <TeamStatusCard key={member.userId} member={member} />
            ))}
            {data.teamStatus.length === 0 && (
              <p className="text-[12px] text-muted-foreground col-span-full">No team members</p>
            )}
          </div>
        </section>

        {/* Two-column layout for velocity + upcoming leave */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Velocity Comparison (Req 14.1) */}
          <section>
            <SectionLabel icon={<TrendingUp className="h-3.5 w-3.5" />} label="Weekly Velocity" />
            <Card className="p-5 mt-3" glow>
              <VelocityComparison velocity={data.weeklyVelocity} />
            </Card>
          </section>

          {/* Upcoming Leave (Req 14.2) */}
          <section>
            <SectionLabel icon={<CalendarDays className="h-3.5 w-3.5" />} label="Upcoming Leave (14 days)" />
            <Card className="p-5 mt-3" glow>
              {data.upcomingLeave.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">No upcoming leave</p>
              ) : (
                <div className="space-y-2.5">
                  {data.upcomingLeave.map((entry, i) => (
                    <UpcomingLeaveRow key={`${entry.userId}-${entry.startDate}-${i}`} entry={entry} />
                  ))}
                </div>
              )}
            </Card>
          </section>
        </div>

        {/* Project Health (Req 13.4) */}
        {data.projectHealth.length > 0 && (
          <section>
            <SectionLabel icon={<TrendingUp className="h-3.5 w-3.5" />} label="Project Health" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
              {data.projectHealth.map((project) => (
                <ProjectHealthCard key={project.projectId} project={project} />
              ))}
            </div>
          </section>
        )}

        {/* Alerts row — side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Attendance Alerts (Req 14.3) */}
          {data.attendanceAlerts.length > 0 && (
            <section>
              <SectionLabel icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-400" />} label="Attendance Alerts" />
              <Card className="p-5 mt-3">
                <div className="space-y-2.5">
                  {data.attendanceAlerts.map((alert) => (
                    <div key={alert.userId} className="flex items-center gap-2.5 text-[12px] rounded-lg border border-amber-500/10 bg-amber-500/[0.03] px-3 py-2.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                      <span className="font-medium">{alert.name}</span>
                      <span className="text-muted-foreground">— {alert.label}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </section>
          )}

          {/* Overwork Signals (Req 26.2, 26.3) */}
          {data.overworkSignals.length > 0 && (
            <section>
              <SectionLabel icon={<Heart className="h-3.5 w-3.5 text-rose-400" />} label="Wellbeing Signals" />
              <Card className="p-5 mt-3">
                <div className="space-y-2.5">
                  {data.overworkSignals.map((signal) => (
                    <div key={signal.userId} className="flex items-start gap-2.5 text-[12px] rounded-lg border border-rose-500/10 bg-rose-500/[0.03] px-3 py-2.5">
                      <Heart className="h-3.5 w-3.5 text-rose-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-medium">{signal.name}</span>
                        <p className="text-muted-foreground mt-0.5">{signal.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </section>
          )}
        </div>

        {/* Milestone Warnings (Req 17.3) */}
        {data.milestoneWarnings.length > 0 && (
          <section>
            <SectionLabel icon={<Milestone className="h-3.5 w-3.5 text-amber-400" />} label="Milestone Deadlines" />
            <Card className="p-5 mt-3">
              <div className="space-y-2.5">
                {data.milestoneWarnings.map((ms) => (
                  <div key={ms.milestoneId} className="flex items-center gap-2 text-[12px]">
                    <ShieldAlert className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    <span className="font-medium">{ms.name}</span>
                    <span className="text-muted-foreground">({ms.projectName})</span>
                    <Badge variant={ms.daysRemaining <= 1 ? "danger" : "warning"} size="sm" className="ml-auto">
                      {ms.daysRemaining}d left
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

function MetricCard({
  icon,
  label,
  value,
  suffix,
  highlight,
  clickable,
  trend,
  accentColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  suffix?: string;
  highlight?: boolean;
  clickable?: boolean;
  trend?: number;
  accentColor?: string;
}) {
  return (
    <Card
      glow
      interactive
      className={cn(
        "relative overflow-hidden p-5",
        clickable && "hover:ring-1 hover:ring-primary/20",
        highlight && "ring-1 ring-indigo-400/30",
      )}
    >
      {/* Colored accent border */}
      <div className="absolute left-0 inset-y-0 w-[3px] rounded-l-xl" style={{ background: accentColor || "hsl(var(--primary))" }} />
      <div className="pl-3">
        <div className="flex items-center gap-2 text-muted-foreground mb-2">
          {icon}
          <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-[28px] font-extrabold leading-none tracking-tight">{value}</span>
          {suffix && <span className="text-[13px] text-muted-foreground font-medium">{suffix}</span>}
          {trend !== undefined && trend !== 0 && (
            <span className={cn("flex items-center text-[12px] font-semibold ml-auto", trend > 0 ? "text-emerald-400" : "text-rose-400")}>
              {trend > 0 ? <TrendingUp className="h-3.5 w-3.5 mr-0.5" /> : <TrendingDown className="h-3.5 w-3.5 mr-0.5" />}
              {trend > 0 ? "+" : ""}{trend}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

function TeamStatusCard({ member }: { member: DashboardData["teamStatus"][number] }) {
  const sessionProofs = useWorkspaceProofStore((s) => s.sessionProofs);

  const formatDuration = (secs: number | null) => {
    if (secs == null) return null;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  /* Check-in status badge (Task 18.13) */
  const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  const checkinStatus = getCheckinStatus(member.userId, sessionProofs, todayStart);

  // Session progress as % of 8h target
  const progressPct = member.sessionDuration != null ? Math.min((member.sessionDuration / 28800) * 100, 100) : 0;

  return (
    <Card className="p-4" interactive>
      <div className="flex items-center gap-3">
        {/* Avatar with status ring */}
        <div className="relative shrink-0">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/60 text-[14px] font-bold text-foreground">
            {member.name.charAt(0)}
          </div>
          <span className={cn("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card", STATUS_COLORS[member.status])} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold truncate">{member.name}</span>
            <Badge variant={STATUS_BADGE_VARIANT[member.status]} size="sm">
              {member.status}
            </Badge>
            {checkinStatus && (
              <Badge variant={getCheckinBadgeVariant(checkinStatus)} size="sm">
                {getCheckinStatusEmoji(checkinStatus)} {getCheckinStatusLabel(checkinStatus)}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
            {member.currentTask && (
              <span className="truncate max-w-[160px]">{member.currentTask}</span>
            )}
            {member.sessionDuration != null && (
              <span className="shrink-0">{formatDuration(member.sessionDuration)}</span>
            )}
            {!member.currentTask && member.sessionDuration == null && (
              <span>—</span>
            )}
          </div>
        </div>
      </div>
      {/* Session progress bar */}
      {member.sessionDuration != null && (
        <div className="mt-3 h-1.5 rounded-full inset-well overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${progressPct}%`,
              background: `linear-gradient(90deg, hsl(var(--session-active)) 0%, hsl(var(--primary)) 100%)`,
              boxShadow: "0 0 8px hsl(var(--primary) / 0.3)",
            }}
          />
        </div>
      )}
    </Card>
  );
}

function ProjectHealthCard({ project }: { project: DashboardData["projectHealth"][number] }) {
  const total = project.openTasks + project.overdueTasks;
  const healthPct = total > 0 ? ((total - project.overdueTasks) / total) * 100 : 100;

  return (
    <Card className="p-4" interactive>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[13px] font-semibold truncate">{project.name}</div>
        <span className="text-[11px] text-muted-foreground">{project.hoursThisWeek.toFixed(1)}h</span>
      </div>
      <div className="flex items-center gap-4 text-[11px] mb-3">
        <span className="text-muted-foreground">
          Open: <span className="font-semibold text-foreground">{project.openTasks}</span>
        </span>
        <span className={cn("text-muted-foreground", project.overdueTasks > 0 && "text-rose-400")}>
          Overdue: <span className="font-semibold">{project.overdueTasks}</span>
        </span>
      </div>
      {/* Health bar */}
      <div className="h-1.5 rounded-full inset-well overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${healthPct}%`,
            background: project.overdueTasks > 0
              ? "linear-gradient(90deg, #10b981 0%, #f59e0b 100%)"
              : "#10b981",
            boxShadow: "0 0 6px rgba(16,185,129,0.2)",
          }}
        />
      </div>
    </Card>
  );
}

function VelocityComparison({ velocity }: { velocity: DashboardData["weeklyVelocity"] }) {
  const diff = velocity.current - velocity.previous;
  const pctChange = velocity.previous > 0
    ? Math.round((diff / velocity.previous) * 100)
    : 0;
  const maxTasks = Math.max(velocity.current, velocity.previous, 1);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">This Week</div>
          <div className="text-[22px] font-bold">{velocity.current} <span className="text-[11px] text-muted-foreground font-normal">tasks</span></div>
        </div>
        <div className="space-y-1 text-right">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Last Week</div>
          <div className="text-[22px] font-bold">{velocity.previous} <span className="text-[11px] text-muted-foreground font-normal">tasks</span></div>
        </div>
        {diff !== 0 && (
          <div className={cn("flex items-center gap-1 text-[14px] font-bold", diff > 0 ? "text-emerald-400" : "text-rose-400")}>
            {diff > 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            {diff > 0 ? "+" : ""}{pctChange}%
          </div>
        )}
      </div>
      {/* Visual bars */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-muted-foreground w-16 shrink-0">This week</span>
          <div className="flex-1 h-2.5 rounded-full inset-well overflow-hidden">
            <div className="h-full rounded-full bg-emerald-400 transition-all duration-700" style={{ width: `${(velocity.current / maxTasks) * 100}%`, boxShadow: "0 0 8px rgba(16,185,129,0.3)" }} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-muted-foreground w-16 shrink-0">Last week</span>
          <div className="flex-1 h-2.5 rounded-full inset-well overflow-hidden">
            <div className="h-full rounded-full bg-muted-foreground/40 transition-all duration-700" style={{ width: `${(velocity.previous / maxTasks) * 100}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function UpcomingLeaveRow({ entry }: { entry: DashboardData["upcomingLeave"][number] }) {
  const start = new Date(entry.startDate * 1000);
  const end = new Date(entry.endDate * 1000);
  const fmt = (d: Date) => d.toLocaleDateString("en", { month: "short", day: "numeric" });

  return (
    <div className="flex items-center gap-2 text-[12px]">
      <CalendarDays className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
      <span className="font-medium">{entry.name}</span>
      <Badge variant="muted" size="sm">{entry.type}</Badge>
      <span className="text-muted-foreground ml-auto">
        {fmt(start)} – {fmt(end)}
      </span>
    </div>
  );
}
