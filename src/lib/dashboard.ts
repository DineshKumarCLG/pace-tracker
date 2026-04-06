/**
 * Dashboard computation functions for PACE v2 Team Ops.
 *
 * Implements the Attendance Alert algorithm from the design doc:
 * - No alerts on weekends or public holidays
 * - No alerts before 12:00 PM local time
 * - No alerts for users on approved leave
 * - WFH users with no session get "WFH — not yet logged in"
 * - Other users with no session get "Not yet logged in"
 *
 * Requirements: 14.3, 27.1, 27.2, 27.3, 27.4
 */

import type {
  AttendanceAlert,
  AttendanceRecord,
  LeaveRequest,
  OverworkSignal,
  PublicHoliday,
  Session,
  TeamMember,
} from "@/types";
import { isWeekend, isPublicHoliday } from "@/lib/leave";

/**
 * Get the UTC midnight timestamp for a given UTC timestamp.
 */
function toUtcMidnight(timestamp: number): number {
  const d = new Date(timestamp * 1000);
  return Math.floor(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000,
  );
}

/**
 * Return the UTC midnight timestamp for the day before the given UTC midnight timestamp.
 */
function previousDay(midnightTimestamp: number): number {
  return midnightTimestamp - 86400;
}

/**
 * Check if a user has an approved leave request (annual or sick) covering a given day.
 */
function hasApprovedLeave(
  userId: string,
  dayTimestamp: number,
  leaveRequests: LeaveRequest[],
): boolean {
  return leaveRequests.some(
    (r) =>
      r.requesterId === userId &&
      r.status === "approved" &&
      (r.type === "annual" || r.type === "sick") &&
      r.startDate <= dayTimestamp &&
      r.endDate >= dayTimestamp,
  );
}

/**
 * Check if a user has an approved WFH request covering a given day.
 */
function hasApprovedWfh(
  userId: string,
  dayTimestamp: number,
  leaveRequests: LeaveRequest[],
): boolean {
  return leaveRequests.some(
    (r) =>
      r.requesterId === userId &&
      r.status === "approved" &&
      r.type === "wfh" &&
      r.startDate <= dayTimestamp &&
      r.endDate >= dayTimestamp,
  );
}

/**
 * Check if a user has any session starting on a given day.
 *
 * A "day" is defined as the UTC date derived from todayTimestamp.
 * Sessions are matched if their startTime falls on the same UTC date.
 */
function hasSessionToday(
  userId: string,
  todayTimestamp: number,
  sessions: Session[],
): boolean {
  const todayDate = new Date(todayTimestamp * 1000);
  const y = todayDate.getUTCFullYear();
  const m = todayDate.getUTCMonth();
  const d = todayDate.getUTCDate();

  return sessions.some((s) => {
    if (s.userId !== userId) return false;
    const sDate = new Date(s.startTime * 1000);
    return (
      sDate.getUTCFullYear() === y &&
      sDate.getUTCMonth() === m &&
      sDate.getUTCDate() === d
    );
  });
}

/**
 * Generate attendance alerts for team members who haven't logged in.
 *
 * Pure function — all inputs are passed explicitly.
 *
 * Algorithm (from design doc):
 * 1. If today is weekend or public holiday → return empty
 * 2. If current hour < 12 → return empty (too early)
 * 3. For each team member:
 *    - If on approved leave today → skip
 *    - If has a session today → skip
 *    - If on approved WFH and no session → alert with "WFH — not yet logged in"
 *    - Otherwise → alert with "Not yet logged in"
 *
 * @param teamMembers - All team members to check
 * @param sessions - All sessions (used to check if user has a session today)
 * @param leaveRequests - All leave requests (used to check leave/WFH status)
 * @param publicHolidays - Public holidays list
 * @param currentTime - Current time as UTC timestamp (seconds)
 * @param currentHour - Current hour in local time (0-23)
 */
export function checkAttendanceAlerts(
  teamMembers: TeamMember[],
  sessions: Session[],
  leaveRequests: LeaveRequest[],
  publicHolidays: PublicHoliday[],
  currentTime: number,
  currentHour: number,
): AttendanceAlert[] {
  // 1. No alerts on weekends
  if (isWeekend(currentTime)) {
    return [];
  }

  // 2. No alerts on public holidays
  if (isPublicHoliday(currentTime, publicHolidays)) {
    return [];
  }

  // 3. No alerts before noon
  if (currentHour < 12) {
    return [];
  }

  const alerts: AttendanceAlert[] = [];

  for (const member of teamMembers) {
    // Skip users on approved leave (annual or sick)
    if (hasApprovedLeave(member.userId, currentTime, leaveRequests)) {
      continue;
    }

    // Skip users who already have a session today
    if (hasSessionToday(member.userId, currentTime, sessions)) {
      continue;
    }

    // Determine label based on WFH status
    const wfh = hasApprovedWfh(member.userId, currentTime, leaveRequests);
    const label = wfh ? "WFH — not yet logged in" : "Not yet logged in";

    alerts.push({
      userId: member.userId,
      name: member.name,
      label,
    });
  }

  return alerts;
}

