import { describe, it, expect } from "vitest";
import fc from "fast-check";

/**
 * Property 4: Session End Closes All Children
 *
 * For any session with open session_tasks and breaks, when ended, all children
 * have `endTime` set. No child remains with `endTime = null`.
 *
 * **Validates: Requirements 3.2, 3.3**
 */

// --- In-memory model mirroring the Rust end_session logic ---

interface SessionTask {
  id: string;
  sessionId: string;
  taskId: string;
  startTime: number;
  endTime: number | null;
}

interface Break {
  id: string;
  sessionId: string;
  startTime: number;
  endTime: number | null;
  type: "lunch" | "short" | "meeting" | "discarded";
  autoDetected: boolean;
}

interface Session {
  id: string;
  userId: string;
  startTime: number;
  endTime: number | null;
  sessionTasks: SessionTask[];
  breaks: Break[];
}

function endSession(session: Session, endTime: number): Session {
  // Mirrors Rust: close all open session_tasks (Req 3.3)
  const closedTasks = session.sessionTasks.map((st) => ({
    ...st,
    endTime: st.endTime === null ? endTime : st.endTime,
  }));

  // Mirrors Rust: close all open breaks (Req 3.3)
  const closedBreaks = session.breaks.map((b) => ({
    ...b,
    endTime: b.endTime === null ? endTime : b.endTime,
  }));

  // Mirrors Rust: update session with endTime (Req 3.2)
  return {
    ...session,
    endTime,
    sessionTasks: closedTasks,
    breaks: closedBreaks,
  };
}

// --- Arbitraries ---

const timestampArb = fc.integer({ min: 1_700_000_000, max: 1_800_000_000 });
const breakTypeArb = fc.constantFrom(
  "lunch" as const,
  "short" as const,
  "meeting" as const,
  "discarded" as const
);

function sessionTaskArb(
  sessionId: string,
  sessionStart: number
): fc.Arbitrary<SessionTask> {
  return fc
    .record({
      id: fc.uuid(),
      taskId: fc.uuid(),
      startTime: fc.integer({ min: sessionStart, max: sessionStart + 36000 }),
      closed: fc.boolean(),
      closedOffset: fc.integer({ min: 1, max: 7200 }),
    })
    .map(({ id, taskId, startTime, closed, closedOffset }) => ({
      id,
      sessionId,
      taskId,
      startTime,
      endTime: closed ? startTime + closedOffset : null,
    }));
}

function breakArb(
  sessionId: string,
  sessionStart: number
): fc.Arbitrary<Break> {
  return fc
    .record({
      id: fc.uuid(),
      startTime: fc.integer({ min: sessionStart, max: sessionStart + 36000 }),
      closed: fc.boolean(),
      closedOffset: fc.integer({ min: 1, max: 7200 }),
      type: breakTypeArb,
      autoDetected: fc.boolean(),
    })
    .map(({ id, startTime, closed, closedOffset, type, autoDetected }) => ({
      id,
      sessionId,
      startTime,
      endTime: closed ? startTime + closedOffset : null,
      type,
      autoDetected,
    }));
}

