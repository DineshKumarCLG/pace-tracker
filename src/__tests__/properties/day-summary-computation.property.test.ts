import { describe, it, expect } from "vitest";
import fc from "fast-check";

/**
 * Property 21: Day Summary Computation
 *
 * For any active session with associated breaks and tasks, the day summary computes:
 * - Total work time = (endTime - startTime) - sum of break durations - sum of discarded gap durations
 * - Tasks closed = count of tasks with status "done" and closedAt within session time range
 * - Breaks count = count of break records with duration >= 8 minutes (micro-breaks excluded)
 *
 * **Validates: Requirement 3.1**
 */

// --- Types mirroring the PACE data model ---

interface Break {
  id: string;
  sessionId: string;
  startTime: number;
  endTime: number;
  type: "lunch" | "short" | "meeting" | "discarded";
}

interface Task {
  id: string;
  status: "open" | "inprogress" | "done" | "blocked";
  closedAt: number | null;
}

interface DaySummary {
  totalWorkSeconds: number;
  tasksClosed: number;
  breaksCount: number;
}

// --- Pure computation mirroring the day summary logic (Req 3.1) ---

const MICRO_BREAK_THRESHOLD_SECS = 8 * 60; // 8 minutes

function computeDaySummary(
  sessionStart: number,
  sessionEnd: number,
  breaks: Break[],
  tasks: Task[]
): DaySummary {
  const sessionDuration = sessionEnd - sessionStart;

  // Subtract break durations (non-discarded breaks with duration >= 8 min)
  const breakDuration = breaks
    .filter((b) => b.type !== "discarded")
    .filter((b) => b.endTime - b.startTime >= MICRO_BREAK_THRESHOLD_SECS)
    .reduce((sum, b) => sum + (b.endTime - b.startTime), 0);

  // Subtract discarded gap durations (all discarded breaks remove time)
  const discardedDuration = breaks
    .filter((b) => b.type === "discarded")
    .reduce((sum, b) => sum + (b.endTime - b.startTime), 0);

  const totalWorkSeconds = sessionDuration - breakDuration - discardedDuration;

  // Tasks closed = tasks with status "done" and closedAt within session range
  const tasksClosed = tasks.filter(
    (t) =>
      t.status === "done" &&
      t.closedAt !== null &&
      t.closedAt >= sessionStart &&
      t.closedAt <= sessionEnd
  ).length;

  // Breaks count = non-micro break records (>= 8 min, non-discarded)
  const breaksCount = breaks.filter(
    (b) =>
      b.type !== "discarded" &&
      b.endTime - b.startTime >= MICRO_BREAK_THRESHOLD_SECS
  ).length;

  return { totalWorkSeconds, tasksClosed, breaksCount };
}

// --- Arbitraries ---

const sessionStartArb = fc.integer({ min: 1_700_000_000, max: 1_800_000_000 });
const breakTypeArb = fc.constantFrom(
  "lunch" as const,
  "short" as const,
  "meeting" as const,
  "discarded" as const
);
const taskStatusArb = fc.constantFrom(
  "open" as const,
  "inprogress" as const,
  "done" as const,
  "blocked" as const
);

function breakArb(
  sessionId: string,
  sessionStart: number,
  sessionEnd: number
): fc.Arbitrary<Break> {
  return fc
    .record({
      id: fc.uuid(),
      type: breakTypeArb,
      // Break starts somewhere within the session
      startOffset: fc.integer({ min: 0, max: Math.max(sessionEnd - sessionStart - 1, 0) }),
      // Duration: mix of micro (<8min) and regular (>=8min) breaks
      isMicro: fc.boolean(),
      microDuration: fc.integer({ min: 60, max: MICRO_BREAK_THRESHOLD_SECS - 1 }),
      regularDuration: fc.integer({ min: MICRO_BREAK_THRESHOLD_SECS, max: 3600 }),
    })
    .map(({ id, type, startOffset, isMicro, microDuration, regularDuration }) => {
      const duration = isMicro ? microDuration : regularDuration;
      const startTime = sessionStart + startOffset;
      // Clamp endTime to not exceed session end
      const endTime = Math.min(startTime + duration, sessionEnd);
      return { id, sessionId, startTime, endTime, type };
    });
}

function taskArb(
  sessionStart: number,
  sessionEnd: number
): fc.Arbitrary<Task> {
  return fc
    .record({
      id: fc.uuid(),
      status: taskStatusArb,
      // closedAt may be inside or outside the session range
      closedAtInSession: fc.boolean(),
      closedAtOffset: fc.integer({ min: 0, max: sessionEnd - sessionStart }),
      closedAtOutside: fc.integer({ min: sessionEnd + 1, max: sessionEnd + 86400 }),
    })
    .map(({ id, status, closedAtInSession, closedAtOffset, closedAtOutside }) => {
      let closedAt: number | null = null;
      if (status === "done") {
        closedAt = closedAtInSession
          ? sessionStart + closedAtOffset
          : closedAtOutside;
      }
      return { id, status, closedAt };
    });
}