/**
 * Detect overwork signals for team members.
 *
 * Pure function — all inputs are passed explicitly.
 *
 * Algorithm (from design doc):
 * 1. For each team member, count days with totalHours > 10 in the provided attendance records
 * 2. If count >= 3, emit an OverworkSignal with supportive language
 *
 * The caller is responsible for passing only the attendance records within the
 * desired rolling window (typically the last 7 days).
 *
 * Requirements: 26.1, 26.2, 26.3, 26.4
 *
 * @param teamMembers - All team members to check
 * @param attendanceRecords - Attendance records for the rolling window (e.g. last 7 days)
 */
export function detectOverwork(
  teamMembers: TeamMember[],
  attendanceRecords: AttendanceRecord[],
): OverworkSignal[] {
  const signals: OverworkSignal[] = [];

  for (const member of teamMembers) {
    // Count days with > 10h in the provided window (Req 26.1)
    const overworkDayCount = attendanceRecords.filter(
      (r) => r.userId === member.userId && r.totalHours > 10,
    ).length;

    // Signal when 3+ overwork days in the window (Req 26.2)
    if (overworkDayCount >= 3) {
      signals.push({
        userId: member.userId,
        name: member.name,
        daysOver10h: overworkDayCount,
        // Supportive language, never punitive (Req 26.3, 26.4)
        message: `${member.name} has worked 10+ hours on ${overworkDayCount} days this week. Consider taking a break.`,
        severity: "warning",
      });
    }
  }

  return signals;
}


/**
 * Compute the consecutive check-in streak for a user.
 *
 * Pure function — all inputs are passed explicitly.
 *
 * Algorithm (from design doc):
 * 1. Start from currentDate, walk backwards day by day
 * 2. Skip weekends (Saturday/Sunday)
 * 3. Skip public holidays
 * 4. Skip days with approved leave (annual or sick)
 * 5. If workday has at least one session → increment streak
 * 6. If workday has no session and no leave → break (streak = 0 reset point)
 * 7. Return the streak count
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4
 *
 * @param userId - The user whose streak to compute
 * @param sessions - All sessions for the user (used to check daily check-ins)
 * @param leaveRequests - All leave requests (used to check approved leave)
 * @param publicHolidays - Public holidays list
 * @param currentDate - Current date as UTC timestamp (seconds)
 * @returns The streak count (number of consecutive workdays with at least one session)
 */
export function computeStreak(
  userId: string,
  sessions: Session[],
  leaveRequests: LeaveRequest[],
  publicHolidays: PublicHoliday[],
  currentDate: number,
): number {
  let streak = 0;
  let checkDate = toUtcMidnight(currentDate);

  // Safety limit to prevent infinite loops (go back at most ~2 years)
  const maxIterations = 800;
  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;

    // Skip weekends (Req 15.4)
    if (isWeekend(checkDate)) {
      checkDate = previousDay(checkDate);
      continue;
    }

    // Skip public holidays (Req 15.4)
    if (isPublicHoliday(checkDate, publicHolidays)) {
      checkDate = previousDay(checkDate);
      continue;
    }

    // Skip approved leave — annual or sick (Req 15.4)
    if (hasApprovedLeave(userId, checkDate, leaveRequests)) {
      checkDate = previousDay(checkDate);
      continue;
    }

    // This is a workday — did the user check in?
    const hasSession = hasSessionOnDate(userId, checkDate, sessions);

    if (hasSession) {
      streak++;
      checkDate = previousDay(checkDate);
    } else {
      // Workday with no session and no leave → streak broken (Req 15.3)
      break;
    }
  }

  return streak;
}

/**
 * Check if a user has any session starting on a given UTC date.
 * Compares by UTC date (year-month-day).
 */
function hasSessionOnDate(
  userId: string,
  dayTimestamp: number,
  sessions: Session[],
): boolean {
  const d = new Date(dayTimestamp * 1000);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();

  return sessions.some((s) => {
    if (s.userId !== userId) return false;
    const sDate = new Date(s.startTime * 1000);
    return (
      sDate.getUTCFullYear() === y &&
      sDate.getUTCMonth() === m &&
      sDate.getUTCDate() === day
    );
  });
}


/**
 * Determine the session expectation for a user on a given day.
 *
 * Returns:
 * - "normal"   — regular workday, session expected as usual
 * - "wfh"      — WFH day, session expected as normal (Req 8.1)
 * - "on_leave" — on approved leave (annual/sick), no session expected (Req 8.2)
 * - "none"     — weekend or public holiday, no session expected
 *
 * Requirements: 8.1, 8.2, 8.3
 *
 * @param userId - The user to check
 * @param leaveRequests - All leave requests
 * @param publicHolidays - Public holidays list
 * @param now - Current time as UTC timestamp (seconds)
 */
export function getSessionExpectation(
  userId: string,
  leaveRequests: LeaveRequest[],
  publicHolidays: PublicHoliday[],
  now: number,
): "normal" | "wfh" | "on_leave" | "none" {
  // Weekends — no session expected
  if (isWeekend(now)) {
    return "none";
  }

  // Public holidays — no session expected
  if (isPublicHoliday(now, publicHolidays)) {
    return "none";
  }

  // On approved leave (annual or sick) — no session expected (Req 8.2)
  if (hasApprovedLeave(userId, now, leaveRequests)) {
    return "on_leave";
  }

  // On approved WFH — session expected as normal (Req 8.1)
  if (hasApprovedWfh(userId, now, leaveRequests)) {
    return "wfh";
  }

  // Normal workday
  return "normal";
}