describe("Property 4: Session End Closes All Children", () => {
  it("after ending a session, no session_task has endTime=null", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        timestampArb,
        fc.integer({ min: 1, max: 10 }),
        (sessionId, sessionStart, taskCount) => {
          // Build a session with random session_tasks (some open, some closed)
          const tasks: SessionTask[] = [];
          for (let i = 0; i < taskCount; i++) {
            const startTime = sessionStart + i * 600;
            const closed = i % 2 === 0; // alternating open/closed
            tasks.push({
              id: `task-${i}`,
              sessionId,
              taskId: `tid-${i}`,
              startTime,
              endTime: closed ? startTime + 300 : null,
            });
          }

          const session: Session = {
            id: sessionId,
            userId: "user-1",
            startTime: sessionStart,
            endTime: null,
            sessionTasks: tasks,
            breaks: [],
          };

          const endTime = sessionStart + 40000;
          const ended = endSession(session, endTime);

          // INVARIANT: no session_task has endTime=null
          for (const st of ended.sessionTasks) {
            expect(st.endTime).not.toBeNull();
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("after ending a session, no break has endTime=null", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        timestampArb,
        fc.integer({ min: 1, max: 10 }),
        breakTypeArb,
        (sessionId, sessionStart, breakCount, bType) => {
          const breaks: Break[] = [];
          for (let i = 0; i < breakCount; i++) {
            const startTime = sessionStart + i * 600;
            const closed = i % 3 === 0; // some open, some closed
            breaks.push({
              id: `break-${i}`,
              sessionId,
              startTime,
              endTime: closed ? startTime + 300 : null,
              type: bType,
              autoDetected: false,
            });
          }

          const session: Session = {
            id: sessionId,
            userId: "user-1",
            startTime: sessionStart,
            endTime: null,
            sessionTasks: [],
            breaks,
          };

          const endTime = sessionStart + 40000;
          const ended = endSession(session, endTime);

          // INVARIANT: no break has endTime=null
          for (const b of ended.breaks) {
            expect(b.endTime).not.toBeNull();
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("after ending, all children (tasks + breaks) have endTime set — randomized mix", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        timestampArb,
        fc.integer({ min: 0, max: 8 }).chain((taskCount) =>
          fc.integer({ min: 0, max: 8 }).map((breakCount) => ({
            taskCount,
            breakCount,
          }))
        ),
        fc.array(fc.boolean(), { minLength: 16, maxLength: 16 }),
        (sessionId, sessionStart, counts, closedFlags) => {
          const tasks: SessionTask[] = [];
          for (let i = 0; i < counts.taskCount; i++) {
            const startTime = sessionStart + i * 600;
            tasks.push({
              id: `st-${i}`,
              sessionId,
              taskId: `tid-${i}`,
              startTime,
              endTime: closedFlags[i] ? startTime + 300 : null,
            });
          }

          const breaks: Break[] = [];
          for (let i = 0; i < counts.breakCount; i++) {
            const startTime = sessionStart + i * 600;
            breaks.push({
              id: `br-${i}`,
              sessionId,
              startTime,
              endTime: closedFlags[counts.taskCount + i] ? startTime + 300 : null,
              type: "short",
              autoDetected: false,
            });
          }

          const session: Session = {
            id: sessionId,
            userId: "user-1",
            startTime: sessionStart,
            endTime: null,
            sessionTasks: tasks,
            breaks,
          };

          const endTime = sessionStart + 50000;
          const ended = endSession(session, endTime);

          // INVARIANT: session itself has endTime set
          expect(ended.endTime).toBe(endTime);

          // INVARIANT: no child has endTime=null
          const allChildren = [
            ...ended.sessionTasks,
            ...ended.breaks,
          ];
          for (const child of allChildren) {
            expect(child.endTime).not.toBeNull();
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("already-closed children retain their original endTime", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        timestampArb,
        timestampArb,
        (sessionId, sessionStart, endTime) => {
          // Ensure endTime is after sessionStart
          const actualEnd = Math.max(sessionStart + 1000, endTime);
          const priorEndTime = sessionStart + 500;

          // A task that was already closed before session end
          const closedTask: SessionTask = {
            id: "pre-closed-task",
            sessionId,
            taskId: "tid-1",
            startTime: sessionStart + 100,
            endTime: priorEndTime,
          };

          // An open task
          const openTask: SessionTask = {
            id: "open-task",
            sessionId,
            taskId: "tid-2",
            startTime: sessionStart + 600,
            endTime: null,
          };

          const session: Session = {
            id: sessionId,
            userId: "user-1",
            startTime: sessionStart,
            endTime: null,
            sessionTasks: [closedTask, openTask],
            breaks: [],
          };

          const ended = endSession(session, actualEnd);

          // Already-closed task keeps its original endTime
          expect(ended.sessionTasks[0].endTime).toBe(priorEndTime);

          // Open task gets the session's endTime
          expect(ended.sessionTasks[1].endTime).toBe(actualEnd);
        }
      ),
      { numRuns: 200 }
    );
  });
});
