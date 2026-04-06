import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeAttendance } from "@/lib/attendance";
import type { Session, Break } from "@/types";

/**
 * Property 3: Attendance hours and break computation
 *
 * For any user and any calendar day with closed sessions, the computed
 * total hours should equal the sum of (session endTime - session startTime
 * - sum of break durations within that session) across all sessions, and
 * the computed break duration should equal the sum of all break record
 * durations within those sessions.
 *
 * **Validates: Requirements 2.3, 2.4**
 */

// --- Helpers ---

/** UTC timestamp for a given date and time */
function utc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  min = 0,
  sec = 0,
): number {
  return Math.floor(Date.UTC(year, month - 1, day, hour, min, sec) / 1000);
}

function makeSession(
  overrides: Partial<Session> & Pick<Session, "id" | "userId" | "startTime">,
): Session {
  return {
    endTime: null,
    startType: "manual",
    startVerified: true,
    outputNote: null,
    lastHeartbeat: null,
    syncedAt: null,
    createdAt: overrides.startTime,
    ...overrides,
  };
}

function makeBreak(
  overrides: Partial<Break> & Pick<Break, "id" | "sessionId" | "startTime">,
): Break {
  return {
    endTime: null,
    type: "short",
    autoDetected: false,
    ...overrides,
  };
}

// --- Arbitraries ---

const DAY_BASE = utc(2025, 6, 15); // fixed day for all tests

const userIdArb = fc.stringMatching(/^user-[a-z0-9]{4,8}$/);

/**
 * Generate a list of non-overlapping closed sessions with optional closed breaks.
 * Sessions are placed sequentially within the day to avoid overlap,
 * which matches the real-world invariant that a user has one active session at a time.
 */
function nonOverlappingSessionsWithBreaksArb(
  userId: string,
  count: number,
): fc.Arbitrary<{ session: Session; breaks: Break[] }[]> {
  // Generate `count` durations and gaps, then lay them out sequentially
  return fc
    .array(
      fc.record({
        gapSec: fc.integer({ min: 0, max: 1800 }), // 0..30min gap between sessions
        durationSec: fc.integer({ min: 60, max: 7200 }), // 1min..2h session
        breakCount: fc.integer({ min: 0, max: 3 }),
        breakSpecs: fc.array(
          fc.record({
            offsetFraction: fc.double({ min: 0.05, max: 0.9, noNaN: true }),
            durationFraction: fc.double({ min: 0.01, max: 0.15, noNaN: true }),
          }),
          { minLength: 3, maxLength: 3 },
        ),
      }),
      { minLength: count, maxLength: count },
    )
    .map((specs) => {
      let cursor = DAY_BASE + 3600; // start at 01:00 UTC
      return specs.map((spec, i) => {
        const startTime = cursor + spec.gapSec;
        const endTime = startTime + spec.durationSec;
        cursor = endTime;

        const breaks: Break[] = [];
        for (let j = 0; j < spec.breakCount; j++) {
          const bs = spec.breakSpecs[j];
          const bStart = Math.floor(
            startTime + bs.offsetFraction * spec.durationSec,
          );
          const bDuration = Math.max(
            1,
            Math.floor(bs.durationFraction * spec.durationSec),
          );
          const bEnd = Math.min(bStart + bDuration, endTime - 1);
          if (bEnd > bStart) {
            breaks.push(
              makeBreak({
                id: `b-${i}-${j}`,
                sessionId: `s-${i}`,
                startTime: bStart,
                endTime: bEnd,
              }),
            );
          }
        }

        return {
          session: makeSession({
            id: `s-${i}`,
            userId,
            startTime,
            endTime,
          }),
          breaks,
        };
      });
    });
}

// --- Helper to extract sessions/breaks from generated data ---

function unpack(generated: { session: Session; breaks: Break[] }[]): {
  sessions: Session[];
  breaksBySessionId: Record<string, Break[]>;
} {
  const sessions = generated.map((g) => g.session);
  const breaksBySessionId: Record<string, Break[]> = {};
  for (const g of generated) {
    breaksBySessionId[g.session.id] = g.breaks;
  }
  return { sessions, breaksBySessionId };
}

// --- Property Tests ---

