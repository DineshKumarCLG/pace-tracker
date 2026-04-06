/**
 * Leave Management Screen — Monthly calendar view of team leave.
 *
 * Rows: one per team member
 * Columns: one per day of the selected month
 * Color coding: annual (indigo), sick (red), WFH (amber), public holiday (emerald)
 * Month navigation with prev/next arrows
 * Summary bar: available / on-leave / WFH counts for today
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4
 */

import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, Users, Palmtree, Laptop, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import Button from "@/components/ui/Button";
import { useLeaveStore } from "@/stores/leaveStore";
import { useTeamStore } from "@/stores/teamStore";
import LeaveRequestForm from "./LeaveRequestForm";
import type { PublicHoliday } from "@/types";

/* ── Helpers ── */

/** Get all days in a given month (1-indexed month). */
function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const count = new Date(year, month, 0).getDate();
  for (let d = 1; d <= count; d++) {
    days.push(new Date(year, month - 1, d));
  }
  return days;
}

/** Format a Date to YYYY-MM-DD for comparison. */
function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Convert a UTC timestamp to a local YYYY-MM-DD key. */
function timestampToDateKey(ts: number): string {
  const d = new Date(ts * 1000);
  return toDateKey(d);
}

type CellStatus = "annual" | "sick" | "wfh" | "holiday" | null;

const STATUS_COLORS: Record<NonNullable<CellStatus>, string> = {
  annual: "bg-indigo-500/80 border-indigo-400/30",
  sick: "bg-red-500/70 border-red-400/30",
  wfh: "bg-amber-500/70 border-amber-400/30",
  holiday: "bg-emerald-500/60 border-emerald-400/30",
};

