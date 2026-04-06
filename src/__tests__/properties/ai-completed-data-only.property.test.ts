import { describe, it, expect } from "vitest";
import fc from "fast-check";

/**
 * Property 15: AI Operates on Completed Data Only
 *
 * For all data passed to the AI_Dispatcher, every session in the input
 * has a non-null endTime. No active session data is included in any
 * AI request payload.
 *
 * **Validates: Requirement 17.1**
 */

// --- Types ---

interface Session {
  id: string;
  userId: string;
  startTime: number;
  endTime: number | null;
  outputNote: string | null;
}

interface CompletedSession {
  id: string;
  userId: string;
  startTime: number;
  endTime: number; // non-null — completed
  outputNote: string | null;
}

interface SessionTask {
  id: string;
  sessionId: string;
  taskId: string;
  startTime: number;
  endTime: number | null;
}

interface CompletedSessionTask {
  id: string;
  sessionId: string;
  taskId: string;
  startTime: number;
  endTime: number; // non-null — completed
}

interface AIReviewInput {
  sessions: CompletedSession[];
  tasks: Array<{ id: string; title: string; closedAt: number | null }>;
  breaks: Array<{ id: string; sessionId: string; startTime: number; endTime: number }>;
  outputNotes: string[];
}

// --- Functions under test ---

/**
 * Filter sessions to only include completed ones (endTime !== null).
 * This is the core filtering logic that the AI_Dispatcher must apply.
 */
function filterCompletedSessions(sessions: Session[]): CompletedSession[] {
  return sessions.filter(
    (s): s is CompletedSession => s.endTime !== null,
  );
}

/**
 * Filter session tasks to only include completed ones.
 */
function filterCompletedSessionTasks(
  sessionTasks: SessionTask[],
): CompletedSessionTask[] {
  return sessionTasks.filter(
    (st): st is CompletedSessionTask => st.endTime !== null,
  );
}

/**
 * Build AI review input from raw data — applies completed-only filtering.
 */
function buildAIReviewInput(
  allSessions: Session[],
  allSessionTasks: SessionTask[],
  tasks: Array<{ id: string; title: string; closedAt: number | null }>,
  breaks: Array<{ id: string; sessionId: string; startTime: number; endTime: number }>,
): AIReviewInput {
  const completedSessions = filterCompletedSessions(allSessions);
  const completedSessionIds = new Set(completedSessions.map((s) => s.id));

  // Only include breaks from completed sessions
  const filteredBreaks = breaks.filter((b) =>
    completedSessionIds.has(b.sessionId),
  );

  // Collect output notes from completed sessions only
  const outputNotes = completedSessions
    .filter((s) => s.outputNote !== null)
    .map((s) => s.outputNote!);

  return {
    sessions: completedSessions,
    tasks,
    breaks: filteredBreaks,
    outputNotes,
  };
}

/**
 * Validate that an AI input payload contains only completed session data.
 * Returns true if all sessions have non-null endTime.
 */
function validateAllSessionsCompleted(input: AIReviewInput): boolean {
  return input.sessions.every((s) => s.endTime !== null && s.endTime > 0);
}

/**
 * Validate that no active session data leaked into the AI input.
 * Checks that no session has endTime === null.
 */
function validateNoActiveSessionData(
  input: AIReviewInput,
  allSessions: Session[],
): boolean {
  const activeSessions = allSessions.filter((s) => s.endTime === null);
  const inputSessionIds = new Set(input.sessions.map((s) => s.id));

  // No active session ID should appear in the AI input
  return activeSessions.every((s) => !inputSessionIds.has(s.id));
}

// --- Arbitraries ---

const userIdArb = fc.uuid();
const weekStartArb = fc.integer({ min: 1_700_000_000, max: 1_800_000_000 });
const WEEK_SECS = 7 * 24 * 3600;

function sessionArb(weekStart: number, weekEnd: number): fc.Arbitrary<Session> {
  return fc
    .record({
      id: fc.uuid(),
      userId: userIdArb,
      startOffset: fc.integer({ min: 0, max: Math.max(weekEnd - weekStart - 3600, 0) }),
      duration: fc.integer({ min: 3600, max: 10 * 3600 }),
      isActive: fc.boolean(), // randomly make some sessions active (endTime = null)
      outputNote: fc.option(fc.lorem({ maxCount: 5 }), { nil: null }),
    })
    .map(({ id, userId, startOffset, duration, isActive, outputNote }) => {
      const startTime = weekStart + startOffset;
      const endTime = isActive ? null : Math.min(startTime + duration, weekEnd);
      return { id, userId, startTime, endTime, outputNote };
    });
}

function sessionTaskArb(session: Session): fc.Arbitrary<SessionTask> {
  const sessionDuration = (session.endTime ?? session.startTime + 3600) - session.startTime;
  return fc
    .record({
      id: fc.uuid(),
      taskId: fc.uuid(),
      startOffset: fc.integer({ min: 0, max: Math.max(sessionDuration - 600, 0) }),
      duration: fc.integer({ min: 300, max: Math.min(sessionDuration, 4 * 3600) }),
      isActive: fc.boolean(),
    })
    .map(({ id, taskId, startOffset, duration, isActive }) => {
      const startTime = session.startTime + startOffset;
      const endTime = isActive ? null : startTime + duration;
      return { id, sessionId: session.id, taskId, startTime, endTime };
    });
}

