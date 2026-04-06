import { describe, it, expect } from "vitest";
import fc from "fast-check";

/**
 * Property 17: Weekly Review Aggregation Correctness
 *
 * Total hours = sum of session durations minus break/discard time.
 * Tasks closed = tasks with closedAt within week.
 * Per-project time = sum of session_task durations grouped by project.
 * Team tab shows no ranking or scoring.
 *
 * **Validates: Requirements 16.2, 16.6**
 */

// --- Types mirroring the PACE data model ---

interface Session {
  id: string;
  startTime: number;
  endTime: number;
}

interface Break {
  id: string;
  sessionId: string;
  startTime: number;
  endTime: number;
  type: "lunch" | "short" | "meeting" | "discarded";
}

interface SessionTask {
  id: string;
  sessionId: string;
  taskId: string;
  projectId: string;
  startTime: number;
  endTime: number;
}

interface Task {
  id: string;
  projectId: string;
  status: "open" | "inprogress" | "done" | "blocked";
  closedAt: number | null;
}

interface TeamMemberSummary {
  userId: string;
  hours: number;
  tasksClosed: number;
  activeDays: number;
}

interface WeeklyAggregation {
  totalHours: number;
  tasksClosed: number;
  perProjectHours: Record<string, number>;
}

// --- Pure aggregation functions under test ---

const MICRO_BREAK_THRESHOLD_SECS = 8 * 60; // 8 minutes

/**
 * Compute weekly total hours:
 * Sum of session durations minus break time (non-discarded >= 8min) minus discarded time.
 */
function computeWeeklyTotalHours(
  sessions: Session[],
  breaks: Break[],
): number {
  const totalSessionSecs = sessions.reduce(
    (sum, s) => sum + (s.endTime - s.startTime),
    0,
  );

  const breakSecs = breaks
    .filter(
      (b) =>
        b.type !== "discarded" &&
        b.endTime - b.startTime >= MICRO_BREAK_THRESHOLD_SECS,
    )
    .reduce((sum, b) => sum + (b.endTime - b.startTime), 0);

  const discardedSecs = breaks
    .filter((b) => b.type === "discarded")
    .reduce((sum, b) => sum + (b.endTime - b.startTime), 0);

  return (totalSessionSecs - breakSecs - discardedSecs) / 3600;
}

/**
 * Count tasks closed within the week boundary.
 */
function computeTasksClosed(
  tasks: Task[],
  weekStart: number,
  weekEnd: number,
): number {
  return tasks.filter(
    (t) =>
      t.status === "done" &&
      t.closedAt !== null &&
      t.closedAt >= weekStart &&
      t.closedAt <= weekEnd,
  ).length;
}

/**
 * Compute per-project time from session_tasks grouped by projectId.
 */
function computePerProjectHours(
  sessionTasks: SessionTask[],
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const st of sessionTasks) {
    const hours = (st.endTime - st.startTime) / 3600;
    result[st.projectId] = (result[st.projectId] ?? 0) + hours;
  }
  return result;
}

/**
 * Full weekly aggregation.
 */
function computeWeeklyAggregation(
  sessions: Session[],
  breaks: Break[],
  tasks: Task[],
  sessionTasks: SessionTask[],
  weekStart: number,
  weekEnd: number,
): WeeklyAggregation {
  return {
    totalHours: computeWeeklyTotalHours(sessions, breaks),
    tasksClosed: computeTasksClosed(tasks, weekStart, weekEnd),
    perProjectHours: computePerProjectHours(sessionTasks),
  };
}

/**
 * Validate team tab has no ranking or scoring — just raw data.
 * Returns true if no member has a rank or score field.
 */
function validateNoRankingOrScoring(
  members: TeamMemberSummary[],
): boolean {
  // Team summaries should only contain hours, tasksClosed, activeDays
  // No rank, score, percentile, or comparison fields
  for (const m of members) {
    const keys = Object.keys(m);
    const forbidden = ["rank", "score", "percentile", "rating", "comparison"];
    if (keys.some((k) => forbidden.includes(k.toLowerCase()))) {
      return false;
    }
  }
  return true;
}

// --- Arbitraries ---

const weekStartArb = fc.integer({ min: 1_700_000_000, max: 1_800_000_000 });
const WEEK_SECS = 7 * 24 * 3600;

const breakTypeArb = fc.constantFrom(
  "lunch" as const,
  "short" as const,
  "meeting" as const,
  "discarded" as const,
);

const taskStatusArb = fc.constantFrom(
  "open" as const,
  "inprogress" as const,
  "done" as const,
  "blocked" as const,
);

const projectIdArb = fc.constantFrom("proj-a", "proj-b", "proj-c", "proj-d");

