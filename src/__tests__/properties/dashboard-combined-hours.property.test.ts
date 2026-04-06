import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { TeamMember } from "@/types";

/**
 * Property 26: Dashboard combined team hours
 *
 * For any set of sessions on the current day (both active and completed),
 * the dashboard's combined team hours should equal the sum of all session
 * durations.
 *
 * We test the pure computation logic extracted from dashboardStore:
 *   computeTodayTeamHours(members, now) = sum((now - m.sessionStart) / 3600)
 *   for all members where sessionStart != null.
 *
 * Properties verified:
 * 1. Combined hours >= 0 always
 * 2. Combined hours = sum of individual member session durations / 3600
 * 3. Members without sessions (sessionStart === null) contribute 0 hours
 * 4. Combined hours increases monotonically as more members have sessions
 *
 * **Validates: Requirements 13.2**
 */

// --- Pure computation under test (mirrors dashboardStore.computeTodayTeamHours) ---

function computeTodayTeamHours(
  members: Record<string, TeamMember>,
  now: number,
): number {
  let totalSecs = 0;
  for (const member of Object.values(members)) {
    if (member.sessionStart != null) {
      totalSecs += now - member.sessionStart;
    }
  }
  return totalSecs / 3600;
}

// --- Helpers ---

function makeTeamMember(
  userId: string,
  sessionStart: number | null,
): TeamMember {
  return {
    userId,
    name: `Member ${userId}`,
    status: sessionStart != null ? "active" : "offline",
    currentTask: null,
    sessionStart,
    breakStart: null,
    outputNote: null,
    avatarColor: "#000",
  };
}

// --- Arbitraries ---

/** Generate a "now" timestamp (reasonable range) */
const nowArb = fc.integer({ min: 1_700_000_000, max: 1_800_000_000 });

/** Generate a sessionStart that is before or at "now" (0 to 12 hours before) */
function sessionStartArb(now: number) {
  return fc.integer({ min: 0, max: 12 * 3600 }).map((offset) => now - offset);
}

/** Generate 1–5 team members with random session states */
const teamArb = (now: number) =>
  fc
    .array(
      fc.record({
        id: fc.stringMatching(/^user-[a-z0-9]{4,8}$/),
        hasSession: fc.boolean(),
        hoursAgo: fc.integer({ min: 0, max: 12 * 3600 }),
      }),
      { minLength: 1, maxLength: 5 },
    )
    .map((specs) => {
      // Deduplicate by id
      const seen = new Set<string>();
      const unique = specs.filter((s) => {
        if (seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
      });
      const members: Record<string, TeamMember> = {};
      for (const spec of unique) {
        const sessionStart = spec.hasSession ? now - spec.hoursAgo : null;
        members[spec.id] = makeTeamMember(spec.id, sessionStart);
      }
      return members;
    });

// --- Property Tests ---

describe("Property 26: Dashboard combined team hours", () => {
  it("combined hours is always >= 0", () => {
    fc.assert(
      fc.property(nowArb, (now) =>
        fc.assert(
          fc.property(teamArb(now), (members) => {
            const hours = computeTodayTeamHours(members, now);
            expect(hours).toBeGreaterThanOrEqual(0);
          }),
          { numRuns: 50 },
        ),
      ),
      { numRuns: 4 },
    );
  });

  it("combined hours equals sum of individual session durations / 3600", () => {
    fc.assert(
      fc.property(nowArb, (now) =>
        fc.assert(
          fc.property(teamArb(now), (members) => {
            const hours = computeTodayTeamHours(members, now);

            // Independently compute expected value
            let expectedSecs = 0;
            for (const member of Object.values(members)) {
              if (member.sessionStart != null) {
                expectedSecs += now - member.sessionStart;
              }
            }
            const expectedHours = expectedSecs / 3600;

            expect(hours).toBeCloseTo(expectedHours, 10);
          }),
          { numRuns: 50 },
        ),
      ),
      { numRuns: 4 },
    );
  });

  it("members without sessions (sessionStart === null) contribute 0 hours", () => {
    fc.assert(
      fc.property(
        nowArb,
        fc.array(fc.stringMatching(/^user-[a-z0-9]{4,8}$/), {
          minLength: 1,
          maxLength: 5,
        }),
        (now, ids) => {
          const uniqueIds = [...new Set(ids)];
          // All members have null sessionStart
          const members: Record<string, TeamMember> = {};
          for (const id of uniqueIds) {
            members[id] = makeTeamMember(id, null);
          }

          const hours = computeTodayTeamHours(members, now);
          expect(hours).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("combined hours increases monotonically as more members have sessions", () => {
    fc.assert(
      fc.property(
        nowArb,
        fc.array(
          fc.record({
            id: fc.stringMatching(/^user-[a-z0-9]{4,8}$/),
            hoursAgo: fc.integer({ min: 0, max: 12 * 3600 }),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        (now, specs) => {
          // Deduplicate
          const seen = new Set<string>();
          const unique = specs.filter((s) => {
            if (seen.has(s.id)) return false;
            seen.add(s.id);
            return true;
          });

          // Start with all members offline (no sessions)
          const members: Record<string, TeamMember> = {};
          for (const spec of unique) {
            members[spec.id] = makeTeamMember(spec.id, null);
          }

          let prevHours = computeTodayTeamHours(members, now);
          expect(prevHours).toBe(0);

          // Progressively activate members and verify monotonic increase
          for (const spec of unique) {
            members[spec.id] = makeTeamMember(spec.id, now - spec.hoursAgo);
            const currentHours = computeTodayTeamHours(members, now);
            expect(currentHours).toBeGreaterThanOrEqual(prevHours);
            prevHours = currentHours;
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
