import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeFocusScore } from "@/lib/analytics";
import type { Session, Break, IdleEvent, Task } from "@/types";

/**
 * Property 14: Focus score computation and bounds
 *
 * The focus score must satisfy strict bounds on all four output fields,
 * and the composite score must equal the weighted formula from the design.
 *
 * **Validates: Requirements 16.1**
 */

// --- Helpers ---

function makeSession(
  id: string,
  startTime: number,
  endTime: number,
): Session {
  return {
    id,
    userId: "user-1",
    startTime,
    endTime,
    startType: "manual",
    startVerified: true,
    outputNote: null,
    lastHeartbeat: null,
    syncedAt: null,
    createdAt: startTime,
  };
}

function makeBreak(
  id: string,
  sessionId: string,
  startTime: number,
  endTime: number,
): Break {
  return {
    id,
    sessionId,
    startTime,
    endTime,
    type: "short",
    autoDetected: false,
  };
}

function makeIdleEvent(
  id: string,
  sessionId: string,
  startTime: number,
  endTime: number,
): IdleEvent {
  return {
    id,
    sessionId,
    startTime,
    endTime,
    resolution: "short",
  };
}

function makeTask(
  id: string,
  status: "open" | "inprogress" | "done" | "blocked",
): Task {
  return {
    id,
    projectId: "proj-1",
    title: `Task ${id}`,
    status,
    assigneeId: "user-1",
    priority: "medium",
    dueDate: null,
    estimatedMinutes: null,
    notes: null,
    createdBy: "user-1",
    createdAt: Date.now(),
    closedAt: status === "done" ? Date.now() : null,
  };
}

// --- Arbitraries ---

const BASE_TIME = 1_700_000_000; // a fixed reference timestamp

/**
 * Generate a session with optional breaks and idle events that fit within it.
 * Breaks/idles are guaranteed to be within session bounds and non-overlapping.
 */
const sessionWithInterruptionsArb = fc
  .record({
    sessionDuration: fc.integer({ min: 60, max: 36000 }), // 1 min to 10 hours
    breakCount: fc.integer({ min: 0, max: 5 }),
    idleCount: fc.integer({ min: 0, max: 5 }),
  })
  .chain(({ sessionDuration, breakCount, idleCount }) => {
    const totalInterruptions = breakCount + idleCount;
    if (totalInterruptions === 0) {
      return fc.constant({
        sessionDuration,
        interruptionOffsets: [] as Array<{ offset: number; length: number; isBreak: boolean }>,
      });
    }
    // Generate non-overlapping interruptions within the session
    return fc
      .array(
        fc.record({
          offsetPct: fc.double({ min: 0.05, max: 0.95, noNaN: true }),
          lengthPct: fc.double({ min: 0.01, max: 0.1, noNaN: true }),
          isBreak: fc.boolean(),
        }),
        { minLength: totalInterruptions, maxLength: totalInterruptions },
      )
      .map((raw) => {
        // Sort by offset and ensure non-overlapping
        const sorted = raw.sort((a, b) => a.offsetPct - b.offsetPct);
        const interruptions: Array<{ offset: number; length: number; isBreak: boolean }> = [];
        let lastEnd = 0;
        for (const r of sorted) {
          const offset = Math.max(
            Math.floor(r.offsetPct * sessionDuration),
            lastEnd + 1,
          );
          const maxLen = Math.floor(r.lengthPct * sessionDuration);
          const length = Math.max(1, Math.min(maxLen, sessionDuration - offset - 1));
          if (offset + length >= sessionDuration) break;
          interruptions.push({ offset, length, isBreak: r.isBreak });
          lastEnd = offset + length;
        }
        return { sessionDuration, interruptionOffsets: interruptions };
      });
  });

const taskStatusArb = fc.constantFrom<Task["status"]>(
  "open",
  "inprogress",
  "done",
  "blocked",
);

/**
 * Full focus score input: multiple sessions with interruptions + tasks.
 */
