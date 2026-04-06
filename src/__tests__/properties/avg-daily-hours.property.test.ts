import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeAvgDailyHours } from "@/lib/analytics";
import type { AttendanceRecord } from "@/types";

/**
 * Property 17: Average daily hours computation
 *
 * For any user and 4-week window of daily session hours, the computed average
 * daily hours should equal the arithmetic mean of total session hours per day
 * across the window.
 *
 * **Validates: Requirements 9.1**
 */

// --- Helpers ---

function makeAttendanceRecord(
  userId: string,
  date: string,
  totalHours: number,
): AttendanceRecord {
  return {
    userId,
    date,
    loginTime: null,
    logoutTime: null,
    totalHours,
    breakMinutes: 0,
    outputNote: null,
  };
}

function dateStr(dayOffset: number): string {
  const base = new Date(2025, 5, 1); // June 1, 2025
  base.setDate(base.getDate() + dayOffset);
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, "0");
  const d = String(base.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// --- Arbitraries ---

const hoursArb = fc.double({ min: 0, max: 24, noNaN: true, noDefaultInfinity: true });

const recordsArb = fc
  .array(hoursArb, { minLength: 1, maxLength: 28 })
  .map((hoursList) =>
    hoursList.map((h, i) => makeAttendanceRecord("user-1", dateStr(i), h)),
  );

// --- Property Tests ---

describe("Property 17: Average daily hours computation", () => {
  it("result equals sum(totalHours) / count (Req 9.1)", () => {
    fc.assert(
      fc.property(recordsArb, (records) => {
        const result = computeAvgDailyHours(records);
        const expected =
          records.reduce((sum, r) => sum + r.totalHours, 0) / records.length;

        // INVARIANT: average equals arithmetic mean
        expect(result).toBeCloseTo(expected, 10);
      }),
      { numRuns: 300 },
    );
  });

  it("result >= 0 for any non-negative hours (Req 9.1)", () => {
    fc.assert(
      fc.property(recordsArb, (records) => {
        const result = computeAvgDailyHours(records);

        // INVARIANT: average of non-negative values is non-negative
        expect(result).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 300 },
    );
  });

  it("empty records → 0 (Req 9.1)", () => {
    const result = computeAvgDailyHours([]);

    // INVARIANT: no records means zero average
    expect(result).toBe(0);
  });

  it("single record → that record's totalHours (Req 9.1)", () => {
    fc.assert(
      fc.property(hoursArb, (hours) => {
        const records = [makeAttendanceRecord("user-1", dateStr(0), hours)];
        const result = computeAvgDailyHours(records);

        // INVARIANT: average of a single value is that value
        expect(result).toBeCloseTo(hours, 10);
      }),
      { numRuns: 200 },
    );
  });

  it("identical hours → that value as average (Req 9.1)", () => {
    fc.assert(
      fc.property(
        hoursArb,
        fc.integer({ min: 1, max: 28 }),
        (hours, count) => {
          const records = Array.from({ length: count }, (_, i) =>
            makeAttendanceRecord("user-1", dateStr(i), hours),
          );
          const result = computeAvgDailyHours(records);

          // INVARIANT: average of identical values equals that value
          expect(result).toBeCloseTo(hours, 10);
        },
      ),
      { numRuns: 200 },
    );
  });
});