const taskArb = fc.record({
  id: fc.uuid(),
  title: fc.lorem({ maxCount: 4 }),
  closedAt: fc.option(fc.integer({ min: 1_700_000_000, max: 1_800_000_000 }), { nil: null }),
});

function breakArb(session: Session): fc.Arbitrary<{
  id: string;
  sessionId: string;
  startTime: number;
  endTime: number;
}> {
  const sessionDuration = (session.endTime ?? session.startTime + 3600) - session.startTime;
  return fc
    .record({
      id: fc.uuid(),
      startOffset: fc.integer({ min: 0, max: Math.max(sessionDuration - 600, 0) }),
      duration: fc.integer({ min: 300, max: 3600 }),
    })
    .map(({ id, startOffset, duration }) => {
      const startTime = session.startTime + startOffset;
      const endTime = startTime + duration;
      return { id, sessionId: session.id, startTime, endTime };
    });
}

// --- Property Tests ---

describe("Property 15: AI Operates on Completed Data Only", () => {
  it("filterCompletedSessions returns only sessions with non-null endTime", () => {
    fc.assert(
      fc.property(
        weekStartArb.chain((ws) => {
          const we = ws + WEEK_SECS;
          return fc.array(sessionArb(ws, we), { minLength: 1, maxLength: 10 });
        }),
        (sessions) => {
          const completed = filterCompletedSessions(sessions);

          // Every returned session must have non-null endTime
          for (const s of completed) {
            expect(s.endTime).not.toBeNull();
            expect(typeof s.endTime).toBe("number");
            expect(s.endTime).toBeGreaterThan(0);
          }

          // Count should match manual filter
          const expectedCount = sessions.filter((s) => s.endTime !== null).length;
          expect(completed.length).toBe(expectedCount);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("buildAIReviewInput excludes all active sessions", () => {
    fc.assert(
      fc.property(
        weekStartArb.chain((ws) => {
          const we = ws + WEEK_SECS;
          return fc.tuple(
            fc.constant(ws),
            fc.array(sessionArb(ws, we), { minLength: 1, maxLength: 8 }),
            fc.array(taskArb, { minLength: 0, maxLength: 5 }),
          );
        }),
        ([weekStart, sessions, tasks]) => {
          // Generate breaks and session tasks
          const allBreaks: Array<{ id: string; sessionId: string; startTime: number; endTime: number }> = [];
          const allSessionTasks: SessionTask[] = [];
          for (const s of sessions) {
            const brks = fc.sample(breakArb(s), fc.sample(fc.integer({ min: 0, max: 2 }), 1)[0]);
            allBreaks.push(...brks);
            const sts = fc.sample(sessionTaskArb(s), fc.sample(fc.integer({ min: 0, max: 2 }), 1)[0]);
            allSessionTasks.push(...sts);
          }

          const input = buildAIReviewInput(sessions, allSessionTasks, tasks, allBreaks);

          // Core property: all sessions in AI input have non-null endTime
          expect(validateAllSessionsCompleted(input)).toBe(true);

          // No active session data leaked
          expect(validateNoActiveSessionData(input, sessions)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("AI input breaks only reference completed sessions", () => {
    fc.assert(
      fc.property(
        weekStartArb.chain((ws) => {
          const we = ws + WEEK_SECS;
          return fc.tuple(
            fc.array(sessionArb(ws, we), { minLength: 2, maxLength: 8 }),
            fc.array(taskArb, { minLength: 0, maxLength: 3 }),
          );
        }),
        ([sessions, tasks]) => {
          const allBreaks: Array<{ id: string; sessionId: string; startTime: number; endTime: number }> = [];
          for (const s of sessions) {
            const brks = fc.sample(breakArb(s), fc.sample(fc.integer({ min: 0, max: 2 }), 1)[0]);
            allBreaks.push(...brks);
          }

          const input = buildAIReviewInput(sessions, [], tasks, allBreaks);
          const completedSessionIds = new Set(input.sessions.map((s) => s.id));

          // Every break in the AI input must reference a completed session
          for (const b of input.breaks) {
            expect(completedSessionIds.has(b.sessionId)).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("output notes in AI input come only from completed sessions", () => {
    fc.assert(
      fc.property(
        weekStartArb.chain((ws) => {
          const we = ws + WEEK_SECS;
          return fc.array(sessionArb(ws, we), { minLength: 1, maxLength: 8 });
        }),
        (sessions) => {
          const input = buildAIReviewInput(sessions, [], [], []);

          // Collect expected notes from completed sessions only
          const expectedNotes = sessions
            .filter((s) => s.endTime !== null && s.outputNote !== null)
            .map((s) => s.outputNote!);

          expect(input.outputNotes).toEqual(expectedNotes);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("when all sessions are active, AI input has zero sessions", () => {
    fc.assert(
      fc.property(
        weekStartArb,
        fc.integer({ min: 1, max: 5 }),
        (weekStart, count) => {
          // Create only active sessions (endTime = null)
          const activeSessions: Session[] = Array.from({ length: count }, (_, i) => ({
            id: `active-${i}`,
            userId: "user-1",
            startTime: weekStart + i * 3600,
            endTime: null,
            outputNote: `note-${i}`,
          }));

          const input = buildAIReviewInput(activeSessions, [], [], []);

          expect(input.sessions.length).toBe(0);
          expect(input.breaks.length).toBe(0);
          expect(input.outputNotes.length).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
