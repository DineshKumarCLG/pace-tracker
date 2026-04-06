import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeAttendance } from "@/lib/attendance";
import type { Session, Break } from "@/types";

/**
 * Property 4: Attendance output note from last session
 *
 * For any user and any calendar day with multiple closed sessions,
 * the displayed output note should be the outputNote from the session
 * with the latest endTime on that day.
 *
 * **Validates: Requirements 2.5**
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

const DAY_BASE = utc(2025, 6, 15); // fixed day for all tests

const userIdArb = fc.stringMatching(/^user-[a-z0-9]{4,8}$/);

/** Arbitrary for an optional output note (string or null) */
const outputNoteArb = fc.oneof(
  fc.constant(null),
  fc.stringMatching(/^[A-Za-z0-9 ]{1,40}$/),
);

/**
 * Generate a list of non-overlapping closed sessions with distinct endTimes
 * and configurable output notes.
 */
function closedSessionsWithNotesArb(
  userId: string,
  count: number,
): fc.Arbitrary<Session[]> {
  return fc
    .array(
      fc.record({
        gapSec: fc.integer({ min: 60, max: 1800 }),
        durationSec: fc.integer({ min: 60, max: 7200 }),
        outputNote: outputNoteArb,
      }),
      { minLength: count, maxLength: count },
    )
    .map((specs) => {
      let cursor = DAY_BASE + 3600; // start at 01:00 UTC
      return specs.map((spec, i) => {
        const startTime = cursor + spec.gapSec;
        const endTime = startTime + spec.durationSec;
        cursor = endTime;
        return makeSession({
          id: `s-${i}`,
          userId,
          startTime,
          endTime,
          outputNote: spec.outputNote,
        });
      });
    });
}

/** Generate an open session (endTime === null) within the same day */
function openSessionArb(userId: string, index: number): fc.Arbitrary<Session> {
  return fc
    .record({
      startHour: fc.integer({ min: 0, max: 23 }),
      startMin: fc.integer({ min: 0, max: 59 }),
      outputNote: outputNoteArb,
    })
    .map(({ startHour, startMin, outputNote }) => {
      const startTime = utc(2025, 6, 15, startHour, startMin);
      return makeSession({
        id: `open-${index}`,
        userId,
        startTime,
        endTime: null,
        outputNote,
      });
    });
}

// --- Property Tests ---

describe("Property 4: Attendance output note from last session", () => {
  it("output note comes from the session with the maximum endTime", () => {
    fc.assert(
      fc.property(
        userIdArb.chain((userId) =>
          fc.integer({ min: 2, max: 6 }).chain((count) =>
            closedSessionsWithNotesArb(userId, count).map((sessions) => ({
              userId,
              sessions,
            })),
          ),
        ),
        ({ userId, sessions }) => {
          const result = computeAttendance(userId, "2025-06-15", sessions, {});

          // Find the session with the latest endTime
          const lastSession = sessions.reduce((latest, s) =>
            s.endTime! > latest.endTime! ? s : latest,
          );

          // INVARIANT: outputNote equals the outputNote of the session with max endTime
          expect(result.outputNote).toBe(lastSession.outputNote ?? null);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("if the last session has no output note, result is null", () => {
    fc.assert(
      fc.property(
        userIdArb.chain((userId) =>
          fc.integer({ min: 1, max: 5 }).chain((count) =>
            closedSessionsWithNotesArb(userId, count).map((sessions) => ({
              userId,
              sessions,
            })),
          ),
        ),
        ({ userId, sessions }) => {
          // Force the last session (by endTime) to have no output note
          const lastSession = sessions.reduce((latest, s) =>
            s.endTime! > latest.endTime! ? s : latest,
          );
          lastSession.outputNote = null;

          const result = computeAttendance(userId, "2025-06-15", sessions, {});

          // INVARIANT: when last session has null outputNote, result is null
          expect(result.outputNote).toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("if no closed sessions exist, output note is null", () => {
    fc.assert(
      fc.property(
        userIdArb,
        fc.integer({ min: 0, max: 5 }),
        (userId, openCount) => {
          // Generate only open sessions (endTime === null)
          const openSessions = fc
            .sample(openSessionArb(userId, 0), openCount)
            .map((s, i) => ({ ...s, id: `open-${i}` }));

          const result = computeAttendance(
            userId,
            "2025-06-15",
            openSessions,
            {},
          );

          // INVARIANT: no closed sessions → outputNote is null
          expect(result.outputNote).toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("open sessions do not affect which output note is selected", () => {
    fc.assert(
      fc.property(
        userIdArb.chain((userId) =>
          fc
            .integer({ min: 1, max: 4 })
            .chain((closedCount) =>
              fc.integer({ min: 1, max: 4 }).chain((openCount) =>
                closedSessionsWithNotesArb(userId, closedCount).map(
                  (closedSessions) => ({
                    userId,
                    closedSessions,
                    openCount,
                  }),
                ),
              ),
            ),
        ),
        ({ userId, closedSessions, openCount }) => {
          // Generate open sessions with potentially different output notes
          const openSessions = fc
            .sample(openSessionArb(userId, 0), openCount)
            .map((s, i) => ({ ...s, id: `open-${i}` }));

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

          // INVARIANT: open sessions have zero effect on output note selection
          expect(resultMixed.outputNote).toBe(resultClosedOnly.outputNote);
        },
      ),
      { numRuns: 200 },
    );
  });
});
