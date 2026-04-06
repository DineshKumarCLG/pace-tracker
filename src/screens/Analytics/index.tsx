/**
 * Team Analytics screen — Individual and team metrics.
 *
 * Two tabs: "Individual" and "Team"
 * - Individual: avg daily hours, most productive day, peak focus range,
 *   task completion rate, output consistency, focus score (private)
 * - Team: hours per project, velocity trend, availability heatmap, leave impact
 * - Focus score visible ONLY on own analytics view (Req 16.2, 25.1)
 * - No comparative rankings (Req 10.6)
 * - Overwork signals with supportive language (Req 10.5)
 *
 * Requirements: 9.6, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 16.2, 25.1, 25.2
 */

import { useState } from "react";
import {
  BarChart3,
  User,
  Users,
  Clock,
  Calendar,
  Target,
  Activity,
  TrendingUp,
  Heart,
  Zap,
  Eye,
  EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { useAnalyticsStore } from "@/stores/analyticsStore";
import type { IndividualAnalytics, TeamAnalytics, FocusScore, OverworkSignal } from "@/types";

type Tab = "individual" | "team";

export default function AnalyticsScreen() {
  const [activeTab, setActiveTab] = useState<Tab>("individual");
  const individual = useAnalyticsStore((s) => s.individual);
  const team = useAnalyticsStore((s) => s.team);
  const focusScore = useAnalyticsStore((s) => s.focusScore);
  const overworkSignals = useAnalyticsStore((s) => s.overworkSignals);
  const loading = useAnalyticsStore((s) => s.loading);

  if (loading && !individual && !team) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-[13px] text-muted-foreground animate-pulse">
          Loading analytics…
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto transition-all duration-200">
      <div className="space-y-5 px-5 py-5 pb-10">
        {/* Header */}
        <div className="mb-1">
          <h1 className="text-[22px] font-bold tracking-tight leading-tight">
            Analytics
          </h1>
          <p className="text-[13px] text-muted-foreground mt-0.5 font-medium">
            Personal and team performance insights
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 p-1 rounded-lg inset-well w-fit" role="tablist">
          <TabButton
            active={activeTab === "individual"}
            onClick={() => setActiveTab("individual")}
            icon={<User className="h-3.5 w-3.5" />}
            label="Individual"
          />
          <TabButton
            active={activeTab === "team"}
            onClick={() => setActiveTab("team")}
            icon={<Users className="h-3.5 w-3.5" />}
            label="Team"
          />
        </div>

        {/* Tab content */}
        {activeTab === "individual" ? (
          <IndividualTab
            data={individual}
            focusScore={focusScore}
            overworkSignals={overworkSignals}
          />
        ) : (
          <TeamTab data={team} overworkSignals={overworkSignals} />
        )}
      </div>
    </div>
  );
}

/* ── Tab Button ── */

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-all duration-150",
        active
          ? "glass text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/* ── Section Label ── */

function SectionLabel({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
        {label}
      </span>
    </div>
  );
}

/* ── Individual Tab ── */

function IndividualTab({
  data,
  focusScore,
  overworkSignals,
}: {
  data: IndividualAnalytics | null;
  focusScore: FocusScore | null;
  overworkSignals: OverworkSignal[];
}) {
  if (!data) {
    return (
      <div className="text-[13px] text-muted-foreground">
        No individual analytics data available
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Metrics grid */}
      <section>
        <SectionLabel
          icon={<BarChart3 className="h-3.5 w-3.5" />}
          label="Your Metrics (4-week rolling)"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-2">
          <MetricCard
            icon={<Clock className="h-4 w-4 text-amber-400" />}
            label="Avg Daily Hours"
            value={data.avgDailyHours.toFixed(1)}
            suffix="hrs"
          />
          <MetricCard
            icon={<Calendar className="h-4 w-4 text-indigo-400" />}
            label="Most Productive Day"
            value={data.mostProductiveDay}
          />
          <MetricCard
            icon={<Zap className="h-4 w-4 text-amber-400" />}
            label="Peak Focus Range"
            value={data.peakFocusRange}
          />
          <MetricCard
            icon={<Target className="h-4 w-4 text-emerald-400" />}
            label="Task Completion Rate"
            value={`${Math.round(data.taskCompletionRate * 100)}%`}
          />
          <MetricCard
            icon={<Activity className="h-4 w-4 text-sky-400" />}
            label="Output Consistency"
            value={data.outputConsistency.toFixed(2)}
            suffix="σ"
          />
        </div>
      </section>

      {/* Focus Score — private, only visible to the current user (Req 16.2, 25.1) */}
      {focusScore && <FocusScoreSection score={focusScore} />}

      {/* Overwork signals (Req 10.5) */}
      {overworkSignals.length > 0 && (
        <OverworkSection signals={overworkSignals} />
      )}
    </div>
  );
}