describe("Property 3: Attendance hours and break computation", () => {
  it("totalHours >= 0 always", () => {
    fc.assert(
      fc.property(
        userIdArb.chain((userId) =>
          fc.integer({ min: 1, max: 5 }).chain((count) =>
            nonOverlappingSessionsWithBreaksArb(userId, count).map(
              (generated) => ({ userId, generated }),
            ),
          ),
        ),
        ({ userId, generated }) => {
          const { sessions, breaksBySessionId } = unpack(generated);
          const result = computeAttendance(
            userId,
            "2025-06-15",
            sessions,
            breaksBySessionId,
          );

          // INVARIANT: totalHours is always non-negative
          expect(result.totalHours).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("breakMinutes >= 0 always", () => {
    fc.assert(
      fc.property(
        userIdArb.chain((userId) =>
          fc.integer({ min: 1, max: 5 }).chain((count) =>
            nonOverlappingSessionsWithBreaksArb(userId, count).map(
              (generated) => ({ userId, generated }),
            ),
          ),
        ),
        ({ userId, generated }) => {
          const { sessions, breaksBySessionId } = unpack(generated);
          const result = computeAttendance(
            userId,
            "2025-06-15",
            sessions,
            breaksBySessionId,
          );

          // INVARIANT: breakMinutes is always non-negative
          expect(result.breakMinutes).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("totalHours <= total session span (logoutTime - loginTime) / 3600", () => {
    fc.assert(
      fc.property(
        userIdArb.chain((userId) =>
          fc.integer({ min: 1, max: 5 }).chain((count) =>
            nonOverlappingSessionsWithBreaksArb(userId, count).map(
              (generated) => ({ userId, generated }),
            ),
          ),
        ),
        ({ userId, generated }) => {
          const { sessions, breaksBySessionId } = unpack(generated);
          const result = computeAttendance(
            userId,
            "2025-06-15",
            sessions,
            breaksBySessionId,
          );

          if (result.loginTime !== null && result.logoutTime !== null) {
            const totalSpanHours =
              (result.logoutTime - result.loginTime) / 3600;
            // INVARIANT: totalHours cannot exceed the login-to-logout span
            expect(result.totalHours).toBeLessThanOrEqual(
              totalSpanHours + 0.001,
            );
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("totalHours = sum(session durations) - sum(break durations), all / 3600", () => {
    fc.assert(
      fc.property(
        userIdArb.chain((userId) =>
          fc.integer({ min: 1, max: 5 }).chain((count) =>
            nonOverlappingSessionsWithBreaksArb(userId, count).map(
              (generated) => ({ userId, generated }),
            ),
          ),
        ),
        ({ userId, generated }) => {
          const { sessions, breaksBySessionId } = unpack(generated);
          const result = computeAttendance(
            userId,
            "2025-06-15",
            sessions,
            breaksBySessionId,
          );

          // Manually compute expected totalHours
          let expectedTotalSecs = 0;
          for (const g of generated) {
            const sessionDuration = g.session.endTime! - g.session.startTime;
            const breakSecs = g.breaks
              .filter((b) => b.endTime !== null)
              .reduce((sum, b) => sum + (b.endTime! - b.startTime), 0);
            expectedTotalSecs += sessionDuration - breakSecs;
          }
          const expectedTotalHours = expectedTotalSecs / 3600;

          // INVARIANT: totalHours matches manual computation
          expect(result.totalHours).toBeCloseTo(expectedTotalHours, 6);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("breakMinutes = sum(break durations) / 60", () => {
    fc.assert(
      fc.property(
        userIdArb.chain((userId) =>
          fc.integer({ min: 1, max: 5 }).chain((count) =>
            nonOverlappingSessionsWithBreaksArb(userId, count).map(
              (generated) => ({ userId, generated }),
            ),
          ),
        ),
        ({ userId, generated }) => {
          const { sessions, breaksBySessionId } = unpack(generated);
          const result = computeAttendance(
            userId,
            "2025-06-15",
            sessions,
            breaksBySessionId,
          );

          // Manually compute expected breakMinutes
          let expectedBreakSecs = 0;
          for (const g of generated) {
            const breakSecs = g.breaks
              .filter((b) => b.endTime !== null)
              .reduce((sum, b) => sum + (b.endTime! - b.startTime), 0);
            expectedBreakSecs += breakSecs;
          }
          const expectedBreakMinutes = expectedBreakSecs / 60;

          // INVARIANT: breakMinutes matches manual computation
          expect(result.breakMinutes).toBeCloseTo(expectedBreakMinutes, 6);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("open breaks (endTime null) do not affect break computation", () => {
    fc.assert(
      fc.property(
        userIdArb.chain((userId) =>
          fc.integer({ min: 1, max: 4 }).chain((count) =>
            nonOverlappingSessionsWithBreaksArb(userId, count).map(
              (generated) => ({ userId, generated }),
            ),
          ),
        ),
        ({ userId, generated }) => {
          const { sessions, breaksBySessionId: closedBreaksMap } =
            unpack(generated);

          // Compute result with closed breaks only
          const resultClosedOnly = computeAttendance(
            userId,
            "2025-06-15",
            sessions,
            closedBreaksMap,
          );

          // Now add open breaks to each session
          const mixedBreaksMap: Record<string, Break[]> = {};
          for (const g of generated) {
            const midpoint = Math.floor(
              (g.session.startTime + g.session.endTime!) / 2,
            );
            const openBreak = makeBreak({
              id: `ob-${g.session.id}`,
              sessionId: g.session.id,
              startTime: midpoint,
              endTime: null,
            });
            mixedBreaksMap[g.session.id] = [...g.breaks, openBreak];
          }

          const resultWithOpen = computeAttendance(
            userId,
            "2025-06-15",
            sessions,
            mixedBreaksMap,
          );

          // INVARIANT: open breaks have zero effect on totalHours and breakMinutes
          expect(resultWithOpen.totalHours).toBeCloseTo(
            resultClosedOnly.totalHours,
            6,
          );
          expect(resultWithOpen.breakMinutes).toBeCloseTo(
            resultClosedOnly.breakMinutes,
            6,
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});
