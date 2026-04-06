/**
 * Attendance computation for PACE v2 Team Ops.
 *
 * Implements the Attendance Computer algorithm from the design doc:
 * - Login time = earliest session start for user on a given day
 * - Logout time = latest session end for user on a given day
 * - Total hours = sum(session durations - break durations) / 3600
 * - Break minutes = sum(break durations) / 60
 * - Output note = from last closed session of the day
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5
 */

import type { AttendanceRecord, Session, Break } from "@/types";

/**
 * Compute a single day's attendance record from sessions and their breaks.
 *
 * All sessions must belong to the same user and same calendar day.
 * Only closed sessions (endTime !== null) are considered.
 *
 * @param userId - The user ID
 * @param date - The calendar date string (YYYY-MM-DD)
 * @param sessions - All sessions for this user on this day (may include open sessions)
 * @param breaksBySessionId - Map of sessionId → Break[] for all sessions
 */
export function computeAttendance(
  userId: string,
  date: string,
  sessions: Session[],
  breaksBySessionId: Record<string, Break[]>,
): AttendanceRecord {
  // Filter to closed sessions only
  const closedSessions = sessions.filter((s) => s.endTime !== null);

  if (closedSessions.length === 0) {
    return {
      userId,
      date,
      loginTime: null,
      logoutTime: null,
      totalHours: 0,
      breakMinutes: 0,
      outputNote: null,
    };
  }

  // Login time = earliest session start (Req 2.1)
  const loginTime = Math.min(...closedSessions.map((s) => s.startTime));

  // Logout time = latest session end (Req 2.2)
  const logoutTime = Math.max(...closedSessions.map((s) => s.endTime!));

  let totalSessionSecs = 0;
  let totalBreakSecs = 0;

  for (const session of closedSessions) {
    const sessionDuration = session.endTime! - session.startTime;

    // Get closed breaks for this session
    const breaks = (breaksBySessionId[session.id] ?? []).filter(
      (b) => b.endTime !== null,
    );

    const breakSecs = breaks.reduce(
      (sum, b) => sum + (b.endTime! - b.startTime),
      0,
    );

    // Total hours = session duration minus break durations (Req 2.3)
    totalSessionSecs += sessionDuration - breakSecs;
    // Break minutes = sum of all break durations (Req 2.4)
    totalBreakSecs += breakSecs;
  }

  // Output note from last closed session by endTime (Req 2.5)
  const lastSession = closedSessions.reduce((latest, s) =>
    s.endTime! > latest.endTime! ? s : latest,
  );

  return {
    userId,
    date,
    loginTime,
    logoutTime,
    totalHours: totalSessionSecs / 3600,
    breakMinutes: totalBreakSecs / 60,
    outputNote: lastSession.outputNote ?? null,
  };
}

/**
 * Compute attendance records for a user over a date range.
 *
 * Groups sessions by calendar date and computes one AttendanceRecord per day.
 *
 * @param userId - The user ID (if null, computes for all users in the sessions)
 * @param startDate - Start date string (YYYY-MM-DD)
 * @param endDate - End date string (YYYY-MM-DD)
 * @param sessions - All sessions in the date range
 * @param breaksBySessionId - Map of sessionId → Break[]
 * @param projectSessionIds - Optional set of session IDs that have time on a specific project (for project filtering)
 */
export function getAttendance(
  userId: string | null,
  startDate: string,
  endDate: string,
  sessions: Session[],
  breaksBySessionId: Record<string, Break[]>,
  projectSessionIds?: Set<string>,
): AttendanceRecord[] {
  // Filter sessions by user if specified
  let filtered = userId
    ? sessions.filter((s) => s.userId === userId)
    : sessions;

  // Filter to closed sessions only
  filtered = filtered.filter((s) => s.endTime !== null);

  // Filter by project if specified
  if (projectSessionIds) {
    filtered = filtered.filter((s) => projectSessionIds.has(s.id));
  }

  // Group sessions by (userId, date)
  const grouped = new Map<string, Session[]>();

  for (const session of filtered) {
    const sessionDate = utcTimestampToDateString(session.startTime);

    // Filter by date range
    if (sessionDate < startDate || sessionDate > endDate) {
      continue;
    }

    const key = `${session.userId}|${sessionDate}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.push(session);
    } else {
      grouped.set(key, [session]);
    }
  }

  // Compute attendance for each group
  const records: AttendanceRecord[] = [];

  for (const [key, daySessions] of grouped) {
    const [uid, date] = key.split("|");
    records.push(computeAttendance(uid, date, daySessions, breaksBySessionId));
  }

  // Sort by date ascending, then userId
  records.sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return a.userId.localeCompare(b.userId);
  });

  return records;
}

/**
 * Export attendance records to CSV format string.
 *
 * Columns: date, person, login time, logout time, total hours, break minutes, output note
 *
 * Requirements: 1.5
 */
export function exportAttendanceCsv(
  records: AttendanceRecord[],
  userNames?: Record<string, string>,
): string {
  const header = "date,person,login_time,logout_time,total_hours,break_minutes,output_note";
  const rows = records.map((r) => {
    const person = userNames?.[r.userId] ?? r.userId;
    const loginTime = r.loginTime !== null ? formatTimestamp(r.loginTime) : "";
    const logoutTime = r.logoutTime !== null ? formatTimestamp(r.logoutTime) : "";
    const totalHours = r.totalHours.toFixed(2);
    const breakMinutes = Math.round(r.breakMinutes).toString();
    const outputNote = csvEscape(r.outputNote ?? "");

    return `${r.date},${csvEscape(person)},${loginTime},${logoutTime},${totalHours},${breakMinutes},${outputNote}`;
  });

  return [header, ...rows].join("\n");
}

/**
 * Convert a UTC timestamp to a YYYY-MM-DD date string.
 */
export function utcTimestampToDateString(timestamp: number): string {
  const d = new Date(timestamp * 1000);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Format a UTC timestamp as ISO 8601 string for CSV export.
 */
function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

/**
 * Escape a string for CSV: wrap in quotes if it contains commas, quotes, or newlines.
 */
function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