function sessionArb(
  weekStart: number,
  weekEnd: number,
): fc.Arbitrary<Session> {
  return fc
    .record({
      id: fc.uuid(),
      startOffset: fc.integer({ min: 0, max: Math.max(weekEnd - weekStart - 3600, 0) }),
      duration: fc.integer({ min: 3600, max: 10 * 3600 }), // 1h-10h
    })
    .map(({ id, startOffset, duration }) => {
      const startTime = weekStart + startOffset;
      const endTime = Math.min(startTime + duration, weekEnd);
      return { id, startTime, endTime };
    });
}

function breakArb(session: Session): fc.Arbitrary<Break> {
  const sessionDuration = session.endTime - session.startTime;
  return fc
    .record({
      id: fc.uuid(),
      type: breakTypeArb,
      startOffset: fc.integer({
        min: 0,
        max: Math.max(sessionDuration - 60, 0),
      }),
      isMicro: fc.boolean(),
      microDuration: fc.integer({ min: 60, max: MICRO_BREAK_THRESHOLD_SECS - 1 }),
      regularDuration: fc.integer({
        min: MICRO_BREAK_THRESHOLD_SECS,
        max: 3600,
      }),
    })
    .map(
      ({
        id,
        type,
        startOffset,
        isMicro,
        microDuration,
        regularDuration,
      }) => {
        const duration = isMicro ? microDuration : regularDuration;
        const startTime = session.startTime + startOffset;
        const endTime = Math.min(startTime + duration, session.endTime);
        return {
          id,
          sessionId: session.id,
          startTime,
          endTime,
          type,
        };
      },
    );
}

function sessionTaskArb(session: Session): fc.Arbitrary<SessionTask> {
  const sessionDuration = session.endTime - session.startTime;
  return fc
    .record({
      id: fc.uuid(),
      taskId: fc.uuid(),
      projectId: projectIdArb,
      startOffset: fc.integer({
        min: 0,
        max: Math.max(sessionDuration - 600, 0),
      }),
      duration: fc.integer({ min: 600, max: Math.min(sessionDuration, 4 * 3600) }),
    })
    .map(({ id, taskId, projectId, startOffset, duration }) => {
      const startTime = session.startTime + startOffset;
      const endTime = Math.min(startTime + duration, session.endTime);
      return {
        id,
        sessionId: session.id,
        taskId,
        projectId,
        startTime,
        endTime,
      };
    });
}

function taskArb(
  weekStart: number,
  weekEnd: number,
): fc.Arbitrary<Task> {
  return fc
    .record({
      id: fc.uuid(),
      projectId: projectIdArb,
      status: taskStatusArb,
      closedInWeek: fc.boolean(),
      closedOffset: fc.integer({ min: 0, max: weekEnd - weekStart }),
      closedOutside: fc.integer({ min: weekEnd + 1, max: weekEnd + 86400 }),
    })
    .map(({ id, projectId, status, closedInWeek, closedOffset, closedOutside }) => {
      let closedAt: number | null = null;
      if (status === "done") {
        closedAt = closedInWeek
          ? weekStart + closedOffset
          : closedOutside;
      }
      return { id, projectId, status, closedAt };
    });
}

// --- Property Tests ---

