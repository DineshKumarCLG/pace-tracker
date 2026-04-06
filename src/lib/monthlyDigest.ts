/**
 * Monthly Digest data computation for PACE v2 Team Ops.
 *
 * Pure function that computes all data needed for the monthly digest PDF.
 * The actual PDF generation (jsPDF) is a separate concern.
 *
 * Includes:
 * - Total team hours for the month
 * - Hours per person
 * - Hours per project
 * - Tasks completed count
 * - Leave days taken per person
 * - Weekly output note summaries
 *
 * Requirements: 22.1, 22.2, 22.3, 22.4
 */

import type {
  AttendanceRecord,
  Task,
  LeaveRequest,
  PublicHoliday,
  User,
  Session,
  SessionTask,
  Project,
} from "@/types";
import { countBusinessDays } from "@/lib/leave";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PersonHours {
  userId: string;
  name: string;
  totalHours: number;
}

export interface ProjectHours {
  projectId: string;
  projectName: string;
  totalHours: number;
}

export interface PersonLeaveDays {
  userId: string;
  name: string;
  leaveDays: number;
}

export interface WeeklyOutputSummary {
  weekLabel: string; // e.g. "Week 1 (Jan 1–7)"
  notes: string[];
}

export interface MonthlyDigestData {
  year: number;
  month: number; // 1-12
  monthLabel: string; // e.g. "January 2025"
  totalTeamHours: number;
  hoursPerPerson: PersonHours[];
  hoursPerProject: ProjectHours[];
  tasksCompleted: number;
  leaveDaysPerPerson: PersonLeaveDays[];
  weeklyOutputSummaries: WeeklyOutputSummary[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Get the UTC start and end timestamps for a given year/month.
 */
export function getMonthRange(year: number, month: number): { start: number; end: number } {
  const start = Date.UTC(year, month - 1, 1) / 1000;
  // End = first moment of next month minus 1 second
  const end = Date.UTC(year, month, 1) / 1000 - 1;
  return { start, end };
}

/**
 * Get week boundaries within a month (for weekly output summaries).
 * Returns array of { start, end, label } for each week.
 */
function getWeeksInMonth(year: number, month: number): Array<{ start: number; end: number; label: string }> {
  const weeks: Array<{ start: number; end: number; label: string }> = [];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  let weekNum = 1;
  let dayIdx = 1;

  while (dayIdx <= daysInMonth) {
    const weekStartDay = dayIdx;
    const weekEndDay = Math.min(dayIdx + 6, daysInMonth);

    const start = Date.UTC(year, month - 1, weekStartDay) / 1000;
    const end = Date.UTC(year, month - 1, weekEndDay, 23, 59, 59) / 1000;

    const monthName = MONTH_NAMES[month - 1].slice(0, 3);
    const label = `Week ${weekNum} (${monthName} ${weekStartDay}–${weekEndDay})`;

    weeks.push({ start, end, label });
    weekNum++;
    dayIdx = weekEndDay + 1;
  }

  return weeks;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Compute all data needed for the monthly digest PDF.
 *
 * Pure function — all data passed in, result returned.
 *
 * Requirements: 22.1
 *
 * @param year - Calendar year
 * @param month - Calendar month (1-12)
 * @param attendanceRecords - Attendance records for the month
 * @param sessions - Sessions for the month (for project hour computation)
 * @param sessionTasks - Session-task associations for the month
 * @param completedTasks - Tasks completed during the month
 * @param leaveRequests - Approved leave requests covering the month
 * @param publicHolidays - Public holidays for the year
 * @param teamMembers - All team members
 * @param projects - All projects (for name resolution)
 */
export function generateMonthlyDigestData(
  year: number,
  month: number,
  attendanceRecords: AttendanceRecord[],
  sessions: Session[],
  sessionTasks: SessionTask[],
  completedTasks: Task[],
  leaveRequests: LeaveRequest[],
  publicHolidays: PublicHoliday[],
  teamMembers: User[],
  projects: Project[],
): MonthlyDigestData {
  const { start: monthStart, end: monthEnd } = getMonthRange(year, month);
  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;

  // --- Hours per person ---
  const hoursPerPerson: PersonHours[] = teamMembers.map((member) => {
    const memberRecords = attendanceRecords.filter(
      (r) => r.userId === member.id,
    );
    const totalHours = memberRecords.reduce((sum, r) => sum + r.totalHours, 0);
    return {
      userId: member.id,
      name: member.name,
      totalHours: Math.round(totalHours * 100) / 100,
    };
  });

  // --- Total team hours ---
  const totalTeamHours = Math.round(
    hoursPerPerson.reduce((sum, p) => sum + p.totalHours, 0) * 100,
  ) / 100;

  // --- Hours per project ---
  const projectMap = new Map(projects.map((p) => [p.id, p.name]));
  const projectHoursMap = new Map<string, number>();

  // Build session lookup
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  for (const st of sessionTasks) {
    if (st.endTime === null) continue;
    const session = sessionById.get(st.sessionId);
    if (!session) continue;

    // Check session is within the month
    if (session.startTime < monthStart || session.startTime > monthEnd) continue;

    // Find the task to get projectId
    const task = completedTasks.find((t) => t.id === st.taskId) ??
      { projectId: "unknown" };

    const hours = (st.endTime - st.startTime) / 3600;
    const existing = projectHoursMap.get(task.projectId) ?? 0;
    projectHoursMap.set(task.projectId, existing + hours);
  }

  const hoursPerProject: ProjectHours[] = Array.from(projectHoursMap.entries()).map(
    ([projectId, totalHours]) => ({
      projectId,
      projectName: projectMap.get(projectId) ?? "Unknown Project",
      totalHours: Math.round(totalHours * 100) / 100,
    }),
  );

  // --- Tasks completed ---
  const tasksCompleted = completedTasks.filter(
    (t) =>
      t.status === "done" &&
      t.closedAt !== null &&
      t.closedAt >= monthStart &&
      t.closedAt <= monthEnd,
  ).length;

  // --- Leave days per person ---
  const approvedLeave = leaveRequests.filter(
    (r) =>
      r.status === "approved" &&
      (r.type === "annual" || r.type === "sick") &&
      r.startDate <= monthEnd &&
      r.endDate >= monthStart,
  );

  const leaveDaysPerPerson: PersonLeaveDays[] = teamMembers.map((member) => {
    const memberLeave = approvedLeave.filter((r) => r.requesterId === member.id);
    let leaveDays = 0;

    for (const req of memberLeave) {
      // Clamp to month boundaries
      const clampedStart = Math.max(req.startDate, monthStart);
      const clampedEnd = Math.min(req.endDate, monthEnd);
      leaveDays += countBusinessDays(clampedStart, clampedEnd, publicHolidays);
    }

    return {
      userId: member.id,
      name: member.name,
      leaveDays,
    };
  });

  // --- Weekly output note summaries ---
  const weeks = getWeeksInMonth(year, month);
  const weeklyOutputSummaries: WeeklyOutputSummary[] = weeks.map((week) => {
    const notes: string[] = [];

    for (const record of attendanceRecords) {
      if (!record.outputNote) continue;

      // Parse record date to timestamp for comparison
      const [ry, rm, rd] = record.date.split("-").map(Number);
      const recordTs = Date.UTC(ry, rm - 1, rd) / 1000;

      if (recordTs >= week.start && recordTs <= week.end) {
        notes.push(record.outputNote);
      }
    }

    return {
      weekLabel: week.label,
      notes,
    };
  });

  return {
    year,
    month,
    monthLabel,
    totalTeamHours,
    hoursPerPerson,
    hoursPerProject,
    tasksCompleted,
    leaveDaysPerPerson,
    weeklyOutputSummaries,
  };
}
