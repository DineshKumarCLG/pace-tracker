import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeStreak } from "@/lib/dashboard";
import { isWeekend, isPublicHoliday } from "@/lib/leave";
import type { Session, LeaveRequest, PublicHoliday } from "@/types";

/**
 * Property 13: Streak computation
 *
 * For any user and any sequence of calendar days, the check-in streak should
 * equal the count of consecutive workdays (walking backwards from today) on
 * which the user started at least one session, where weekends, public holidays,
 * and approved leave days are skipped (not streak-breaking), and a workday with
 * no session and no approved leave resets the streak to zero.
 *
 * **Validates: Requirements 15.1, 15.3, 15.4**
 */

// --- Helpers ---

/** UTC midnight timestamp for a given date */
function utcMidnight(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / 1000);
}

function makeSession(userId: string, startTime: number): Session {
  return {
    id: `s-${startTime}`,
    userId,
    startTime,
    endTime: startTime + 3600,
    startType: "manual",
    startVerified: true,
    outputNote: null,
    lastHeartbeat: null,
    syncedAt: null,
    createdAt: startTime,
  };
}

function makeLeaveRequest(
  requesterId: string,
  startDate: number,
  endDate: number,
  type: "annual" | "sick" = "annual",
): LeaveRequest {
  return {
    id: `lr-${startDate}-${type}`,
    requesterId,
    type,
    startDate,
    endDate,
    reason: "test",
    status: "approved",
    reviewerId: "reviewer-1",
    reviewReason: null,
    createdAt: startDate,
    updatedAt: startDate,
  };
}

function makePublicHoliday(date: number, name: string): PublicHoliday {
  const d = new Date(date * 1000);
  return {
    id: `ph-${date}`,
    date,
    name,
    year: d.getUTCFullYear(),
    createdAt: date,
  };
}

// --- Arbitraries ---

/** A known Monday: 2025-06-16. We build scenarios relative to this. */
const BASE_MONDAY = utcMidnight(2025, 6, 16);
const DAY = 86400;

/**
 * Generate a streak scenario: a sequence of N workdays going backwards,
 * each either having a session, approved leave, or nothing (gap).
 * We also sprinkle weekends and holidays in between.
 */
const streakScenarioArb = fc.record({
  /** Number of workdays to simulate (1–20) */
  workdayCount: fc.integer({ min: 1, max: 20 }),
  /**
   * For each workday: "session" | "leave" | "gap"
   * - session: user has a session on that day
   * - leave: user has approved leave on that day
   * - gap: workday with no session and no leave (streak breaker)
   */
  dayActions: fc.array(
    fc.constantFrom("session" as const, "leave" as const, "gap" as const),
    { minLength: 20, maxLength: 20 },
  ),
  /** Public holiday indices (which workdays are holidays, 0-indexed) */
  holidayIndices: fc.array(fc.integer({ min: 0, max: 19 }), {
    minLength: 0,
    maxLength: 5,
  }),
});

// --- Property Tests ---

