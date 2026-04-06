/**
 * Individual analytics computation for PACE v2 Team Ops.
 *
 * Computes personal work metrics from attendance records, sessions, and tasks
 * over a 4-week rolling window. All functions are pure — inputs are passed explicitly.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

import type { AttendanceRecord, Session, Task, IndividualAnalytics, FocusScore, Break, IdleEvent } from "@/types";

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * Compute average daily hours from attendance records (Req 9.1).
 *
 * Mean of totalHours across all days in the provided records.
 * Returns 0 if no records.
 */
export function computeAvgDailyHours(records: AttendanceRecord[]): number {
  if (records.length === 0) return 0;
  const total = records.reduce((sum, r) => sum + r.totalHours, 0);
  return total / records.length;
}

/**
 * Compute the most productive day of the week (Req 9.2).
 *
 * Weekday with the highest average session hours across the provided records.
 * Returns "Monday" as default when no records exist.
 */
export function computeMostProductiveDay(records: AttendanceRecord[]): string {
  if (records.length === 0) return "Monday";

  // Accumulate hours per weekday (0=Sunday..6=Saturday)
  const dayTotals: number[] = [0, 0, 0, 0, 0, 0, 0];
  const dayCounts: number[] = [0, 0, 0, 0, 0, 0, 0];

  for (const record of records) {
    const dayOfWeek = getWeekdayFromDateString(record.date);
    dayTotals[dayOfWeek] += record.totalHours;
    dayCounts[dayOfWeek] += 1;
  }

  let bestDay = 1; // default Monday
  let bestAvg = -1;

  for (let i = 0; i < 7; i++) {
    if (dayCounts[i] > 0) {
      const avg = dayTotals[i] / dayCounts[i];
      if (avg > bestAvg) {
        bestAvg = avg;
        bestDay = i;
      }
    }
  }

  return WEEKDAY_NAMES[bestDay];
}

/**
 * Compute peak focus time range (Req 9.3).
 *
 * Simplified: finds the hour-of-day with the most total session hours logged,
 * then returns a 2-hour range string like "10:00-12:00".
 *
 * Sessions are split into per-hour buckets based on their start/end times.
 * Returns "09:00-11:00" as default when no sessions exist.
 */
export function computePeakFocusRange(sessions: Session[]): string {
  // Filter to closed sessions only
  const closed = sessions.filter((s) => s.endTime !== null);
  if (closed.length === 0) return "09:00-11:00";

  // Accumulate seconds per hour bucket (0-23)
  const hourBuckets: number[] = new Array(24).fill(0);

  for (const session of closed) {
    const startSec = session.startTime;
    const endSec = session.endTime!;

    // Walk through each hour the session spans
    let cursor = startSec;
    while (cursor < endSec) {
      const cursorDate = new Date(cursor * 1000);
      const hour = cursorDate.getUTCHours();

      // End of this hour bucket
      const nextHourStart = new Date(cursor * 1000);
      nextHourStart.setUTCMinutes(0, 0, 0);
      nextHourStart.setUTCHours(hour + 1);
      const nextHourTimestamp = Math.floor(nextHourStart.getTime() / 1000);

      const bucketEnd = Math.min(nextHourTimestamp, endSec);
      hourBuckets[hour] += bucketEnd - cursor;

      cursor = bucketEnd;
    }
  }

  // Find the hour with the most seconds
  let peakHour = 9; // default
  let peakSeconds = -1;

  for (let h = 0; h < 24; h++) {
    if (hourBuckets[h] > peakSeconds) {
      peakSeconds = hourBuckets[h];
      peakHour = h;
    }
  }

  const startHour = peakHour;
  const endHour = startHour + 2;

  return `${padHour(startHour)}:00-${padHour(endHour)}:00`;
}

/**
 * Compute task completion rate (Req 9.4).
 *
 * tasks done / tasks assigned, expressed as 0.0 - 1.0.
 * Returns 0 if no tasks assigned.
 */