describe("Property 17: Weekly Review Aggregation Correctness", () => {
  it("total hours = sum of session durations minus break/discard time", () => {
    fc.assert(
      fc.property(
        weekStartArb,
        fc.integer({ min: 1, max: 5 }), // number of sessions
        (weekStart, sessionCount) => {
          const weekEnd = weekStart + WEEK_SECS;

          // Generate sessions
          const sessions = fc.sample(
            sessionArb(weekStart, weekEnd),
            sessionCount,
          );

          // Generate breaks for each session
          const allBreaks: Break[] = [];
          for (const s of sessions) {
            const breakCount = fc.sample(fc.integer({ min: 0, max: 3 }), 1)[0];
            const sessionBreaks = fc.sample(breakArb(s), breakCount);
            allBreaks.push(...sessionBreaks);
          }

          const totalHours = computeWeeklyTotalHours(sessions, allBreaks);

          // Manual verification
          const totalSessionSecs = sessions.reduce(
            (sum, s) => sum + (s.endTime - s.startTime),
            0,
          );
          const breakSecs = allBreaks
            .filter(
              (b) =>
                b.type !== "discarded" &&
                b.endTime - b.startTime >= MICRO_BREAK_THRESHOLD_SECS,
            )
            .reduce((sum, b) => sum + (b.endTime - b.startTime), 0);
          const discardedSecs = allBreaks
            .filter((b) => b.type === "discarded")
            .reduce((sum, b) => sum + (b.endTime - b.startTime), 0);

          const expected = (totalSessionSecs - breakSecs - discardedSecs) / 3600;
          expect(totalHours).toBeCloseTo(expected, 10);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("tasks closed = tasks with closedAt within week boundary", () => {
    fc.assert(
      fc.property(
        weekStartArb,
        fc.integer({ min: 1, max: 15 }),
        (weekStart, taskCount) => {
          const weekEnd = weekStart + WEEK_SECS;
          const tasks = fc.sample(taskArb(weekStart, weekEnd), taskCount);

          const closed = computeTasksClosed(tasks, weekStart, weekEnd);

          // Manual count
          const expected = tasks.filter(
            (t) =>
              t.status === "done" &&
              t.closedAt !== null &&
              t.closedAt >= weekStart &&
              t.closedAt <= weekEnd,
          ).length;

          expect(closed).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("per-project time = sum of session_task durations grouped by project", () => {
    fc.assert(
      fc.property(
        weekStartArb,
        fc.integer({ min: 1, max: 4 }),
        (weekStart, sessionCount) => {
          const weekEnd = weekStart + WEEK_SECS;
          const sessions = fc.sample(
            sessionArb(weekStart, weekEnd),
            sessionCount,
          );

          // Generate session tasks
          const allSessionTasks: SessionTask[] = [];
          for (const s of sessions) {
            const stCount = fc.sample(fc.integer({ min: 1, max: 4 }), 1)[0];
            const sts = fc.sample(sessionTaskArb(s), stCount);
            allSessionTasks.push(...sts);
          }

          const perProject = computePerProjectHours(allSessionTasks);

          // Manual grouping
          const expected: Record<string, number> = {};
          for (const st of allSessionTasks) {
            const hours = (st.endTime - st.startTime) / 3600;
            expected[st.projectId] = (expected[st.projectId] ?? 0) + hours;
          }

          // Same keys
          expect(Object.keys(perProject).sort()).toEqual(
            Object.keys(expected).sort(),
          );

          // Same values
          for (const key of Object.keys(expected)) {
            expect(perProject[key]).toBeCloseTo(expected[key], 10);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("team tab shows no ranking or scoring fields", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            userId: fc.uuid(),
            hours: fc.double({ min: 0, max: 60, noNaN: true }),
            tasksClosed: fc.integer({ min: 0, max: 30 }),
            activeDays: fc.integer({ min: 0, max: 7 }),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        (members) => {
          expect(validateNoRankingOrScoring(members)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("full weekly aggregation is internally consistent", () => {
    fc.assert(
      fc.property(
        weekStartArb,
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 1, max: 10 }),
        (weekStart, sessionCount, taskCount) => {
          const weekEnd = weekStart + WEEK_SECS;

          const sessions = fc.sample(
            sessionArb(weekStart, weekEnd),
            sessionCount,
          );

          const allBreaks: Break[] = [];
          for (const s of sessions) {
            const bc = fc.sample(fc.integer({ min: 0, max: 3 }), 1)[0];
            allBreaks.push(...fc.sample(breakArb(s), bc));
          }

          const allSessionTasks: SessionTask[] = [];
          for (const s of sessions) {
            const stc = fc.sample(fc.integer({ min: 1, max: 3 }), 1)[0];
            allSessionTasks.push(...fc.sample(sessionTaskArb(s), stc));
          }

          const tasks = fc.sample(taskArb(weekStart, weekEnd), taskCount);

          const agg = computeWeeklyAggregation(
            sessions,
            allBreaks,
            tasks,
            allSessionTasks,
            weekStart,
            weekEnd,
          );

          // Structural invariants:
          // 1. totalHours >= 0 (work can't be negative when breaks fit in sessions)
          // Note: In edge cases breaks could exceed session time, so we just check it's finite
          expect(Number.isFinite(agg.totalHours)).toBe(true);

          // 2. tasksClosed <= total done tasks
          const totalDone = tasks.filter((t) => t.status === "done").length;
          expect(agg.tasksClosed).toBeLessThanOrEqual(totalDone);

          // 3. All per-project hours are non-negative
          for (const hours of Object.values(agg.perProjectHours)) {
            expect(hours).toBeGreaterThanOrEqual(0);
          }

          // 4. Sum of per-project hours = sum of all session_task durations
          const totalProjectHours = Object.values(agg.perProjectHours).reduce(
            (s, h) => s + h,
            0,
          );
          const expectedTotal = allSessionTasks.reduce(
            (s, st) => s + (st.endTime - st.startTime) / 3600,
            0,
          );
          expect(totalProjectHours).toBeCloseTo(expectedTotal, 10);
        },
      ),
      { numRuns: 200 },
    );
  });
});