describe("Property 13: Streak computation", () => {
  it("streak is always >= 0 (Req 15.1)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.boolean(), // whether each of 10 recent days has a session
          { minLength: 10, maxLength: 10 },
        ),
        (sessionDays) => {
          const userId = "user-1";
          const currentDate = BASE_MONDAY; // a Monday

          // Create sessions for days that have them (going backwards)
          const sessions: Session[] = [];
          for (let i = 0; i < sessionDays.length; i++) {
            if (sessionDays[i]) {
              sessions.push(
                makeSession(userId, currentDate - i * DAY + 3600),
              );
            }
          }

          const streak = computeStreak(
            userId,
            sessions,
            [],
            [],
            currentDate,
          );

          // INVARIANT: streak is always non-negative
          expect(streak).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("streak counts only workdays with sessions (Req 15.1)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 15 }),
        (consecutiveDays) => {
          const userId = "user-1";
          // Start from a known Wednesday 2025-06-18 so we have workdays
          const startDate = utcMidnight(2025, 6, 18);

          // Create sessions for `consecutiveDays` consecutive workdays going back
          const sessions: Session[] = [];
          let day = startDate;
          let workdaysAdded = 0;

          while (workdaysAdded < consecutiveDays) {
            if (!isWeekend(day)) {
              sessions.push(makeSession(userId, day + 3600));
              workdaysAdded++;
            }
            day -= DAY;
          }

          const streak = computeStreak(
            userId,
            sessions,
            [],
            [],
            startDate,
          );

          // INVARIANT: streak equals the number of consecutive workdays with sessions
          expect(streak).toBe(consecutiveDays);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("weekends do not break the streak (Req 15.4)", () => {
    // Create sessions on Fri and Mon — weekend in between should not break streak
    const userId = "user-1";
    const friday = utcMidnight(2025, 6, 13); // Friday
    const monday = utcMidnight(2025, 6, 16); // Monday

    const sessions = [
      makeSession(userId, monday + 3600),
      makeSession(userId, friday + 3600),
    ];

    const streak = computeStreak(userId, sessions, [], [], monday);

    // Streak should be 2: Monday + Friday (weekend skipped)
    expect(streak).toBe(2);
  });

  it("public holidays do not break the streak (Req 15.4)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3 }),
        (holidaysBetween) => {
          const userId = "user-1";
          // Use a sequence of weekdays: Wed Jun 18, Thu Jun 19, Fri Jun 20
          // Make some of them holidays and ensure streak still counts through
          const wed = utcMidnight(2025, 6, 18);
          const thu = utcMidnight(2025, 6, 19);
          const fri = utcMidnight(2025, 6, 20);

          // Sessions on Wed and Fri, Thu is a holiday
          const sessions = [
            makeSession(userId, fri + 3600),
            makeSession(userId, wed + 3600),
          ];

          const holidays = [makePublicHoliday(thu, "Test Holiday")];

          const streak = computeStreak(
            userId,
            sessions,
            [],
            holidays,
            fri,
          );

          // INVARIANT: Thu (holiday) is skipped, streak = 2 (Fri + Wed)
          expect(streak).toBe(2);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("approved leave does not break the streak (Req 15.4)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("annual" as const, "sick" as const),
        (leaveType) => {
          const userId = "user-1";
          // Wed Jun 18, Thu Jun 19, Fri Jun 20
          const wed = utcMidnight(2025, 6, 18);
          const thu = utcMidnight(2025, 6, 19);
          const fri = utcMidnight(2025, 6, 20);

          // Sessions on Wed and Fri, Thu is approved leave
          const sessions = [
            makeSession(userId, fri + 3600),
            makeSession(userId, wed + 3600),
          ];

          const leaveRequests = [
            makeLeaveRequest(userId, thu, thu + DAY - 1, leaveType),
          ];

          const streak = computeStreak(
            userId,
            sessions,
            leaveRequests,
            [],
            fri,
          );

          // INVARIANT: Thu (approved leave) is skipped, streak = 2 (Fri + Wed)
          expect(streak).toBe(2);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("workday without session and without leave breaks the streak (Req 15.3)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5 }),
        (daysBefore, daysAfterGap) => {
          const userId = "user-1";
          // Build a sequence of workdays with a gap in the middle
          // Start from Fri Jun 20 and go backwards
          const startDate = utcMidnight(2025, 6, 20); // Friday

          const sessions: Session[] = [];
          let day = startDate;
          let workdaysAdded = 0;

          // Add sessions for `daysBefore` workdays (most recent)
          while (workdaysAdded < daysBefore) {
            if (!isWeekend(day)) {
              sessions.push(makeSession(userId, day + 3600));
              workdaysAdded++;
            }
            day -= DAY;
          }

          // Skip one workday (the gap — no session, no leave)
          while (isWeekend(day)) {
            day -= DAY;
          }
          const gapDay = day;
          day -= DAY;

          // Add sessions for `daysAfterGap` workdays (older, before the gap)
          let olderAdded = 0;
          while (olderAdded < daysAfterGap) {
            if (!isWeekend(day)) {
              sessions.push(makeSession(userId, day + 3600));
              olderAdded++;
            }
            day -= DAY;
          }

          const streak = computeStreak(
            userId,
            sessions,
            [],
            [],
            startDate,
          );

          // INVARIANT: streak should equal daysBefore (stops at the gap)
          expect(streak).toBe(daysBefore);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("streak is zero when current workday has no session (Req 15.3)", () => {
    const userId = "user-1";
    const monday = utcMidnight(2025, 6, 16); // Monday

    // No sessions at all
    const streak = computeStreak(userId, [], [], [], monday);

    expect(streak).toBe(0);
  });
});