const STATUS_LABELS: Record<NonNullable<CellStatus>, string> = {
  annual: "Annual Leave",
  sick: "Sick Leave",
  wfh: "WFH",
  holiday: "Public Holiday",
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/* ── Component ── */

export default function LeaveScreen() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-indexed
  const [showRequestForm, setShowRequestForm] = useState(false);

  const requests = useLeaveStore((s) => s.requests);
  const publicHolidays = useLeaveStore((s) => s.publicHolidays);
  const members = useTeamStore((s) => s.members);
  const memberList = useMemo(() => Object.values(members), [members]);

  const days = useMemo(() => getDaysInMonth(year, month), [year, month]);

  /* Build a lookup: userId → dateKey → CellStatus */
  const cellMap = useMemo(() => {
    const map: Record<string, Record<string, CellStatus>> = {};

    // Holiday dates for this month
    const holidayKeys = new Set<string>();
    for (const h of publicHolidays) {
      const key = timestampToDateKey(h.date);
      holidayKeys.add(key);
    }

    // For each member, mark holiday cells
    for (const m of memberList) {
      if (!map[m.userId]) map[m.userId] = {};
      for (const day of days) {
        const key = toDateKey(day);
        if (holidayKeys.has(key)) {
          map[m.userId][key] = "holiday";
        }
      }
    }

    // Approved leave requests
    const approved = requests.filter((r) => r.status === "approved");
    for (const req of approved) {
      const uid = req.requesterId;
      if (!map[uid]) map[uid] = {};

      // Walk each day in the request range
      const start = new Date(req.startDate * 1000);
      const end = new Date(req.endDate * 1000);
      const cursor = new Date(start);
      while (cursor <= end) {
        const key = toDateKey(cursor);
        // Only mark if within the displayed month
        if (cursor.getFullYear() === year && cursor.getMonth() + 1 === month) {
          // Leave type overrides holiday (leave is more specific)
          const status: CellStatus =
            req.type === "annual" ? "annual" :
            req.type === "sick" ? "sick" : "wfh";
          map[uid][key] = status;
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    return map;
  }, [requests, publicHolidays, memberList, days, year, month]);

  /* Summary bar: counts for today */
  const todaySummary = useMemo(() => {
    const todayKey = toDateKey(now);
    let onLeave = 0;
    let onWfh = 0;

    for (const m of memberList) {
      const status = cellMap[m.userId]?.[todayKey];
      if (status === "annual" || status === "sick") onLeave++;
      else if (status === "wfh") onWfh++;
    }

    const available = memberList.length - onLeave - onWfh;
    return { available, onLeave, onWfh };
  }, [cellMap, memberList, now]);

  /* Navigation */
  function prevMonth() {
    if (month === 1) { setMonth(12); setYear(year - 1); }
    else setMonth(month - 1);
  }
  function nextMonth() {
    if (month === 12) { setMonth(1); setYear(year + 1); }
    else setMonth(month + 1);
  }

  const todayKey = toDateKey(now);

  return (
    <div className="h-full overflow-y-auto transition-all duration-200">
      <div className="space-y-4 px-5 py-5 pb-10">
        {/* Header */}
        <div className="mb-1 flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight leading-tight">Leave</h1>
            <p className="text-[13px] text-muted-foreground mt-0.5 font-medium">
              Team leave calendar
            </p>
          </div>
          <Button variant="primary" size="sm" onClick={() => setShowRequestForm(true)}>
            <Plus className="h-3.5 w-3.5" />
            Request Leave
          </Button>
        </div>

        {/* Summary bar */}
        <div className="flex gap-3">
          <SummaryPill icon={<Users className="h-3.5 w-3.5" />} label="Available" count={todaySummary.available} color="text-emerald-400" />
          <SummaryPill icon={<Palmtree className="h-3.5 w-3.5" />} label="On Leave" count={todaySummary.onLeave} color="text-indigo-400" />
          <SummaryPill icon={<Laptop className="h-3.5 w-3.5" />} label="WFH" count={todaySummary.onWfh} color="text-amber-400" />
        </div>

        {/* Month navigation */}
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

        {/* Legend */}
        <div className="flex flex-wrap gap-3 text-[11px] font-medium text-muted-foreground">
          {(Object.keys(STATUS_COLORS) as NonNullable<CellStatus>[]).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className={cn("h-2.5 w-2.5 rounded-sm border", STATUS_COLORS[s])} />
              {STATUS_LABELS[s]}
            </span>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="glass noise rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-card/90 backdrop-blur-sm px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 min-w-[120px]">
                    Member
                  </th>
                  {days.map((d) => {
                    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                    const isToday = toDateKey(d) === todayKey;
                    return (
                      <th
                        key={d.getDate()}
                        className={cn(
                          "px-0 py-2 text-center font-semibold min-w-[28px]",
                          isWeekend ? "text-muted-foreground/30" : "text-muted-foreground/60",
                          isToday && "text-primary",
                        )}
                      >
                        <div className="text-[9px] uppercase">
                          {d.toLocaleDateString("en", { weekday: "narrow" })}
                        </div>
                        <div className={cn("text-[11px]", isToday && "font-bold")}>{d.getDate()}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {memberList.length === 0 ? (
                  <tr>
                    <td colSpan={days.length + 1} className="px-3 py-8 text-center text-[13px] text-muted-foreground">
                      No team members found
                    </td>
                  </tr>
                ) : (
                  memberList.map((m) => (
                    <tr key={m.userId} className="border-t border-border/30 hover:bg-accent/20 transition-colors">
                      <td className="sticky left-0 z-10 bg-card/90 backdrop-blur-sm px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <div
                            className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold shrink-0"
                            style={{
                              background: `linear-gradient(135deg, ${m.avatarColor} 0%, ${m.avatarColor}cc 100%)`,
                              color: "hsl(30 20% 8%)",
                            }}
                          >
                            {m.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-[12px] font-medium truncate max-w-[80px]">{m.name}</span>
                        </div>
                      </td>
                      {days.map((d) => {
                        const key = toDateKey(d);
                        const status = cellMap[m.userId]?.[key] ?? null;
                        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                        const isToday = key === todayKey;
                        return (
                          <td
                            key={d.getDate()}
                            className={cn("px-0.5 py-1 text-center", isWeekend && !status && "opacity-30")}
                          >
                            <div
                              className={cn(
                                "mx-auto h-5 w-5 rounded-sm border transition-colors",
                                status
                                  ? STATUS_COLORS[status]
                                  : "border-border/20 bg-transparent",
                                isToday && !status && "ring-1 ring-primary/40",
                              )}
                              title={status ? `${m.name}: ${STATUS_LABELS[status]}` : undefined}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Holiday list for this month */}
        <HolidayList holidays={publicHolidays} year={year} month={month} />
      </div>

      {/* Leave Request Modal */}
      <LeaveRequestForm open={showRequestForm} onClose={() => setShowRequestForm(false)} />
    </div>
  );
}

/* ── Sub-components ── */

function SummaryPill({ icon, label, count, color }: { icon: React.ReactNode; label: string; count: number; color: string }) {
  return (
    <div className="glass noise rounded-lg px-3 py-2 flex items-center gap-2 min-w-[100px]">
      <span className={cn("shrink-0", color)}>{icon}</span>
      <div>
        <div className="text-[16px] font-bold leading-tight">{count}</div>
        <div className="text-[10px] font-medium text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function HolidayList({ holidays, year, month }: { holidays: PublicHoliday[]; year: number; month: number }) {
  const monthHolidays = holidays.filter((h) => {
    const d = new Date(h.date * 1000);
    return d.getFullYear() === year && d.getMonth() + 1 === month;
  });

  if (monthHolidays.length === 0) return null;

  return (
    <div className="glass noise rounded-xl p-4">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-2">
        Public Holidays
      </h3>
      <div className="space-y-1.5">
        {monthHolidays.map((h) => {
          const d = new Date(h.date * 1000);
          return (
            <div key={h.id} className="flex items-center gap-2 text-[12px]">
              <span className="h-2 w-2 rounded-sm bg-emerald-500/60 border border-emerald-400/30 shrink-0" />
              <span className="font-medium">{h.name}</span>
              <span className="text-muted-foreground ml-auto">
                {d.toLocaleDateString("en", { month: "short", day: "numeric" })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