export function computeTaskCompletionRate(tasks: Task[]): number {
  if (tasks.length === 0) return 0;
  const done = tasks.filter((t) => t.status === "done").length;
  return done / tasks.length;
}

/**
 * Compute output consistency as standard deviation of daily hours (Req 9.5).
 *
 * Lower value = more consistent output.
 * Returns 0 if fewer than 2 records.
 */
export function computeOutputConsistency(records: AttendanceRecord[]): number {
  if (records.length < 2) return 0;

  const hours = records.map((r) => r.totalHours);
  const mean = hours.reduce((sum, h) => sum + h, 0) / hours.length;
  const squaredDiffs = hours.map((h) => (h - mean) ** 2);
  const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / hours.length;

  return Math.sqrt(variance);
}

/**
 * Compute full individual analytics from attendance records, sessions, and tasks.
 *
 * This is the main entry point — equivalent to the `get_individual_analytics()` command.
 * All data should be pre-filtered to the 4-week rolling window by the caller.
 *
 * @param userId - The user ID
 * @param attendanceRecords - Attendance records for the user within the 4-week window
 * @param sessions - Sessions for the user within the 4-week window
 * @param tasks - Tasks assigned to the user within the 4-week window
 */
export function getIndividualAnalytics(
  userId: string,
  attendanceRecords: AttendanceRecord[],
  sessions: Session[],
  tasks: Task[],
): IndividualAnalytics {
  return {
    userId,
    avgDailyHours: computeAvgDailyHours(attendanceRecords),
    mostProductiveDay: computeMostProductiveDay(attendanceRecords),
    peakFocusRange: computePeakFocusRange(sessions),
    taskCompletionRate: computeTaskCompletionRate(tasks),
    outputConsistency: computeOutputConsistency(attendanceRecords),
  };
}

// ── Helpers ──

/**
 * Get the day of week (0=Sunday..6=Saturday) from a YYYY-MM-DD date string.
 */
function getWeekdayFromDateString(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCDay();
}

/**
 * Pad an hour number to 2 digits.
 */
function padHour(h: number): string {
  return String(h).padStart(2, "0");
}


// ── Team Analytics (Req 10.1, 10.2, 10.3, 10.4, 10.6) ──

import type { TeamAnalytics, LeaveRequest, SessionTask, Project } from "@/types";

/**
 * Compute combined hours per project (Req 10.1).
 *
 * Groups session-task segments by project and sums durations.
 * Only closed session-tasks (endTime !== null) are counted.
 *
 * @param sessionTasks - All session-task records for the team in the time period
 * @param tasks - All tasks (used to resolve projectId)
 * @param projects - All projects (used to resolve project name)
 */
export function computeHoursPerProject(
  sessionTasks: SessionTask[],
  tasks: Task[],
  projects: Project[],
): TeamAnalytics["hoursPerProject"] {
  const taskProjectMap = new Map<string, string>();
  for (const t of tasks) {
    taskProjectMap.set(t.id, t.projectId);
  }

  const projectNameMap = new Map<string, string>();
  for (const p of projects) {
    projectNameMap.set(p.id, p.name);
  }

  const hoursByProject = new Map<string, number>();

  for (const st of sessionTasks) {
    if (st.endTime === null) continue;
    const projectId = taskProjectMap.get(st.taskId);
    if (!projectId) continue;

    const hours = (st.endTime - st.startTime) / 3600;
    hoursByProject.set(projectId, (hoursByProject.get(projectId) ?? 0) + hours);
  }

  const result: TeamAnalytics["hoursPerProject"] = [];
  for (const [projectId, totalHours] of hoursByProject) {
    result.push({
      projectId,
      projectName: projectNameMap.get(projectId) ?? projectId,
      totalHours,
    });
  }

  // Sort by totalHours descending for consistent output
  result.sort((a, b) => b.totalHours - a.totalHours);
  return result;
}

/**
 * Compute velocity trend over 8 weeks (Req 10.2).
 *
 * Counts tasks moved to "done" per ISO week. Weeks are identified by
 * their Monday start date (YYYY-MM-DD).
 *
 * @param tasks - All tasks for the team
 * @param referenceDate - The "now" date to compute 8 weeks back from (UTC timestamp in seconds)
 */
