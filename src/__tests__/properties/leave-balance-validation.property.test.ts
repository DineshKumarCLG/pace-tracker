import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  validateLeaveRequest,
  computeLeaveBalance,
  countBusinessDays,
  ANNUAL_ALLOCATION,
} from "@/lib/leave";
import type { LeaveRequest, PublicHoliday } from "@/types";

/**
 * Property 9: Leave balance validation on submission
 *
 * When a user submits annual leave, validateLeaveRequest() must reject
 * if the requested business days exceed the remaining annual balance,
 * accept if sufficient balance exists, and always report the correct
 * remainingBalance = annualAllocated - annualUsed - requestedDays when valid.
 *
 * **Validates: Requirements 6.5**
 */

// --- Helpers ---

/** UTC midnight timestamp for a given date */
function utc(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / 1000);
}

// --- Arbitraries ---

const userIdArb = fc.stringMatching(/^user-[a-z0-9]{4,8}$/);

/** Generate a valid date range within a given year (start < end) */
function dateRangeArb(year: number) {
  return fc
    .record({
      startMonth: fc.integer({ min: 1, max: 12 }),
      startDay: fc.integer({ min: 1, max: 28 }),
      durationDays: fc.integer({ min: 1, max: 10 }),
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

/**
 * Build approved annual leave requests that consume a known number of
 * business days from the user's balance for the given year.
 */
function approvedAnnualRequestsArb(
  userId: string,
  year: number,
): fc.Arbitrary<LeaveRequest[]> {
  return fc
    .array(dateRangeArb(year), { minLength: 0, maxLength: 4 })
    .map((ranges) =>
      ranges.map((range, i) => ({
        id: `existing-${i}`,
        requesterId: userId,
        type: "annual" as const,
        startDate: range.startDate,
        endDate: range.endDate,
        reason: "existing leave",
        status: "approved" as const,
        reviewerId: null,
        reviewReason: null,
        createdAt: range.startDate,
        updatedAt: range.startDate,
      })),
    );
}

// --- Property Tests ---

describe("Property 9: Leave balance validation on submission", () => {
  const YEAR = 2025;

  it("rejects annual leave when requested days exceed remaining balance", () => {
    fc.assert(
      fc.property(
        userIdArb,
        approvedAnnualRequestsArb("placeholder", YEAR),
        fc.array(publicHolidayArb(YEAR), { minLength: 0, maxLength: 3 }),
        dateRangeArb(YEAR),
        (_userId, existingTemplates, holidays, newRange) => {
          // Use a consistent userId for both existing requests and the new one
          const userId = _userId;
          const existing = existingTemplates.map((r) => ({
            ...r,
            requesterId: userId,
          }));

          // Compute current balance
          const balance = computeLeaveBalance(userId, YEAR, existing, holidays);
          const yearHolidays = holidays.filter((h) => h.year === YEAR);
          const requestedDays = countBusinessDays(
            newRange.startDate,
            newRange.endDate,
            yearHolidays,
          );

          // Skip trivial cases where there are no business days or dates are invalid
          if (requestedDays === 0 || newRange.startDate >= newRange.endDate) {
            return;
          }

          const result = validateLeaveRequest(
            userId,
            "annual",
            newRange.startDate,
            newRange.endDate,
            existing,
            holidays,
          );

          if (requestedDays > balance.annualRemaining) {
            // Must be rejected
            expect(result.valid).toBe(false);
            expect(result.remainingBalance).toBe(balance.annualRemaining);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("accepts annual leave when sufficient balance exists", () => {
    fc.assert(
      fc.property(
        userIdArb,
        approvedAnnualRequestsArb("placeholder", YEAR),
        fc.array(publicHolidayArb(YEAR), { minLength: 0, maxLength: 3 }),
        dateRangeArb(YEAR),
        (_userId, existingTemplates, holidays, newRange) => {
          const userId = _userId;
          const existing = existingTemplates.map((r) => ({
            ...r,
            requesterId: userId,
          }));

          const balance = computeLeaveBalance(userId, YEAR, existing, holidays);
          const yearHolidays = holidays.filter((h) => h.year === YEAR);
          const requestedDays = countBusinessDays(
            newRange.startDate,
            newRange.endDate,
            yearHolidays,
          );

          if (
            requestedDays === 0 ||
            newRange.startDate >= newRange.endDate ||
            requestedDays > balance.annualRemaining
          ) {
            return; // Skip cases outside this property's scope
          }

          const result = validateLeaveRequest(
            userId,
            "annual",
            newRange.startDate,
            newRange.endDate,
            existing,
            holidays,
          );

          expect(result.valid).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("remainingBalance = annualAllocated - annualUsed - requestedDays when valid", () => {
    fc.assert(
      fc.property(
        userIdArb,
        approvedAnnualRequestsArb("placeholder", YEAR),
        fc.array(publicHolidayArb(YEAR), { minLength: 0, maxLength: 3 }),
        dateRangeArb(YEAR),
        (_userId, existingTemplates, holidays, newRange) => {
          const userId = _userId;
          const existing = existingTemplates.map((r) => ({
            ...r,
            requesterId: userId,
          }));

          const balance = computeLeaveBalance(userId, YEAR, existing, holidays);
          const yearHolidays = holidays.filter((h) => h.year === YEAR);
          const requestedDays = countBusinessDays(
            newRange.startDate,
            newRange.endDate,
            yearHolidays,
          );

          if (
            requestedDays === 0 ||
            newRange.startDate >= newRange.endDate ||
            requestedDays > balance.annualRemaining
          ) {
            return; // Only test valid submissions
          }

          const result = validateLeaveRequest(
            userId,
            "annual",
            newRange.startDate,
            newRange.endDate,
            existing,
            holidays,
          );

          expect(result.valid).toBe(true);
          expect(result.remainingBalance).toBe(
            ANNUAL_ALLOCATION - balance.annualUsed - requestedDays,
          );
          expect(result.requestedDays).toBe(requestedDays);
        },
      ),
      { numRuns: 200 },
    );
  });
});
