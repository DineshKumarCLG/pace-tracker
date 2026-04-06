import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  computeLeaveBalance,
  ANNUAL_ALLOCATION,
  SICK_ALLOCATION,
} from "@/lib/leave";
import type { LeaveRequest, PublicHoliday } from "@/types";

/**
 * Property 7: WFH does not affect leave balance
 *
 * For any approved WFH request regardless of date range, the user's annual
 * leave balance and sick leave balance should remain unchanged before and
 * after the WFH approval.
 *
 * **Validates: Requirements 3.5**
 */

// --- Helpers ---

/** UTC midnight timestamp for a given date */
function utc(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / 1000);
}

// --- Arbitraries ---

const userIdArb = fc.stringMatching(/^user-[a-z0-9]{4,8}$/);
const yearArb = fc.integer({ min: 2020, max: 2030 });

/** Generate a valid date range within a given year (start < end) */
function dateRangeArb(year: number) {
  return fc
    .record({
      startMonth: fc.integer({ min: 1, max: 12 }),
      startDay: fc.integer({ min: 1, max: 28 }),
      durationDays: fc.integer({ min: 1, max: 14 }),
    })
    .map(({ startMonth, startDay, durationDays }) => {
      const startDate = utc(year, startMonth, startDay);
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

/** Generate an approved WFH request for a specific user and year */
function wfhRequestArb(
  userId: string,
  year: number,
  status: "pending" | "approved" | "declined" = "approved",
): fc.Arbitrary<LeaveRequest> {
  return fc
    .record({
      id: fc.uuid(),
      dateRange: dateRangeArb(year),
      reason: fc.string({ minLength: 0, maxLength: 20 }),
    })
    .map(({ id, dateRange, reason }) => ({
      id,
      requesterId: userId,
      type: "wfh" as const,
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

/** Generate an annual or sick leave request */
function nonWfhRequestArb(
  userId: string,
  year: number,
): fc.Arbitrary<LeaveRequest> {
  return fc
    .record({
      id: fc.uuid(),
      type: fc.constantFrom("annual" as const, "sick" as const),
      status: fc.constantFrom(
        "pending" as const,
        "approved" as const,
        "declined" as const,
      ),
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

describe("Property 7: WFH does not affect leave balance", () => {
  it("for any number of approved WFH requests, annual and sick balance remain at full allocation", () => {
    fc.assert(
      fc.property(
        userIdArb,
        yearArb.chain((year) =>
          fc.tuple(
            fc.constant(year),
            fc.array(wfhRequestArb("placeholder", year), {
              minLength: 1,
              maxLength: 10,
            }),
            fc.array(publicHolidayArb(year), { minLength: 0, maxLength: 3 }),
          ),
        ),
        (userId, [year, wfhRequests, holidays]) => {
          // Fix requesterId to match the generated userId
          const requests = wfhRequests.map((r) => ({
            ...r,
            requesterId: userId,
          }));

          const balance = computeLeaveBalance(
            userId,
            year,
            requests,
            holidays,
          );

          // WFH requests must never deduct from any balance
          expect(balance.annualUsed).toBe(0);
          expect(balance.annualRemaining).toBe(ANNUAL_ALLOCATION);
          expect(balance.sickUsed).toBe(0);
          expect(balance.sickRemaining).toBe(SICK_ALLOCATION);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("adding WFH requests to existing annual/sick requests does not change annual or sick balance", () => {
    fc.assert(
      fc.property(
        userIdArb,
        yearArb.chain((year) =>
          fc.tuple(
            fc.constant(year),
            fc.array(nonWfhRequestArb("placeholder", year), {
              minLength: 0,
              maxLength: 5,
            }),
            fc.array(wfhRequestArb("placeholder", year), {
              minLength: 1,
              maxLength: 5,
            }),
            fc.array(publicHolidayArb(year), { minLength: 0, maxLength: 3 }),
          ),
        ),
        (userId, [year, existingRequests, wfhRequests, holidays]) => {
          // Fix requesterId
          const existing = existingRequests.map((r) => ({
            ...r,
            requesterId: userId,
          }));
          const wfh = wfhRequests.map((r) => ({
            ...r,
            requesterId: userId,
          }));

          // Balance WITHOUT WFH requests
          const balanceBefore = computeLeaveBalance(
            userId,
            year,
            existing,
            holidays,
          );

          // Balance WITH WFH requests added
          const balanceAfter = computeLeaveBalance(
            userId,
            year,
            [...existing, ...wfh],
            holidays,
          );

          // Adding WFH must not change any balance values
          expect(balanceAfter.annualUsed).toBe(balanceBefore.annualUsed);
          expect(balanceAfter.annualRemaining).toBe(
            balanceBefore.annualRemaining,
          );
          expect(balanceAfter.sickUsed).toBe(balanceBefore.sickUsed);
          expect(balanceAfter.sickRemaining).toBe(
            balanceBefore.sickRemaining,
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it("WFH requests with any status never affect balance", () => {
    fc.assert(
      fc.property(
        userIdArb,
        yearArb.chain((year) =>
          fc.tuple(
            fc.constant(year),
            fc.constantFrom(
              "pending" as const,
              "approved" as const,
              "declined" as const,
            ),
            fc.array(dateRangeArb(year), { minLength: 1, maxLength: 8 }),
            fc.array(publicHolidayArb(year), { minLength: 0, maxLength: 3 }),
          ),
        ),
        (userId, [year, status, dateRanges, holidays]) => {
          const requests: LeaveRequest[] = dateRanges.map((range, i) => ({
            id: `wfh-${i}`,
            requesterId: userId,
            type: "wfh" as const,
            startDate: range.startDate,
            endDate: range.endDate,
            reason: "Working from home",
            status,
            reviewerId: null,
            reviewReason: null,
            createdAt: range.startDate,
            updatedAt: range.startDate,
          }));

          const balance = computeLeaveBalance(
            userId,
            year,
            requests,
            holidays,
          );

          // Regardless of status, WFH never touches balance
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