export function computeVelocityTrend(
  tasks: Task[],
  referenceDate: number,
): TeamAnalytics["velocityTrend"] {
  // Compute 8 week boundaries (Monday-based)
  const weeks: Array<{ weekStart: string; startTs: number; endTs: number }> = [];
  const refDate = new Date(referenceDate * 1000);

  // Find the Monday of the current week
  const refDay = refDate.getUTCDay(); // 0=Sun..6=Sat
  const daysToMonday = refDay === 0 ? 6 : refDay - 1;
  const currentMonday = new Date(refDate);
  currentMonday.setUTCDate(refDate.getUTCDate() - daysToMonday);
  currentMonday.setUTCHours(0, 0, 0, 0);

  for (let i = 7; i >= 0; i--) {
    const weekStart = new Date(currentMonday);
    weekStart.setUTCDate(currentMonday.getUTCDate() - i * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekStart.getUTCDate() + 7);

    const y = weekStart.getUTCFullYear();
    const m = String(weekStart.getUTCMonth() + 1).padStart(2, "0");
    const d = String(weekStart.getUTCDate()).padStart(2, "0");

    weeks.push({
      weekStart: `${y}-${m}-${d}`,
      startTs: Math.floor(weekStart.getTime() / 1000),
      endTs: Math.floor(weekEnd.getTime() / 1000),
    });
  }

  // Count done tasks per week by closedAt timestamp
  return weeks.map((w) => {
    const count = tasks.filter(
      (t) =>
        t.status === "done" &&
        t.closedAt !== null &&
        t.closedAt >= w.startTs &&
        t.closedAt < w.endTs,
    ).length;

    return { weekStart: w.weekStart, tasksCompleted: count };
  });
}

/**
 * Compute availability heatmap over 4 weeks (Req 10.3).
 *
 * Shows daily hours per team member. Each member gets a row with
 * an array of { date, hours } entries for each day in the 4-week window.
 *
 * @param attendanceRecords - All attendance records for the team in the 4-week window
 * @param teamMembers - All team members (for names)
 */
export function computeAvailabilityHeatmap(
  attendanceRecords: AttendanceRecord[],
  teamMembers: Array<{ userId: string; name: string }>,
): TeamAnalytics["availabilityHeatmap"] {
  // Build a lookup: userId → date → hours
  const hoursMap = new Map<string, Map<string, number>>();

  for (const record of attendanceRecords) {
    let userMap = hoursMap.get(record.userId);
    if (!userMap) {
      userMap = new Map();
      hoursMap.set(record.userId, userMap);
    }
    userMap.set(record.date, record.totalHours);
  }

  // Collect all unique dates sorted
  const allDates = new Set<string>();
  for (const record of attendanceRecords) {
    allDates.add(record.date);
  }
  const sortedDates = [...allDates].sort();

  return teamMembers.map((member) => {
    const userMap = hoursMap.get(member.userId);
    const dailyHours = sortedDates.map((date) => ({
      date,
      hours: userMap?.get(date) ?? 0,
    }));

    return {
      userId: member.userId,
      name: member.name,
      dailyHours,
    };
  });
}

/**
 * Compute leave impact percentage (Req 10.4).
 *
 * Percentage reduction in total team hours during weeks with approved leave
 * compared to the 4-week average.
 *
 * Formula: leaveImpactPct = ((avgWeeklyHours - avgLeaveWeekHours) / avgWeeklyHours) * 100
 * Returns 0 if no data or no leave weeks.
 *
 * @param attendanceRecords - All attendance records for the team in the 4-week window
 * @param leaveRequests - Approved leave requests (annual/sick, not WFH) in the window
 */
