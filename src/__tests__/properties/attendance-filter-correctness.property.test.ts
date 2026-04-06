import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { getAttendance } from "@/lib/attendance";
import type { Session } from "@/types";

/**
 * Property 1: Attendance filter correctness
 *
 * For any set of attendance records and any combination of active filters
 * (person, date range, project), the returned result set should contain only
 * records that match all active filters simultaneously — every record's userId
 * matches the person filter, every record's date falls within the date range,
 * and every record's day has session time on the filtered project.
 *
 * **Validates: Requirements 1.2, 1.3, 1.4**
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

// --- Arbitraries ---

/** Pool of user IDs to pick from */
const USER_IDS = ["user-alice", "user-bob", "user-carol", "user-dave"];

/** Pool of dates in June 2025 (days 1–20) */
const DATE_RANGE_START = "2025-06-01";
const DATE_RANGE_END = "2025-06-20";

/**
 * Generate a closed session for a given user on a given day (1-based day of June 2025).
 * Optionally tagged with a project via the returned session ID.
 */
function closedSessionForDay(
  userId: string,
  day: number,
  index: number,
  hour: number,
  durationMin: number,
): Session {
  const startTime = utc(2025, 6, day, hour, 0);
  const endTime = startTime + durationMin * 60;
  return makeSession({
    id: `s-${userId}-d${day}-${index}`,
    userId,
    startTime,
    endTime,
  });
}

/**
 * Arbitrary that generates a realistic set of closed sessions across
 * multiple users and multiple days, plus a set of "project session IDs"
 * representing sessions that have time on a specific project.
 */
const testDataArb = fc
  .record({
    // Which users have sessions (at least 2 for meaningful person filter tests)
    userIndices: fc.uniqueArray(fc.integer({ min: 0, max: 3 }), {
      minLength: 2,
      maxLength: 4,
    }),
    // Which days have sessions (at least 3 for meaningful date range tests)
    days: fc.uniqueArray(fc.integer({ min: 1, max: 20 }), {
      minLength: 3,
      maxLength: 10,
    }),
    // How many sessions per user-day (1-2)
    sessionsPerDay: fc.integer({ min: 1, max: 2 }),
    // Fraction of sessions that belong to the "project" (for project filter)
    projectFraction: fc.double({ min: 0.2, max: 0.8, noNaN: true }),
    // Session start hour and duration
    startHour: fc.integer({ min: 8, max: 14 }),
    durationMin: fc.integer({ min: 30, max: 180 }),
  })
  .map(
    ({
      userIndices,
      days,
      sessionsPerDay,
      projectFraction,
      startHour,
      durationMin,
    }) => {
      const users = userIndices.map((i) => USER_IDS[i]);
      const sortedDays = [...days].sort((a, b) => a - b);
      const sessions: Session[] = [];
      const projectSessionIds = new Set<string>();

      for (const userId of users) {
        for (const day of sortedDays) {
          for (let s = 0; s < sessionsPerDay; s++) {
            const session = closedSessionForDay(
              userId,
              day,
              s,
              startHour + s * 3,
              durationMin,
            );
            sessions.push(session);

            // Randomly assign some sessions to the project
            if (Math.random() < projectFraction) {
              projectSessionIds.add(session.id);
            }
          }
        }
      }

      return { users, sortedDays, sessions, projectSessionIds };
    },
  );

// --- Property Tests ---

