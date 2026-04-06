import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { createLeaveRequest } from "@/lib/leave";
import { pb } from "@/lib/pocketbase";
import type { PublicHoliday } from "@/types";

/**
 * Property 8: Leave request status assignment
 *
 * For any leave request submission, if the type is "sick" then the created
 * record's status should be "approved"; otherwise (annual or wfh) the status
 * should be "pending".
 *
 * **Validates: Requirements 6.2, 6.3**
 */

// --- Helpers ---

/** UTC midnight timestamp for a given date */
function utc(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / 1000);
}

// --- Arbitraries ---

const userIdArb = fc.stringMatching(/^user-[a-z0-9]{4,8}$/);
const reasonArb = fc.string({ minLength: 1, maxLength: 30 });

/**
 * Generate a future date range that always contains at least one business day.
 * Starts on a weekday (Mon-Fri) and spans 1-5 business days.
 * Uses 2030 to guarantee dates are always in the future.
 */
const futureDateRangeArb = fc
  .record({
    month: fc.integer({ min: 1, max: 11 }),
    startDay: fc.integer({ min: 1, max: 20 }),
    durationDays: fc.integer({ min: 1, max: 5 }),
  })
  .map(({ month, startDay, durationDays }) => {
    // Find the next weekday on or after the generated start
    let start = new Date(Date.UTC(2030, month - 1, startDay));
    const dayOfWeek = start.getUTCDay();
    if (dayOfWeek === 0) start.setUTCDate(start.getUTCDate() + 1); // Sun → Mon
    if (dayOfWeek === 6) start.setUTCDate(start.getUTCDate() + 2); // Sat → Mon

    const startDate = Math.floor(start.getTime() / 1000);
    // End date: add enough calendar days to cover durationDays business days
    const endDate = utc(
      start.getUTCFullYear(),
      start.getUTCMonth() + 1,
      start.getUTCDate() + durationDays + 2, // +2 to account for possible weekend
    );
    return { startDate, endDate };
  });

/** Generate public holidays for 2030 */
const publicHolidayArb = fc
  .record({
    id: fc.uuid(),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
    name: fc.stringMatching(/^[A-Z][a-z]+ Day$/),
  })
  .map(({ id, month, day, name }): PublicHoliday => ({
    id,
    date: utc(2030, month, day),
    name,
    year: 2030,
    createdAt: utc(2030, 1, 1),
  }));

// --- Mock setup ---

// Mock pb.collection at module level to prevent real network calls
vi.mock("@/lib/pocketbase", () => {
  const mockCreate = vi.fn().mockResolvedValue({
    id: "lr-mock-id",
    collectionId: "",
    collectionName: "leave_requests",
    created: "",
    updated: "",
  });

  return {
    pb: {
      collection: vi.fn().mockReturnValue({
        create: mockCreate,
      }),
    },
  };
});

// --- Tests ---

describe("Property 8: Leave request status assignment", () => {
  it("sick leave requests always get status 'approved'", () => {
    return fc.assert(
      fc.asyncProperty(
        userIdArb,
        futureDateRangeArb,
        reasonArb,
        fc.array(publicHolidayArb, { minLength: 0, maxLength: 3 }),
        async (userId, { startDate, endDate }, reason, holidays) => {
          const result = await createLeaveRequest(
            userId,
            "sick",
            startDate,
            endDate,
            reason,
            [],
            holidays,
          );

          expect(result.status).toBe("approved");
          expect(result.type).toBe("sick");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("annual leave requests (with sufficient balance) always get status 'pending'", () => {
    return fc.assert(
      fc.asyncProperty(
        userIdArb,
        futureDateRangeArb,
        reasonArb,
        fc.array(publicHolidayArb, { minLength: 0, maxLength: 3 }),
        async (userId, { startDate, endDate }, reason, holidays) => {
          // No existing requests → full 20-day balance, always sufficient
          const result = await createLeaveRequest(
            userId,
            "annual",
            startDate,
            endDate,
            reason,
            [],
            holidays,
          );

          expect(result.status).toBe("pending");
          expect(result.type).toBe("annual");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("WFH requests always get status 'pending'", () => {
    return fc.assert(
      fc.asyncProperty(
        userIdArb,
        futureDateRangeArb,
        reasonArb,
        fc.array(publicHolidayArb, { minLength: 0, maxLength: 3 }),
        async (userId, { startDate, endDate }, reason, holidays) => {
          const result = await createLeaveRequest(
            userId,
            "wfh",
            startDate,
            endDate,
            reason,
            [],
            holidays,
          );

          expect(result.status).toBe("pending");
          expect(result.type).toBe("wfh");
        },
      ),
      { numRuns: 100 },
    );
  });
});