export function computeLeaveImpactPct(
  attendanceRecords: AttendanceRecord[],
  leaveRequests: LeaveRequest[],
): number {
  if (attendanceRecords.length === 0) return 0;

  // Group attendance hours by ISO week (Monday start)
  const weeklyHours = new Map<string, number>();

  for (const record of attendanceRecords) {
    const weekStart = getWeekStartFromDateString(record.date);
    weeklyHours.set(weekStart, (weeklyHours.get(weekStart) ?? 0) + record.totalHours);
  }

  if (weeklyHours.size === 0) return 0;

  // Compute overall average weekly hours
  const allWeekHours = [...weeklyHours.values()];
  const avgWeeklyHours = allWeekHours.reduce((s, h) => s + h, 0) / allWeekHours.length;

  if (avgWeeklyHours === 0) return 0;

  // Identify weeks that contain approved leave (annual or sick, not WFH)
  const approvedLeave = leaveRequests.filter(
    (lr) => lr.status === "approved" && (lr.type === "annual" || lr.type === "sick"),
  );

  if (approvedLeave.length === 0) return 0;

  // Find which weeks have leave
  const leaveWeeks = new Set<string>();
  for (const lr of approvedLeave) {
    // Walk through each day of the leave request
    const startDate = new Date(lr.startDate * 1000);
    const endDate = new Date(lr.endDate * 1000);
    const cursor = new Date(startDate);

    while (cursor <= endDate) {
      const y = cursor.getUTCFullYear();
      const m = String(cursor.getUTCMonth() + 1).padStart(2, "0");
      const d = String(cursor.getUTCDate()).padStart(2, "0");
      const dateStr = `${y}-${m}-${d}`;
      const weekStart = getWeekStartFromDateString(dateStr);
      leaveWeeks.add(weekStart);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  // Compute average hours for leave weeks
  const leaveWeekHours: number[] = [];
  for (const week of leaveWeeks) {
    const hours = weeklyHours.get(week);
    if (hours !== undefined) {
      leaveWeekHours.push(hours);
    }
  }

  if (leaveWeekHours.length === 0) return 0;

  const avgLeaveWeekHours =
    leaveWeekHours.reduce((s, h) => s + h, 0) / leaveWeekHours.length;

  // Percentage reduction
  const impact = ((avgWeeklyHours - avgLeaveWeekHours) / avgWeeklyHours) * 100;

  // Clamp to 0-100 (negative means leave weeks had MORE hours, which means 0 impact)
  return Math.max(0, Math.min(100, impact));
}

/**
 * Compute full team analytics — the main entry point for `get_team_analytics()`.
 *
 * All data should be pre-filtered to the appropriate windows by the caller.
 * No comparative rankings between members (Req 10.6).
 *
 * @param sessionTasks - Session-task records for the team
 * @param tasks - All tasks for the team
 * @param projects - All projects
 * @param attendanceRecords - Attendance records for the 4-week window
 * @param teamMembers - Team member info (userId + name)
 * @param leaveRequests - Approved leave requests in the window
 * @param referenceDate - "Now" as UTC timestamp in seconds (for velocity trend)
 */
export function getTeamAnalytics(
  sessionTasks: SessionTask[],
  tasks: Task[],
  projects: Project[],
  attendanceRecords: AttendanceRecord[],
  teamMembers: Array<{ userId: string; name: string }>,
  leaveRequests: LeaveRequest[],
  referenceDate: number,
): TeamAnalytics {
  return {
    hoursPerProject: computeHoursPerProject(sessionTasks, tasks, projects),
    velocityTrend: computeVelocityTrend(tasks, referenceDate),
    availabilityHeatmap: computeAvailabilityHeatmap(attendanceRecords, teamMembers),
    leaveImpactPct: computeLeaveImpactPct(attendanceRecords, leaveRequests),
  };
}

/**
 * Get the Monday-based week start (YYYY-MM-DD) for a given date string.
 */
function getWeekStartFromDateString(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = d.getUTCDay(); // 0=Sun..6=Sat
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  d.setUTCDate(d.getUTCDate() - daysToMonday);

  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}


// ── Focus Score (Req 16.1, 16.2, 16.3, 16.4) ──

/**
 * Merge breaks and idle events into a single sorted list of interruptions.
 * Only includes resolved (endTime !== null) entries.
 */
function mergeInterruptions(
  breaks: Break[],
  idleEvents: IdleEvent[],
): Array<{ startTime: number; endTime: number }> {
  const result: Array<{ startTime: number; endTime: number }> = [];

  for (const b of breaks) {
    if (b.endTime !== null) {
      result.push({ startTime: b.startTime, endTime: b.endTime });
    }
  }
  for (const ie of idleEvents) {
    if (ie.endTime !== null) {
      result.push({ startTime: ie.startTime, endTime: ie.endTime });
    }
  }

  result.sort((a, b) => a.startTime - b.startTime);
  return result;
}

/**
 * Compute focus score from sessions, breaks, idle events, and tasks.
 *
 * Pure function — all data is passed explicitly. The caller is responsible for
 * filtering to the appropriate time window (default 28 days).
 *
 * Algorithm:
 *   1. session_continuity = (total_session_secs - total_break_secs) / total_session_secs
 *   2. avg_uninterrupted_min = mean(uninterrupted segment lengths) / 60
 *   3. task_completion_rate = done / assigned
 *   4. composite = (session_continuity × 0.4 + min(avg_uninterrupted_min / 60, 1.0) × 0.3 + task_completion_rate × 0.3) × 100
 *
 * Focus score is LOCAL-ONLY — never synced to PocketBase (Req 16.3, 16.4).
 *
 * @param sessions - Closed sessions within the window
 * @param sessionBreaks - Map of sessionId → Break[] for those sessions
 * @param sessionIdleEvents - Map of sessionId → IdleEvent[] for those sessions
 * @param tasks - Tasks assigned to the user within the window
 */
export function computeFocusScore(
  sessions: Session[],
  sessionBreaks: Map<string, Break[]>,
  sessionIdleEvents: Map<string, IdleEvent[]>,
  tasks: Task[],
): FocusScore {
  const closedSessions = sessions.filter((s) => s.endTime !== null);

  let totalSessionSecs = 0;
  let totalBreakSecs = 0;
  const uninterruptedSegments: number[] = [];

  for (const session of closedSessions) {
    const duration = session.endTime! - session.startTime;
    totalSessionSecs += duration;

    const breaks = sessionBreaks.get(session.id) ?? [];
    const idleEvents = sessionIdleEvents.get(session.id) ?? [];
    const interruptions = mergeInterruptions(breaks, idleEvents);

    let breakSecs = 0;
    for (const i of interruptions) {
      breakSecs += i.endTime - i.startTime;
    }
    totalBreakSecs += breakSecs;

    // Compute uninterrupted segments between interruptions
    let cursor = session.startTime;
    for (const interruption of interruptions) {
      if (interruption.startTime > cursor) {
        uninterruptedSegments.push(interruption.startTime - cursor);
      }
      cursor = Math.max(cursor, interruption.endTime);
    }
    if (session.endTime! > cursor) {
      uninterruptedSegments.push(session.endTime! - cursor);
    }
  }

  // 1. Session continuity
  const sessionContinuity =
    totalSessionSecs > 0
      ? Math.max(0, Math.min(1, (totalSessionSecs - totalBreakSecs) / totalSessionSecs))
      : 0;

  // 2. Average uninterrupted segment length in minutes
  const avgUninterruptedMin =
    uninterruptedSegments.length > 0
      ? uninterruptedSegments.reduce((s, v) => s + v, 0) / uninterruptedSegments.length / 60
      : 0;

  // 3. Task completion rate
  const taskCompletionRate =
    tasks.length > 0
      ? tasks.filter((t) => t.status === "done").length / tasks.length
      : 0;

  // 4. Weighted composite, scaled to 0–100
  const compositeScore =
    (sessionContinuity * 0.4 +
      Math.min(avgUninterruptedMin / 60, 1.0) * 0.3 +
      taskCompletionRate * 0.3) *
    100;

  return {
    sessionContinuity,
    avgUninterruptedMin,
    taskCompletionRate,
    compositeScore,
  };
}