/* ── Focus Score Section (Private) ── */

function FocusScoreSection({ score }: { score: FocusScore }) {
  return (
    <section>
      <SectionLabel
        icon={<Eye className="h-3.5 w-3.5" />}
        label="Focus Score (Private — only you can see this)"
      />
      <Card className="p-4 mt-2">
        <div className="flex items-center gap-3 mb-3">
          <Badge variant="muted" size="sm">
            <EyeOff className="h-3 w-3 mr-0.5" />
            Private
          </Badge>
          <span className="text-[11px] text-muted-foreground">
            Never shared with your team
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
              Composite
            </div>
            <div className="text-[20px] font-bold leading-tight">
              {Math.round(score.compositeScore)}
              <span className="text-[11px] text-muted-foreground font-normal">
                /100
              </span>
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
              Continuity
            </div>
            <div className="text-[16px] font-bold leading-tight">
              {Math.round(score.sessionContinuity * 100)}%
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
              Avg Uninterrupted
            </div>
            <div className="text-[16px] font-bold leading-tight">
              {Math.round(score.avgUninterruptedMin)}
              <span className="text-[11px] text-muted-foreground font-normal">
                min
              </span>
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
              Task Completion
            </div>
            <div className="text-[16px] font-bold leading-tight">
              {Math.round(score.taskCompletionRate * 100)}%
            </div>
          </div>
        </div>
      </Card>
    </section>
  );
}

/* ── Team Tab ── */

function TeamTab({
  data,
  overworkSignals,
}: {
  data: TeamAnalytics | null;
  overworkSignals: OverworkSignal[];
}) {
  if (!data) {
    return (
      <div className="text-[13px] text-muted-foreground">
        No team analytics data available
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Hours per project (Req 10.1) */}
      <section>
        <SectionLabel
          icon={<BarChart3 className="h-3.5 w-3.5" />}
          label="Hours per Project"
        />
        <Card className="p-4 mt-2">
          {data.hoursPerProject.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              No project hours recorded
            </p>
          ) : (
            <div className="space-y-3">
              {data.hoursPerProject.map((project) => (
                <ProjectHoursBar key={project.projectId} project={project} maxHours={data.hoursPerProject[0]?.totalHours ?? 1} />
              ))}
            </div>
          )}
        </Card>
      </section>

      {/* Velocity trend (Req 10.2) */}
      <section>
        <SectionLabel
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          label="Velocity Trend (8 weeks)"
        />
        <Card className="p-4 mt-2">
          {data.velocityTrend.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              No velocity data
            </p>
          ) : (
            <VelocityChart trend={data.velocityTrend} />
          )}
        </Card>
      </section>

      {/* Availability heatmap (Req 10.3) */}
      <section>
        <SectionLabel
          icon={<Calendar className="h-3.5 w-3.5" />}
          label="Availability Heatmap"
        />
        <Card className="p-4 mt-2">
          {data.availabilityHeatmap.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              No availability data
            </p>
          ) : (
            <AvailabilityHeatmap rows={data.availabilityHeatmap} />
          )}
        </Card>
      </section>

      {/* Leave impact (Req 10.4) */}
      <section>
        <SectionLabel
          icon={<Calendar className="h-3.5 w-3.5" />}
          label="Leave Impact"
        />
        <Card className="p-4 mt-2">
          <div className="flex items-baseline gap-2">
            <span className="text-[20px] font-bold">
              {data.leaveImpactPct.toFixed(1)}%
            </span>
            <span className="text-[11px] text-muted-foreground">
              reduction in team hours during leave weeks
            </span>
          </div>
        </Card>
      </section>

      {/* Overwork signals (Req 10.5) */}
      {overworkSignals.length > 0 && (
        <OverworkSection signals={overworkSignals} />
      )}
    </div>
  );
}

/* ── Shared: Overwork Section ── */

