import { describe, it, expect } from "vitest";
import fc from "fast-check";

/**
 * Property 16: Task Validation and Stale Detection
 *
 * For any task, the status field accepts only the values "open", "inprogress",
 * "done", or "blocked". For any task with no logged session time in 7 or more
 * days and status not equal to "blocked", the task is flagged as stale in the
 * weekly review.
 *
 * **Validates: Requirements 8.4, 8.5**
 */

// --- In-memory model mirroring task validation and stale detection ---

type TaskStatus = "open" | "inprogress" | "done" | "blocked";
const VALID_STATUSES: TaskStatus[] = ["open", "inprogress", "done", "blocked"];
const SEVEN_DAYS_SECS = 7 * 24 * 60 * 60;

interface Task {
  id: string;
  status: TaskStatus;
  createdAt: number;
}

interface SessionTask {
  taskId: string;
  startTime: number;
  endTime: number | null;
}

type CreateResult = { ok: true; task: Task } | { ok: false; error: string };

function createTask(id: string, status: string, createdAt: number): CreateResult {
  // Validate status (Req 8.4)
  if (!VALID_STATUSES.includes(status as TaskStatus)) {
    return { ok: false, error: `Invalid status: ${status}` };
  }

  return {
    ok: true,
    task: { id, status: status as TaskStatus, createdAt },
  };
}

function isTaskStale(
  task: Task,
  sessionTasks: SessionTask[],
  now: number
): boolean {
  // Blocked tasks are never flagged stale (Req 8.5)
  if (task.status === "blocked") return false;

  // Find the most recent logged time for this task
  const taskSessions = sessionTasks.filter((st) => st.taskId === task.id);

  if (taskSessions.length === 0) {
    // No logged time ever — stale if created 7+ days ago
    return now - task.createdAt >= SEVEN_DAYS_SECS;
  }

  // Find the latest activity timestamp
  const latestActivity = Math.max(
    ...taskSessions.map((st) => st.endTime ?? st.startTime)
  );

  // Stale if no logged time in 7+ days (Req 8.5)
  return now - latestActivity >= SEVEN_DAYS_SECS;
}

// --- Arbitraries ---

const timestampArb = fc.integer({ min: 1_700_000_000, max: 1_800_000_000 });
const validStatusArb = fc.constantFrom<TaskStatus>("open", "inprogress", "done", "blocked");
const invalidStatusArb = fc.constantFrom(
  "pending", "cancelled", "archived", "active", "paused", "", "OPEN", "Done"
);

describe("Property 16: Task Validation and Stale Detection", () => {
  it("task status accepts only open, inprogress, done, blocked", () => {
    fc.assert(
      fc.property(validStatusArb, timestampArb, (status, createdAt) => {
        const result = createTask("t1", status, createdAt);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(VALID_STATUSES).toContain(result.task.status);
        }
      }),
      { numRuns: 200 }
    );
  });

  it("invalid status values are rejected", () => {
    fc.assert(
      fc.property(invalidStatusArb, timestampArb, (status, createdAt) => {
        const result = createTask("t1", status, createdAt);
        expect(result.ok).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  it("task with no logged time for 7+ days and status != blocked is flagged stale", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<TaskStatus>("open", "inprogress", "done"),
        timestampArb,
        fc.integer({ min: SEVEN_DAYS_SECS, max: SEVEN_DAYS_SECS + 86400 * 30 }),
        (status, createdAt, staleDuration) => {
          const task: Task = { id: "t1", status, createdAt };
          const now = createdAt + staleDuration;

          // No session_tasks at all
          const stale = isTaskStale(task, [], now);
          expect(stale).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("blocked task is never flagged stale regardless of inactivity", () => {
    fc.assert(
      fc.property(
        timestampArb,
        fc.integer({ min: SEVEN_DAYS_SECS, max: SEVEN_DAYS_SECS + 86400 * 365 }),
        (createdAt, staleDuration) => {
          const task: Task = { id: "t1", status: "blocked", createdAt };
          const now = createdAt + staleDuration;

          // Even with no logged time for months, blocked is not stale (Req 8.5)
          const stale = isTaskStale(task, [], now);
          expect(stale).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("task with recent logged time (< 7 days) is not flagged stale", () => {
    fc.assert(
      fc.property(
        validStatusArb,
        timestampArb,
        fc.integer({ min: 0, max: SEVEN_DAYS_SECS - 1 }),
        fc.integer({ min: 60, max: 3600 }),
        (status, createdAt, recentOffset, sessionDuration) => {
          const task: Task = { id: "t1", status, createdAt };
          const now = createdAt + 86400 * 30; // 30 days after creation

          // Session logged recently (within 7 days of now)
          const sessionStart = now - recentOffset;
          const sessionTasks: SessionTask[] = [
            {
              taskId: "t1",
              startTime: sessionStart,
              endTime: sessionStart + sessionDuration,
            },
          ];

          const stale = isTaskStale(task, sessionTasks, now);
          expect(stale).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("task with last logged time exactly 7 days ago is flagged stale", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<TaskStatus>("open", "inprogress", "done"),
        timestampArb,
        fc.integer({ min: 60, max: 3600 }),
        (status, createdAt, sessionDuration) => {
          const task: Task = { id: "t1", status, createdAt };
          const lastActivityStart = createdAt + 86400;
          const lastActivityEnd = lastActivityStart + sessionDuration;
          // now is exactly 7 days after the endTime (latest activity)
          const now = lastActivityEnd + SEVEN_DAYS_SECS;

          const sessionTasks: SessionTask[] = [
            {
              taskId: "t1",
              startTime: lastActivityStart,
              endTime: lastActivityEnd,
            },
          ];

          const stale = isTaskStale(task, sessionTasks, now);
          expect(stale).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("task with last logged time 6 days ago is NOT flagged stale", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<TaskStatus>("open", "inprogress", "done"),
        timestampArb,
        (status, createdAt) => {
          const task: Task = { id: "t1", status, createdAt };
          const lastActivity = createdAt + 86400;
          const sixDays = 6 * 24 * 60 * 60;
          const now = lastActivity + sixDays; // 6 days after last activity

          const sessionTasks: SessionTask[] = [
            {
              taskId: "t1",
              startTime: lastActivity,
              endTime: lastActivity + 3600,
            },
          ];

          const stale = isTaskStale(task, sessionTasks, now);
          expect(stale).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("stale detection uses the most recent session_task activity", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<TaskStatus>("open", "inprogress"),
        timestampArb,
        fc.integer({ min: 1, max: 5 }),
        (status, baseTime, sessionCount) => {
          const task: Task = { id: "t1", status, createdAt: baseTime };

          // Create multiple sessions at different times
          const sessionTasks: SessionTask[] = [];
          for (let i = 0; i < sessionCount; i++) {
            const start = baseTime + i * 86400; // each day
            sessionTasks.push({
              taskId: "t1",
              startTime: start,
              endTime: start + 3600,
            });
          }

          // Latest session is (sessionCount - 1) days after baseTime
          const latestEnd = baseTime + (sessionCount - 1) * 86400 + 3600;

          // Check at exactly 7 days after latest activity → stale
          const staleNow = latestEnd + SEVEN_DAYS_SECS;
          expect(isTaskStale(task, sessionTasks, staleNow)).toBe(true);

          // Check at 6 days after latest activity → not stale
          const notStaleNow = latestEnd + SEVEN_DAYS_SECS - 1;
          expect(isTaskStale(task, sessionTasks, notStaleNow)).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });
});
