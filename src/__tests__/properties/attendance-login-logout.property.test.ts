import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeAttendance } from "@/lib/attendance";
import type { Session, Break } from "@/types";

/**
 * Property 2: Attendance login/logout derivation
 *
 * For any user and any calendar day with one or more closed sessions,
 * the computed login time should equal the minimum session startTime
 * and the computed logout time should equal the maximum session endTime
 * across all sessions for that user on that day.
 *
 * **Validates: Requirements 2.1, 2.2**
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

const userIdArb = fc.stringMatching(/^user-[a-z0-9]{4,8}$/);

/** Generate a closed session within a fixed day (2025-06-15) */
function closedSessionArb(
  userId: string,
  index: number,
): fc.Arbitrary<Session> {
  return fc
    .record({
      startHour: fc.integer({ min: 0, max: 22 }),
      startMin: fc.integer({ min: 0, max: 59 }),
      durationMin: fc.integer({ min: 1, max: 120 }),
    })
    .map(({ startHour, startMin, durationMin }) => {
      const startTime = utc(2025, 6, 15, startHour, startMin);
      // Ensure endTime stays within the same day and is after startTime
      const endTime = startTime + durationMin * 60;
      return makeSession({
        id: `s-${index}`,
        userId,
        startTime,
        endTime,
      });
    });
}

/** Generate an open session (endTime === null) within the same day */
function openSessionArb(userId: string, index: number): fc.Arbitrary<Session> {
  return fc
    .record({
      startHour: fc.integer({ min: 0, max: 23 }),
      startMin: fc.integer({ min: 0, max: 59 }),
    })
    .map(({ startHour, startMin }) => {
      const startTime = utc(2025, 6, 15, startHour, startMin);
      return makeSession({
        id: `open-${index}`,
        userId,
        startTime,
        endTime: null,
      });
    });
}

// --- Property Tests ---

describe("Property 2: Attendance login/logout derivation", () => {
  it("loginTime equals the minimum startTime among closed sessions", () => {
    fc.assert(
      fc.property(
        userIdArb,
        fc.integer({ min: 1, max: 6 }),
        (userId, sessionCount) => {
          // Generate closed sessions
          const sessions = fc.sample(
            closedSessionArb(userId, 0),
            sessionCount,
          ).map((s, i) => ({ ...s, id: `s-${i}` }));

          const result = computeAttendance(userId, "2025-06-15", sessions, {});

          const expectedLoginTime = Math.min(
            ...sessions.map((s) => s.startTime),
          );

          // INVARIANT: loginTime = min(startTime) across all closed sessions
          expect(result.loginTime).toBe(expectedLoginTime);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("logoutTime equals the maximum endTime among closed sessions", () => {
    fc.assert(
      fc.property(
        userIdArb,
        fc.integer({ min: 1, max: 6 }),
        (userId, sessionCount) => {
          const sessions = fc.sample(
            closedSessionArb(userId, 0),
            sessionCount,
          ).map((s, i) => ({ ...s, id: `s-${i}` }));

          const result = computeAttendance(userId, "2025-06-15", sessions, {});

          const expectedLogoutTime = Math.max(
            ...sessions.map((s) => s.endTime!),
          );

          // INVARIANT: logoutTime = max(endTime) across all closed sessions
          expect(result.logoutTime).toBe(expectedLogoutTime);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("loginTime <= logoutTime when both are present", () => {
    fc.assert(
      fc.property(
        userIdArb,
        fc.integer({ min: 1, max: 6 }),
        (userId, sessionCount) => {
          const sessions = fc.sample(
            closedSessionArb(userId, 0),
            sessionCount,
          ).map((s, i) => ({ ...s, id: `s-${i}` }));

          const result = computeAttendance(userId, "2025-06-15", sessions, {});

          // INVARIANT: loginTime <= logoutTime
          expect(result.loginTime).not.toBeNull();
          expect(result.logoutTime).not.toBeNull();
          expect(result.loginTime!).toBeLessThanOrEqual(result.logoutTime!);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("both loginTime and logoutTime are null when no closed sessions exist", () => {
    fc.assert(
      fc.property(
        userIdArb,
        fc.integer({ min: 0, max: 5 }),
        (userId, openCount) => {
          // Generate only open sessions (endTime === null)
          const openSessions = fc.sample(
            openSessionArb(userId, 0),
            openCount,
          ).map((s, i) => ({ ...s, id: `open-${i}` }));

          const result = computeAttendance(
            userId,
            "2025-06-15",
            openSessions,
            {},
          );

          // INVARIANT: no closed sessions → both null
          expect(result.loginTime).toBeNull();
          expect(result.logoutTime).toBeNull();
          expect(result.totalHours).toBe(0);
          expect(result.breakMinutes).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("open sessions (endTime === null) do not affect login/logout times", () => {
    fc.assert(
      fc.property(
        userIdArb,
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 1, max: 4 }),
        (userId, closedCount, openCount) => {
          const closedSessions = fc.sample(
            closedSessionArb(userId, 0),
            closedCount,
          ).map((s, i) => ({ ...s, id: `closed-${i}` }));

          const openSessions = fc.sample(
            openSessionArb(userId, 0),
            openCount,
          ).map((s, i) => ({ ...s, id: `open-${i}` }));

          // Compute with only closed sessions
          const resultClosedOnly = computeAttendance(
            userId,
            "2025-06-15",
            closedSessions,
            {},
          );

          // Compute with closed + open sessions mixed together
          const allSessions = [...closedSessions, ...openSessions];
          const resultMixed = computeAttendance(
            userId,
            "2025-06-15",
            allSessions,
            {},
          );

          // INVARIANT: open sessions have zero effect on login/logout
          expect(resultMixed.loginTime).toBe(resultClosedOnly.loginTime);
          expect(resultMixed.logoutTime).toBe(resultClosedOnly.logoutTime);
        },
      ),
      { numRuns: 200 },
    );
  });
});
