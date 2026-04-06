import { useState, useMemo } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  ListChecks,
  CalendarDays,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import HoursChart from "./HoursChart";
import ProjectBars from "./ProjectBars";
import OutputLog from "./OutputLog";
import NeedsAttention from "./NeedsAttention";
import TeamReview from "./TeamReview";
import AIReviewDraft from "./AIReviewDraft";
import { getWeekRange, formatWeekLabel, getWeeklyMockData, type WeeklyData } from "./reviewData";

type Tab = "personal" | "team";

/* ── KPI Card ── */
function KpiCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-[var(--radius-kpi-card)] glass noise cursor-default transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0">
      <div className="relative p-3.5">
        <div className="flex items-center gap-1.5 text-muted-foreground mb-1.5">
          {icon}
          <span className="text-[10px] font-semibold uppercase tracking-widest">
            {label}
          </span>
        </div>
        <p className="text-[22px] font-bold tabular-nums tracking-tight leading-none">
          {value}
        </p>
        {sub && (
          <p className="text-[10px] text-muted-foreground mt-1 font-medium">
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}

/* ── KPI Row ── */
function KpiRow({ data }: { data: WeeklyData }) {
  return (
    <div
      className="grid grid-cols-4 gap-3 animate-slide-up"
      style={{ animationDelay: "80ms" }}
    >
      <KpiCard
        icon={<Clock className="h-3.5 w-3.5" />}
        label="Hours"
        value={`${data.totalHours.toFixed(1)}h`}
        sub={`${data.weekdayHours.toFixed(1)}h weekday · ${data.weekendHours.toFixed(1)}h weekend`}
      />
      <KpiCard
        icon={<ListChecks className="h-3.5 w-3.5" />}
        label="Tasks Closed"
        value={String(data.tasksClosed)}
      />
      <KpiCard
        icon={<CalendarDays className="h-3.5 w-3.5" />}
        label="Active Days"
        value={String(data.activeDays)}
      />
      <KpiCard
        icon={<FileText className="h-3.5 w-3.5" />}
        label="Notes"
        value={String(data.outputNotes.length)}
      />
    </div>
  );
}

/* ── Next Priority Field ── */
function NextPriority() {
  const [value, setValue] = useState("");
  return (
    <div className="glass noise rounded-xl p-4 animate-slide-up" style={{ animationDelay: "320ms" }}>
      <h3 className="text-[12px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
        One priority for next week
      </h3>
      <textarea
        className="w-full rounded-lg inset-well px-3 py-2.5 text-[13px] text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-1 focus:ring-primary/40"
        rows={2}
        placeholder="What's the single most important thing to focus on?"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </div>
  );
}

/* ── Main Review Screen ── */
export default function ReviewScreen() {
  const [tab, setTab] = useState<Tab>("personal");
  const [weekOffset, setWeekOffset] = useState(0);
  const userId = useAuthStore((s) => s.user?.id ?? "default-user");

  const { weekStart, weekEnd } = useMemo(
    () => getWeekRange(weekOffset),
    [weekOffset],
  );
  const weekLabel = useMemo(() => formatWeekLabel(weekStart, weekEnd), [weekStart, weekEnd]);
  const data = useMemo(() => getWeeklyMockData(weekOffset), [weekOffset]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[780px] space-y-5 px-4 sm:px-6 py-5 sm:py-6 pb-12">
        {/* Header with gradient accent */}
        <div className="mb-2">
          <div className="flex items-center gap-3 mb-1">
            <div className="h-8 w-1 rounded-full bg-gradient-to-b from-primary to-primary/30" />
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-[24px] sm:text-[26px] font-extrabold tracking-tight leading-tight">
                    Review
                  </h1>
                  <p className="text-[12px] sm:text-[13px] text-muted-foreground mt-0.5 font-medium">
                    Weekly summary & insights
                  </p>
                </div>
                {/* Week navigation */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setWeekOffset((o) => o - 1)}
                    className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    aria-label="Previous week"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="text-[12px] font-semibold tabular-nums min-w-[140px] text-center">
                    {weekLabel}
                  </span>
                  <button
                    onClick={() => setWeekOffset((o) => Math.min(o + 1, 0))}
                    disabled={weekOffset >= 0}
                    className={cn(
                      "rounded-md p-1.5 transition-colors",
                      weekOffset >= 0
                        ? "text-muted-foreground/30 cursor-not-allowed"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent",
                    )}
                    aria-label="Next week"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 p-1 rounded-lg inset-well w-fit">
          {(["personal", "team"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-md px-4 py-1.5 text-[12px] font-semibold transition-all duration-150",
                tab === t
                  ? "btn-ghost text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "personal" ? "Personal" : "Team"}
            </button>
          ))}
        </div>

        {/* Content */}
        {tab === "personal" ? (
          <div className="space-y-5">
            <KpiRow data={data} />

            {/* Two-column layout for chart + project bars */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <HoursChart data={data.dailyHours} />
              <ProjectBars data={data.projectBreakdown} />
            </div>

            <OutputLog notes={data.outputNotes} />
            <NeedsAttention
              staleTasks={data.staleTasks}
              blockedTasks={data.blockedTasks}
            />

            {/* Two-column for AI draft + priority */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <AIReviewDraft
                userId={userId}
                weekStart={Math.floor(weekStart.getTime() / 1000)}
                aiEnabled={true}
              />
              <NextPriority />
            </div>
          </div>
        ) : (
          <div className="animate-slide-up">
            <TeamReview weekOffset={weekOffset} />
          </div>
        )}
      </div>
    </div>
  );
}
