import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  computeLeaveBalance,
  countBusinessDays,
  ANNUAL_ALLOCATION,
  SICK_ALLOCATION,
} from "@/lib/leave";
import type { LeaveRequest, PublicHoliday } from "@/types";

/**
 * Property 6: Leave balance computation
 *
 * For any user and calendar year, the leave balance should satisfy:
 * annual_remaining = 20 - count(business days in approved annual leave requests
 * excluding public holidays and weekends), and sick_remaining = 10 - count(business
 * days in approved sick leave requests excluding public holidays and weekends).
 * Public holidays falling within a leave request range must not be counted as leave days.
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.6, 4.3, 7.5**
 */

// --- Helpers ---

/** UTC midnight timestamp for a given date */
function utc(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / 1000);
}

// --- Arbitraries ---

const userIdArb = fc.stringMatching(/^user-[a-z0-9]{4,8}$/);
const yearArb = fc.integer({ min: 2020, max: 2030 });

const leaveTypeArb = fc.constantFrom(
  "annual" as const,
  "sick" as const,
  "wfh" as const,
);

const leaveStatusArb = fc.constantFrom(
  "pending" as const,
  "approved" as const,
  "declined" as const,
);

/** Generate a valid date range within a given year (start < end, both weekdays) */
function dateRangeArb(year: number) {
  return fc
    .record({
      startMonth: fc.integer({ min: 1, max: 12 }),
      startDay: fc.integer({ min: 1, max: 28 }),
      durationDays: fc.integer({ min: 1, max: 14 }),
    })
    .map(({ startMonth, startDay, durationDays }) => {
      const startDate = utc(year, startMonth, startDay);
      // Ensure endDate stays within the same year
      let endDay = startDay + durationDays;
      let endMonth = startMonth;
      if (endDay > 28) {
        endDay = 28;
        endMonth = Math.min(startMonth + 1, 12);
      }
      const endDate = utc(year, endMonth, endDay);
      return { startDate, endDate };
    });
}

/** Generate a leave request for a specific user and year */
function leaveRequestArb(
  userId: string,
  year: number,
): fc.Arbitrary<LeaveRequest> {
  return fc
    .record({
      id: fc.uuid(),
      type: leaveTypeArb,
      status: leaveStatusArb,
      dateRange: dateRangeArb(year),
      reason: fc.string({ minLength: 0, maxLength: 20 }),
    })
    .map(({ id, type, status, dateRange, reason }) => ({
      id,
      requesterId: userId,
      type,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      reason,
      status,
      reviewerId: null,
      reviewReason: null,
      createdAt: dateRange.startDate,
      updatedAt: dateRange.startDate,
    }));
}

/** Generate public holidays for a given year */
function publicHolidayArb(year: number): fc.Arbitrary<PublicHoliday> {
  return fc
    .record({
      id: fc.uuid(),
      month: fc.integer({ min: 1, max: 12 }),
      day: fc.integer({ min: 1, max: 28 }),
      name: fc.stringMatching(/^[A-Z][a-z]+ Day$/),
    })
    .map(({ id, month, day, name }) => ({
      id,
      date: utc(year, month, day),
      name,
      year,
      createdAt: utc(year, 1, 1),
    }));
}

// --- Property Tests ---