describe("Property 1: Attendance filter correctness", () => {
  it("person filter: all returned records have the specified userId", () => {
    fc.assert(
      fc.property(testDataArb, ({ users, sessions }) => {
        // Pick a user to filter by
        const targetUser = users[0];

        const records = getAttendance(
          targetUser,
          DATE_RANGE_START,
          DATE_RANGE_END,
          sessions,
          {},
          undefined,
        );

        // INVARIANT: every returned record belongs to the filtered user
        for (const record of records) {
          expect(record.userId).toBe(targetUser);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("person filter: records for other users are excluded", () => {
    fc.assert(
      fc.property(testDataArb, ({ users, sessions }) => {
        const targetUser = users[0];

        const records = getAttendance(
          targetUser,
          DATE_RANGE_START,
          DATE_RANGE_END,
          sessions,
          {},
          undefined,
        );

        const otherUsers = users.filter((u) => u !== targetUser);
        const otherUserIds = new Set(otherUsers);

        // INVARIANT: no record from another user appears in the result
        for (const record of records) {
          expect(otherUserIds.has(record.userId)).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("date range filter: all returned records have dates within [startDate, endDate]", () => {
    fc.assert(
      fc.property(
        testDataArb,
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 12, max: 20 }),
        ({ sessions }, startDay, endDay) => {
          const startDate = `2025-06-${String(startDay).padStart(2, "0")}`;
          const endDate = `2025-06-${String(endDay).padStart(2, "0")}`;

          const records = getAttendance(
            null,
            startDate,
            endDate,
            sessions,
            {},
            undefined,
          );

          // INVARIANT: every returned record's date is within the range
          for (const record of records) {
            expect(record.date >= startDate).toBe(true);
            expect(record.date <= endDate).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("date range filter: records outside the range are excluded", () => {
    fc.assert(
      fc.property(
        testDataArb,
        fc.integer({ min: 5, max: 10 }),
        fc.integer({ min: 11, max: 15 }),
        ({ sessions }, startDay, endDay) => {
          const startDate = `2025-06-${String(startDay).padStart(2, "0")}`;
          const endDate = `2025-06-${String(endDay).padStart(2, "0")}`;

          const records = getAttendance(
            null,
            startDate,
            endDate,
            sessions,
            {},
            undefined,
          );

          // INVARIANT: no record outside the date range appears
          for (const record of records) {
            expect(record.date < startDate).toBe(false);
            expect(record.date > endDate).toBe(false);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("project filter: all returned records come from sessions in the project set", () => {
    fc.assert(
      fc.property(testDataArb, ({ sessions, projectSessionIds }) => {
        // Skip if no project sessions
        fc.pre(projectSessionIds.size > 0);

        const records = getAttendance(
          null,
          DATE_RANGE_START,
          DATE_RANGE_END,
          sessions,
          {},
          projectSessionIds,
        );

        // Build a set of (userId, date) pairs that have project sessions
        const projectUserDates = new Set<string>();
        for (const session of sessions) {
          if (
            session.endTime !== null &&
            projectSessionIds.has(session.id)
          ) {
            const d = new Date(session.startTime * 1000);
            const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
            projectUserDates.add(`${session.userId}|${dateStr}`);
          }
        }

        // INVARIANT: every returned record's (userId, date) is in the project set
        for (const record of records) {
          const key = `${record.userId}|${record.date}`;
          expect(projectUserDates.has(key)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("no filter: returns records for all users with closed sessions in the date range", () => {
    fc.assert(
      fc.property(testDataArb, ({ sessions }) => {
        const records = getAttendance(
          null,
          DATE_RANGE_START,
          DATE_RANGE_END,
          sessions,
          {},
          undefined,
        );

        // Collect unique userIds from records
        const recordUserIds = new Set(records.map((r) => r.userId));

        // Collect userIds that have at least one closed session in the range
        const expectedUserIds = new Set<string>();
        for (const session of sessions) {
          if (session.endTime !== null) {
            expectedUserIds.add(session.userId);
          }
        }

        // INVARIANT: all users with closed sessions appear in the result
        for (const userId of expectedUserIds) {
          expect(recordUserIds.has(userId)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("filters are composable: person + date range narrows results correctly", () => {
    fc.assert(
      fc.property(
        testDataArb,
        fc.integer({ min: 5, max: 10 }),
        fc.integer({ min: 11, max: 15 }),
        ({ users, sessions }, startDay, endDay) => {
          const targetUser = users[0];
          const startDate = `2025-06-${String(startDay).padStart(2, "0")}`;
          const endDate = `2025-06-${String(endDay).padStart(2, "0")}`;

          // Apply both filters
          const combined = getAttendance(
            targetUser,
            startDate,
            endDate,
            sessions,
            {},
            undefined,
          );

          // Apply person filter only (full date range)
          const personOnly = getAttendance(
            targetUser,
            DATE_RANGE_START,
            DATE_RANGE_END,
            sessions,
            {},
            undefined,
          );

          // Apply date range filter only (all users)
          const dateOnly = getAttendance(
            null,
            startDate,
            endDate,
            sessions,
            {},
            undefined,
          );

          // INVARIANT: combined result is a subset of both individual filter results
          const personOnlyKeys = new Set(
            personOnly.map((r) => `${r.userId}|${r.date}`),
          );
          const dateOnlyKeys = new Set(
            dateOnly.map((r) => `${r.userId}|${r.date}`),
          );

          for (const record of combined) {
            const key = `${record.userId}|${record.date}`;
            expect(personOnlyKeys.has(key)).toBe(true);
            expect(dateOnlyKeys.has(key)).toBe(true);
          }

          // INVARIANT: combined results satisfy both filters simultaneously
          for (const record of combined) {
            expect(record.userId).toBe(targetUser);
            expect(record.date >= startDate).toBe(true);
            expect(record.date <= endDate).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("filters are composable: person + project narrows results correctly", () => {
    fc.assert(
      fc.property(testDataArb, ({ users, sessions, projectSessionIds }) => {
        fc.pre(projectSessionIds.size > 0);

        const targetUser = users[0];

        const combined = getAttendance(
          targetUser,
          DATE_RANGE_START,
          DATE_RANGE_END,
          sessions,
          {},
          projectSessionIds,
        );

        // INVARIANT: all records match both person and project filters
        for (const record of combined) {
          expect(record.userId).toBe(targetUser);
        }

        // Verify project constraint: each record's (userId, date) must have
        // at least one session in the project set
        const projectUserDates = new Set<string>();
        for (const session of sessions) {
          if (
            session.endTime !== null &&
            projectSessionIds.has(session.id) &&
            session.userId === targetUser
          ) {
            const d = new Date(session.startTime * 1000);
            const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
            projectUserDates.add(dateStr);
          }
        }

        for (const record of combined) {
          expect(projectUserDates.has(record.date)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("filters are composable: all three filters narrow results correctly", () => {
    fc.assert(
      fc.property(
        testDataArb,
        fc.integer({ min: 3, max: 8 }),
        fc.integer({ min: 12, max: 18 }),
        ({ users, sessions, projectSessionIds }, startDay, endDay) => {
          fc.pre(projectSessionIds.size > 0);

          const targetUser = users[0];
          const startDate = `2025-06-${String(startDay).padStart(2, "0")}`;
          const endDate = `2025-06-${String(endDay).padStart(2, "0")}`;

          const records = getAttendance(
            targetUser,
            startDate,
            endDate,
            sessions,
            {},
            projectSessionIds,
          );

          // Build expected project dates for this user
          const projectUserDates = new Set<string>();
          for (const session of sessions) {
            if (
              session.endTime !== null &&
              projectSessionIds.has(session.id) &&
              session.userId === targetUser
            ) {
              const d = new Date(session.startTime * 1000);
              const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
              projectUserDates.add(dateStr);
            }
          }

          // INVARIANT: every record satisfies ALL three filters simultaneously
          for (const record of records) {
            // Person filter
            expect(record.userId).toBe(targetUser);
            // Date range filter
            expect(record.date >= startDate).toBe(true);
            expect(record.date <= endDate).toBe(true);
            // Project filter
            expect(projectUserDates.has(record.date)).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