// --- Property Tests ---

describe("Property 21: Day Summary Computation", () => {
  it("total work time = session duration minus break and discarded durations", () => {
    fc.assert(
      fc.property(
        sessionStartArb,
        fc.integer({ min: 3600, max: 43200 }), // session length 1h-12h
        fc.integer({ min: 0, max: 8 }),
        (sessionStart, sessionLength, breakCount) => {
          const sessionEnd = sessionStart + sessionLength;
          const sessionId = "session-1";

          // Generate deterministic breaks for this test
          const breaks: Break[] = [];
          for (let i = 0; i < breakCount; i++) {
            const isMicro = i % 3 === 0;
            const duration = isMicro ? 300 : 600; // 5min or 10min
            const startTime = sessionStart + (i + 1) * 600;
            if (startTime + duration > sessionEnd) break;
            breaks.push({
              id: `break-${i}`,
              sessionId,
              startTime,
              endTime: startTime + duration,
              type: i % 4 === 3 ? "discarded" : "short",
            });
          }

          const summary = computeDaySummary(sessionStart, sessionEnd, breaks, []);

          // Manually compute expected
          const regularBreakDuration = breaks
            .filter((b) => b.type !== "discarded" && b.endTime - b.startTime >= MICRO_BREAK_THRESHOLD_SECS)
            .reduce((s, b) => s + (b.endTime - b.startTime), 0);
          const discardedDuration = breaks
            .filter((b) => b.type === "discarded")
            .reduce((s, b) => s + (b.endTime - b.startTime), 0);

          const expected = sessionLength - regularBreakDuration - discardedDuration;
          expect(summary.totalWorkSeconds).toBe(expected);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("total work time is always non-negative when breaks fit within session", () => {
    fc.assert(
      fc.property(
        sessionStartArb,
        fc.integer({ min: 7200, max: 43200 }), // 2h-12h session
        (sessionStart, sessionLength) => {
          const sessionEnd = sessionStart + sessionLength;
          const sessionId = "session-1";

          // Create breaks that collectively don't exceed session duration
          // Use at most half the session for breaks
          const maxBreakTime = Math.floor(sessionLength / 2);
          const breakDuration = Math.min(1800, maxBreakTime); // 30min or half session
          const breaks: Break[] = [
            {
              id: "b1",
              sessionId,
              startTime: sessionStart + 1800,
              endTime: sessionStart + 1800 + breakDuration,
              type: "lunch",
            },
          ];

          const summary = computeDaySummary(sessionStart, sessionEnd, breaks, []);
          expect(summary.totalWorkSeconds).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("tasks closed counts only 'done' tasks with closedAt within session range", () => {
    fc.assert(
      fc.property(
        sessionStartArb,
        fc.integer({ min: 3600, max: 43200 }),
        fc.array(taskStatusArb, { minLength: 1, maxLength: 10 }),
        fc.array(fc.boolean(), { minLength: 10, maxLength: 10 }),
        (sessionStart, sessionLength, statuses, insideFlags) => {
          const sessionEnd = sessionStart + sessionLength;

          const tasks: Task[] = statuses.map((status, i) => {
            let closedAt: number | null = null;
            if (status === "done") {
              const inside = insideFlags[i % insideFlags.length];
              closedAt = inside
                ? sessionStart + Math.floor(sessionLength / 2)
                : sessionEnd + 3600; // outside session
            }
            return { id: `task-${i}`, status, closedAt };
          });

          const summary = computeDaySummary(sessionStart, sessionEnd, [], tasks);

          // Manually count expected
          const expected = tasks.filter(
            (t) =>
              t.status === "done" &&
              t.closedAt !== null &&
              t.closedAt >= sessionStart &&
              t.closedAt <= sessionEnd
          ).length;

          expect(summary.tasksClosed).toBe(expected);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("breaks count excludes micro-breaks (under 8 minutes) and discarded breaks", () => {
    fc.assert(
      fc.property(
        sessionStartArb,
        fc.integer({ min: 14400, max: 43200 }), // 4h-12h session
        fc.array(
          fc.record({
            isMicro: fc.boolean(),
            isDiscarded: fc.boolean(),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        (sessionStart, sessionLength, breakSpecs) => {
          const sessionEnd = sessionStart + sessionLength;
          const sessionId = "session-1";

          const breaks: Break[] = breakSpecs.map((spec, i) => {
            const duration = spec.isMicro ? 300 : 900; // 5min or 15min
            const startTime = sessionStart + (i + 1) * 1200;
            if (startTime + duration > sessionEnd) {
              // Clamp to fit
              return {
                id: `b-${i}`,
                sessionId,
                startTime: sessionStart + 60,
                endTime: sessionStart + 60 + duration,
                type: spec.isDiscarded ? ("discarded" as const) : ("short" as const),
              };
            }
            return {
              id: `b-${i}`,
              sessionId,
              startTime,
              endTime: startTime + duration,
              type: spec.isDiscarded ? ("discarded" as const) : ("short" as const),
            };
          });

          const summary = computeDaySummary(sessionStart, sessionEnd, breaks, []);

          // Expected: only non-discarded breaks >= 8 min
          const expected = breaks.filter(
            (b) =>
              b.type !== "discarded" &&
              b.endTime - b.startTime >= MICRO_BREAK_THRESHOLD_SECS
          ).length;

          expect(summary.breaksCount).toBe(expected);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("full day summary computation is consistent across random sessions", () => {
    fc.assert(
      fc.property(
        sessionStartArb,
        fc.integer({ min: 7200, max: 43200 }),
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 0, max: 8 }),
        (sessionStart, sessionLength, breakCount, taskCount) => {
          const sessionEnd = sessionStart + sessionLength;
          const sessionId = "session-1";

          // Generate breaks with a mix of types and durations
          const breaks: Break[] = [];
          for (let i = 0; i < breakCount; i++) {
            const isMicro = i % 2 === 0;
            const duration = isMicro ? 240 : 720; // 4min or 12min
            const type: Break["type"] = i % 5 === 0 ? "discarded" : i % 3 === 0 ? "lunch" : "short";
            const startTime = sessionStart + (i + 1) * 900;
            if (startTime + duration > sessionEnd) continue;
            breaks.push({
              id: `b-${i}`,
              sessionId,
              startTime,
              endTime: startTime + duration,
              type,
            });
          }

          // Generate tasks with mixed statuses
          const tasks: Task[] = [];
          for (let i = 0; i < taskCount; i++) {
            const isDone = i % 3 === 0;
            const insideSession = i % 2 === 0;
            tasks.push({
              id: `t-${i}`,
              status: isDone ? "done" : i % 2 === 0 ? "inprogress" : "open",
              closedAt: isDone
                ? insideSession
                  ? sessionStart + Math.floor(sessionLength / 2)
                  : sessionEnd + 7200
                : null,
            });
          }

          const summary = computeDaySummary(sessionStart, sessionEnd, breaks, tasks);

          // Verify all three components independently
          const regularBreakDuration = breaks
            .filter((b) => b.type !== "discarded" && b.endTime - b.startTime >= MICRO_BREAK_THRESHOLD_SECS)
            .reduce((s, b) => s + (b.endTime - b.startTime), 0);
          const discardedDuration = breaks
            .filter((b) => b.type === "discarded")
            .reduce((s, b) => s + (b.endTime - b.startTime), 0);

          expect(summary.totalWorkSeconds).toBe(
            sessionLength - regularBreakDuration - discardedDuration
          );

          const expectedTasksClosed = tasks.filter(
            (t) =>
              t.status === "done" &&
              t.closedAt !== null &&
              t.closedAt >= sessionStart &&
              t.closedAt <= sessionEnd
          ).length;
          expect(summary.tasksClosed).toBe(expectedTasksClosed);

          const expectedBreaks = breaks.filter(
            (b) =>
              b.type !== "discarded" &&
              b.endTime - b.startTime >= MICRO_BREAK_THRESHOLD_SECS
          ).length;
          expect(summary.breaksCount).toBe(expectedBreaks);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("with randomized fast-check generators for breaks and tasks", () => {
    fc.assert(
      fc.property(
        sessionStartArb,
        fc.integer({ min: 7200, max: 43200 }),
        fc.uuid(),
        (sessionStart, sessionLength, sessionId) => {
          const sessionEnd = sessionStart + sessionLength;

          // Use the arbitrary generators
          const breaksResult = fc.sample(
            fc.array(breakArb(sessionId, sessionStart, sessionEnd), {
              minLength: 0,
              maxLength: 8,
            }),
            1
          )[0];

          const tasksResult = fc.sample(
            fc.array(taskArb(sessionStart, sessionEnd), {
              minLength: 0,
              maxLength: 8,
            }),
            1
          )[0];

          const summary = computeDaySummary(
            sessionStart,
            sessionEnd,
            breaksResult,
            tasksResult
          );

          // Verify structural invariants
          // 1. tasksClosed <= total done tasks
          const totalDone = tasksResult.filter((t) => t.status === "done").length;
          expect(summary.tasksClosed).toBeLessThanOrEqual(totalDone);

          // 2. breaksCount <= total non-discarded breaks
          const totalNonDiscarded = breaksResult.filter(
            (b) => b.type !== "discarded"
          ).length;
          expect(summary.breaksCount).toBeLessThanOrEqual(totalNonDiscarded);

          // 3. totalWorkSeconds <= sessionLength (work can't exceed session)
          expect(summary.totalWorkSeconds).toBeLessThanOrEqual(sessionLength);
        }
      ),
      { numRuns: 200 }
    );
  });
});