const focusInputArb = fc
  .record({
    sessionCount: fc.integer({ min: 1, max: 10 }),
    taskCount: fc.integer({ min: 0, max: 20 }),
  })
  .chain(({ sessionCount, taskCount }) =>
    fc.record({
      sessionSpecs: fc.array(sessionWithInterruptionsArb, {
        minLength: sessionCount,
        maxLength: sessionCount,
      }),
      taskStatuses: fc.array(taskStatusArb, {
        minLength: taskCount,
        maxLength: taskCount,
      }),
    }),
  )
  .map(({ sessionSpecs, taskStatuses }) => {
    const sessions: Session[] = [];
    const sessionBreaks = new Map<string, Break[]>();
    const sessionIdleEvents = new Map<string, IdleEvent[]>();
    let timeOffset = 0;

    for (let i = 0; i < sessionSpecs.length; i++) {
      const spec = sessionSpecs[i];
      const sessionId = `session-${i}`;
      const sessionStart = BASE_TIME + timeOffset;
      const sessionEnd = sessionStart + spec.sessionDuration;

      sessions.push(makeSession(sessionId, sessionStart, sessionEnd));

      const breaks: Break[] = [];
      const idles: IdleEvent[] = [];
      let bIdx = 0;
      let iIdx = 0;

      for (const intr of spec.interruptionOffsets) {
        if (intr.isBreak) {
          breaks.push(
            makeBreak(
              `break-${i}-${bIdx++}`,
              sessionId,
              sessionStart + intr.offset,
              sessionStart + intr.offset + intr.length,
            ),
          );
        } else {
          idles.push(
            makeIdleEvent(
              `idle-${i}-${iIdx++}`,
              sessionId,
              sessionStart + intr.offset,
              sessionStart + intr.offset + intr.length,
            ),
          );
        }
      }

      sessionBreaks.set(sessionId, breaks);
      sessionIdleEvents.set(sessionId, idles);

      // Gap between sessions
      timeOffset += spec.sessionDuration + 3600;
    }

    const tasks = taskStatuses.map((s, i) => makeTask(`task-${i}`, s));

    return { sessions, sessionBreaks, sessionIdleEvents, tasks };
  });

// --- Property Tests ---

describe("Property 14: Focus score computation and bounds", () => {
  it("0 <= sessionContinuity <= 1.0 (Req 16.1)", () => {
    fc.assert(
      fc.property(focusInputArb, ({ sessions, sessionBreaks, sessionIdleEvents, tasks }) => {
        const result = computeFocusScore(sessions, sessionBreaks, sessionIdleEvents, tasks);

        expect(result.sessionContinuity).toBeGreaterThanOrEqual(0);
        expect(result.sessionContinuity).toBeLessThanOrEqual(1.0);
      }),
      { numRuns: 300 },
    );
  });

  it("avgUninterruptedMin >= 0 (Req 16.1)", () => {
    fc.assert(
      fc.property(focusInputArb, ({ sessions, sessionBreaks, sessionIdleEvents, tasks }) => {
        const result = computeFocusScore(sessions, sessionBreaks, sessionIdleEvents, tasks);

        expect(result.avgUninterruptedMin).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 300 },
    );
  });

  it("0 <= taskCompletionRate <= 1.0 (Req 16.1)", () => {
    fc.assert(
      fc.property(focusInputArb, ({ sessions, sessionBreaks, sessionIdleEvents, tasks }) => {
        const result = computeFocusScore(sessions, sessionBreaks, sessionIdleEvents, tasks);

        expect(result.taskCompletionRate).toBeGreaterThanOrEqual(0);
        expect(result.taskCompletionRate).toBeLessThanOrEqual(1.0);
      }),
      { numRuns: 300 },
    );
  });

  it("0 <= compositeScore <= 100 (Req 16.1)", () => {
    fc.assert(
      fc.property(focusInputArb, ({ sessions, sessionBreaks, sessionIdleEvents, tasks }) => {
        const result = computeFocusScore(sessions, sessionBreaks, sessionIdleEvents, tasks);

        expect(result.compositeScore).toBeGreaterThanOrEqual(0);
        expect(result.compositeScore).toBeLessThanOrEqual(100);
      }),
      { numRuns: 300 },
    );
  });

  it("compositeScore matches weighted formula (Req 16.1)", () => {
    fc.assert(
      fc.property(focusInputArb, ({ sessions, sessionBreaks, sessionIdleEvents, tasks }) => {
        const result = computeFocusScore(sessions, sessionBreaks, sessionIdleEvents, tasks);

        const expected =
          (result.sessionContinuity * 0.4 +
            Math.min(result.avgUninterruptedMin / 60, 1.0) * 0.3 +
            result.taskCompletionRate * 0.3) *
          100;

        // INVARIANT: composite equals the weighted formula
        expect(result.compositeScore).toBeCloseTo(expected, 10);
      }),
      { numRuns: 300 },
    );
  });

  it("empty inputs → all zeros (Req 16.1)", () => {
    const result = computeFocusScore([], new Map(), new Map(), []);

    expect(result.sessionContinuity).toBe(0);
    expect(result.avgUninterruptedMin).toBe(0);
    expect(result.taskCompletionRate).toBe(0);
    expect(result.compositeScore).toBe(0);
  });
});