describe("Property 6: Leave balance computation", () => {
  it("annualRemaining = annualAllocated - annualUsed invariant always holds", () => {
    fc.assert(
      fc.property(
        userIdArb,
        yearArb,
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 3 }),
        (userId, year, requestCount, holidayCount) => {
          const requests = fc.sample(
            leaveRequestArb(userId, year),
            requestCount,
          );
          const holidays = fc.sample(publicHolidayArb(year), holidayCount);

          const balance = computeLeaveBalance(userId, year, requests, holidays);

          // INVARIANT: remaining = allocated - used
          expect(balance.annualRemaining).toBe(
            balance.annualAllocated - balance.annualUsed,
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it("sickRemaining = sickAllocated - sickUsed invariant always holds", () => {
    fc.assert(
      fc.property(
        userIdArb,
        yearArb,
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 3 }),
        (userId, year, requestCount, holidayCount) => {
          const requests = fc.sample(
            leaveRequestArb(userId, year),
            requestCount,
          );
          const holidays = fc.sample(publicHolidayArb(year), holidayCount);

          const balance = computeLeaveBalance(userId, year, requests, holidays);

          // INVARIANT: remaining = allocated - used
          expect(balance.sickRemaining).toBe(
            balance.sickAllocated - balance.sickUsed,
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it("annualAllocated is always 20 and sickAllocated is always 10", () => {
    fc.assert(
      fc.property(
        userIdArb,
        yearArb,
        fc.array(leaveTypeArb, { minLength: 0, maxLength: 5 }),
        (userId, year) => {
          const balance = computeLeaveBalance(userId, year, [], []);

          // INVARIANT: fixed allocations
          expect(balance.annualAllocated).toBe(ANNUAL_ALLOCATION);
          expect(balance.annualAllocated).toBe(20);
          expect(balance.sickAllocated).toBe(SICK_ALLOCATION);
          expect(balance.sickAllocated).toBe(10);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("annualUsed >= 0 and sickUsed >= 0 for any set of requests", () => {
    fc.assert(
      fc.property(
        userIdArb,
        yearArb,
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 0, max: 3 }),
        (userId, year, requestCount, holidayCount) => {
          const requests = fc.sample(
            leaveRequestArb(userId, year),
            requestCount,
          );
          const holidays = fc.sample(publicHolidayArb(year), holidayCount);

          const balance = computeLeaveBalance(userId, year, requests, holidays);

          // INVARIANT: used counts are non-negative
          expect(balance.annualUsed).toBeGreaterThanOrEqual(0);
          expect(balance.sickUsed).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("approved leave requests correctly reflect total business days used", () => {
    fc.assert(
      fc.property(
        userIdArb,
        yearArb,
        fc.array(dateRangeArb(2025), { minLength: 1, maxLength: 4 }),
        fc.array(publicHolidayArb(2025), { minLength: 0, maxLength: 3 }),
        (userId, _year, dateRanges, holidays) => {
          const year = 2025;

          // Build only approved annual requests
          const requests: LeaveRequest[] = dateRanges.map((range, i) => ({
            id: `lr-${i}`,
            requesterId: userId,
            type: "annual" as const,
            startDate: range.startDate,
            endDate: range.endDate,
            reason: "",
            status: "approved" as const,
            reviewerId: null,
            reviewReason: null,
            createdAt: range.startDate,
            updatedAt: range.startDate,
          }));

          const balance = computeLeaveBalance(userId, year, requests, holidays);

          // Manually compute expected business days
          const yearHolidays = holidays.filter((h) => h.year === year);
          let expectedAnnualUsed = 0;
          for (const req of requests) {
            expectedAnnualUsed += countBusinessDays(
              req.startDate,
              req.endDate,
              yearHolidays,
            );
          }

          expect(balance.annualUsed).toBe(expectedAnnualUsed);
          expect(balance.annualRemaining).toBe(
            ANNUAL_ALLOCATION - expectedAnnualUsed,
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it("pending and declined requests do not affect the balance", () => {
    fc.assert(
      fc.property(
        userIdArb,
        yearArb,
        fc.array(dateRangeArb(2025), { minLength: 1, maxLength: 5 }),
        fc.constantFrom("pending" as const, "declined" as const),
        (userId, _year, dateRanges, status) => {
          const year = 2025;

          // Build requests that are NOT approved
          const requests: LeaveRequest[] = dateRanges.map((range, i) => ({
            id: `lr-${i}`,
            requesterId: userId,
            type: "annual" as const,
            startDate: range.startDate,
            endDate: range.endDate,
            reason: "",
            status,
            reviewerId: null,
            reviewReason: null,
            createdAt: range.startDate,
            updatedAt: range.startDate,
          }));

          const balance = computeLeaveBalance(userId, year, requests, []);

          // INVARIANT: non-approved requests have zero impact
          expect(balance.annualUsed).toBe(0);
          expect(balance.annualRemaining).toBe(ANNUAL_ALLOCATION);
          expect(balance.sickUsed).toBe(0);
          expect(balance.sickRemaining).toBe(SICK_ALLOCATION);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("WFH requests never affect any balance", () => {
    fc.assert(
      fc.property(
        userIdArb,
        yearArb,
        fc.array(dateRangeArb(2025), { minLength: 1, maxLength: 5 }),
        (userId, _year, dateRanges) => {
          const year = 2025;

          // Build approved WFH requests
          const requests: LeaveRequest[] = dateRanges.map((range, i) => ({
            id: `lr-${i}`,
            requesterId: userId,
            type: "wfh" as const,
            startDate: range.startDate,
            endDate: range.endDate,
            reason: "",
            status: "approved" as const,
            reviewerId: null,
            reviewReason: null,
            createdAt: range.startDate,
            updatedAt: range.startDate,
          }));

          const balance = computeLeaveBalance(userId, year, requests, []);

          // INVARIANT: WFH never touches any balance
          expect(balance.annualUsed).toBe(0);
          expect(balance.annualRemaining).toBe(ANNUAL_ALLOCATION);
          expect(balance.sickUsed).toBe(0);
          expect(balance.sickRemaining).toBe(SICK_ALLOCATION);
        },
      ),
      { numRuns: 200 },
    );
  });
});
