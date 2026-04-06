/**
 * Report generation for PACE v2 Team Ops.
 *
 * Pure functions for generating end-of-day reports from session data.
 * No side effects — all data is passed in, report object is returned.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4
 */

import type {
  Session,
  SessionTask,
  Break,
  Meeting,
  GitEvent,
  Task,
  DailyReport,
  AttendanceRecord,
  LeaveRequest,
  User,
  MorningDigest,
} from "@/types";
import { utcTimestampToDateString } from "@/lib/attendance";

/**
 * Generate an end-of-day report from session data.
 *
 * Algorithm:
 * 1. totalMinutes = session duration minus break durations (in minutes)
 * 2. tasksWorked = session tasks with durations, resolved to task titles
 * 3. breaks = break records with type and duration
 * 4. meetings = meeting records with title and duration (derived from break)
 * 5. outputNote = session's output note
 * 6. gitCommits = git events linked to the session
 * 7. If no tasks logged, include "No tasks logged" placeholder (Req 11.4)
 *
 * @param id - UUID for the report
 * @param session - The closed session (must have endTime)
 * @param sessionTasks - Session task records for this session
 * @param breaks - Break records for this session (closed only considered)
 * @param meetings - Meeting records for this session
 * @param gitEvents - Git events linked to this session
 * @param tasksById - Map of taskId → Task for resolving titles
 */
export function generateEndOfDayReport(
  id: string,
  session: Session,
  sessionTasks: SessionTask[],
  breaks: Break[],
  meetings: Meeting[],
  gitEvents: GitEvent[],
  tasksById: Record<string, Task>,
): DailyReport {
  const endTime = session.endTime ?? session.startTime;

  // 1. Total minutes = session duration minus closed break durations
  const sessionDurationSecs = endTime - session.startTime;
  const closedBreaks = breaks.filter((b) => b.endTime !== null);
  const totalBreakSecs = closedBreaks.reduce(
    (sum, b) => sum + (b.endTime! - b.startTime),
    0,
  );
  const totalMinutes = Math.max(
    0,
    Math.round((sessionDurationSecs - totalBreakSecs) / 60),
  );

  // 2. Tasks worked with durations, resolved to titles (Req 11.1)
  const tasksWorked = sessionTasks
    .filter((st) => st.endTime !== null)
    .map((st) => {
      const task = tasksById[st.taskId];
      const durationSecs = st.endTime! - st.startTime;
      return {
        taskId: st.taskId,
        title: task?.title ?? "Unknown task",
        minutes: Math.round(durationSecs / 60),
      };
    });

  // Handle "No tasks logged" case (Req 11.4)
  if (tasksWorked.length === 0) {
    tasksWorked.push({
      taskId: "",
      title: "No tasks logged",
      minutes: 0,
    });
  }

  // 3. Breaks with type and duration
  const breakEntries = closedBreaks.map((b) => ({
    type: b.type,
    minutes: Math.round((b.endTime! - b.startTime) / 60),
  }));

  // 4. Meetings with title and duration (derived from linked break)
  const breaksById = new Map(breaks.map((b) => [b.id, b]));
  const meetingEntries = meetings.map((m) => {
    const linkedBreak = breaksById.get(m.breakId);
    let minutes = 0;
    if (linkedBreak && linkedBreak.endTime !== null) {
      minutes = Math.round((linkedBreak.endTime - linkedBreak.startTime) / 60);
    }
    return {
      title: m.title,
      minutes,
    };
  });

  // 5. Output note
  const outputNote = session.outputNote ?? null;

  // 6. Git commits
  const gitCommits = gitEvents.map((ge) => ({
    hash: ge.commitHash,
    message: ge.message ?? "",
  }));

  // 7. Date from session start
  const date = utcTimestampToDateString(session.startTime);

  return {
    id,
    userId: session.userId,
    sessionId: session.id,
    date,
    totalMinutes,
    tasksWorked,
    breaks: breakEntries,
    meetings: meetingEntries,
    outputNote,
    gitCommits,
    createdAt: Math.floor(Date.now() / 1000),
  };
}


/**
 * Generate a morning digest summarizing the previous workday's activity
 * and today's leave/WFH status.
 *
 * Pure function — all data is passed in, digest object is returned.
 *
 * Algorithm:
 * 1. For each team member, compute from previous workday attendance:
 *    - totalHours from their attendance record
 *    - tasksCompleted (titles of tasks marked "done" on that day)
 *    - outputNote from their attendance record
 * 2. List members on approved leave today (annual or sick)
 * 3. List members on approved WFH today
 *
 * Requirements: 12.1, 12.2, 12.3
 *
 * @param id - UUID for the digest
 * @param date - The current date (YYYY-MM-DD) the digest is generated for
 * @param previousWorkday - The previous workday date (YYYY-MM-DD)
 * @param attendanceRecords - Attendance records for the previous workday
 * @param completedTasks - Tasks completed (status "done", closedAt on previous workday)
 * @param leaveRequests - All approved leave requests that may cover today
 * @param teamMembers - All team members
 */
export function generateMorningDigest(
  id: string,
  date: string,
  previousWorkday: string,
  attendanceRecords: AttendanceRecord[],
  completedTasks: Task[],
  leaveRequests: LeaveRequest[],
  teamMembers: User[],
): MorningDigest {
  // Build attendance lookup by userId for the previous workday
  const attendanceByUser = new Map<string, AttendanceRecord>();
  for (const record of attendanceRecords) {
    if (record.date === previousWorkday) {
      attendanceByUser.set(record.userId, record);
    }
  }

  // Build completed tasks grouped by assigneeId for the previous workday
  const tasksByUser = new Map<string, string[]>();
  for (const task of completedTasks) {
    if (task.assigneeId && task.status === "done") {
      const existing = tasksByUser.get(task.assigneeId) ?? [];
      existing.push(task.title);
      tasksByUser.set(task.assigneeId, existing);
    }
  }

  // Parse today's date to a UTC timestamp range for leave matching
  const [yearStr, monthStr, dayStr] = date.split("-");
  const todayStart = Date.UTC(
    Number(yearStr),
    Number(monthStr) - 1,
    Number(dayStr),
  ) / 1000;

  // Determine on-leave and on-WFH members for today
  const approvedRequests = leaveRequests.filter((r) => r.status === "approved");

  const onLeaveToday: string[] = [];
  const onWfhToday: string[] = [];

  for (const member of teamMembers) {
    const matchingRequest = approvedRequests.find(
      (r) =>
        r.requesterId === member.id &&
        r.startDate <= todayStart &&
        r.endDate >= todayStart,
    );

    if (matchingRequest) {
      if (matchingRequest.type === "annual" || matchingRequest.type === "sick") {
        onLeaveToday.push(member.name);
      } else if (matchingRequest.type === "wfh") {
        onWfhToday.push(member.name);
      }
    }
  }

  // Build member summaries
  const memberSummaries = teamMembers.map((member) => {
    const attendance = attendanceByUser.get(member.id);
    const tasks = tasksByUser.get(member.id) ?? [];

    return {
      userId: member.id,
      name: member.name,
      totalHours: attendance?.totalHours ?? 0,
      tasksCompleted: tasks,
      outputNote: attendance?.outputNote ?? null,
    };
  });

  return {
    id,
    date,
    memberSummaries,
    onLeaveToday,
    onWfhToday,
    createdAt: Math.floor(Date.now() / 1000),
  };
}
