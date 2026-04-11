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
  GitEvent,
  Task,
  DailyReport,
} from "@/types";
import { utcTimestampToDateString } from "@/lib/attendance";

/**
 * Generate an end-of-day report from session data.
 *
 * Algorithm:
 * 1. totalMinutes = session duration minus break durations (in minutes)
 * 2. tasksWorked = session tasks with durations, resolved to task titles
 * 3. breaks = break records with type and duration
 * 4. outputNote = session's output note
 * 5. gitCommits = git events linked to the session
 * 6. If no tasks logged, include "No tasks logged" placeholder (Req 11.4)
 *
 * @param id - UUID for the report
 * @param session - The closed session (must have endTime)
 * @param sessionTasks - Session task records for this session
 * @param breaks - Break records for this session (closed only considered)
 * @param gitEvents - Git events linked to this session
 * @param tasksById - Map of taskId → Task for resolving titles
 */
export function generateEndOfDayReport(
  id: string,
  session: Session,
  sessionTasks: SessionTask[],
  breaks: Break[],
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

  // 4. Output note
  const outputNote = session.outputNote ?? null;

  // 5. Git commits
  const gitCommits = gitEvents.map((ge) => ({
    hash: ge.commitHash,
    message: ge.message ?? "",
  }));

  // 6. Date from session start
  const date = utcTimestampToDateString(session.startTime);

  return {
    id,
    userId: session.userId,
    sessionId: session.id,
    date,
    totalMinutes,
    tasksWorked,
    breaks: breakEntries,
    outputNote,
    gitCommits,
    createdAt: Math.floor(Date.now() / 1000),
  };
}