function OverworkSection({ signals }: { signals: OverworkSignal[] }) {
  return (
    <section>
      <SectionLabel
        icon={<Heart className="h-3.5 w-3.5 text-rose-400" />}
        label="Wellbeing Signals"
      />
      <Card className="p-4 mt-2">
        <div className="space-y-2">
          {signals.map((signal) => (
            <div
              key={signal.userId}
              className="flex items-start gap-2 text-[12px]"
            >
              <Heart className="h-3.5 w-3.5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-medium">{signal.name}</span>
                <p className="text-muted-foreground mt-0.5">
                  {signal.message}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </section>
  );
}

/* ── Metric Card ── */

function MetricCard({
  icon,
  label,
  value,
  suffix,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  suffix?: string;
}) {
  return (
    <Card className="p-4 flex items-center gap-3">
      <div className="shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
          {label}
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-[20px] font-bold leading-tight">{value}</span>
          {suffix && (
            <span className="text-[11px] text-muted-foreground">{suffix}</span>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ── Project Hours Bar ── */

function ProjectHoursBar({
  project,
  maxHours,
}: {
  project: TeamAnalytics["hoursPerProject"][number];
  maxHours: number;
}) {
  const pct = maxHours > 0 ? (project.totalHours / maxHours) * 100 : 0;

  return (
    <div>
      <div className="flex items-center justify-between text-[12px] mb-1">
        <span className="font-medium truncate">{project.projectName}</span>
        <span className="text-muted-foreground shrink-0 ml-2">
          {project.totalHours.toFixed(1)}h
        </span>
      </div>
      <div className="h-2 rounded-full inset-well overflow-hidden">
        <div
          className="h-full rounded-full bg-indigo-500/70 transition-all duration-300"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

/* ── Velocity Chart (simple bar chart) ── */

function VelocityChart({
  trend,
}: {
  trend: TeamAnalytics["velocityTrend"];
}) {
  const maxTasks = Math.max(...trend.map((w) => w.tasksCompleted), 1);

  return (
    <div className="flex items-end gap-2 h-[120px]">
      {trend.map((week) => {
        const heightPct =
          maxTasks > 0 ? (week.tasksCompleted / maxTasks) * 100 : 0;
        return (
          <div
            key={week.weekStart}
            className="flex-1 flex flex-col items-center gap-1"
          >
            <span className="text-[10px] font-medium text-muted-foreground">
              {week.tasksCompleted}
            </span>
            <div className="w-full flex-1 flex items-end">
              <div
                className="w-full rounded-t bg-indigo-500/60 transition-all duration-300 min-h-[2px]"
                style={{ height: `${Math.max(heightPct, 2)}%` }}
              />
            </div>
            <span className="text-[9px] text-muted-foreground/60 truncate max-w-full">
              {week.weekStart.slice(5)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Availability Heatmap ── */

function AvailabilityHeatmap({
  rows,
}: {
  rows: TeamAnalytics["availabilityHeatmap"];
}) {
  // Collect all unique dates across all rows
  const allDates = new Set<string>();
  for (const row of rows) {
    for (const dh of row.dailyHours) {
      allDates.add(dh.date);
    }
  }
  const sortedDates = [...allDates].sort();

  if (sortedDates.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground">No data to display</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr>
            <th className="text-left font-medium text-muted-foreground pr-3 pb-2">
              Member
            </th>
            {sortedDates.map((date) => (
              <th
                key={date}
                className="text-center font-medium text-muted-foreground/60 pb-2 px-0.5 min-w-[28px]"
              >
                {date.slice(8)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const hoursMap = new Map(
              row.dailyHours.map((dh) => [dh.date, dh.hours]),
            );
            return (
              <tr key={row.userId}>
                <td className="font-medium pr-3 py-1 whitespace-nowrap">
                  {row.name}
                </td>
                {sortedDates.map((date) => {
                  const hours = hoursMap.get(date) ?? 0;
                  return (
                    <td key={date} className="text-center py-1 px-0.5">
                      <div
                        className={cn(
                          "w-6 h-6 rounded-sm flex items-center justify-center text-[9px] font-medium mx-auto",
                          hours === 0
                            ? "bg-muted/30 text-muted-foreground/40"
                            : hours < 4
                              ? "bg-indigo-500/20 text-indigo-300"
                              : hours < 8
                                ? "bg-indigo-500/40 text-indigo-200"
                                : "bg-indigo-500/70 text-white",
                        )}
                        title={`${row.name}: ${hours.toFixed(1)}h on ${date}`}
                      >
                        {hours > 0 ? hours.toFixed(0) : "·"}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
